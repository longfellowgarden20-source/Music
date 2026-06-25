"""
Audio engine — MusicGen generation + pro post-processing.

Everything CPU-bound and memory-conscious (M4 16GB safe):
  - lazy model load, single cached instance
  - generation with seed control for reproducibility
  - melody-conditioned generation (hum/upload a melody -> style transfer)
  - post: normalize, fade in/out, trim silence, loop, speed/pitch
  - analysis: BPM + musical key estimate
  - export: WAV + MP3
"""
from __future__ import annotations
import os
import numpy as np
import torch
import soundfile as sf
from datetime import datetime

def _resolve_out_dir() -> str:
    """Absolute, stable, writable output dir for generated audio + stems.

    Must NOT be cwd-relative: the packaged app runs with cwd inside the .app
    bundle, so a relative "music_output" landed in a throwaway location that the
    API server (which used an absolute repo path) could never find — stems were
    written but never located, giving silent empty DAW tracks.

      - dev (STEMAI_DEV=1): repo-local ./music_output, so it's easy to inspect
      - packaged: ~/Library/Application Support/StemAI/music_output (persistent,
        same root the DB + tracks already live in)
    """
    override = os.environ.get("STEMAI_OUT_DIR", "").strip()
    if override:
        d = os.path.abspath(override)
    elif os.environ.get("STEMAI_DEV") == "1":
        d = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(__file__)), "music_output"))
    else:
        base = os.path.expanduser("~/Library/Application Support/StemAI")
        d = os.path.join(base, "music_output")
    os.makedirs(d, exist_ok=True)
    return d

OUT_DIR = _resolve_out_dir()

def _pick_device() -> str:
    """Prefer Apple GPU (MPS) when available — much faster + lower RAM than CPU.
    Override with MUSIC_STUDIO_DEVICE=cpu to force CPU."""
    forced = os.environ.get("MUSIC_STUDIO_DEVICE", "").strip().lower()
    if forced in ("cpu", "mps"):
        return forced
    try:
        if torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


DEVICE = _pick_device()
# float16 halves model RAM and speeds up MPS; CPU stays float32 (no fp16 speedup there).
DTYPE = torch.float16 if DEVICE == "mps" else torch.float32

# Allow MPS up to 85% of unified memory. 60% was too tight — auto_finish
# (6 sequential generations) OOMs before completing all sections.
if DEVICE == "mps":
    try:
        torch.mps.set_per_process_memory_fraction(0.85)
    except Exception:
        pass

_model = None
_processor = None
_melody_model = None
_melody_processor = None
_current = None

# ── Cancellation (kill switch) ─────────────────────────────────────────────────────
# A cooperative cancel: request_cancel() flips the flag, and the stopping criteria
# below checks it on every decoding step so generation halts mid-token instead of
# running to completion. is_generating() lets the API report whether work is live.
import threading
_cancel = threading.Event()
_generating = threading.Event()


def request_cancel():
    """Ask any in-flight generation to stop as soon as the next token is checked."""
    _cancel.set()


def is_generating() -> bool:
    return _generating.is_set()


def is_cancelled() -> bool:
    return _cancel.is_set()


class _CancelledError(RuntimeError):
    """Raised internally when a generation was cancelled by the kill switch."""


def _stopping_criteria():
    """Build a StoppingCriteriaList that halts generation when cancel is requested.
    Returns None if transformers' StoppingCriteria isn't importable (older versions)."""
    try:
        from transformers import StoppingCriteria, StoppingCriteriaList
    except Exception:
        return None

    class _Cancel(StoppingCriteria):
        def __call__(self, input_ids, scores, **kw):
            return _cancel.is_set()

    return StoppingCriteriaList([_Cancel()])


import contextlib


@contextlib.contextmanager
def generation_session():
    """Bracket a top-level generation. Clears any stale cancel flag, marks work as
    live, and ensures the live flag is cleared even if generation raises."""
    _cancel.clear()
    _generating.set()
    try:
        yield
    finally:
        _generating.clear()
        _cancel.clear()


def _generate_tokens(**kwargs):
    """Wrapper around _model.generate that injects the cancel stopping criteria and
    raises _CancelledError if the run was stopped by the kill switch.

    When the stopping criteria fires mid-stream MusicGen may also raise while trying
    to decode an incomplete token sequence — so if cancel is set we treat ANY error
    from generate as a clean cancellation rather than a real failure."""
    sc = _stopping_criteria()
    if sc is not None:
        kwargs["stopping_criteria"] = sc
    try:
        out = _model.generate(**kwargs)
    except Exception:
        if _cancel.is_set():
            raise _CancelledError("generation cancelled")
        raise
    if _cancel.is_set():
        raise _CancelledError("generation cancelled")
    return out

# ── Safety guardrails (16GB-friendly) ─────────────────────────────────────────────
# Approx peak RAM each model needs while generating (model + activations).
# Tuned a touch optimistic — these run in slightly less once weights are loaded.
MODEL_RAM_GB = {"small": 1.6, "medium": 3.6, "large": 7.5}
# Hard duration caps so a long clip on a big model can't blow memory.
MODEL_MAX_DURATION = {"small": 30, "medium": 30, "large": 15}


def _prep_inputs(inputs):
    """Move processor inputs to DEVICE and cast float tensors (e.g. conditioning
    audio) to the model's dtype so fp16 weights don't hit a float/Half mismatch.
    Integer tensors (token ids, attention masks) are left untouched."""
    inputs = inputs.to(DEVICE)
    if DTYPE != torch.float32:
        for k, v in inputs.items():
            if torch.is_tensor(v) and torch.is_floating_point(v):
                inputs[k] = v.to(DTYPE)
    return inputs


def _force_cpu():
    """Permanently drop to CPU float32 for the rest of the session and drop the
    currently-loaded model so it reloads on CPU."""
    global DEVICE, DTYPE
    DEVICE, DTYPE = "cpu", torch.float32
    free_memory()


def free_ram_gb() -> float:
    try:
        import psutil
        return psutil.virtual_memory().available / 1e9
    except Exception:
        return 99.0  # if psutil missing, don't block


def safety_check(model_size: str, duration: float):
    """Raise a clear error if this generation is likely to crash the machine.
    Returns the (possibly capped) duration."""
    need = MODEL_RAM_GB.get(model_size, 3.0)
    if DTYPE == torch.float16:   # fp16 weights ~halve the footprint
        need *= 0.55
    free = free_ram_gb()
    # if the model isn't loaded yet we need headroom for it; if already loaded, less
    headroom = need if _current != model_size else need * 0.4
    if free < headroom + 1.5:   # 1.5GB OS breathing room (was 0.8 — too tight on Mac)
        # Before hard-failing, try dropping to CPU which shares less with the OS
        if DEVICE == "mps":
            print(f"[engine] low RAM ({free:.1f}GB), falling back to CPU for safety")
            _force_cpu()
            free = free_ram_gb()
            if free < headroom + 1.5:
                raise MemoryError(
                    f"Not enough memory to generate. Close other apps and try again. "
                    f"({free:.1f}GB free, need ~{headroom:.1f}GB)")
        else:
            raise MemoryError(
                f"Not enough memory to generate. Close other apps and try again. "
                f"({free:.1f}GB free, need ~{headroom:.1f}GB)")
    cap = MODEL_MAX_DURATION.get(model_size, 20)
    return min(duration, cap)


def free_memory():
    """Release the loaded model + run GC. Call after heavy work or to switch models."""
    global _model, _processor, _current
    _model = None
    _processor = None
    _current = None
    import gc
    gc.collect()
    try:
        torch.mps.empty_cache()
    except Exception:
        pass


def load_model(size: str = "small"):
    """Standard text->music model (musicgen-small/medium/large)."""
    global _model, _processor, _current, DEVICE, DTYPE
    if _current == size and _model is not None:
        return
    # switching models? free the old one first so we don't hold two in RAM
    if _model is not None and _current != size:
        free_memory()
    from transformers import AutoProcessor, MusicgenForConditionalGeneration
    model_id = f"facebook/musicgen-{size}"
    _processor = AutoProcessor.from_pretrained(model_id)
    try:
        print(f"[engine] loading {model_id} on {DEVICE} ({DTYPE}) ...")
        _model = MusicgenForConditionalGeneration.from_pretrained(
            model_id, torch_dtype=DTYPE).to(DEVICE)
    except Exception as e:
        # MPS / fp16 path failed — fall back to plain CPU float32 so generation still works.
        print(f"[engine] {DEVICE}/{DTYPE} load failed ({e}); falling back to cpu float32")
        DEVICE, DTYPE = "cpu", torch.float32
        _model = MusicgenForConditionalGeneration.from_pretrained(
            model_id, torch_dtype=DTYPE).to(DEVICE)
    _current = size
    print("[engine] model ready")


def _set_seed(seed: int | None) -> int:
    if seed is None or seed < 0:
        seed = int.from_bytes(os.urandom(4), "little")
    torch.manual_seed(seed)
    np.random.seed(seed % (2**32))
    return seed


def _sa3_engine():
    """Return the Stable Audio 3 backend if it's selected+available, else None.
    Used by generate/extend/reference_generate/add_layer/auto_finish so the WHOLE
    app routes through the commercially-licensed engine when STEMAI_ENGINE=stableaudio3."""
    try:
        from . import stableaudio3_engine
    except Exception:
        return None
    return stableaudio3_engine if stableaudio3_engine.is_enabled() else None


def generate(prompt: str, duration: float = 8, model_size: str = "small",
             guidance: float = 3.0, temperature: float = 0.85,
             seed: int | None = None, negative: str = "", steps: int | None = None,
             sampler: str = "pingpong"):
    """Returns (sample_rate, np.float32 audio[mono], used_seed).

    `steps` is the Stable Audio 3 diffusion-step count (quality dial: ~8 fast,
    ~16-25 higher quality). Ignored by the MusicGen path."""
    # Route core text->music to a commercially-licensed backend when selected via
    # STEMAI_ENGINE. Everything else (MusicGen path below) is untouched.
    #   stableaudio3 -> Stable Audio 3 Small (Stability Community License, sellable,
    #                   ~3s on Apple Silicon; runs in isolated sa3_env via subprocess)
    #   acestep      -> ACE-Step (Apache-2.0; kept as an alternative)
    try:
        from . import stableaudio3_engine
    except Exception:
        stableaudio3_engine = None
    if stableaudio3_engine and stableaudio3_engine.is_enabled():
        # `guidance` from the UI maps to SA3's cfg_scale (prompt-faithfulness /
        # variation dial). UI sends ~1-10; SA3 wants ~0.5-2.0, so scale it down.
        cfg = max(0.3, min(2.5, (guidance or 5) / 5.0))
        return stableaudio3_engine.generate(prompt, duration=duration, seed=seed,
                                            steps=(steps or 8), cfg_scale=cfg,
                                            sampler=sampler)

    try:
        from . import acestep_engine
    except Exception:
        acestep_engine = None
    if acestep_engine and acestep_engine.is_enabled():
        return acestep_engine.generate(prompt, duration=duration, seed=seed, guidance=max(1.0, guidance * 2))

    duration = safety_check(model_size, duration)   # caps duration / blocks if low RAM
    load_model(model_size)
    used_seed = _set_seed(seed)

    text = prompt if not negative else f"{prompt}. avoid: {negative}"
    inputs = _processor(text=[text], padding=True, return_tensors="pt").to(DEVICE)
    max_tokens = int(duration * 50)  # ~50 tokens / second

    try:
        with torch.no_grad():
            out = _generate_tokens(
                **inputs,
                max_new_tokens=max_tokens,
                guidance_scale=guidance,
                do_sample=True,
                temperature=float(temperature),
            )
    except _CancelledError:
        raise   # kill switch — never retry, let it propagate
    except Exception as e:
        if DEVICE == "mps":
            print(f"[engine] mps generate failed ({e}); retrying on cpu")
            _force_cpu()
            load_model(model_size)
            inputs = _processor(text=[text], padding=True, return_tensors="pt").to(DEVICE)
            with torch.no_grad():
                out = _generate_tokens(
                    **inputs, max_new_tokens=max_tokens, guidance_scale=guidance,
                    do_sample=True, temperature=float(temperature))
        else:
            raise
    audio = out[0, 0].float().cpu().numpy().astype(np.float32)
    # fp16 sampling can nudge the raw peak past 1.0 — guard against clipping
    # before any downstream use (export normalizes too, but be safe everywhere).
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 1.0:
        audio = audio / peak * 0.99
    sr = _model.config.audio_encoder.sampling_rate
    return sr, audio, used_seed


def variations(prompt: str, n: int = 3, **kw):
    """[#3] Generate N takes of the same prompt with different random seeds.
    Returns list of (sample_rate, audio, seed)."""
    kw.pop("seed", None)
    return [generate(prompt, seed=None, **kw) for _ in range(n)]


def extend(prompt: str, prior_audio: np.ndarray, prior_sr: int,
           add_duration: float = 8, model_size: str = "small",
           guidance: float = 3.0, temperature: float = 0.85,
           seed: int | None = None):
    """[#2] Continue an existing track — generate audio that flows from the
    tail of `prior_audio`, then concatenate. Uses MusicGen audio conditioning
    via the processor's audio input.
    Returns (sample_rate, combined_audio, used_seed)."""
    _sa3 = _sa3_engine()
    if _sa3:
        # Generate a fresh continuation from the prompt and seam it onto the prior
        # audio. (SA3 has no audio-priming, so the new part flows by description,
        # not by literal continuation — but it's all on the sellable engine.)
        sr2, new_part, used = _sa3.generate(prompt or "continue the music",
                                            duration=max(4, add_duration), seed=seed)
        import librosa
        prior = prior_audio if prior_sr == sr2 else librosa.resample(prior_audio, orig_sr=prior_sr, target_sr=sr2)
        return sr2, _seam(prior, new_part, sr2, 0.4), used

    load_model(model_size)
    used_seed = _set_seed(seed)

    target_sr = _model.config.audio_encoder.sampling_rate
    prime = prior_audio
    if prior_sr != target_sr:
        import librosa
        prime = librosa.resample(prior_audio, orig_sr=prior_sr, target_sr=target_sr)
    # condition on the last ~4s for continuity
    tail_sec = 4.0
    tail_len = int(target_sr * tail_sec)
    tail = prime[-tail_len:]

    inputs = _prep_inputs(_processor(
        audio=[tail], sampling_rate=target_sr,
        text=[prompt], padding=True, return_tensors="pt"))
    max_tokens = int(add_duration * 50)
    with torch.no_grad():
        out = _generate_tokens(**inputs, max_new_tokens=max_tokens,
                              guidance_scale=guidance, do_sample=True,
                              temperature=float(temperature))
    new_part = out[0, 0].cpu().numpy().astype(np.float32)

    # MusicGen audio-conditioning PREPENDS the (Encodec-resynthesized) priming
    # tail to its output. If we kept it, every seam would contain the original
    # clean tail immediately followed by a codec-degraded copy of the same 4s —
    # the source of the smeared, muddy, "doubled" transitions in long builds.
    # Drop the primed portion and keep only the genuinely-new audio, then
    # crossfade it onto the clean original with a longer fade for a smooth seam.
    if len(new_part) > tail_len + int(target_sr * 0.5):
        new_part = new_part[tail_len:]
    combined = _seam(prime, new_part, target_sr, 0.4)
    return target_sr, combined, used_seed


# Section "recipes" appended to the base prompt so each part has its own feel,
# while keeping the same persona/instrumentation as the original track.
SECTION_RECIPES = {
    "Intro":  "intro section, stripped back, softer, building up gently, fewer drums",
    "Verse":  "verse section, steady groove, moderate energy, room for vocals",
    "Chorus": "chorus section, fuller and bigger, more energy, catchy and lifted, all elements in",
    "Bridge": "bridge section, switch-up, different feel, breakdown, more atmospheric",
    "Drop":   "drop section, maximum energy, hard-hitting, full drums and bass",
    "Outro":  "outro section, winding down, stripped back, resolving, fading energy",
}

# Default structure for one-click "complete the song" → ~72s arranged track.
AUTO_ARRANGEMENT = [
    ("Verse", 12), ("Chorus", 14), ("Verse", 12),
    ("Bridge", 10), ("Chorus", 14), ("Outro", 10),
]


def auto_finish(prompt: str, prior_audio: np.ndarray, prior_sr: int,
                model_size: str = "small", guidance: float = 3.0,
                arrangement: list[tuple[str, float]] | None = None,
                on_progress=None):
    """One-click: build a short take into a full arranged song that *flows* from
    the original. Each section CONTINUES from the running song (via extend), so it
    grows rather than restarting. Returns (sample_rate, full_audio, roles_list).

    Runs on the GPU (MPS) when available — ~3-4x faster than CPU. The earlier
    6-pass OOM was MPS *caching* transient buffers across passes until it hit the
    memory cap; fix is empty_cache() after each section so peak memory stays flat.
    Per-section CPU fallback if MPS still OOMs, with a finally that restores the
    original device. Input size is bounded (only ever conditions on a 4s tail)."""
    arrangement = arrangement or AUTO_ARRANGEMENT
    base = (prompt or "continue the music").strip()
    full = prior_audio
    sr = prior_sr
    roles = []
    n = len(arrangement)
    orig_device, orig_dtype = DEVICE, DTYPE

    def _drain_cache():
        # Release transient MPS/CUDA allocations between passes WITHOUT unloading
        # the model — this is what keeps peak memory flat across all 6 sections.
        import gc
        gc.collect()
        try:
            if DEVICE == "mps":
                torch.mps.empty_cache()
            elif DEVICE == "cuda":
                torch.cuda.empty_cache()
        except Exception:
            pass

    try:
        for i, (role, dur) in enumerate(arrangement):
            if _cancel.is_set():
                raise _CancelledError("generation cancelled")
            if on_progress:
                on_progress(i, n, role)
            recipe = SECTION_RECIPES.get(role, "")
            sec_prompt = f"{base.rstrip('.')}, {recipe}" if recipe else base
            try:
                sr, full, _ = extend(sec_prompt, full, sr, add_duration=dur,
                                     model_size=model_size, guidance=guidance)
            except RuntimeError as e:
                # If MPS still runs out of memory on this machine, fall back to CPU
                # for the REST of the build rather than failing the whole feature.
                if DEVICE == "mps" and "memory" in str(e).lower():
                    print(f"[engine] auto_finish: MPS OOM on section {i+1}, falling back to CPU")
                    globals()["DEVICE"], globals()["DTYPE"] = "cpu", torch.float32
                    free_memory()
                    sr, full, _ = extend(sec_prompt, full, sr, add_duration=dur,
                                         model_size=model_size, guidance=guidance)
                else:
                    raise
            roles.append(role)
            _drain_cache()

        # Gentler master for the assembled song: it's already 6 passes of
        # codec-processed audio with seams, so a strong tanh drive (default
        # strength 1.0 → drive 2.3) piles harmonic distortion on top and makes
        # it muddy/harsh. Light EQ + glue only.
        full = auto_master(full, sr, strength=0.5)
        _drain_cache()
        return sr, full, roles
    finally:
        # If we fell back to CPU mid-build, restore the original (MPS) device so
        # future generations are fast again.
        if (DEVICE, DTYPE) != (orig_device, orig_dtype):
            globals()["DEVICE"], globals()["DTYPE"] = orig_device, orig_dtype
            free_memory()


def _seam(a: np.ndarray, b: np.ndarray, sr: int, xfade: float) -> np.ndarray:
    n = min(int(sr * xfade), len(a), len(b))
    if n <= 0:
        return np.concatenate([a, b])
    ramp = np.linspace(0, 1, n)
    blend = a[-n:] * (1 - ramp) + b[:n] * ramp
    return np.concatenate([a[:-n], blend, b[n:]])


def stems_mix(layers: list[dict], duration: float = 8, model_size: str = "small",
              guidance: float = 3.0):
    """[#7] Generate several layers (e.g. drums / bass / melody) and mix them
    at per-layer volumes into one track.
    `layers` = [{"prompt": str, "volume": 0..1}, ...]
    Returns (sample_rate, mixed_audio, [seeds], stems) where stems is a list of
    {"name", "audio", "volume"} so the individual layers can be saved & re-mixed."""
    rendered, seeds, sr, stems = [], [], None, []
    for layer in layers:
        if not layer.get("prompt", "").strip():
            continue
        s, a, seed = generate(layer["prompt"], duration=duration,
                              model_size=model_size, guidance=guidance)
        sr = s
        vol = float(layer.get("volume", 1.0))
        rendered.append((a, vol))
        seeds.append(seed)
        stems.append({"name": layer.get("name", layer["prompt"][:20]),
                      "audio": a, "volume": vol})
    if not rendered:
        return None, None, [], []
    length = min(len(a) for a, _ in rendered)
    mix = np.zeros(length, dtype=np.float32)
    for a, vol in rendered:
        mix += a[:length] * vol
    return sr, normalize(mix), seeds, stems


def reference_generate(ref_audio: np.ndarray, ref_sr: int, prompt: str = "",
                       mode: str = "restyle", duration: float = 8,
                       model_size: str = "small", guidance: float = 3.0,
                       temperature: float = 1.0, seed: int | None = None):
    """Take inspiration from a reference song.

    mode='continue' -> generate music that flows out of the reference (keeps it,
                       appends new audio).
    mode='restyle'  -> generate a NEW track that borrows the reference's musical
                       feel but follows `prompt` (returns only the new audio).

    Returns (sample_rate, audio, used_seed).
    Note: this conditions on the reference's *style/vibe*, it does not clone the
    exact beat.
    """
    _sa3 = _sa3_engine()
    if _sa3:
        # SA3 is text->audio (no melody conditioning), so we generate fresh audio
        # from the prompt. For 'continue' we seam it onto the reference; for
        # 'restyle' we return just the new styled audio. Keeps everything on the
        # commercially-licensed engine.
        text = prompt.strip() or "music in the same style as the reference"
        sr2, styled, used = _sa3.generate(text, duration=duration, seed=seed)
        if mode == "continue":
            import librosa
            ref = ref_audio if ref_sr == sr2 else librosa.resample(ref_audio, orig_sr=ref_sr, target_sr=sr2)
            return sr2, _seam(ref, styled, sr2, 0.15), used
        return sr2, styled, used

    load_model(model_size)
    used_seed = _set_seed(seed)
    target_sr = _model.config.audio_encoder.sampling_rate

    ref = ref_audio
    if ref_sr != target_sr:
        import librosa
        ref = librosa.resample(ref_audio, orig_sr=ref_sr, target_sr=target_sr)
    # use up to the last ~6s of the reference as the conditioning prime
    prime = ref[-int(target_sr * 6):]

    text = prompt.strip() or "music in the same style as the reference"
    inputs = _prep_inputs(_processor(audio=[prime], sampling_rate=target_sr,
                        text=[text], padding=True, return_tensors="pt"))
    max_tokens = int(duration * 50)
    with torch.no_grad():
        out = _generate_tokens(**inputs, max_new_tokens=max_tokens,
                              guidance_scale=guidance, do_sample=True,
                              temperature=float(temperature))
    new_part = out[0, 0].cpu().numpy().astype(np.float32)

    if mode == "continue":
        # new_part already includes the prime at its head; seam onto full ref
        prime_len = len(prime)
        tail = new_part[prime_len:] if len(new_part) > prime_len else new_part
        combined = _seam(ref, tail, target_sr, 0.15)
        return target_sr, combined, used_seed
    # restyle: drop the echoed prime, keep only the freshly styled audio
    prime_len = len(prime)
    styled = new_part[prime_len:] if len(new_part) > prime_len else new_part
    return target_sr, styled, used_seed


def add_layer(base_audio: np.ndarray, base_sr: int, instrument_prompt: str,
              blend: str = "smart", volume: float = 0.7,
              model_size: str = "small", guidance: float = 3.0,
              seed: int | None = None):
    """Add a new instrument layer (drums/bass/etc.) on top of an existing track.

    blend='smart'  -> the new layer is conditioned on the base track so it matches
                      the tempo/feel, then mixed under it.
    blend='simple' -> the new layer is generated from the prompt alone, then layered.

    Returns (sample_rate, mixed_audio, used_seed).
    """
    _sa3 = _sa3_engine()
    if _sa3:
        # Generate the new instrument from its prompt on SA3, then mix it under the
        # base track (length-matched). SA3 has no melody conditioning, so 'smart'
        # vs 'simple' both generate from the prompt; tempo/key still come through
        # the prompt text the caller built.
        dur = len(base_audio) / base_sr
        sr2, layer, used = _sa3.generate(instrument_prompt, duration=max(4, dur), seed=seed)
        import librosa
        base = base_audio if base_sr == sr2 else librosa.resample(base_audio, orig_sr=base_sr, target_sr=sr2)
        n = min(len(base), len(layer))
        mix = base[:n] + layer[:n] * float(volume)
        return sr2, normalize(mix), used

    load_model(model_size)
    used_seed = _set_seed(seed)
    target_sr = _model.config.audio_encoder.sampling_rate

    base = base_audio
    if base_sr != target_sr:
        import librosa
        base = librosa.resample(base_audio, orig_sr=base_sr, target_sr=target_sr)

    dur = len(base) / target_sr
    max_tokens = int(dur * 50)

    prime_len = 0
    if blend == "smart":
        prime = base[-int(target_sr * 6):]
        prime_len = len(prime)
        inputs = _prep_inputs(_processor(audio=[prime], sampling_rate=target_sr,
                            text=[instrument_prompt], padding=True,
                            return_tensors="pt"))
    else:
        inputs = _prep_inputs(_processor(text=[instrument_prompt], padding=True,
                            return_tensors="pt"))

    with torch.no_grad():
        out = _generate_tokens(**inputs, max_new_tokens=max_tokens,
                              guidance_scale=guidance, do_sample=True, temperature=0.85)
    layer = out[0, 0].cpu().numpy().astype(np.float32)
    # smart mode echoes the prime at the head — drop it so the layer aligns to t=0
    if prime_len and len(layer) > prime_len:
        layer = layer[prime_len:]

    # match lengths, mix the new layer under the base
    n = min(len(base), len(layer))
    mix = base[:n] + layer[:n] * float(volume)
    return target_sr, normalize(mix), used_seed


# ── Post-processing ──────────────────────────────────────────────────────────────
def normalize(audio: np.ndarray, target_peak: float = 0.97) -> np.ndarray:
    peak = np.max(np.abs(audio)) or 1.0
    return (audio / peak) * target_peak


def _biquad(audio, sr, kind, freq, q=0.707, gain_db=0.0):
    """Minimal RBJ biquad filter (no scipy.signal dependency surprises)."""
    import math
    a0 = audio
    w0 = 2 * math.pi * freq / sr
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    A = 10 ** (gain_db / 40)
    if kind == "highpass":
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
        a0c = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
    elif kind == "highshelf":
        sq = 2 * math.sqrt(A) * alpha
        b0 = A * ((A + 1) + (A - 1) * cw + sq)
        b1 = -2 * A * ((A - 1) + (A + 1) * cw)
        b2 = A * ((A + 1) + (A - 1) * cw - sq)
        a0c = (A + 1) - (A - 1) * cw + sq
        a1 = 2 * ((A - 1) - (A + 1) * cw)
        a2 = (A + 1) - (A - 1) * cw - sq
    elif kind == "peak":
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
        a0c = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
    else:
        return a0
    b = np.array([b0, b1, b2]) / a0c
    a = np.array([1.0, a1 / a0c, a2 / a0c])
    # direct-form filtering
    from scipy.signal import lfilter
    return lfilter(b, a, a0).astype(np.float32)


def screech_guard(audio: np.ndarray, sr: int) -> np.ndarray:
    """Detect and suppress high-frequency artifact screeching from MusicGen.

    MusicGen token sampling at high temperatures can produce spurious tokens
    that decode into brief 6–12kHz bursts. We detect by measuring HF RMS
    in 50ms windows and soft-limit any window that spikes > 4× the median.
    Much gentler than a brickwall filter — musical highs are left untouched.
    """
    from scipy.signal import lfilter
    a = audio.astype(np.float32)

    # rough 5kHz highpass to isolate the screechy band
    try:
        w0 = 2 * 3.14159265 * 5000 / sr
        cw = np.cos(w0); sw = np.sin(w0); alpha = sw / (2 * 0.707)
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
        a0c = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
        b = np.array([b0, b1, b2]) / a0c
        ac = np.array([1.0, a1 / a0c, a2 / a0c])
        hf = lfilter(b, ac, a).astype(np.float32)
    except Exception:
        return a

    win = max(1, int(sr * 0.05))  # 50ms windows
    hf_rms = np.array([np.sqrt(np.mean(hf[i:i+win]**2)) for i in range(0, len(hf), win)])
    if hf_rms.size == 0:
        return a
    median_hf = float(np.median(hf_rms)) + 1e-9
    threshold = max(median_hf * 4.0, 0.08)  # spike must be at least 4× median AND 8% peak

    has_artifact = bool(np.any(hf_rms > threshold))
    if not has_artifact:
        return a

    # Gentle 8kHz lowpass to tame the screech without killing air/brightness
    try:
        w0 = 2 * 3.14159265 * 8000 / sr
        cw = np.cos(w0); sw = np.sin(w0); alpha = sw / (2 * 0.707)
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
        a0c = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
        b = np.array([b0, b1, b2]) / a0c
        ac = np.array([1.0, a1 / a0c, a2 / a0c])
        a = lfilter(b, ac, a).astype(np.float32)
        print("[engine] screech_guard: HF artifact detected and suppressed")
    except Exception as e:
        print(f"[engine] screech_guard lowpass failed: {e}")
    return a


def auto_master(audio: np.ndarray, sr: int, strength: float = 1.0) -> np.ndarray:
    """Make raw model output sound 'produced':
      1. screech guard — suppress MusicGen HF artifacts before any processing
      2. high-pass to remove sub-bass mud/rumble
      3. gentle low-mid cut (clears boxiness)
      4. presence + air boost (clarity, sheen)
      5. soft-knee compression (glue + loudness)
      6. peak normalize
    strength scales the EQ/compression amount (0..1.5).
    """
    a = screech_guard(audio, sr)
    s = float(strength)
    try:
        a = _biquad(a, sr, "highpass", 35)                    # kill rumble
        a = _biquad(a, sr, "peak", 300, q=1.0, gain_db=-2.5 * s)   # de-mud
        a = _biquad(a, sr, "peak", 3000, q=0.9, gain_db=2.0 * s)   # presence
        a = _biquad(a, sr, "highshelf", 8000, gain_db=2.5 * s)     # air
    except Exception as e:
        print(f"[engine] EQ skipped: {e}")
    # soft compression: tanh waveshaper — drive capped at 1.8 to avoid distortion
    drive = min(1.0 + 1.3 * s, 1.8)
    a = np.tanh(a * drive) / np.tanh(drive)
    return normalize(a, 0.97)


def score_take(audio: np.ndarray, sr: int) -> float:
    """Heuristic quality score for 'best of N'. Higher = better.
    Rewards: good dynamic range, fullness, rhythmic energy.
    Penalizes: near-silence, clipping/harshness, dead mono noise.
    """
    a = audio.astype(np.float32)
    if a.size == 0:
        return -1e9
    rms = float(np.sqrt(np.mean(a ** 2)))
    peak = float(np.max(np.abs(a))) or 1e-6
    if rms < 0.01:
        return -100.0                      # basically silent
    crest = peak / (rms + 1e-9)            # dynamic range
    clip_ratio = float(np.mean(np.abs(a) > 0.98))   # harsh clipping
    # spectral energy spread = "fullness" (cheap proxy via diff energy)
    hf = float(np.mean(np.abs(np.diff(a))))
    score = 0.0
    score += min(rms * 10, 4)              # presence, capped
    score += 2.0 if 2 < crest < 12 else -1.0   # healthy dynamics
    score += min(hf * 50, 3)              # brightness/detail
    score -= clip_ratio * 20             # punish clipping
    return score


def best_of(prompt: str, n: int = 3, master: bool = True, **kw):
    """Generate N takes, score them, return the best one mastered.
    Returns (sample_rate, audio, seed, score, all_scores)."""
    kw.pop("seed", None)
    best = None
    scores = []
    for i in range(n):
        sr, a, seed = generate(prompt, seed=None, **kw)
        sc = score_take(a, sr)
        scores.append(round(sc, 2))
        if best is None or sc > best[3]:
            best = (sr, a, seed, sc)
    sr, a, seed, sc = best
    if master:
        a = auto_master(a, sr)
    return sr, a, seed, sc, scores


def fade(audio: np.ndarray, sr: int, fade_in: float = 0.0,
         fade_out: float = 0.0) -> np.ndarray:
    a = audio.copy()
    if fade_in > 0:
        n = min(int(sr * fade_in), len(a))
        a[:n] *= np.linspace(0, 1, n)
    if fade_out > 0:
        n = min(int(sr * fade_out), len(a))
        a[-n:] *= np.linspace(1, 0, n)
    return a


def trim_silence(audio: np.ndarray, thresh: float = 0.01) -> np.ndarray:
    mask = np.abs(audio) > thresh
    if not mask.any():
        return audio
    start = np.argmax(mask)
    end = len(mask) - np.argmax(mask[::-1])
    return audio[start:end]


def make_loop(audio: np.ndarray, sr: int, crossfade: float = 0.25) -> np.ndarray:
    """Crossfade the tail into the head so the clip loops seamlessly."""
    n = min(int(sr * crossfade), len(audio) // 2)
    if n <= 0:
        return audio
    head, tail = audio[:n], audio[-n:]
    ramp = np.linspace(0, 1, n)
    blended = tail * (1 - ramp) + head * ramp
    return np.concatenate([blended, audio[n:-n]]) if len(audio) > 2 * n else audio


def change_speed(audio: np.ndarray, sr: int, factor: float) -> tuple[int, np.ndarray]:
    """Resample-based speed change (also shifts pitch, tape style)."""
    if factor == 1.0:
        return sr, audio
    import librosa
    new = librosa.resample(audio, orig_sr=sr, target_sr=int(sr / factor))
    return sr, new


def pitch_shift(audio: np.ndarray, sr: int, semitones: float) -> np.ndarray:
    if semitones == 0:
        return audio
    import librosa
    return librosa.effects.pitch_shift(audio, sr=sr, n_steps=semitones)


# ── Arrangement / editing ──────────────────────────────────────────────────────────
def trim(audio: np.ndarray, sr: int, start_s: float, end_s: float) -> np.ndarray:
    """Keep only the region between start_s and end_s (seconds)."""
    a, b = int(max(0, start_s) * sr), int(end_s * sr)
    b = min(b, len(audio)) if end_s > 0 else len(audio)
    return audio[a:b] if b > a else audio


def reverse(audio: np.ndarray) -> np.ndarray:
    return audio[::-1].copy()


def time_stretch(audio: np.ndarray, sr: int, rate: float) -> np.ndarray:
    """Change length WITHOUT changing pitch. rate>1 = faster/shorter."""
    if rate == 1.0:
        return audio
    import librosa
    return librosa.effects.time_stretch(audio, rate=rate)


def stitch(clips: list[np.ndarray], sr: int, crossfade: float = 0.1) -> np.ndarray:
    """Join multiple clips into one, crossfading the seams."""
    clips = [c for c in clips if c is not None and len(c)]
    if not clips:
        return np.zeros(0, np.float32)
    out = clips[0].astype(np.float32)
    for c in clips[1:]:
        out = _seam(out, c.astype(np.float32), sr, crossfade)
    return out


def loop_to_length(audio: np.ndarray, sr: int, target_seconds: float,
                   crossfade: float = 0.2) -> np.ndarray:
    """Repeat a clip (seamlessly) until it reaches target length."""
    loop = make_loop(audio, sr, crossfade)
    target = int(target_seconds * sr)
    if len(loop) >= target:
        return loop[:target]
    reps = int(np.ceil(target / len(loop)))
    out = loop
    for _ in range(reps - 1):
        out = _seam(out, loop, sr, crossfade)
    return out[:target]


def crossfade_mix(a: np.ndarray, b: np.ndarray, sr: int, seconds: float = 1.0) -> np.ndarray:
    """DJ-style crossfade transition from clip a into clip b."""
    return _seam(a.astype(np.float32), b.astype(np.float32), sr, seconds)


def region_replace(audio: np.ndarray, sr: int,
                   start_s: float, end_s: float,
                   prompt: str,
                   model_size: str = "small",
                   guidance: float = 4.0,
                   temperature: float = 0.95,
                   xfade: float = 0.25,
                   seed: int | None = None) -> tuple[np.ndarray, int]:
    """Replace the audio between start_s and end_s with freshly generated music.

    When SA3 is active, uses native inpainting: the full track + a time-range mask
    are passed to SA3 so it generates content that blends with the surrounding audio.
    Falls back to the MusicGen prompt-conditioned approach when SA3 is off.

    Returns (new_full_audio, used_seed).
    """
    _sa3 = _sa3_engine()
    if _sa3:
        new_audio, used_seed = _sa3.inpaint_region(
            audio, sr, start_s, end_s, prompt,
            steps=8, cfg_scale=1.0, seed=seed, xfade=xfade)
        return new_audio, used_seed

    duration = end_s - start_s
    if duration <= 0:
        raise ValueError(f"end ({end_s}s) must be after start ({start_s}s)")

    total_s = len(audio) / sr
    start_s = max(0.0, min(start_s, total_s))
    end_s   = max(start_s + 0.5, min(end_s, total_s))
    duration = end_s - start_s

    pre  = audio[:int(start_s * sr)].astype(np.float32)
    post = audio[int(end_s   * sr):].astype(np.float32)

    # Condition on the tail of the pre-region (up to 4 s) so new audio flows
    # naturally from what came before.
    load_model(model_size)
    used_seed = _set_seed(seed)
    target_sr = _model.config.audio_encoder.sampling_rate

    prime = pre
    if sr != target_sr:
        import librosa
        prime = librosa.resample(pre, orig_sr=sr, target_sr=target_sr)
    tail = prime[-int(target_sr * 4):] if len(prime) > 0 else None

    if tail is not None and len(tail) > 0:
        inputs = _prep_inputs(_processor(
            audio=[tail], sampling_rate=target_sr,
            text=[prompt], padding=True, return_tensors="pt"))
    else:
        inputs = _prep_inputs(_processor(
            text=[prompt], padding=True, return_tensors="pt"))

    max_tokens = int(duration * 50)
    with torch.no_grad():
        out = _generate_tokens(**inputs, max_new_tokens=max_tokens,
                              guidance_scale=guidance, do_sample=True,
                              temperature=float(temperature))

    raw = out[0, 0].cpu().numpy().astype(np.float32)
    # Strip the echoed prime from the head of the output
    if tail is not None and len(tail) > 0:
        skip = len(tail)
        new_region = raw[skip:] if len(raw) > skip else raw
    else:
        new_region = raw

    # Resample back to original sr if needed
    if target_sr != sr:
        import librosa
        new_region = librosa.resample(new_region, orig_sr=target_sr, target_sr=sr)
        if len(pre) > 0:
            pre = librosa.resample(pre, orig_sr=sr, target_sr=sr)
        if len(post) > 0:
            post = librosa.resample(post, orig_sr=sr, target_sr=sr)

    # Crossfade at both joints
    if len(pre) > 0 and len(new_region) > 0:
        joined = _seam(pre, new_region, sr, xfade)
    elif len(pre) > 0:
        joined = pre
    else:
        joined = new_region

    if len(post) > 0 and len(joined) > 0:
        result = _seam(joined, post, sr, xfade)
    else:
        result = joined

    return result, used_seed


def region_waveform_png(audio: np.ndarray, sr: int,
                        start_s: float, end_s: float,
                        out_path: str,
                        color: str = "#f472b6",
                        color_region: str = "#fbbf24") -> str:
    """Render a waveform PNG highlighting a selected region in a different color."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    n = 1200
    step = max(1, len(audio) // n)
    samples = audio[::step]
    total = len(audio) / sr
    xs = np.linspace(0, total, len(samples))

    fig, ax = plt.subplots(figsize=(14, 2.4), dpi=100)
    fig.patch.set_alpha(0)
    ax.set_facecolor("none")

    for xi, yi in zip(xs, samples):
        c = color_region if start_s <= xi <= end_s else color
        alpha = 1.0 if start_s <= xi <= end_s else 0.45
        ax.plot([xi, xi], [-abs(yi), abs(yi)], color=c, lw=1.2,
                alpha=alpha, solid_capstyle="round")

    # region box
    ax.axvspan(start_s, end_s, alpha=0.12, color=color_region, zorder=0)
    ax.axvline(start_s, color=color_region, lw=1.5, alpha=0.8)
    ax.axvline(end_s,   color=color_region, lw=1.5, alpha=0.8)

    # time labels
    ax.set_xlim(0, total)
    lim = max(0.05, float(np.max(np.abs(samples))))
    ax.set_ylim(-lim * 1.1, lim * 1.1)
    ax.set_xticks(np.arange(0, total + 1, max(1, int(total / 12))))
    ax.tick_params(colors="#9494b0", labelsize=7)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.tick_params(left=False)
    ax.set_yticks([])

    plt.subplots_adjust(left=0.02, right=0.98, top=0.95, bottom=0.2)
    fig.savefig(out_path, transparent=True, bbox_inches="tight", pad_inches=0.05)
    plt.close(fig)
    return out_path


# ── Stem separation (Demucs) ────────────────────────────────────────────────────────
_demucs = None


def separate_stems(filepath: str, out_dir: str = None) -> dict:
    """Split any song into drums / bass / vocals / other using Demucs.
    Returns {stem_name: wav_path}. CPU — slower (~1-2 min per minute of audio)."""
    global _demucs
    import ssl
    try:
        import certifi
        ssl._create_default_https_context = lambda: ssl.create_default_context(
            cafile=certifi.where())
    except Exception:
        pass
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model

    if _demucs is None:
        print("[engine] loading Demucs (htdemucs_6s) — downloads once …")
        _demucs = get_model("htdemucs_6s")
        _demucs.eval()

    # load with soundfile (avoids torchaudio/torchcodec dependency)
    data, sr = sf.read(filepath, dtype="float32", always_2d=True)  # (frames, ch)
    wav = torch.from_numpy(data.T)                                  # (ch, frames)
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)
    elif wav.shape[0] > 2:
        wav = wav[:2]
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)

    # Demucs needs ~8 GB of GPU memory for a full-length track — more than the
    # M-series shared MPS limit (6.4 GB). Always run on CPU to avoid OOM.
    demucs_device = "cpu"
    print(f"[engine] Demucs running on {demucs_device} (forced; MPS OOMs on long tracks)")
    # Resample to Demucs model rate (44100) if source differs. apply_model
    # resamples internally and outputs at model.samplerate — writing stems back
    # at the original `sr` when sr != model.samplerate stamps wrong header on
    # the file (44100-Hz samples tagged as 32000 Hz), making every stem play
    # ~37% too fast and cut off early in the DAW.
    demucs_sr = _demucs.samplerate
    if sr != demucs_sr:
        try:
            import librosa
            resampled = librosa.resample(data.T, orig_sr=sr, target_sr=demucs_sr)
            wav = torch.from_numpy(resampled)
        except Exception:
            pass  # fall through with original wav; slight pitch-shift but won't truncate
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        elif wav.shape[0] > 2:
            wav = wav[:2]
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)

    with torch.no_grad():
        sources = apply_model(_demucs, wav[None], device=demucs_device,
                              progress=True)[0]
    sources = sources * ref.std() + ref.mean()

    # htdemucs_6s produces: drums, bass, guitar, piano, other, vocals
    # Return all 6 as separate stems — the DAW handles dynamic track counts.
    names = _demucs.sources
    out_dir = out_dir or OUT_DIR
    base = os.path.splitext(os.path.basename(filepath))[0]

    out = {}
    for name, src in zip(names, sources):
        mono = src.mean(0).cpu().numpy().astype(np.float32)
        path = os.path.join(out_dir, f"{base}_{name}.wav")
        sf.write(path, mono, demucs_sr)  # always write at Demucs output rate (44100)
        out[name] = path
    return out


# ── Analysis ────────────────────────────────────────────────────────────────────
_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def analyze(audio: np.ndarray, sr: int) -> dict:
    """Best-effort BPM + key estimate."""
    try:
        import librosa
        tempo, _ = librosa.beat.beat_track(y=audio, sr=sr)
        tempo = float(np.atleast_1d(tempo)[0])
        chroma = librosa.feature.chroma_cqt(y=audio, sr=sr)
        key_idx = int(np.argmax(chroma.mean(axis=1)))
        return {"bpm": round(tempo, 1), "key": _KEYS[key_idx]}
    except Exception as e:
        print(f"[engine] analyze failed: {e}")
        return {"bpm": None, "key": None}


# ── Export ──────────────────────────────────────────────────────────────────────
def save_wav(audio: np.ndarray, sr: int, prompt: str, target_dir: str | None = None) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "" for ch in prompt)[:40]
    safe = safe.strip().replace(" ", "_") or "track"
    d = target_dir if target_dir else OUT_DIR
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, f"{ts}_{safe}.wav")
    sf.write(path, audio, sr)
    return path


def export_mp3(wav_path: str, bitrate: str = "320k") -> str | None:
    """Convert a WAV to MP3 via pydub/ffmpeg. Returns mp3 path or None."""
    try:
        from pydub import AudioSegment
        mp3_path = os.path.splitext(wav_path)[0] + ".mp3"
        AudioSegment.from_wav(wav_path).export(mp3_path, format="mp3", bitrate=bitrate)
        return mp3_path
    except Exception as e:
        print(f"[engine] mp3 export failed (need ffmpeg): {e}")
        return None


# ── Waveform image [#1] ──────────────────────────────────────────────────────────
def waveform_png(audio: np.ndarray, sr: int, out_path: str,
                 color: str = "#8b5cff", color2: str = "#22d3ee") -> str:
    """Render a clean gradient waveform PNG (transparent bg) for the player/library."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection

    # downsample to ~1200 points for a crisp, light render
    n = 1200
    step = max(1, len(audio) // n)
    samples = audio[::step]
    x = np.linspace(0, 1, len(samples))

    fig, ax = plt.subplots(figsize=(12, 2.2), dpi=100)
    fig.patch.set_alpha(0)
    ax.set_facecolor("none")

    # mirror bars for a modern waveform look
    for i, (xi, yi) in enumerate(zip(x, samples)):
        c = color if i % 2 == 0 else color2
        ax.plot([xi, xi], [-abs(yi), abs(yi)], color=c, lw=1.1, alpha=.9, solid_capstyle="round")
    ax.set_xlim(0, 1)
    lim = max(0.05, float(np.max(np.abs(samples))))
    ax.set_ylim(-lim * 1.1, lim * 1.1)
    ax.axis("off")
    plt.subplots_adjust(left=0, right=1, top=1, bottom=0)
    fig.savefig(out_path, transparent=True, bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    return out_path


# ── Cover art [#5] ──────────────────────────────────────────────────────────────
def cover_art(prompt: str, out_path: str, bpm=None, key=None,
              palette: tuple[str, str] = ("#8b5cff", "#22d3ee")) -> str:
    """Generate a 1000x1000 album cover: gradient + abstract waveform rings +
    the prompt as a title. No external API — pure Pillow."""
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    import math, random

    S = 1000
    c1 = tuple(int(palette[0][i:i+2], 16) for i in (1, 3, 5))
    c2 = tuple(int(palette[1][i:i+2], 16) for i in (1, 3, 5))

    img = Image.new("RGB", (S, S))
    px = img.load()
    # diagonal gradient
    for y in range(S):
        for x in range(0, S, 2):
            t = ((x + y) / (2 * S))
            col = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
            px[x, y] = col
            if x + 1 < S:
                px[x + 1, y] = col
    # darken for contrast
    overlay = Image.new("RGB", (S, S), (8, 8, 16))
    img = Image.blend(img, overlay, 0.45)

    draw = ImageDraw.Draw(img, "RGBA")
    rng = random.Random(hash(prompt) & 0xffffff)
    # concentric audio rings
    cx, cy = S // 2, int(S * 0.42)
    for r in range(60, 360, 14):
        pts = []
        for a in range(0, 361, 6):
            rad = math.radians(a)
            jitter = rng.uniform(-10, 18)
            rr = r + jitter
            pts.append((cx + rr * math.cos(rad), cy + rr * math.sin(rad)))
        draw.line(pts, fill=(255, 255, 255, 28), width=2)
    # central glow dot
    for rr, al in [(46, 60), (30, 110), (16, 200)]:
        draw.ellipse([cx-rr, cy-rr, cx+rr, cy+rr], fill=(255, 255, 255, al))

    # title text
    def font(sz):
        for p in ["/System/Library/Fonts/Helvetica.ttc",
                  "/System/Library/Fonts/Supplemental/Arial Bold.ttf"]:
            try:
                return ImageFont.truetype(p, sz)
            except Exception:
                continue
        return ImageFont.load_default()

    title = prompt.strip()[:42]
    f_big = font(58); f_small = font(30)
    # wrap title to 2 lines
    words = title.split()
    lines, cur = [], ""
    for w in words:
        if len(cur + " " + w) <= 20:
            cur = (cur + " " + w).strip()
        else:
            lines.append(cur); cur = w
    lines.append(cur)
    lines = lines[:2]
    ty = int(S * 0.72)
    for ln in lines:
        draw.text((60, ty), ln.upper(), font=f_big, fill=(255, 255, 255, 255))
        ty += 64
    sub = "  ·  ".join(filter(None, [f"{bpm:.0f} BPM" if bpm else None,
                                     f"KEY {key}" if key else None, "AI MUSIC STUDIO"]))
    draw.text((62, ty + 10), sub, font=f_small, fill=(230, 230, 245, 210))

    img.save(out_path, quality=92)
    return out_path

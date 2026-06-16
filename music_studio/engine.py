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

OUT_DIR = "music_output"
os.makedirs(OUT_DIR, exist_ok=True)

DEVICE = "cpu"   # MPS crashes on 16GB unified memory with these models

_model = None
_processor = None
_melody_model = None
_melody_processor = None
_current = None


def load_model(size: str = "small"):
    """Standard text->music model (musicgen-small/medium/large)."""
    global _model, _processor, _current
    if _current == size and _model is not None:
        return
    from transformers import AutoProcessor, MusicgenForConditionalGeneration
    model_id = f"facebook/musicgen-{size}"
    print(f"[engine] loading {model_id} on {DEVICE} ...")
    _processor = AutoProcessor.from_pretrained(model_id)
    _model = MusicgenForConditionalGeneration.from_pretrained(model_id).to(DEVICE)
    _current = size
    print("[engine] model ready")


def _set_seed(seed: int | None) -> int:
    if seed is None or seed < 0:
        seed = int.from_bytes(os.urandom(4), "little")
    torch.manual_seed(seed)
    np.random.seed(seed % (2**32))
    return seed


def generate(prompt: str, duration: float = 8, model_size: str = "small",
             guidance: float = 3.0, temperature: float = 1.0,
             seed: int | None = None, negative: str = ""):
    """Returns (sample_rate, np.float32 audio[mono], used_seed)."""
    load_model(model_size)
    used_seed = _set_seed(seed)

    text = prompt if not negative else f"{prompt}. avoid: {negative}"
    inputs = _processor(text=[text], padding=True, return_tensors="pt").to(DEVICE)
    max_tokens = int(duration * 50)  # ~50 tokens / second

    with torch.no_grad():
        out = _model.generate(
            **inputs,
            max_new_tokens=max_tokens,
            guidance_scale=guidance,
            do_sample=True,
            temperature=float(temperature),
        )
    audio = out[0, 0].cpu().numpy().astype(np.float32)
    sr = _model.config.audio_encoder.sampling_rate
    return sr, audio, used_seed


def variations(prompt: str, n: int = 3, **kw):
    """[#3] Generate N takes of the same prompt with different random seeds.
    Returns list of (sample_rate, audio, seed)."""
    kw.pop("seed", None)
    return [generate(prompt, seed=None, **kw) for _ in range(n)]


def extend(prompt: str, prior_audio: np.ndarray, prior_sr: int,
           add_duration: float = 8, model_size: str = "small",
           guidance: float = 3.0, temperature: float = 1.0,
           seed: int | None = None):
    """[#2] Continue an existing track — generate audio that flows from the
    tail of `prior_audio`, then concatenate. Uses MusicGen audio conditioning
    via the processor's audio input.
    Returns (sample_rate, combined_audio, used_seed)."""
    load_model(model_size)
    used_seed = _set_seed(seed)

    target_sr = _model.config.audio_encoder.sampling_rate
    prime = prior_audio
    if prior_sr != target_sr:
        import librosa
        prime = librosa.resample(prior_audio, orig_sr=prior_sr, target_sr=target_sr)
    # condition on the last ~4s for continuity
    tail = prime[-int(target_sr * 4):]

    inputs = _processor(
        audio=[tail], sampling_rate=target_sr,
        text=[prompt], padding=True, return_tensors="pt").to(DEVICE)
    max_tokens = int(add_duration * 50)
    with torch.no_grad():
        out = _model.generate(**inputs, max_new_tokens=max_tokens,
                              guidance_scale=guidance, do_sample=True,
                              temperature=float(temperature))
    new_part = out[0, 0].cpu().numpy().astype(np.float32)
    # crossfade the seam so it sounds continuous
    combined = _seam(prime, new_part, target_sr, 0.15)
    return target_sr, combined, used_seed


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
    Returns (sample_rate, mixed_audio, [seeds])."""
    rendered, seeds, sr = [], [], None
    for layer in layers:
        if not layer.get("prompt", "").strip():
            continue
        s, a, seed = generate(layer["prompt"], duration=duration,
                              model_size=model_size, guidance=guidance)
        sr = s
        rendered.append((a, float(layer.get("volume", 1.0))))
        seeds.append(seed)
    if not rendered:
        return None, None, []
    length = min(len(a) for a, _ in rendered)
    mix = np.zeros(length, dtype=np.float32)
    for a, vol in rendered:
        mix += a[:length] * vol
    return sr, normalize(mix), seeds


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
    inputs = _processor(audio=[prime], sampling_rate=target_sr,
                        text=[text], padding=True, return_tensors="pt").to(DEVICE)
    max_tokens = int(duration * 50)
    with torch.no_grad():
        out = _model.generate(**inputs, max_new_tokens=max_tokens,
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
        inputs = _processor(audio=[prime], sampling_rate=target_sr,
                            text=[instrument_prompt], padding=True,
                            return_tensors="pt").to(DEVICE)
    else:
        inputs = _processor(text=[instrument_prompt], padding=True,
                            return_tensors="pt").to(DEVICE)

    with torch.no_grad():
        out = _model.generate(**inputs, max_new_tokens=max_tokens,
                              guidance_scale=guidance, do_sample=True, temperature=1.0)
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
def save_wav(audio: np.ndarray, sr: int, prompt: str) -> str:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
    safe = "".join(ch if ch.isalnum() or ch in " -_" else "" for ch in prompt)[:40]
    safe = safe.strip().replace(" ", "_") or "track"
    path = os.path.join(OUT_DIR, f"{ts}_{safe}.wav")
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

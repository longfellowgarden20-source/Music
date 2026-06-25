"""
Stable Audio 3 backend bridge.

Why this exists: Stable Audio 3 Small is commercially licensable (Stability AI
Community License — sellable under $1M revenue), runs in ~3s on Apple Silicon,
and is bundleable. It replaces MusicGen's non-commercial limitation. But it needs
its own torch build, so it lives in the isolated sa3_env and we call it via a
subprocess worker (sa3_worker.py).

Enable with env var:  STEMAI_ENGINE=stableaudio3
Mirrors engine.generate()'s contract: returns (sample_rate, np.float32 mono, seed).
If sa3_env or the model is missing, this raises and engine.py falls back.

Attribution required when shipping: "Powered by Stability AI" + bundle the
Stability AI Community License and the Gemma Terms NOTICE (T5Gemma text encoder).
"""
from __future__ import annotations
import os
import json
import tempfile
import subprocess
import numpy as np
import soundfile as sf

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SA3_PYTHON = os.path.join(_ROOT, "sa3_env", "bin", "python3")


def is_enabled() -> bool:
    return os.environ.get("STEMAI_ENGINE", "").lower() in ("stableaudio3", "sa3", "stable-audio-3")


def available() -> bool:
    """True if the isolated sa3_env exists (so the UI can show status)."""
    return os.path.exists(_SA3_PYTHON)


def generate(prompt: str, duration: float = 30, seed: int | None = None,
             steps: int = 8, cfg_scale: float = 1.0, sampler: str = "pingpong"):
    """Returns (sample_rate, np.float32 mono, used_seed) — matches engine.generate().

    cfg_scale: how strictly the model follows the prompt. Higher = more literal/
    consistent between takes; lower = looser, more variation. ~1.0 default.
    sampler: "pingpong" or "euler" (the only two the rf denoiser supports)."""
    if not available():
        raise RuntimeError("Stable Audio 3 environment (sa3_env) not found.")

    used_seed = seed if (seed is not None and seed >= 0) else int.from_bytes(os.urandom(4), "little")

    out_dir = tempfile.mkdtemp(prefix="sa3_")
    out_path = os.path.join(out_dir, "out.wav")
    params = {
        "prompt": prompt,
        "duration": float(max(4, min(duration, 180))),
        "steps": int(steps),
        "cfg_scale": float(cfg_scale),
        "sampler": str(sampler),
        "seed": int(used_seed),
        "out_path": out_path,
    }

    env = dict(os.environ)
    env.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    proc = subprocess.run(
        [_SA3_PYTHON, "-m", "music_studio.sa3_worker", json.dumps(params)],
        cwd=_ROOT, env=env, capture_output=True, text=True, timeout=600,
    )
    last = (proc.stdout or "").strip().splitlines()[-1] if proc.stdout.strip() else ""
    if not last.startswith("OK") or not os.path.exists(out_path):
        raise RuntimeError(f"Stable Audio 3 generation failed: {last or proc.stderr[-300:]}")

    audio, sr = sf.read(out_path, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1).astype(np.float32)   # app pipeline expects mono float32
    try:
        import shutil
        shutil.rmtree(out_dir, ignore_errors=True)
    except Exception:
        pass
    return sr, mono, used_seed


def inpaint_region(audio: np.ndarray, sr: int,
                   start_s: float, end_s: float,
                   prompt: str,
                   steps: int = 8, cfg_scale: float = 1.0,
                   seed: int | None = None,
                   xfade: float = 0.25) -> tuple[np.ndarray, int]:
    """Replace audio[start_s:end_s] using SA3's native inpainting mask.

    The whole original track is passed as `inpaint_audio` so SA3 can blend
    the regenerated region with the surrounding content. Returns (new_full_audio, used_seed).
    xfade: crossfade seconds at each joint to hide seams (0 = hard cut).
    """
    if not available():
        raise RuntimeError("Stable Audio 3 environment (sa3_env) not found.")

    used_seed = seed if (seed is not None and seed >= 0) else int.from_bytes(os.urandom(4), "little")

    # Write the source audio to a temp WAV so the worker can load it
    src_dir = tempfile.mkdtemp(prefix="sa3_inp_")
    src_path = os.path.join(src_dir, "source.wav")
    out_path = os.path.join(src_dir, "out.wav")

    # Ensure stereo for SA3 (it expects [channels, samples])
    if audio.ndim == 1:
        stereo = np.stack([audio, audio], axis=-1)
    else:
        stereo = audio
    sf.write(src_path, stereo, sr)

    total_s = len(audio) / sr
    params = {
        "prompt": prompt,
        "duration": float(total_s),
        "steps": int(steps),
        "cfg_scale": float(cfg_scale),
        "seed": int(used_seed),
        "out_path": out_path,
        # inpaint fields
        "inpaint_audio_path": src_path,
        "inpaint_start": float(max(0.0, start_s)),
        "inpaint_end": float(min(end_s, total_s)),
        "xfade": float(xfade),
    }

    env = dict(os.environ)
    env.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    proc = subprocess.run(
        [_SA3_PYTHON, "-m", "music_studio.sa3_worker", json.dumps(params)],
        cwd=_ROOT, env=env, capture_output=True, text=True, timeout=600,
    )
    last = (proc.stdout or "").strip().splitlines()[-1] if proc.stdout.strip() else ""
    if not last.startswith("OK") or not os.path.exists(out_path):
        raise RuntimeError(f"SA3 inpaint failed: {last or proc.stderr[-300:]}")

    result_audio, result_sr = sf.read(out_path, dtype="float32", always_2d=True)
    mono = result_audio.mean(axis=1).astype(np.float32)
    try:
        import shutil
        shutil.rmtree(src_dir, ignore_errors=True)
    except Exception:
        pass
    return mono, used_seed

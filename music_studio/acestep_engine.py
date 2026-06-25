"""
ACE-Step backend — SPIKE / proof-of-concept.

Why this exists: facebook/musicgen-* weights are CC-BY-NC (non-commercial), which
blocks selling the app. ACE-Step is Apache-2.0 (commercial use allowed). This
module is an isolated, flag-gated text->music path so we can prove ACE-Step loads
and the quality is acceptable BEFORE porting the whole engine (restyle, add-layer,
melody) off MusicGen.

Enable with env var:  STEMAI_ENGINE=acestep
Install (one-time):    pip install git+https://github.com/ace-step/ACE-Step.git

Nothing here touches engine.py's MusicGen path — if ACE-Step isn't installed or the
flag is off, the app behaves exactly as before.
"""
from __future__ import annotations
import os
import tempfile
import numpy as np
import soundfile as sf

_pipe = None


def is_enabled() -> bool:
    return os.environ.get("STEMAI_ENGINE", "").lower() == "acestep"


def available() -> bool:
    """True if the ACE-Step package is importable (so the UI can show status)."""
    try:
        import acestep.pipeline_ace_step  # noqa: F401
        return True
    except Exception:
        return False


def _device_dtype():
    try:
        import torch
        if torch.backends.mps.is_available():
            return "mps", "float16"   # MPS doesn't support bfloat16
        if torch.cuda.is_available():
            return "cuda", "bfloat16"
    except Exception:
        pass
    return "cpu", "float32"


def _load():
    global _pipe
    if _pipe is not None:
        return _pipe
    from acestep.pipeline_ace_step import ACEStepPipeline
    device, dtype = _device_dtype()
    # cpu_offload moves the multi-GB transformer CPU<->device on EVERY diffusion
    # step. On Apple Silicon (unified memory, RAM == VRAM) that buys nothing and
    # costs everything — it was the cause of the 88-270s/step we saw. Only enable
    # offload as a last resort on a discrete-GPU box that's actually VRAM-starved.
    # overlapped_decode pipelines the VAE decode to cut tail latency.
    _pipe = ACEStepPipeline(
        dtype=dtype,
        cpu_offload=False,
        overlapped_decode=True,
        persistent_storage_path=os.path.join(
            os.path.expanduser("~"), ".cache", "stemai-acestep"),
    )
    return _pipe


def generate(prompt: str, duration: float = 8, seed: int | None = None,
             guidance: float = 7.0, steps: int = 60):
    """Mirror engine.generate()'s contract: returns (sample_rate, np.float32 mono, used_seed).

    ACE-Step writes a wav; we read it back and conform it to the app's expected shape
    so the rest of the pipeline (DAW, mixdown, library) is unchanged.
    """
    pipe = _load()
    used_seed = seed if (seed is not None and seed >= 0) else int.from_bytes(os.urandom(4), "little")

    out_dir = tempfile.mkdtemp(prefix="acestep_")
    save_path = os.path.join(out_dir, "out.wav")
    pipe(
        format="wav",
        audio_duration=float(max(4, duration)),
        prompt=prompt,
        lyrics="",                      # instrumental for now (matches MusicGen path)
        infer_step=int(steps),
        guidance_scale=float(guidance),
        manual_seeds=[int(used_seed)],
        save_path=save_path,
        task="text2music",
    )

    audio, sr = sf.read(save_path, dtype="float32", always_2d=True)
    mono = audio.mean(axis=1).astype(np.float32)   # app pipeline expects mono float32
    try:
        import shutil; shutil.rmtree(out_dir, ignore_errors=True)
    except Exception:
        pass
    return sr, mono, used_seed

"""
Pro effects rack — powered by Spotify's pedalboard (studio-grade DSP).

Every function takes (audio: float32 mono, sr) and returns processed float32.
Used by the Effects tab so any track can be mixed/mastered like a real DAW.
"""
from __future__ import annotations
import numpy as np
from pedalboard import (
    Pedalboard, Reverb, Delay, Compressor, Limiter, Gain,
    HighpassFilter, LowpassFilter, PeakFilter, HighShelfFilter, LowShelfFilter,
    Chorus, Distortion, Phaser, Bitcrush,
)


def _run(board: Pedalboard, audio: np.ndarray, sr: int) -> np.ndarray:
    out = board(audio.astype(np.float32), sr)
    return out.astype(np.float32)


# ── Individual effects ────────────────────────────────────────────────────────────
def eq(audio, sr, low_gain=0.0, mid_gain=0.0, high_gain=0.0,
       low_freq=120, mid_freq=1000, high_freq=8000):
    """3-band EQ (low shelf / mid peak / high shelf), gains in dB."""
    board = Pedalboard([
        LowShelfFilter(cutoff_frequency_hz=low_freq, gain_db=low_gain),
        PeakFilter(cutoff_frequency_hz=mid_freq, gain_db=mid_gain, q=1.0),
        HighShelfFilter(cutoff_frequency_hz=high_freq, gain_db=high_gain),
    ])
    return _run(board, audio, sr)


def reverb(audio, sr, amount=0.3, room=0.5):
    board = Pedalboard([Reverb(room_size=room, wet_level=amount,
                               dry_level=1.0 - amount * 0.5)])
    return _run(board, audio, sr)


def delay(audio, sr, seconds=0.25, feedback=0.3, mix=0.3):
    board = Pedalboard([Delay(delay_seconds=seconds, feedback=feedback, mix=mix)])
    return _run(board, audio, sr)


def compressor(audio, sr, threshold_db=-18, ratio=4, attack_ms=5, release_ms=120):
    board = Pedalboard([Compressor(threshold_db=threshold_db, ratio=ratio,
                                   attack_ms=attack_ms, release_ms=release_ms)])
    return _run(board, audio, sr)


def limiter(audio, sr, threshold_db=-1.0, release_ms=100):
    board = Pedalboard([Limiter(threshold_db=threshold_db, release_ms=release_ms)])
    return _run(board, audio, sr)


def saturation(audio, sr, drive_db=8):
    """Warm analog-style drive."""
    board = Pedalboard([Distortion(drive_db=drive_db)])
    return _run(board, audio, sr)


def chorus(audio, sr, rate_hz=1.0, depth=0.25, mix=0.4):
    board = Pedalboard([Chorus(rate_hz=rate_hz, depth=depth, mix=mix)])
    return _run(board, audio, sr)


def phaser(audio, sr, rate_hz=0.5, depth=0.5, mix=0.4):
    board = Pedalboard([Phaser(rate_hz=rate_hz, depth=depth, mix=mix)])
    return _run(board, audio, sr)


def bitcrush(audio, sr, bits=8):
    """Lo-fi crush for that crunchy/retro sound."""
    board = Pedalboard([Bitcrush(bit_depth=bits)])
    return _run(board, audio, sr)


def telephone(audio, sr):
    """Band-limited 'telephone/radio' effect."""
    board = Pedalboard([HighpassFilter(800), LowpassFilter(3000)])
    return _run(board, audio, sr)


# ── Stereo widener (manual — pedalboard is mono-in here) ───────────────────────────
def stereo_widen(audio, sr, width=1.5):
    """Turn mono into a wide stereo signal via Haas + mid/side widening.
    Returns a (N, 2) stereo array."""
    a = audio.astype(np.float32)
    # small delay on one channel = width (Haas effect)
    d = int(sr * 0.012)
    left = a
    right = np.concatenate([np.zeros(d, np.float32), a])[:len(a)]
    # mid/side widen
    mid = (left + right) / 2
    side = (left - right) / 2 * width
    L = mid + side
    R = mid - side
    stereo = np.stack([L, R], axis=1)
    peak = np.max(np.abs(stereo)) or 1.0
    return (stereo / peak * 0.97).astype(np.float32)


# ── Streaming master (loudness target) ─────────────────────────────────────────────
def streaming_master(audio, sr, target_lufs=-14.0):
    """Master chain aimed at streaming loudness (-14 LUFS ~ Spotify/YT)."""
    board = Pedalboard([
        HighpassFilter(30),
        Compressor(threshold_db=-16, ratio=2.5, attack_ms=10, release_ms=150),
        HighShelfFilter(cutoff_frequency_hz=8000, gain_db=1.5),
        Limiter(threshold_db=-1.0, release_ms=120),
    ])
    out = _run(board, audio, sr)
    return measure_and_gain(out, sr, target_lufs)


# ── Loudness measurement (simple LUFS-ish) ─────────────────────────────────────────
def measure_lufs(audio, sr) -> float:
    """Approximate integrated loudness (LUFS). Good enough for guidance."""
    a = audio.astype(np.float64)
    if a.size == 0:
        return -70.0
    # K-weighting approximation: high-pass + RMS in dB
    from scipy.signal import butter, sosfilt
    sos = butter(2, 100, "hp", fs=sr, output="sos")
    filtered = sosfilt(sos, a)
    rms = np.sqrt(np.mean(filtered ** 2)) or 1e-9
    return float(-0.691 + 20 * np.log10(rms))


def measure_and_gain(audio, sr, target_lufs=-14.0) -> np.ndarray:
    cur = measure_lufs(audio, sr)
    gain_db = target_lufs - cur
    gain_db = max(min(gain_db, 12), -12)   # clamp
    g = 10 ** (gain_db / 20)
    out = audio * g
    peak = np.max(np.abs(out)) or 1.0
    if peak > 0.99:
        out = out / peak * 0.99
    return out.astype(np.float32)


# ── Effect registry for the UI ──────────────────────────────────────────────────────
# name -> (function, {param: (min, max, default)})
EFFECTS = {
    "EQ (3-band)": (eq, {"low_gain": (-12, 12, 0), "mid_gain": (-12, 12, 0),
                         "high_gain": (-12, 12, 0)}),
    "Reverb": (reverb, {"amount": (0, 1, 0.3), "room": (0, 1, 0.5)}),
    "Delay / Echo": (delay, {"seconds": (0.05, 1.0, 0.25),
                             "feedback": (0, 0.9, 0.3), "mix": (0, 1, 0.3)}),
    "Compressor": (compressor, {"threshold_db": (-40, 0, -18), "ratio": (1, 12, 4)}),
    "Limiter": (limiter, {"threshold_db": (-12, 0, -1)}),
    "Saturation / Warmth": (saturation, {"drive_db": (0, 24, 8)}),
    "Chorus": (chorus, {"rate_hz": (0.1, 5, 1.0), "depth": (0, 1, 0.25),
                        "mix": (0, 1, 0.4)}),
    "Phaser": (phaser, {"rate_hz": (0.1, 3, 0.5), "depth": (0, 1, 0.5),
                        "mix": (0, 1, 0.4)}),
    "Bitcrush (lo-fi)": (bitcrush, {"bits": (2, 16, 8)}),
    "Telephone / Radio": (telephone, {}),
    "Streaming Master": (streaming_master, {"target_lufs": (-20, -8, -14)}),
}

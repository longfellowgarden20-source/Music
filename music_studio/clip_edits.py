"""
Non-destructive clip editing for the DAW.

The DAW sends a per-track *edit stack*: an ordered list of operations against the
individual stems (delete a region of vocals, duplicate a drum hit, fade, gain, etc.).
Nothing is baked until the user hits Render — then `render_stack()` applies the whole
stack on top of the freshly-loaded stems and mixes them into one track.

The stack is persisted server-side (so the user has a real history that survives a
reload) via `history.py`. Undo/redo just moves a pointer within the saved stack.

Each op is a dict:
  {"op": "delete",   "stem": "vocals", "start": 4.0, "end": 8.0}
  {"op": "silence",  "stem": "vocals", "start": 4.0, "end": 8.0}      # same as delete-in-place
  {"op": "duplicate","stem": "drums",  "start": 0.0, "end": 2.0, "at": 8.0}
  {"op": "gain",     "stem": "bass",   "start": 0.0, "end": 0.0, "db": 3.0}   # 0/0 = whole stem
  {"op": "fade",     "stem": "vocals", "start": 4.0, "end": 6.0, "shape": "in"|"out"}
  {"op": "reverse",  "stem": "other",  "start": 2.0, "end": 4.0}
  {"op": "move",     "stem": "drums",  "start": 0.0, "end": 2.0, "at": 10.0}  # cut + paste
  {"op": "ramp",     "stem": "bass",   "start": 0.0, "end": 8.0, "from_db": -60, "to_db": 0}
"""
from __future__ import annotations
import numpy as np


def _idx(t: float, sr: int, n: int) -> int:
    return max(0, min(int(round(t * sr)), n))


def _db_to_lin(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def _ramp(n: int, start_lin: float, end_lin: float) -> np.ndarray:
    if n <= 0:
        return np.zeros(0, dtype=np.float32)
    return np.linspace(start_lin, end_lin, n, dtype=np.float32)


def apply_op(audio: np.ndarray, sr: int, op: dict) -> np.ndarray:
    """Apply one operation to a mono stem array; returns the new array.
    Length may change (delete/duplicate/move). Out-of-range times are clamped."""
    a = audio.astype(np.float32, copy=True)
    n = len(a)
    kind = op.get("op")
    s = _idx(float(op.get("start", 0.0)), sr, n)
    e = float(op.get("end", 0.0))
    e = n if e <= 0 else _idx(e, sr, n)
    if e < s:
        s, e = e, s

    if kind in ("delete", "cut-region"):
        # remove the region entirely (timeline shrinks)
        return np.concatenate([a[:s], a[e:]])

    if kind in ("silence", "mute-region"):
        # zero the region in place (timeline length unchanged)
        a[s:e] = 0.0
        return a

    if kind == "gain":
        lin = _db_to_lin(float(op.get("db", 0.0)))
        if e <= s:                      # 0/0 → whole stem
            return a * lin
        a[s:e] = a[s:e] * lin
        return a

    if kind == "ramp":
        # linear volume automation across the region (e.g. fade-style swell)
        lo = _db_to_lin(float(op.get("from_db", -60.0)))
        hi = _db_to_lin(float(op.get("to_db", 0.0)))
        if e <= s:
            return a
        a[s:e] = a[s:e] * _ramp(e - s, lo, hi)
        return a

    if kind == "fade":
        if e <= s:
            return a
        shape = op.get("shape", "in")
        env = _ramp(e - s, 0.0, 1.0) if shape == "in" else _ramp(e - s, 1.0, 0.0)
        a[s:e] = a[s:e] * env
        return a

    if kind == "reverse":
        if e <= s:
            return a
        a[s:e] = a[s:e][::-1]
        return a

    if kind == "duplicate":
        # copy [s:e] and insert it at `at` (defaults to right after the region)
        seg = a[s:e].copy()
        at = op.get("at")
        at_i = _idx(float(at), sr, len(a)) if at is not None else e
        return np.concatenate([a[:at_i], seg, a[at_i:]])

    if kind == "move":
        # cut [s:e] out, then insert it at `at`
        seg = a[s:e].copy()
        rest = np.concatenate([a[:s], a[e:]])
        at = op.get("at", 0.0)
        at_i = _idx(float(at), sr, len(rest))
        return np.concatenate([rest[:at_i], seg, rest[at_i:]])

    if kind == "insert-silence":
        # open a gap of `dur` seconds at `start`
        dur = int(round(float(op.get("dur", 0.0)) * sr))
        if dur <= 0:
            return a
        return np.concatenate([a[:s], np.zeros(dur, np.float32), a[s:]])

    # unknown op → no-op (forward-compatible)
    return a


def apply_stem_ops(audio: np.ndarray, sr: int, ops: list[dict]) -> np.ndarray:
    """Apply an ordered list of ops to one stem."""
    a = audio
    for op in ops:
        a = apply_op(a, sr, op)
    return a

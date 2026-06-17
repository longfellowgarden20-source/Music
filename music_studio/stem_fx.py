"""
Server-side bake of the DAW's live WebAudio effects rack.

The DAW monitors each stem through a per-stem chain that mirrors WebAudio nodes:

    pan  →  3-band EQ  →  compressor  →  (dry + reverb-send + delay-send)

and sums every stem into a master bus with a brick-wall limiter. While you're
editing, that all runs live in the browser. When you Render/Mixdown, we re-create
the exact same chain here with `pedalboard` so the file you export *sounds like
what you heard* — EQ, compression, reverb tails, delay echoes, pan and the master
limiter are all baked in, not just dry stems with volume.

Parameter mapping is kept byte-for-byte in sync with `applyFxToNodes` / `ensureCtx`
in daw/app/studio/[id]/DAWStudio.tsx — if you change a number there, change it here.

`fx` is the StemFx dict the UI persists:
    {eqLow, eqMid, eqHigh: dB -12..+12,  comp, reverb, delay: 0..1 sends}
"""
from __future__ import annotations
import numpy as np

try:
    from pedalboard import (Pedalboard, LowShelfFilter, PeakFilter, HighShelfFilter,
                            Compressor, Reverb, Delay, Gain)
    _HAVE_PB = True
except Exception:                       # pragma: no cover - env without pedalboard
    _HAVE_PB = False

FX_KEYS = ("eqLow", "eqMid", "eqHigh", "comp", "reverb", "delay")


def fx_is_active(fx: dict | None) -> bool:
    """True if this stem's rack does anything (so we can skip the work when flat)."""
    if not fx:
        return False
    return any(abs(float(fx.get(k, 0.0))) > 1e-4 for k in FX_KEYS)


def auto_is_active(auto: dict | None) -> bool:
    """True if this stem has any drawn volume/pan automation breakpoints."""
    if not auto:
        return False
    return bool(auto.get("vol")) or bool(auto.get("pan"))


def any_fx_active(mixer: dict | None) -> bool:
    if not mixer:
        return False
    for cfg in mixer.values():
        if isinstance(cfg, dict):
            if fx_is_active(cfg.get("fx")):
                return True
            if abs(float(cfg.get("pan", 0.0))) > 1e-4:
                return True
            if auto_is_active(cfg.get("auto")):
                return True
    return False


def _envelope(points: list, n: int, sr: int, fallback: float) -> np.ndarray:
    """Sample-accurate piecewise-linear curve over n samples. Mirrors autoValueAt."""
    if not points:
        return np.full(n, fallback, dtype=np.float32)
    pts = sorted(points, key=lambda p: float(p.get("t", 0.0)))
    ts = np.array([float(p.get("t", 0.0)) * sr for p in pts], dtype=np.float64)
    vs = np.array([float(p.get("v", fallback)) for p in pts], dtype=np.float64)
    x = np.arange(n, dtype=np.float64)
    # np.interp holds the endpoints flat outside the range — exactly the UI behaviour
    return np.interp(x, ts, vs).astype(np.float32)


def _eq_comp_board(fx: dict) -> "Pedalboard":
    """Per-stem EQ + compressor, matching the WebAudio nodes."""
    plugins = []
    low, mid, high = float(fx.get("eqLow", 0)), float(fx.get("eqMid", 0)), float(fx.get("eqHigh", 0))
    if abs(low) > 1e-4:
        plugins.append(LowShelfFilter(cutoff_frequency_hz=120, gain_db=low))
    if abs(mid) > 1e-4:
        plugins.append(PeakFilter(cutoff_frequency_hz=1000, gain_db=mid, q=1.0))
    if abs(high) > 1e-4:
        plugins.append(HighShelfFilter(cutoff_frequency_hz=6000, gain_db=high))
    comp = float(fx.get("comp", 0))
    if comp > 1e-4:
        # mirror DynamicsCompressorNode: threshold -40*comp dB, ratio 1+comp*11
        plugins.append(Compressor(threshold_db=-40.0 * comp,
                                  ratio=1.0 + comp * 11.0,
                                  attack_ms=3.0, release_ms=250.0))
    return Pedalboard(plugins)


def _pan_stereo(mono: np.ndarray, pan: float) -> np.ndarray:
    """Constant-power pan of a mono signal to (n, 2). pan in -1..+1."""
    pan = max(-1.0, min(1.0, pan))
    ang = (pan + 1.0) * 0.25 * np.pi          # 0..pi/2
    l, r = np.cos(ang), np.sin(ang)
    return np.stack([mono * l, mono * r], axis=-1).astype(np.float32)


def render_mix(stems: dict[str, np.ndarray], sr: int, mixer: dict | None,
               *, limiter: bool = True) -> np.ndarray:
    """Bake the full per-stem FX rack + pan and a master limiter, return stereo (n,2).

    `stems` values are mono float32 arrays (already have edit-stack ops applied).
    `mixer[name]` = {vol, mute, pan, fx:{...}, auto:{vol:[{t,v}], pan:[{t,v}]}}.
    When `auto.vol`/`auto.pan` have breakpoints they override the static knob with
    a sample-accurate piecewise-linear envelope. Missing → dry, centered, unity.
    Falls back to a plain mono sum if pedalboard isn't available.
    """
    mixer = mixer or {}
    names = list(stems.keys())
    if not names:
        return np.zeros((1, 2), dtype=np.float32)

    length = max(len(a) for a in stems.values())

    # shared reverb / delay return buses, summed across all sends (matches the
    # browser's shared bus topology rather than per-stem instances)
    rev_bus = np.zeros((length, 2), dtype=np.float32)
    del_bus = np.zeros((length, 2), dtype=np.float32)
    dry_mix = np.zeros((length, 2), dtype=np.float32)

    used = False
    for name in names:
        cfg = mixer.get(name, {}) if isinstance(mixer.get(name), dict) else {}
        if cfg.get("mute"):
            continue
        used = True
        vol = float(cfg.get("vol", 1.0))
        pan = float(cfg.get("pan", 0.0))
        fx = cfg.get("fx") or {}
        auto = cfg.get("auto") or {}

        a = stems[name].astype(np.float32, copy=False)
        if len(a) < length:
            a = np.concatenate([a, np.zeros(length - len(a), np.float32)])

        # EQ + compression (mono), then volume — automation envelope overrides the
        # static fader/pan knob when the user has drawn breakpoints (mirrors the
        # browser, where scheduleAuto schedules the AudioParam instead of the knob).
        if _HAVE_PB and fx_is_active(fx):
            board = _eq_comp_board(fx)
            if len(board) > 0:
                a = board(a, sr)

        if auto.get("vol"):
            a = a * _envelope(auto["vol"], length, sr, vol)
        else:
            a = a * vol

        if auto.get("pan"):
            pan_env = np.clip(_envelope(auto["pan"], length, sr, pan), -1.0, 1.0)
            ang = (pan_env + 1.0) * 0.25 * np.pi       # 0..pi/2, constant-power
            st = np.stack([a * np.cos(ang), a * np.sin(ang)], axis=-1).astype(np.float32)
        else:
            st = _pan_stereo(a, pan)                   # → (n,2)
        dry_mix += st

        rev = float(fx.get("reverb", 0.0))
        dly = float(fx.get("delay", 0.0))
        if rev > 1e-4:
            rev_bus += st * rev
        if dly > 1e-4:
            del_bus += st * dly

    if not used:
        return np.zeros((length, 2), dtype=np.float32)

    mix = dry_mix
    if _HAVE_PB and np.any(rev_bus):
        # convolution-style hall ~2.2s tail to match makeImpulse(2.2, 2.5)
        verb = Pedalboard([Reverb(room_size=0.6, damping=0.4, wet_level=1.0, dry_level=0.0)])
        wet = verb(rev_bus.T, sr).T if rev_bus.ndim == 2 else verb(rev_bus, sr)
        mix = mix + wet[:length]
    if _HAVE_PB and np.any(del_bus):
        # 0.33s delay, 0.35 feedback — matches the browser delay bus
        ech = Pedalboard([Delay(delay_seconds=0.33, feedback=0.35, mix=1.0)])
        wet = ech(del_bus.T, sr).T if del_bus.ndim == 2 else ech(del_bus, sr)
        mix = mix + wet[:length]

    # master limiter: brick-wall at ~-3dB (mirror the WebAudio limiter intent)
    if limiter and _HAVE_PB:
        lim = Pedalboard([Compressor(threshold_db=-3.0, ratio=20.0,
                                     attack_ms=2.0, release_ms=150.0)])
        mix = lim(mix.T, sr).T

    return mix.astype(np.float32)

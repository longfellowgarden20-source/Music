"""
YouTube → strip → revamp pipeline.

Flow:
  1. download(url)          — yt-dlp → WAV in library.AUDIO_DIR
  2. strip_vocals(track_id) — Demucs separate, mute vocals, bake instrumental
  3. revamp(track_id, cfg)  — apply FX rack + optional AI re-generation on each stem
"""
from __future__ import annotations
import os
import re
import tempfile
import numpy as np
import soundfile as sf

from . import library, engine, stem_fx


def _out_dir() -> str:
    """Always write alongside the real library — survives packaging and moves."""
    return library.AUDIO_DIR


# ─── 1. Download ────────────────────────────────────────────────────────────

def download(url: str) -> dict:
    """Download a YouTube (or any yt-dlp-supported) URL as a WAV.

    Returns a library track dict (same shape as /api/track/{id}).
    """
    import yt_dlp

    out = _out_dir()
    os.makedirs(out, exist_ok=True)
    tmp = tempfile.mktemp(suffix=".%(ext)s", dir=out)

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": tmp,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "wav",
        }],
        "quiet": True,
        "no_warnings": True,
    }

    info: dict = {}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=True)

    wav_path = tmp.replace("%(ext)s", "wav")
    if not os.path.exists(wav_path):
        # yt-dlp may use the video id as the filename stem
        base = os.path.splitext(tmp)[0]
        wav_path = base + ".wav"
    if not os.path.exists(wav_path):
        raise FileNotFoundError(f"yt-dlp finished but WAV not found at {wav_path}")

    title = _clean(info.get("title") or info.get("id") or "YouTube import")
    artist = _clean(info.get("uploader") or info.get("channel") or "")
    full_title = f"{artist} — {title}" if artist else title
    duration = float(info.get("duration") or 0)

    import soundfile as sf
    audio, sr = sf.read(wav_path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)

    meta = engine.analyze(np.ascontiguousarray(audio), sr)

    track_id = library.add_track(
        filepath=wav_path,
        prompt=url,
        model="youtube",
        title=full_title,
        collection="YouTube",
        duration=duration or len(audio) / sr,
        bpm=meta.get("bpm"),
        musical_key=meta.get("key"),
    )
    return library.get_track(track_id)


# ─── 2. Strip vocals → instrumental ─────────────────────────────────────────

def strip_vocals(track_id: int, *, out_dir: str | None = None) -> dict:
    """Run Demucs on a track, mute vocals, bake the instrumental.

    Returns {instrumental_id, stems, stem_paths}.
    """
    t = library.get_track(track_id)
    if not t:
        raise ValueError(f"Track {track_id} not found")

    out = out_dir or os.path.join(_out_dir(), f"stems_{track_id}")
    os.makedirs(out, exist_ok=True)

    # reuse engine's Demucs separation
    stem_paths = engine.separate_stems(t["filepath"], out_dir=out)
    # stem_paths = {drums, bass, other, vocals}

    stems: dict[str, np.ndarray] = {}
    sr_out = 32000
    for name, path in stem_paths.items():
        if name == "vocals":
            continue                         # skip — this is the strip
        audio, sr_out = sf.read(path, dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        stems[name] = audio

    # flat mix (no FX) — just sum the non-vocal stems at equal volume
    length = max(len(a) for a in stems.values())
    mix = np.zeros(length, dtype=np.float32)
    for a in stems.values():
        padded = np.concatenate([a, np.zeros(length - len(a), np.float32)]) if len(a) < length else a
        mix += padded

    peak = float(np.abs(mix).max())
    if peak > 1e-6:
        mix = mix / peak * 0.92

    title = (t.get("title") or t.get("prompt") or f"Track #{track_id}")
    instr_title = f"{title} (instrumental)"

    instr_path = os.path.join(_out_dir(), f"instrumental_{track_id}.wav")
    sf.write(instr_path, mix, sr_out)

    meta = engine.analyze(np.ascontiguousarray(mix), sr_out)
    instr_id = library.add_version(
        track_id,
        "instrumental",
        filepath=instr_path,
        prompt=f"Instrumental of track {track_id}",
        model="demucs",
        title=instr_title,
        collection="Instrumental",
        duration=len(mix) / sr_out,
        bpm=meta.get("bpm"),
        musical_key=meta.get("key"),
    )
    return {
        "instrumental_id": instr_id,
        "source_id": track_id,
        "stems": list(stems.keys()),
        "stem_paths": stem_paths,
        "track": library.get_track(instr_id),
    }


# ─── 3. Revamp — apply FX touch to all stems then re-bake ───────────────────

def revamp(track_id: int, mixer: dict | None = None) -> dict:
    """Apply a FX/automation config to the stems of an already-separated track,
    bake them into a new version. `mixer` mirrors the DAW mixer config shape:
    {stem: {vol, pan, mute, fx:{eqLow,eqMid,eqHigh,comp,reverb,delay}, auto:{...}}}.

    If mixer is None, a sensible default (light compression + reverb glue) is applied.
    """
    t = library.get_track(track_id)
    if not t:
        raise ValueError(f"Track {track_id} not found")

    stem_dir = os.path.join(_out_dir(), f"stems_{track_id}")
    if not os.path.exists(stem_dir):
        raise ValueError(f"Stems not split for track {track_id} — run strip_vocals first")

    stems: dict[str, np.ndarray] = {}
    sr_out = 32000
    for fname in os.listdir(stem_dir):
        if not fname.endswith(".wav"):
            continue
        # filenames are like "{base}_{stemname}.wav"
        stem_name = fname.rsplit("_", 1)[-1].replace(".wav", "")
        if stem_name == "vocals":
            continue
        audio, sr_out = sf.read(os.path.join(stem_dir, fname), dtype="float32")
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        stems[stem_name] = audio

    if not stems:
        raise ValueError("No non-vocal stems found")

    if mixer is None:
        mixer = _default_mixer(list(stems.keys()))

    mix = stem_fx.render_mix(stems, sr_out, mixer, limiter=True)

    title = (t.get("title") or t.get("prompt") or f"Track #{track_id}")
    revamp_title = f"{title} (revamped)"

    revamp_path = os.path.join(_out_dir(), f"revamp_{track_id}.wav")
    sf.write(revamp_path, mix, sr_out)

    mono = mix.mean(axis=1) if mix.ndim > 1 else mix
    meta = engine.analyze(np.ascontiguousarray(mono), sr_out)
    revamp_id = library.add_version(
        track_id,
        "revamp",
        filepath=revamp_path,
        prompt=f"Revamp of track {track_id}",
        model="revamp",
        title=revamp_title,
        collection="Revamped",
        duration=len(mono) / sr_out,
        bpm=meta.get("bpm"),
        musical_key=meta.get("key"),
    )
    return {
        "revamp_id": revamp_id,
        "source_id": track_id,
        "fx_baked": True,
        "track": library.get_track(revamp_id),
    }


# ─── helpers ────────────────────────────────────────────────────────────────

def _clean(s: str) -> str:
    return re.sub(r'[^\w\s\-—]', '', s).strip()[:80]


def _default_mixer(stem_names: list[str]) -> dict:
    """Light default that makes stems gel: gentle compression + reverb glue."""
    out = {}
    for name in stem_names:
        fx = {"eqLow": 0.0, "eqMid": 0.0, "eqHigh": 0.0,
              "comp": 0.0, "reverb": 0.0, "delay": 0.0}
        if name == "drums":
            fx["comp"] = 0.35         # punch up the drums
            fx["eqLow"] = 2.0         # add low-end weight
        elif name == "bass":
            fx["eqLow"] = 1.5
            fx["comp"] = 0.3
        elif name == "other":
            fx["reverb"] = 0.18       # space/air on the melody/harmony
            fx["eqHigh"] = 1.5
        out[name] = {"vol": 1.0, "pan": 0.0, "mute": False,
                     "fx": fx, "auto": {"vol": [], "pan": []}}
    return out

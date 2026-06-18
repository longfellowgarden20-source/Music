"""
FastAPI server — full backend for the Next.js Music Studio frontend.
Runs on port 8765. Wraps everything the Gradio app does.

Track / data:
  GET  /api/tracks                 → all tracks (search/collection/sort/favorites)
  GET  /api/track/{id}             → single track metadata
  GET  /api/track/{id}/versions    → version history
  GET  /api/audio/{id}             → stream the WAV
  GET  /api/cover/{id}             → cover art PNG
  GET  /api/waveform/{id}          → waveform peaks JSON
  GET  /api/collections            → list collections
  GET  /api/stats                  → library stats

Library management:
  POST /api/track/{id}/rename      → {title}
  POST /api/track/{id}/rate        → {rating}
  POST /api/track/{id}/favorite    → toggle
  POST /api/track/{id}/notes       → {notes}
  POST /api/track/{id}/collection  → {collection}
  POST /api/track/{id}/duplicate   → new id
  DELETE /api/track/{id}           → delete

Generation:
  POST /api/generate               → make a new track
  POST /api/track/{id}/tweak       → natural-language regenerate (new version)
  POST /api/track/{id}/extend      → continue the track
  POST /api/track/{id}/complete    → build into a full arranged song
  POST /api/sounds-like            → {text} → prompt suggestion

Editing:
  GET  /api/effects                → effect catalog with params
  POST /api/track/{id}/effect      → apply an effect
  POST /api/track/{id}/pitch       → pitch shift
  POST /api/track/{id}/speed       → speed change
  POST /api/track/{id}/fade        → fade in/out
  POST /api/track/{id}/normalize   → normalize
  POST /api/track/{id}/preset      → bass-boost / lofi / stream-master
  POST /api/track/{id}/arrange     → trim / reverse / stretch / loop
  POST /api/track/{id}/region      → replace a time region

Stems (DAW):
  GET  /api/stems/{id}             → stem info
  POST /api/stems/{id}/split       → run Demucs
  GET  /api/stem-audio/{id}/{stem} → stream a stem
  GET  /api/waveform-stem/{id}/{stem}
  GET  /api/transients/{id}/{stem} → clip rectangles
"""
from __future__ import annotations
import os
import numpy as np
import asyncio
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

try:
    from dotenv import load_dotenv as _lde
    # Load .env.local from the repo root (dev) or user home dir (packaged app)
    for _p in [".env.local", os.path.join(os.path.expanduser("~"), ".stemai.env")]:
        if os.path.exists(_p):
            _lde(_p, override=False)
            break
except Exception:
    pass

try:
    from . import library, engine, effects, history, clip_edits, project, stem_fx, youtube, vocals, licensing
except ImportError:
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from music_studio import library, engine, effects, history, clip_edits, project, stem_fx, youtube, vocals, licensing

app = FastAPI(title="Music Studio API")

# The engine only ever serves the local machine (dev browser on localhost, or
# the packaged Electron renderer loading from file://, whose Origin is "null").
# Allow any localhost port plus the file:// origin; nothing else can reach it.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|null|file://.*)$",
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── helpers ─────────────────────────────────────────────────────────────────
def _track_json(t: dict) -> dict:
    return {
        "id":         t["id"],
        "title":      t["title"] or t["prompt"] or f"Track #{t['id']}",
        "prompt":     t["prompt"] or "",
        "model":      t["model"] or "",
        "duration":   t["duration"] or 0,
        "bpm":        t["bpm"],
        "key":        t["musical_key"],
        "rating":     t["rating"] or 0,
        "favorite":   bool(t["favorite"]),
        "tags":       t["tags"] or "",
        "notes":      t.get("notes") or "",
        "collection": t["collection"] or "All Tracks",
        "created_at": t["created_at"],
        "filepath":   t["filepath"],
        "cover_path": t.get("cover_path") or "",
        "stems_json": t.get("stems_json") or "",
        "project_id": t.get("project_id") or t["id"],
        "version":    t.get("version") or 1,
        "edit_label": t.get("edit_label") or "",
        "has_audio":  bool(t["filepath"] and os.path.exists(t["filepath"])),
        "has_cover":  bool(t.get("cover_path") and os.path.exists(t.get("cover_path") or "")),
    }


def _require(track_id: int) -> dict:
    t = library.get_track(track_id)
    if not t:
        raise HTTPException(404, "Track not found")
    return t


def _load_arr(track_id: int):
    """Return (sr, mono_audio, track) for a track, raising if missing."""
    import soundfile as sf
    t = _require(track_id)
    if not t["filepath"] or not os.path.exists(t["filepath"]):
        raise HTTPException(404, "Audio file not found")
    audio, sr = sf.read(t["filepath"], dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return sr, audio, t


def _save_version(audio, sr, t, edit_label, title=None, collection=None):
    """Save processed audio as a new version of track t's project (with art).
    Accepts mono (n,) or stereo (n,2); analysis always runs on a mono downmix."""
    audio = engine.normalize(audio)
    mono = audio.mean(axis=1) if getattr(audio, "ndim", 1) > 1 else audio
    an = engine.analyze(np.ascontiguousarray(mono), sr)
    path = engine.save_wav(audio, sr, (title or t["title"] or t["prompt"] or "edit")[:60])
    base = os.path.splitext(path)[0]
    cv = ""
    try:
        cv = engine.cover_art((t["prompt"] or t["title"] or "track"),
                              base + "_cover.png", bpm=an["bpm"], key=an["key"]) or ""
    except Exception:
        pass
    import soundfile as sf
    info = sf.info(path)
    new_id = library.add_version(
        int(t["id"]), edit_label,
        title=(title or t["title"] or "edit"),
        prompt=(t["prompt"] or ""),
        duration=info.frames / info.samplerate,
        model=(t["model"] or "edit"), guidance=0, seed=0,
        filepath=path, sample_rate=info.samplerate,
        cover_path=cv, bpm=an["bpm"], musical_key=an["key"],
        collection=(collection or t.get("collection") or "Edited"))
    return new_id


# ── tracks / data ────────────────────────────────────────────────────────────
@app.get("/api/tracks")
def get_tracks(search: str = "", collection: str = "", sort: str = "newest",
               favorites: bool = False):
    rows = library.list_tracks(search=search, collection=collection,
                               sort=sort, favorites_only=favorites)
    return [_track_json(t) for t in rows]


@app.get("/api/track/{track_id}")
def get_track(track_id: int):
    return _track_json(_require(track_id))


@app.get("/api/track/{track_id}/versions")
def get_versions(track_id: int):
    t = _require(track_id)
    rows = library.list_versions(t.get("project_id") or track_id)
    return [_track_json(r) for r in rows]


@app.get("/api/audio/{track_id}")
def get_audio(track_id: int):
    t = _require(track_id)
    if not t["filepath"] or not os.path.exists(t["filepath"]):
        raise HTTPException(404, "Audio file not found")
    return FileResponse(t["filepath"], media_type="audio/wav",
                        headers={"Accept-Ranges": "bytes"})


@app.get("/api/cover/{track_id}")
def get_cover(track_id: int):
    t = _require(track_id)
    cp = t.get("cover_path")
    if not cp or not os.path.exists(cp):
        raise HTTPException(404, "No cover")
    return FileResponse(cp, media_type="image/png")


@app.get("/api/waveform/{track_id}")
def get_waveform(track_id: int, points: int = 1800):
    sr, audio, t = _load_arr(track_id)
    return _peaks(audio, sr, points, track_id=track_id)


def _peaks(audio, sr, points, **extra):
    step = max(1, len(audio) // points)
    peaks = []
    for i in range(0, len(audio) - step, step):
        peaks.append(float(np.max(np.abs(audio[i:i+step]))))
    mx = max(peaks) if peaks else 1.0
    out = {"peaks": [p / mx for p in peaks], "duration": len(audio) / sr, "sr": sr}
    out.update(extra)
    return out


@app.get("/api/collections")
def get_collections():
    return library.list_collections()


@app.get("/api/stats")
def get_stats():
    return library.stats()


# ── library management ────────────────────────────────────────────────────────
class RenameBody(BaseModel):    title: str
class RateBody(BaseModel):      rating: int
class NotesBody(BaseModel):     notes: str
class CollectionBody(BaseModel): collection: str


@app.post("/api/track/{track_id}/rename")
def rename(track_id: int, body: RenameBody):
    _require(track_id)
    library.update_track(track_id, title=body.title.strip()[:80])
    return {"ok": True}


@app.post("/api/track/{track_id}/rate")
def rate(track_id: int, body: RateBody):
    _require(track_id)
    library.update_track(track_id, rating=max(0, min(5, body.rating)))
    return {"ok": True}


@app.post("/api/track/{track_id}/favorite")
def favorite(track_id: int):
    t = _require(track_id)
    new = 0 if t["favorite"] else 1
    library.update_track(track_id, favorite=new)
    return {"ok": True, "favorite": bool(new)}


@app.post("/api/track/{track_id}/notes")
def save_notes(track_id: int, body: NotesBody):
    _require(track_id)
    library.update_track(track_id, notes=body.notes.strip())
    return {"ok": True}


@app.get("/api/track/{track_id}/ai-notes")
def ai_notes(track_id: int):
    """Run Groq producer analysis on a track and return suggestions."""
    t = _require(track_id)
    from .groq_helper import track_notes, available
    if not available():
        return {"error": "Groq API key not configured."}
    return track_notes(
        prompt=t.get("prompt") or "",
        bpm=t.get("bpm"),
        key=t.get("musical_key"),
        duration=t.get("duration"),
    )


@app.post("/api/track/{track_id}/share")
def share_track(track_id: int):
    """Upload the track audio to 0x0.st from the backend (no browser CSP restrictions)
    and return the public URL."""
    import httpx
    t = _require(track_id)
    path = t.get("filepath", "")
    if not path or not os.path.exists(path):
        raise HTTPException(404, "Audio file not found")
    try:
        with open(path, "rb") as f:
            data = f.read()
        title = (t.get("title") or t.get("prompt") or "track")[:60]
        fname = title.replace("/", "_").replace("\\", "_") + ".wav"
        r = httpx.post("https://catbox.moe/user/api.php",
            data={"reqtype": "fileupload", "userhash": ""},
            files={"fileToUpload": (fname, data, "audio/wav")}, timeout=120)
        r.raise_for_status()
        url = r.text.strip()
        if not url.startswith("http"):
            raise ValueError(f"Unexpected response: {url}")
        return {"url": url}
    except Exception as e:
        raise HTTPException(502, f"Upload failed: {e}")


@app.post("/api/track/{track_id}/collection")
def set_collection(track_id: int, body: CollectionBody):
    _require(track_id)
    library.update_track(track_id, collection=body.collection.strip() or "All Tracks")
    return {"ok": True}


@app.post("/api/track/{track_id}/duplicate")
def duplicate(track_id: int):
    _require(track_id)
    new_id = library.duplicate_track(track_id)
    return {"ok": True, "id": new_id}


@app.delete("/api/track/{track_id}")
def delete(track_id: int):
    _require(track_id)
    library.delete_track(track_id)
    return {"ok": True}


# ── kill switch ───────────────────────────────────────────────────────────────
@app.post("/api/cancel")
def cancel_generation():
    """Kill switch: stop any in-flight generation as soon as the next token is
    checked. Safe to call even when nothing is running."""
    was_running = engine.is_generating()
    engine.request_cancel()
    return {"ok": True, "was_running": was_running}


@app.get("/api/status")
def gen_status():
    """Is a generation currently running? Used by the UI to show the Stop button."""
    return {"generating": engine.is_generating()}


# ── licensing ───────────────────────────────────────────────────────────────
# When STEMAI_REQUIRE_LICENSE is unset/0 (dev), the gate is open so we can work
# without a key. In the packaged build the launcher sets it to 1.
_LICENSE_REQUIRED = os.environ.get("STEMAI_REQUIRE_LICENSE", "0") == "1"


def require_license():
    """Block expensive/paid actions until the app is activated."""
    if _LICENSE_REQUIRED and not licensing.is_activated():
        raise HTTPException(402, "StemAI is not activated. Enter your license key to unlock.")


class ActivateBody(BaseModel):
    key: str


@app.get("/api/license")
def license_status():
    """UI calls this on launch to decide whether to show the activation screen."""
    info = licensing.activation_info()
    return {
        "required": _LICENSE_REQUIRED,
        "activated": licensing.is_activated(),
        "email": (info or {}).get("email", ""),
    }


@app.post("/api/license/activate")
def license_activate(body: ActivateBody):
    try:
        info = licensing.activate(body.key)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"activated": True, "email": info.get("email", "")}


@app.post("/api/license/deactivate")
def license_deactivate():
    licensing.deactivate()
    return {"activated": False}


# ── generation ────────────────────────────────────────────────────────────────
class GenerateBody(BaseModel):
    prompt: str
    negative: str = ""
    duration: float = 12
    model_size: str = "small"
    guidance: float = 3.0
    temperature: float = 1.0
    seed: Optional[int] = None
    master: bool = True
    collection: str = "All Tracks"
    title: str = ""


@app.post("/api/generate")
def generate(body: GenerateBody):
    require_license()
    if not body.prompt.strip():
        raise HTTPException(400, "Enter a prompt")
    try:
        with engine.generation_session():
            sr, audio, used_seed = engine.generate(
                prompt=body.prompt, negative=body.negative, duration=body.duration,
                model_size=body.model_size, guidance=body.guidance,
                temperature=body.temperature, seed=body.seed)
    except engine._CancelledError:
        raise HTTPException(499, "Generation cancelled")
    except MemoryError as e:
        raise HTTPException(507, str(e))
    except Exception as e:
        raise HTTPException(500, f"Generation failed: {e}")

    if body.master:
        audio = engine.auto_master(audio, sr)
    else:
        audio = engine.normalize(audio)

    an = engine.analyze(audio, sr)
    path = engine.save_wav(audio, sr, body.prompt)
    base = os.path.splitext(path)[0]
    cv = ""
    try:
        cv = engine.cover_art(body.prompt, base + "_cover.png",
                              bpm=an["bpm"], key=an["key"]) or ""
    except Exception:
        pass

    track_id = library.add_track(
        title=(body.title.strip()[:80] if body.title.strip() else body.prompt[:60]),
        prompt=body.prompt, negative=body.negative, duration=body.duration,
        model=body.model_size, guidance=body.guidance, temperature=body.temperature,
        seed=used_seed, filepath=path, cover_path=cv, sample_rate=sr,
        bpm=an["bpm"], musical_key=an["key"],
        collection=body.collection or "All Tracks")
    try:
        library.sync_to_supabase(track_id)
    except Exception:
        pass
    return {"ok": True, "id": track_id, "seed": used_seed,
            "bpm": an["bpm"], "key": an["key"], "track": _track_json(_require(track_id))}


class TweakBody(BaseModel):
    tweak: str
    keep_vibe: bool = True
    model_size: str = "small"
    guidance: float = 3.0


def _merge_tweak(original_prompt: str, tweak: str) -> str:
    """Fold a natural-language tweak into the original prompt.
    Ported from app.merge_tweak — handles 'less X', 'more X', 'no X', tempo words."""
    import re
    base = (original_prompt or "").strip().rstrip(".")
    t = (tweak or "").lower().strip()
    if not t:
        return base
    additions, removals, mods = [], [], []
    for c in re.split(r"[,;]| and | but ", t):
        c = c.strip()
        if not c:
            continue
        if c.startswith("more ") or c.startswith("add ") or c.startswith("with "):
            thing = c.split(" ", 1)[1]
            additions.append(f"more {thing}" if c.startswith("more") else thing)
        elif c.startswith("less "):
            removals.append(c.split(" ", 1)[1])
        elif c.startswith("no ") or c.startswith("remove ") or c.startswith("without "):
            removals.append(c.split(" ", 1)[1])
        elif c in ("slower", "faster", "calmer", "harder", "softer", "darker",
                   "brighter", "happier", "sadder", "heavier", "lighter",
                   "more upbeat", "more chill", "more aggressive"):
            mods.append(c)
        else:
            additions.append(c)
    parts = [base]
    if additions:
        parts.append("with " + ", ".join(additions))
    if mods:
        parts.append(", ".join(mods))
    if removals:
        parts.append("avoid: " + ", ".join(removals))
    return ", ".join(p for p in parts if p)


@app.post("/api/track/{track_id}/tweak")
def tweak(track_id: int, body: TweakBody):
    sr, audio, t = _load_arr(track_id)
    if not body.tweak.strip():
        raise HTTPException(400, "Describe a change")
    new_prompt = _merge_tweak(t["prompt"] or "", body.tweak)
    dur = max(4, min(int(t["duration"] or 8), 20))
    try:
        with engine.generation_session():
            if body.keep_vibe:
                sr2, out, seed = engine.reference_generate(
                    audio.astype("float32"), sr, prompt=new_prompt, mode="restyle",
                    duration=dur, model_size=body.model_size, guidance=body.guidance)
            else:
                sr2, out, seed = engine.generate(new_prompt, duration=dur,
                    model_size=body.model_size, guidance=body.guidance)
    except engine._CancelledError:
        raise HTTPException(499, "Tweak cancelled")
    except MemoryError as e:
        raise HTTPException(507, str(e))
    except Exception as e:
        raise HTTPException(500, f"Tweak failed: {e}")
    new_id = _save_version(out, sr2, t, f"tweak: {body.tweak[:25]}",
                           title=t["title"], collection="Tweaked")
    library.update_track(new_id, prompt=new_prompt)
    return {"ok": True, "id": new_id, "new_prompt": new_prompt,
            "track": _track_json(_require(new_id))}


class ExtendBody(BaseModel):
    prompt: str = ""
    add_duration: float = 8
    model_size: str = "small"
    guidance: float = 3.0


@app.post("/api/track/{track_id}/extend")
def extend(track_id: int, body: ExtendBody):
    sr, audio, t = _load_arr(track_id)
    prompt = body.prompt.strip() or t["prompt"] or "continue the music"
    try:
        with engine.generation_session():
            try:
                sr2, out, seed = engine.extend(prompt, audio, sr,
                    add_duration=body.add_duration, model_size=body.model_size,
                    guidance=body.guidance)
            except TypeError:
                # fall back to positional signature if kwargs differ
                sr2, out, seed = engine.extend(prompt, audio, sr, body.add_duration,
                    body.model_size, body.guidance)
    except engine._CancelledError:
        raise HTTPException(499, "Extend cancelled")
    except MemoryError as e:
        raise HTTPException(507, str(e))
    except Exception as e:
        raise HTTPException(500, f"Extend failed: {e}")
    new_id = _save_version(out, sr2, t, f"extended +{body.add_duration:.0f}s",
                           title=t["title"], collection="Edited")
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


class CompleteBody(BaseModel):
    prompt: str = ""
    model_size: str = "small"
    guidance: float = 3.0


@app.post("/api/track/{track_id}/complete")
def complete_song(track_id: int, body: CompleteBody):
    """One-click 'complete the song': build the track into a full ~72s arranged
    song (verse/chorus/bridge/outro) that flows from the original."""
    sr, audio, t = _load_arr(track_id)
    prompt = body.prompt.strip() or t["prompt"] or "continue the music"
    try:
        with engine.generation_session():
            sr2, full, roles = engine.auto_finish(
                prompt, audio, sr, model_size=body.model_size, guidance=body.guidance)
    except engine._CancelledError:
        raise HTTPException(499, "Song build cancelled")
    except MemoryError as e:
        raise HTTPException(507, str(e))
    except Exception as e:
        raise HTTPException(500, f"Complete failed: {e}")
    structure = "intro → " + " → ".join(roles)
    new_id = _save_version(full, sr2, t, "full song",
                           title=t["title"], collection="Full Songs")
    return {"ok": True, "id": new_id, "structure": structure,
            "track": _track_json(_require(new_id))}


class SoundsLikeBody(BaseModel):
    text: str


@app.post("/api/sounds-like")
def sounds_like(body: SoundsLikeBody):
    try:
        from .groq_helper import sounds_like as _sl
    except Exception:
        try:
            from music_studio.groq_helper import sounds_like as _sl
        except Exception:
            _sl = None
    if not _sl:
        return {"prompt": body.text}
    try:
        return {"prompt": _sl(body.text)}
    except Exception as e:
        raise HTTPException(500, f"Suggestion failed: {e}")


# ── editing ────────────────────────────────────────────────────────────────────
@app.get("/api/effects")
def get_effects():
    out = []
    for name, (fn, params) in effects.EFFECTS.items():
        out.append({
            "name": name,
            "params": [{"key": k, "min": lo, "max": hi, "default": df,
                        "label": k.replace("_", " ")}
                       for k, (lo, hi, df) in params.items()],
        })
    return out


class EffectBody(BaseModel):
    effect: str
    params: dict = {}


@app.post("/api/track/{track_id}/effect")
def apply_effect(track_id: int, body: EffectBody):
    sr, audio, t = _load_arr(track_id)
    if body.effect not in effects.EFFECTS:
        raise HTTPException(400, f"Unknown effect '{body.effect}'")
    fn, params = effects.EFFECTS[body.effect]
    kw = {}
    for k in params:
        if k in body.params and body.params[k] is not None:
            kw[k] = body.params[k]
    out = fn(audio, sr, **kw)
    if out.ndim > 1:
        out = out.mean(axis=1)
    new_id = _save_version(out, sr, t, body.effect, title=t["title"],
                           collection="Edited")
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


class PitchBody(BaseModel): semitones: float
class SpeedBody(BaseModel): speed_pct: float
class FadeBody(BaseModel):  fade_in: float = 0; fade_out: float = 0


@app.post("/api/track/{track_id}/pitch")
def pitch(track_id: int, body: PitchBody):
    sr, audio, t = _load_arr(track_id)
    out = engine.pitch_shift(audio, sr, float(body.semitones))
    new_id = _save_version(out, sr, t, f"pitch {body.semitones:+.0f}st", title=t["title"])
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


@app.post("/api/track/{track_id}/speed")
def speed(track_id: int, body: SpeedBody):
    sr, audio, t = _load_arr(track_id)
    factor = float(body.speed_pct) / 100.0
    _, out = engine.change_speed(audio, sr, factor)
    new_id = _save_version(out, sr, t, f"speed {body.speed_pct:.0f}%", title=t["title"])
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


@app.post("/api/track/{track_id}/fade")
def fade(track_id: int, body: FadeBody):
    sr, audio, t = _load_arr(track_id)
    out = engine.fade(audio, sr, float(body.fade_in), float(body.fade_out))
    new_id = _save_version(out, sr, t, f"fade {body.fade_in}s/{body.fade_out}s", title=t["title"])
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


@app.post("/api/track/{track_id}/normalize")
def normalize(track_id: int):
    sr, audio, t = _load_arr(track_id)
    out = engine.normalize(audio)
    new_id = _save_version(out, sr, t, "normalized", title=t["title"])
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


class PresetBody(BaseModel): preset: str


@app.post("/api/track/{track_id}/preset")
def preset(track_id: int, body: PresetBody):
    sr, audio, t = _load_arr(track_id)
    p = body.preset
    if p == "bass-boost":
        out = effects.eq(audio, sr, low_gain=4.0)
        out = effects.compressor(out, sr, threshold_db=-20, ratio=3)
        label = "bass boost"
    elif p == "lofi":
        out = effects.bitcrush(audio, sr, bits=10)
        out = effects.eq(out, sr, low_gain=2.0, mid_gain=-1.0, high_gain=-2.0)
        out = effects.reverb(out, sr, amount=0.2, room=0.3)
        label = "lo-fi preset"
    elif p == "stream-master":
        out = effects.streaming_master(audio, sr, target_lufs=-14.0)
        label = "stream master"
    elif p == "stereo-widen":
        out = effects.stereo_widen(audio, sr, 1.5)
        if out.ndim > 1:
            out = out.mean(axis=1)
        label = "stereo widen"
    elif p == "cut-silence":
        out = engine.trim_silence(audio)
        label = "cut silence"
    else:
        raise HTTPException(400, f"Unknown preset '{p}'")
    new_id = _save_version(out, sr, t, label, title=t["title"])
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


class ArrangeBody(BaseModel):
    op: str           # trim | reverse | stretch | loop
    a: float = 0
    b: float = 0


@app.post("/api/track/{track_id}/arrange")
def arrange(track_id: int, body: ArrangeBody):
    sr, audio, t = _load_arr(track_id)
    op = body.op
    if op == "trim":
        out = engine.trim(audio, sr, body.a, body.b); label = f"trim {body.a}-{body.b}s"
    elif op == "reverse":
        out = engine.reverse(audio); label = "reverse"
    elif op == "stretch":
        out = engine.time_stretch(audio, sr, body.a or 1.0); label = f"stretch {body.a}x"
    elif op == "loop":
        out = engine.loop_to_length(audio, sr, body.a or 30); label = f"loop {body.a}s"
    else:
        raise HTTPException(400, f"Unknown op '{op}'")
    new_id = _save_version(out, sr, t, label, title=t["title"])
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


class RegionBody(BaseModel):
    start: float
    end: float
    prompt: str
    model_size: str = "small"
    guidance: float = 3.0
    xfade: float = 0.25


@app.post("/api/track/{track_id}/region")
def region(track_id: int, body: RegionBody):
    sr, audio, t = _load_arr(track_id)
    if not body.prompt.strip():
        raise HTTPException(400, "Describe the region change")
    total = len(audio) / sr
    start_s, end_s = body.start, (body.end if body.end > 0 else total)
    if start_s >= end_s or end_s > total + 0.1:
        raise HTTPException(400, f"Invalid range — track is {total:.1f}s")
    try:
        new_audio, seed = engine.region_replace(
            audio, sr, start_s, end_s, body.prompt.strip(),
            model_size=body.model_size, guidance=body.guidance, xfade=float(body.xfade))
    except MemoryError as e:
        raise HTTPException(507, str(e))
    except Exception as e:
        raise HTTPException(500, f"Region replace failed: {e}")
    new_id = _save_version(new_audio, sr, t,
                           f"region {start_s:.0f}-{end_s:.0f}s: {body.prompt[:20]}",
                           title=t["title"])
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


# ── live vocal merge ───────────────────────────────────────────────────────────
@app.post("/api/track/{track_id}/merge-vocal")
async def merge_vocal(track_id: int, vocal: UploadFile = File(...)):
    """Receive a browser MediaRecorder WebM blob, mix it with the track, save as new version."""
    import io, tempfile, subprocess
    t = _require(track_id)
    if not t["filepath"] or not os.path.exists(t["filepath"]):
        raise HTTPException(404, "Track audio not found")

    raw = await vocal.read()
    # Use imageio_ffmpeg's bundled binary — works on Mac + Windows without system ffmpeg.
    import imageio_ffmpeg
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp_in:
        tmp_in.write(raw)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path.replace(".webm", ".wav")
    try:
        proc = subprocess.run(
            [ffmpeg_exe, "-y", "-i", tmp_in_path, "-ar", "32000", "-ac", "1", tmp_out_path],
            capture_output=True, timeout=30,
        )
        if proc.returncode != 0:
            raise HTTPException(500, "Could not convert vocal audio (ffmpeg error)")

        import soundfile as sf, numpy as np
        track_audio, track_sr = sf.read(t["filepath"], dtype="float32")
        vocal_audio, vocal_sr = sf.read(tmp_out_path, dtype="float32")
        if track_audio.ndim > 1: track_audio = track_audio.mean(axis=1)
        if vocal_audio.ndim > 1: vocal_audio = vocal_audio.mean(axis=1)

        # Resample vocal to match track SR if needed
        if vocal_sr != track_sr:
            import librosa
            vocal_audio = librosa.resample(vocal_audio, orig_sr=vocal_sr, target_sr=track_sr)

        # Pad shorter to match, then mix (vocal at 80% so the beat stays prominent)
        n = max(len(track_audio), len(vocal_audio))
        ta = np.pad(track_audio, (0, n - len(track_audio)))
        va = np.pad(vocal_audio, (0, n - len(vocal_audio)))
        mixed = np.clip(ta + va * 0.8, -1.0, 1.0)

        # Save as new version
        import tempfile as _tf
        with _tf.NamedTemporaryFile(suffix=".wav", delete=False) as out_f:
            sf.write(out_f.name, mixed, track_sr)
            mixed_path = out_f.name

        loop = asyncio.get_event_loop()
        new_track = await loop.run_in_executor(None, lambda: library.clone_track(
            track_id, mixed_path, edit_label="+ live vocal"))
        return {"ok": True, "track": _track_json(new_track)}
    finally:
        for p in [tmp_in_path, tmp_out_path]:
            try: os.unlink(p)
            except: pass


# ── stems (DAW) ────────────────────────────────────────────────────────────────
# Use the engine's OWN output dir (resolved to absolute) so that the directory
# stems are WRITTEN to is always the same one we LOOK them up in. Previously this
# recomputed a repo-relative path which diverged from engine.OUT_DIR when the
# packaged app ran with a different cwd → stems written, never found, silent
# empty tracks in the DAW.
_OUT_DIR = os.path.abspath(getattr(engine, "OUT_DIR", "music_output"))
os.makedirs(_OUT_DIR, exist_ok=True)

def _stem_path(t, name):
    """Find a stem file for track t and stem name.

    Checks two locations (both are written by different code paths):
      1. music_output/<src_name>_<name>.wav  (engine.separate_stems output)
      2. same dir as source file             (legacy path)
    """
    src_name = os.path.splitext(os.path.basename(t["filepath"]))[0]
    # primary: music_output directory (where engine.separate_stems writes)
    primary = os.path.join(_OUT_DIR, f"{src_name}_{name}.wav")
    if os.path.exists(primary):
        return primary
    # fallback: same directory as source file
    return os.path.join(os.path.dirname(t["filepath"]), f"{src_name}_{name}.wav")


@app.get("/api/stems/{track_id}")
def get_stems(track_id: int):
    t = _require(track_id)
    if not t["filepath"] or not os.path.exists(t["filepath"]):
        raise HTTPException(404, "Track not found")
    names = ["drums", "bass", "other", "vocals"]
    existing = {n: _stem_path(t, n) for n in names if os.path.exists(_stem_path(t, n))}
    return {"track_id": track_id, "separated": len(existing) == 4,
            "stems": existing, "source": t["filepath"]}


@app.post("/api/stems/{track_id}/split")
def split_stems(track_id: int):
    t = _require(track_id)
    if not t["filepath"] or not os.path.exists(t["filepath"]):
        raise HTTPException(404, "Track not found")
    try:
        # Pass the explicit absolute dir so writes land exactly where _stem_path looks.
        stems = engine.separate_stems(t["filepath"], out_dir=_OUT_DIR)
        # Verify the files actually exist before claiming success — never report a
        # "fake" split that leaves the DAW with empty, silent tracks.
        missing = [n for n, p in stems.items() if not os.path.exists(p)]
        if missing:
            raise RuntimeError(f"stems written but not found on disk: {missing}")
        return {"track_id": track_id, "separated": True, "stems": stems}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Stem separation failed: {e}")


@app.get("/api/stem-audio/{track_id}/{stem_name}")
def get_stem_audio(track_id: int, stem_name: str):
    t = _require(track_id)
    path = _stem_path(t, stem_name)
    if not os.path.exists(path):
        raise HTTPException(404, f"Stem '{stem_name}' not found — split first")
    return FileResponse(path, media_type="audio/wav", headers={"Accept-Ranges": "bytes"})


@app.get("/api/waveform-stem/{track_id}/{stem_name}")
def get_stem_waveform(track_id: int, stem_name: str, points: int = 1800):
    import soundfile as sf
    t = _require(track_id)
    path = _stem_path(t, stem_name)
    if not os.path.exists(path):
        raise HTTPException(404, f"Stem '{stem_name}' not split yet")
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return _peaks(audio, sr, points, stem=stem_name)


@app.get("/api/harmonics/{track_id}/{stem_name}")
def get_harmonics(track_id: int, stem_name: str, start: float = 0.0, end: float = 0.0,
                  n: int = 8):
    """Decompose the selected sound into the 'strings of notes' that make it up:
    the fundamental pitch + its harmonic series (overtones). Each harmonic is a
    real note with its own pitch and relative strength — that's the physical
    makeup of a single sound's timbre."""
    import soundfile as sf, librosa
    t = _require(track_id)
    path = t["filepath"] if stem_name == "master" else _stem_path(t, stem_name)
    if not os.path.exists(path):
        raise HTTPException(404, f"Audio not found for '{stem_name}'")
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    total = len(audio) / sr
    s = max(0.0, start)
    e = end if end > s else total
    e = min(e, total)
    seg = audio[int(s * sr):int(e * sr)]
    if seg.size < 256:
        seg = audio

    # magnitude spectrum of the selection
    win = seg * np.hanning(seg.size)
    spec = np.abs(np.fft.rfft(win))
    freqs = np.fft.rfftfreq(seg.size, 1.0 / sr)

    # fundamental: strongest peak in a musical range
    band = (freqs >= 50) & (freqs <= 1000)
    if not band.any() or spec[band].max() <= 0:
        return {"track_id": track_id, "stem": stem_name, "fundamental": None, "harmonics": []}
    f0 = float(freqs[band][int(np.argmax(spec[band]))])

    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    def note_of(freq):
        if freq <= 0:
            return ""
        midi = int(round(69 + 12 * np.log2(freq / 440.0)))
        return f"{names[midi % 12]}{midi // 12 - 1}"

    def energy_at(freq):
        # sum spectral energy in a narrow ±3% window around the harmonic
        lo, hi = freq * 0.97, freq * 1.03
        m = (freqs >= lo) & (freqs <= hi)
        return float(spec[m].sum()) if m.any() else 0.0

    harmonics = []
    for k in range(1, n + 1):
        fk = f0 * k
        if fk > sr / 2:
            break
        harmonics.append({"n": k, "freq": round(fk, 1), "note": note_of(fk),
                          "energy": energy_at(fk)})
    emax = max((h["energy"] for h in harmonics), default=0.0)
    for h in harmonics:
        h["strength"] = round(h["energy"] / emax, 4) if emax > 0 else 0.0
        del h["energy"]

    return {"track_id": track_id, "stem": stem_name,
            "start": round(s, 4), "end": round(e, 4),
            "fundamental": {"freq": round(f0, 1), "note": note_of(f0)},
            "harmonics": harmonics}


@app.get("/api/layers/{track_id}/{stem_name}")
def get_layers(track_id: int, stem_name: str, start: float = 0.0, end: float = 0.0,
               points: int = 120):
    """Strip a region into 5 frequency-band layers — the components that make
    up the sound. Returns an energy envelope per band so the UI can draw a
    real block for each. Bandpass via FFT (no extra deps)."""
    import soundfile as sf
    t = _require(track_id)
    path = t["filepath"] if stem_name == "master" else _stem_path(t, stem_name)
    if not os.path.exists(path):
        raise HTTPException(404, f"Audio not found for '{stem_name}'")
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    total = len(audio) / sr
    s = max(0.0, start)
    e = end if end > s else total
    e = min(e, total)
    seg = audio[int(s * sr):int(e * sr)]
    if seg.size < 16:
        seg = audio  # fall back to whole track if selection too tiny

    bands = [
        ("sub",      20,   80,   "#7c3aed"),   # sub-bass
        ("bass",     80,   250,  "#22c55e"),   # bass
        ("low-mid",  250,  1200, "#eab308"),   # body / low-mid
        ("high-mid", 1200, 5000, "#f97316"),   # presence / attack
        ("air",      5000, 18000,"#22d3ee"),   # air / sparkle
    ]
    spec = np.fft.rfft(seg)
    freqs = np.fft.rfftfreq(seg.size, 1.0 / sr)

    layers = []
    for name, lo, hi, color in bands:
        mask = (freqs >= lo) & (freqs < hi)
        band_spec = np.where(mask, spec, 0)
        band_sig = np.fft.irfft(band_spec, n=seg.size).astype(np.float32)
        # energy of this band relative to the full segment (0..1)
        rms = float(np.sqrt(np.mean(band_sig ** 2))) if band_sig.size else 0.0
        # envelope for the block shape
        n = max(1, min(points, band_sig.size))
        chunk = max(1, band_sig.size // n)
        env = [float(np.sqrt(np.mean(band_sig[i*chunk:(i+1)*chunk] ** 2)))
               for i in range(n)]
        peak = max(env) if env else 0.0
        env = [round(v / peak, 4) if peak > 0 else 0.0 for v in env]
        layers.append({"name": name, "lo": lo, "hi": hi, "color": color,
                       "energy": round(rms, 5), "env": env})

    # normalise energy across bands so the strongest band reads as 1.0
    emax = max((l["energy"] for l in layers), default=0.0)
    for l in layers:
        l["level"] = round(l["energy"] / emax, 4) if emax > 0 else 0.0

    return {"track_id": track_id, "stem": stem_name,
            "start": round(s, 4), "end": round(e, 4), "layers": layers}


class MixdownBody(BaseModel):
    # per-stem settings: {drums: {vol, mute, pan}, bass: {...}, ...}
    stems: dict
    title: str = ""


@app.post("/api/stems/{track_id}/mixdown")
def mixdown(track_id: int, body: MixdownBody):
    """Combine stem files at given volumes/pans (respecting mutes) → new version."""
    import soundfile as sf
    t = _require(track_id)
    order = ["drums", "bass", "other", "vocals"]
    arrays: dict[str, np.ndarray] = {}
    sr_out = None
    for name in order:
        path = _stem_path(t, name)
        if not os.path.exists(path):
            continue
        arr, sr = sf.read(path, dtype="float32")
        if arr.ndim > 1:
            arr = arr.mean(axis=1)
        arrays[name] = arr.astype(np.float32)
        sr_out = sr
    if not arrays:
        raise HTTPException(400, "No stems to mix")
    if all(body.stems.get(n, {}).get("mute") for n in arrays):
        raise HTTPException(400, "All stems muted — nothing to mix")

    fx_baked = stem_fx.any_fx_active(body.stems)
    if fx_baked:
        # bake EQ/comp/reverb/delay + pan + master limiter → stereo
        L = min(len(a) for a in arrays.values())
        clipped = {n: a[:L] for n, a in arrays.items()}
        mix = stem_fx.render_mix(clipped, sr_out, body.stems, limiter=True)
    else:
        length = min(len(a) for a in arrays.values())
        mix = np.zeros(length, dtype=np.float32)
        for name, a in arrays.items():
            cfg = body.stems.get(name, {})
            if cfg.get("mute"):
                continue
            mix += a[:length] * float(cfg.get("vol", 1.0))
    mix = engine.normalize(mix)
    muted = [n for n in order if body.stems.get(n, {}).get("mute")]
    label = "mixdown" + (f" (no {'+'.join(muted)})" if muted else "") + (" FX" if fx_baked else "")
    new_id = _save_version(mix, sr_out, t, label,
                           title=(body.title or t["title"]), collection="Edited")
    return {"ok": True, "id": new_id, "fx_baked": fx_baked, "track": _track_json(_require(new_id))}


# ── DAW non-destructive clip editing + history ───────────────────────────────────
def _stem_arrays(t: dict):
    """Load all 4 stems as mono float32 at a common sr. Requires a prior split."""
    import soundfile as sf
    order = ["drums", "bass", "other", "vocals"]
    stems, sr_out = {}, None
    for name in order:
        path = _stem_path(t, name)
        if not os.path.exists(path):
            continue
        arr, sr = sf.read(path, dtype="float32")
        if arr.ndim > 1:
            arr = arr.mean(axis=1)
        stems[name] = arr
        sr_out = sr
    return stems, sr_out


class OpBody(BaseModel):
    op: dict


class OpsBody(BaseModel):
    ops: list
    head: Optional[int] = None


@app.get("/api/daw/{track_id}/history")
def daw_history_get(track_id: int):
    _require(track_id)
    return history.get(track_id)


@app.post("/api/daw/{track_id}/history/push")
def daw_history_push(track_id: int, body: OpBody):
    _require(track_id)
    return history.push(track_id, body.op)


@app.post("/api/daw/{track_id}/history/undo")
def daw_history_undo(track_id: int):
    _require(track_id)
    return history.undo(track_id)


@app.post("/api/daw/{track_id}/history/redo")
def daw_history_redo(track_id: int):
    _require(track_id)
    return history.redo(track_id)


@app.post("/api/daw/{track_id}/history/clear")
def daw_history_clear(track_id: int):
    _require(track_id)
    return history.clear(track_id)


@app.post("/api/daw/{track_id}/history/replace")
def daw_history_replace(track_id: int, body: OpsBody):
    _require(track_id)
    return history.replace(track_id, body.ops, body.head)


@app.get("/api/daw/{track_id}/preview-stem/{stem_name}")
def daw_preview_stem(track_id: int, stem_name: str, points: int = 1800):
    """Waveform peaks for one stem with the *live* edit stack applied — no save.
    Lets the timeline show edits instantly before rendering."""
    import soundfile as sf
    t = _require(track_id)
    path = _stem_path(t, stem_name)
    if not os.path.exists(path):
        raise HTTPException(404, f"Stem '{stem_name}' not split yet")
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    live = [o for o in history.get(track_id)["live_ops"] if o.get("stem") == stem_name]
    if live:
        audio = clip_edits.apply_stem_ops(audio, sr, live)
    return _peaks(audio, sr, points, stem=stem_name)


@app.post("/api/daw/{track_id}/render")
def daw_render(track_id: int, body: Optional[MixdownBody] = None):
    """Bake the live edit stack into every stem, mix them down (respecting the
    mixer's per-stem vol/mute/pan), and save the result as a new track version."""
    t = _require(track_id)
    stems, sr = _stem_arrays(t)
    if not stems:
        raise HTTPException(400, "Split into stems before rendering edits")
    live = history.get(track_id)["live_ops"]
    if not live:
        raise HTTPException(400, "No edits to render — make some edits first")

    # apply each stem's ops in order
    by_stem: dict[str, list] = {}
    for op in live:
        by_stem.setdefault(op.get("stem", ""), []).append(op)
    for name in list(stems.keys()):
        ops = by_stem.get(name)
        if ops:
            stems[name] = clip_edits.apply_stem_ops(stems[name], sr, ops)

    cfg = (body.stems if body else {}) or {}
    if all(cfg.get(n, {}).get("mute") for n in stems) and stems:
        raise HTTPException(400, "All stems muted — nothing to render")

    # If any stem has live FX (EQ/comp/reverb/delay) or pan, bake the full rack +
    # master limiter into a stereo mix so the export matches the live monitor.
    # Otherwise take the fast mono path (just vol/mute).
    fx_baked = stem_fx.any_fx_active(cfg)
    if fx_baked:
        mix = stem_fx.render_mix(stems, sr, cfg, limiter=True)   # → (n, 2)
        label = f"daw edit ({len(live)} ops, FX baked)"
    else:
        length = max(len(a) for a in stems.values())   # edits can lengthen; pad to longest
        mix = np.zeros(length, dtype=np.float32)
        for name, a in stems.items():
            c = cfg.get(name, {})
            if c.get("mute"):
                continue
            if len(a) < length:
                a = np.concatenate([a, np.zeros(length - len(a), np.float32)])
            mix += a[:length] * float(c.get("vol", 1.0))
        label = f"daw edit ({len(live)} ops)"
    mix = engine.normalize(mix)

    new_id = _save_version(mix, sr, t, label, title=t["title"], collection="Edited")
    return {"ok": True, "id": new_id, "ops": len(live), "fx_baked": fx_baked,
            "track": _track_json(_require(new_id))}


@app.post("/api/daw/{track_id}/export-stem/{stem_name}")
def daw_export_stem(track_id: int, stem_name: str):
    """Render a single stem (with its live edits applied) to its own new track."""
    import soundfile as sf
    t = _require(track_id)
    path = _stem_path(t, stem_name)
    if not os.path.exists(path):
        raise HTTPException(404, f"Stem '{stem_name}' not split yet")
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    live = [o for o in history.get(track_id)["live_ops"] if o.get("stem") == stem_name]
    if live:
        audio = clip_edits.apply_stem_ops(audio, sr, live)
    new_id = _save_version(audio, sr, t, f"{stem_name} stem",
                           title=f"{t['title']} — {stem_name}", collection="Stems")
    return {"ok": True, "id": new_id, "track": _track_json(_require(new_id))}


@app.get("/api/transients/{track_id}/{stem_name}")
def get_transients(track_id: int, stem_name: str):
    import soundfile as sf, librosa
    t = _require(track_id)
    path = t["filepath"] if stem_name == "master" else _stem_path(t, stem_name)
    if not os.path.exists(path):
        raise HTTPException(404, f"Audio not found for '{stem_name}'")
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    onsets = librosa.onset.onset_detect(y=audio, sr=sr, units="time",
                                        hop_length=512, backtrack=True).tolist()
    duration = len(audio) / sr
    clips = []
    for i, start in enumerate(onsets):
        end = onsets[i+1] if i+1 < len(onsets) else duration
        end = min(end, start + 4.0)
        clips.append({"id": i, "start": round(start, 4),
                      "end": round(end, 4), "dur": round(end - start, 4)})
    return {"track_id": track_id, "stem": stem_name, "duration": duration, "clips": clips}


# ── DAW generative stem editing (AI region / extend / swap) ──────────────────
# These mutate a single stem .wav in place. We snapshot the *original* stem the
# first time it's touched so the UI can always revert. Edits feed back into the
# normal preview/render pipeline because they just rewrite the stem file.

def _stem_backup_path(t, name):
    src_dir = os.path.dirname(t["filepath"])
    src_name = os.path.splitext(os.path.basename(t["filepath"]))[0]
    return os.path.join(src_dir, f"{src_name}_{name}.orig.wav")


def _load_stem(t, name):
    import soundfile as sf
    path = _stem_path(t, name)
    if not os.path.exists(path):
        raise HTTPException(404, f"Stem '{name}' not split yet")
    audio, sr = sf.read(path, dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    return audio, sr, path


def _write_stem(t, name, audio, sr):
    """Write a stem back to disk, backing up the pristine original once."""
    import soundfile as sf, shutil
    path = _stem_path(t, name)
    bak = _stem_backup_path(t, name)
    if not os.path.exists(bak) and os.path.exists(path):
        shutil.copyfile(path, bak)
    sf.write(path, audio.astype("float32"), sr)


class StemGenBody(BaseModel):
    prompt: str = ""
    start: float = 0.0
    end: float = 0.0
    model_size: str = "small"
    guidance: float = 4.0
    add_duration: float = 8.0


@app.post("/api/daw/{track_id}/stem-regenerate/{stem_name}")
def daw_stem_regenerate(track_id: int, stem_name: str, body: StemGenBody):
    """Regenerate a time-region of ONE stem from a prompt (rest of the stem kept)."""
    t = _require(track_id)
    audio, sr, _ = _load_stem(t, stem_name)
    total = len(audio) / sr
    start_s, end_s = body.start, (body.end if body.end > 0 else total)
    if start_s >= end_s or end_s > total + 0.1:
        raise HTTPException(400, f"Invalid range — stem is {total:.1f}s")
    prompt = body.prompt.strip() or f"{stem_name} part"
    try:
        with engine.generation_session():
            new_audio, _ = engine.region_replace(
                audio, sr, start_s, end_s, prompt,
                model_size=body.model_size, guidance=body.guidance)
    except engine._CancelledError:
        raise HTTPException(499, "Regenerate cancelled")
    except Exception as e:
        raise HTTPException(500, f"Stem regenerate failed: {e}")
    _write_stem(t, stem_name, new_audio, sr)
    return {"ok": True, "stem": stem_name, "duration": len(new_audio) / sr}


@app.post("/api/daw/{track_id}/stem-extend/{stem_name}")
def daw_stem_extend(track_id: int, stem_name: str, body: StemGenBody):
    """AI-continue ONE stem so it flows from its own tail (lengthens that stem)."""
    t = _require(track_id)
    audio, sr, _ = _load_stem(t, stem_name)
    prompt = body.prompt.strip() or f"continue the {stem_name}"
    try:
        with engine.generation_session():
            sr2, out, _ = engine.extend(prompt, audio, sr,
                add_duration=body.add_duration, model_size=body.model_size,
                guidance=body.guidance)
    except engine._CancelledError:
        raise HTTPException(499, "Extend cancelled")
    except Exception as e:
        raise HTTPException(500, f"Stem extend failed: {e}")
    _write_stem(t, stem_name, out, sr2)
    return {"ok": True, "stem": stem_name, "duration": len(out) / sr2}


@app.post("/api/daw/{track_id}/stem-swap/{stem_name}")
def daw_stem_swap(track_id: int, stem_name: str, body: StemGenBody):
    """Swap a stem to a different instrument/sound from a prompt, conditioned on the
    existing stem so the timing & vibe carry over (e.g. turn the bass into a synth)."""
    t = _require(track_id)
    audio, sr, _ = _load_stem(t, stem_name)
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(400, "Describe what to swap it to")
    dur = min(max(len(audio) / sr, 4.0), 30.0)   # match stem, cap to keep gen time sane
    try:
        with engine.generation_session():
            sr2, out, _ = engine.reference_generate(
                audio, sr, prompt=prompt, mode="restyle", duration=dur,
                model_size=body.model_size, guidance=body.guidance)
    except engine._CancelledError:
        raise HTTPException(499, "Swap cancelled")
    except Exception as e:
        raise HTTPException(500, f"Stem swap failed: {e}")
    # match the swapped stem to the original length so the mix lines up
    if len(out) > len(audio):
        out = out[:len(audio)]
    elif len(out) < len(audio):
        out = np.concatenate([out, np.zeros(len(audio) - len(out), np.float32)])
    _write_stem(t, stem_name, out, sr2)
    return {"ok": True, "stem": stem_name, "duration": len(out) / sr2}


@app.post("/api/daw/{track_id}/stem-revert/{stem_name}")
def daw_stem_revert(track_id: int, stem_name: str):
    """Restore a stem to its pristine (pre-AI-edit) state."""
    import shutil
    t = _require(track_id)
    bak = _stem_backup_path(t, stem_name)
    if not os.path.exists(bak):
        raise HTTPException(404, "No AI edits to revert on this stem")
    shutil.copyfile(bak, _stem_path(t, stem_name))
    import soundfile as sf
    info = sf.info(_stem_path(t, stem_name))
    return {"ok": True, "stem": stem_name, "duration": info.frames / info.samplerate}


# ── DAW project state (mixer / sections / markers / view) ────────────────────
class ProjectBody(BaseModel):
    state: dict


@app.get("/api/daw/{track_id}/project")
def daw_project_get(track_id: int):
    _require(track_id)
    return project.get(track_id)


@app.post("/api/daw/{track_id}/project")
def daw_project_save(track_id: int, body: ProjectBody):
    """Auto-save: merge a partial state patch over the saved project."""
    _require(track_id)
    return project.save(track_id, body.state or {})


# ── Export all edited stems as a zip ─────────────────────────────────────────
@app.get("/api/daw/{track_id}/export-zip")
def daw_export_zip(track_id: int):
    """Bundle all four stems (with their live edits baked in) into a downloadable zip."""
    import io, zipfile, soundfile as sf
    t = _require(track_id)
    names = ["drums", "bass", "other", "vocals"]
    paths = {n: _stem_path(t, n) for n in names}
    missing = [n for n, p in paths.items() if not os.path.exists(p)]
    if missing:
        raise HTTPException(404, f"Stems not split: {', '.join(missing)}")
    live_all = history.get(track_id)["live_ops"]
    base = (t["title"] or t["prompt"] or f"track{track_id}")[:50].strip().replace("/", "-")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for n in names:
            audio, sr = sf.read(paths[n], dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            ops = [o for o in live_all if o.get("stem") == n]
            if ops:
                audio = clip_edits.apply_stem_ops(audio, sr, ops)
            wav = io.BytesIO()
            sf.write(wav, audio, sr, format="WAV")
            zf.writestr(f"{base}_{n}.wav", wav.getvalue())
    buf.seek(0)
    from fastapi.responses import StreamingResponse
    return StreamingResponse(
        buf, media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{base}_stems.zip"'})


# ── YouTube import / strip / revamp ─────────────────────────────────────────

class YoutubeImportBody(BaseModel):
    url: str


class RevampBody(BaseModel):
    mixer: Optional[dict] = None


def _sse(event: str, data: dict) -> str:
    import json
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


_youtube_lock = False


@app.post("/api/youtube/run")
async def youtube_run(body: YoutubeImportBody):
    """Single SSE endpoint: download → strip vocals → revamp.
    Streams progress events so the frontend never times out."""
    import asyncio, json
    from fastapi.responses import StreamingResponse
    global _youtube_lock

    if _youtube_lock:
        async def busy():
            yield _sse("error", {"msg": "Already processing a track — please wait for it to finish."})
        return StreamingResponse(busy(), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async def stream():
        global _youtube_lock
        _youtube_lock = True
        loop = asyncio.get_event_loop()
        try:
            # Step 1 — download
            yield _sse("progress", {"step": 1, "msg": "Downloading audio…"})
            try:
                track = await loop.run_in_executor(None, lambda: youtube.download(body.url))
            except Exception as e:
                yield _sse("error", {"msg": str(e)}); return
            yield _sse("progress", {"step": 1, "msg": f"Downloaded: {track['title']}", "done": True,
                                    "track": _track_json(track)})

            # Step 2 — strip vocals (slow — Demucs)
            yield _sse("progress", {"step": 2, "msg": "Separating stems & removing vocals…"})
            try:
                result = await loop.run_in_executor(None, lambda: youtube.strip_vocals(track["id"]))
            except Exception as e:
                yield _sse("error", {"msg": str(e)}); return
            instr = _track_json(result["track"])
            yield _sse("progress", {"step": 2, "msg": "Vocals stripped", "done": True,
                                    "instrumental": instr, "stems": result["stems"]})

            # Step 3 — revamp
            yield _sse("progress", {"step": 3, "msg": "Applying FX signature…"})
            try:
                rev = await loop.run_in_executor(None, lambda: youtube.revamp(track["id"]))
            except Exception as e:
                yield _sse("error", {"msg": str(e)}); return
            revamp_track = _track_json(rev["track"])
            yield _sse("done", {"instrumental": instr, "revamp": revamp_track,
                                "stems": result["stems"]})
        finally:
            _youtube_lock = False

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})


# ── AI Vocals (Groq lyrics + Bark TTS) ──────────────────────────────────────

class VocalsBody(BaseModel):
    prompt: str
    style: str = "sung"          # sung | rap | hum | spoken
    voice: str = "v2/en_speaker_6"
    bars: int = 8
    track_id: Optional[int] = None   # attach to an existing track


@app.post("/api/vocals/lyrics")
def vocals_lyrics(body: VocalsBody):
    """Use Groq to write lyrics only — no audio generation."""
    try:
        analysis = vocals.analyze_track(body.track_id) if body.track_id else {}
        lyrics = vocals.write_lyrics(
            body.prompt,
            track_analysis=analysis,
            style=body.style,
            bars=body.bars,
        )
        return {"ok": True, "lyrics": lyrics, "analysis": analysis}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.post("/api/vocals/generate")
async def vocals_generate(body: VocalsBody):
    """SSE: write lyrics → generate Bark audio → save to library.
    Streams progress so the client doesn't time out (Bark takes 30-90s)."""
    import asyncio
    from fastapi.responses import StreamingResponse

    async def stream():
        loop = asyncio.get_event_loop()
        analysis = {}

        # Step 1 — deep audio analysis (if track_id given)
        if body.track_id:
            yield _sse("progress", {"step": 1, "msg": "Analyzing track…"})
            try:
                analysis = await loop.run_in_executor(None, lambda: vocals.analyze_track(body.track_id))
            except Exception as e:
                yield _sse("error", {"msg": str(e)}); return
            yield _sse("progress", {"step": 1, "done": True,
                "msg": f"Analyzed — {analysis.get('mood','')}, {analysis.get('tempo_feel','')}",
                "analysis": analysis})
        else:
            yield _sse("progress", {"step": 1, "done": True, "msg": "No track — writing from prompt only"})

        # Step 2 — lyrics via Groq
        yield _sse("progress", {"step": 2, "msg": "Writing lyrics with Groq…"})
        try:
            lyrics = await loop.run_in_executor(None, lambda: vocals.write_lyrics(
                body.prompt, track_analysis=analysis, style=body.style, bars=body.bars,
            ))
        except Exception as e:
            yield _sse("error", {"msg": str(e)}); return
        yield _sse("progress", {"step": 2, "done": True, "msg": "Lyrics ready", "lyrics": lyrics})

        # Step 3 — Bark audio generation (slow, 30-90s)
        yield _sse("progress", {"step": 3, "msg": "Generating vocals with Bark (30-90s)…"})
        try:
            result = await loop.run_in_executor(None, lambda: vocals.create_vocal_stem(
                body.prompt,
                track_id=body.track_id,
                style=body.style,
                voice=body.voice,
                bars=body.bars,
                track_analysis=analysis,
            ))
        except Exception as e:
            yield _sse("error", {"msg": str(e)}); return

        yield _sse("done", {
            "vocal_id": result["vocal_id"],
            "lyrics": result["lyrics"],
            "analysis": result.get("analysis", {}),
            "duration": result["duration"],
            "track": _track_json(result["track"]),
        })

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


if __name__ == "__main__":
    import uvicorn
    print("Starting Music Studio API on http://localhost:8765")
    uvicorn.run(app, host="0.0.0.0", port=8765, reload=False)

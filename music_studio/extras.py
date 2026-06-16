"""
Extra studio features:
  [#6] distribution export — bundle a track into an upload-ready folder
       (WAV + MP3 + cover art + auto title/description/tags)
  [#8] prompt memory — learn from your highly-rated tracks and suggest prompts

Kept separate from engine/library so the core stays lean.
"""
from __future__ import annotations
import os
import re
import json
import shutil
import zipfile
from collections import Counter
from datetime import datetime

try:
    from . import library, engine
except ImportError:
    import library, engine

EXPORT_DIR = "music_output/exports"
os.makedirs(EXPORT_DIR, exist_ok=True)

_STOP = {"a", "the", "and", "with", "of", "for", "to", "in", "on", "at", "by",
         "feat", "featuring", "avoid", "no", "very", "really"}


# ── [#6] Distribution export ──────────────────────────────────────────────────────
def _auto_meta(track: dict) -> dict:
    """Title / description / tags from the track's prompt + analysis."""
    prompt = track["prompt"]
    words = [w for w in re.findall(r"[a-zA-Z0-9']+", prompt.lower()) if w not in _STOP]
    tags = []
    for w in words:
        if w not in tags:
            tags.append(w)
    tags = tags[:15]
    nice = prompt.split(",")[0].strip().title()
    title = f"{nice}"
    if track.get("bpm"):
        title += f" ({track['bpm']:.0f} BPM"
        if track.get("musical_key"):
            title += f" {track['musical_key']}"
        title += ")"
    desc = (f"{nice} — AI-generated royalty-free music.\n\n"
            f"Style: {prompt}\n"
            + (f"Tempo: {track['bpm']:.0f} BPM\n" if track.get("bpm") else "")
            + (f"Key: {track['musical_key']}\n" if track.get("musical_key") else "")
            + "\nFree for use in your projects. Generated with AI Music Studio.")
    return {"title": title, "description": desc, "tags": tags}


def export_for_distribution(track_id: int, platform: str = "all",
                            make_zip: bool = True) -> dict:
    """Build an upload-ready folder for a track. platform: youtube|beatstars|tiktok|all."""
    t = library.get_track(track_id)
    if not t or not os.path.exists(t["filepath"]):
        return {"ok": False, "error": "track/file not found"}

    slug = re.sub(r"[^a-z0-9]+", "-", (t["title"] or t["prompt"]).lower()).strip("-")[:40]
    folder = os.path.join(EXPORT_DIR, f"{track_id}_{slug}")
    os.makedirs(folder, exist_ok=True)

    # audio: wav + mp3
    wav_dst = os.path.join(folder, f"{slug}.wav")
    shutil.copy(t["filepath"], wav_dst)
    mp3 = engine.export_mp3(wav_dst)

    # cover art (regenerate fresh into the folder)
    cover = os.path.join(folder, "cover.png")
    try:
        engine.cover_art(t["prompt"], cover, bpm=t.get("bpm"), key=t.get("musical_key"))
    except Exception as e:
        print(f"[extras] cover failed: {e}")
        cover = None

    meta = _auto_meta(t)
    # platform-tuned text files
    files_written = [wav_dst]
    if mp3:
        files_written.append(mp3)
    if cover:
        files_written.append(cover)

    def write(name, content):
        p = os.path.join(folder, name)
        with open(p, "w") as f:
            f.write(content)
        files_written.append(p)

    plats = ["youtube", "beatstars", "tiktok"] if platform == "all" else [platform]
    for p in plats:
        if p == "youtube":
            write("youtube.txt",
                  f"TITLE:\n{meta['title']} | Royalty-Free\n\n"
                  f"DESCRIPTION:\n{meta['description']}\n\n"
                  f"TAGS:\n{', '.join(meta['tags'])}")
        elif p == "beatstars":
            write("beatstars.txt",
                  f"BEAT NAME:\n{meta['title']}\n\n"
                  f"DESCRIPTION:\n{meta['description']}\n\n"
                  f"TAGS (max 12):\n{', '.join(meta['tags'][:12])}\n\n"
                  f"BPM: {t.get('bpm') or '—'}   KEY: {t.get('musical_key') or '—'}")
        elif p == "tiktok":
            hashtags = " ".join("#" + re.sub(r'[^a-z0-9]', '', w) for w in meta["tags"][:8])
            write("tiktok.txt",
                  f"CAPTION:\nNew sound 🎵 {meta['title']}\n\n{hashtags} #fyp #aimusic #newmusic")

    write("metadata.json", json.dumps({**meta, "track": t,
          "exported_at": datetime.now().isoformat()}, indent=2, default=str))

    zip_path = None
    if make_zip:
        zip_path = folder + ".zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for fp in files_written:
                z.write(fp, os.path.basename(fp))

    return {"ok": True, "folder": folder, "zip": zip_path,
            "files": [os.path.basename(f) for f in files_written], "meta": meta}


# ── [#8] Prompt memory ────────────────────────────────────────────────────────────
def suggest_prompts(n: int = 5) -> list[str]:
    """Learn from tracks rated >=4 (or favorited): surface the actual high-rated
    prompts, plus a couple recombined from your most-loved keywords."""
    tracks = library.list_tracks()
    loved = [t for t in tracks if (t.get("rating") or 0) >= 4 or t.get("favorite")]
    if not loved:
        return []

    suggestions = []
    # 1) the real prompts you loved, newest first
    seen = set()
    for t in sorted(loved, key=lambda x: x["created_at"], reverse=True):
        p = t["prompt"].strip()
        if p and p.lower() not in seen:
            suggestions.append(p)
            seen.add(p.lower())
        if len(suggestions) >= n:
            break

    # 2) one recombined "DNA" prompt from your favorite keywords
    words = []
    for t in loved:
        words += [w for w in re.findall(r"[a-zA-Z0-9']+", t["prompt"].lower())
                  if w not in _STOP and len(w) > 2]
    top = [w for w, _ in Counter(words).most_common(6)]
    if len(top) >= 3 and len(suggestions) < n + 1:
        suggestions.append(", ".join(top) + "  (your style mix)")

    return suggestions[:n + 1]


def loved_keywords(k: int = 12) -> list[tuple[str, int]]:
    """Top keywords across your favorited / highly-rated tracks."""
    tracks = library.list_tracks()
    loved = [t for t in tracks if (t.get("rating") or 0) >= 4 or t.get("favorite")]
    words = []
    for t in loved:
        words += [w for w in re.findall(r"[a-zA-Z0-9']+", t["prompt"].lower())
                  if w not in _STOP and len(w) > 2]
    return Counter(words).most_common(k)

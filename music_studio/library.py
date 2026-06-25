"""
Track library — SQLite (local, always) + optional Supabase sync (cloud).

Every generated track gets a row here: prompt, settings, file path, tags,
favorite flag, rating, play count, BPM/key analysis. The UI reads/writes
through this module so storage is in one place and Vercel migration is a
matter of pointing the same schema at Postgres.
"""
from __future__ import annotations
import os
import json
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Optional

# Resolve the user data directory so tracks and the DB survive app updates
# and live somewhere the customer can find/back up.
#   macOS  → ~/Library/Application Support/StemAI/
#   Windows → %APPDATA%/StemAI/
#   Linux   → ~/.local/share/StemAI/
import platform as _platform

def _data_dir() -> str:
    system = _platform.system()
    if system == "Darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "StemAI")
    elif system == "Windows":
        base = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "StemAI")
    else:
        base = os.path.join(os.path.expanduser("~"), ".local", "share", "StemAI")
    os.makedirs(base, exist_ok=True)
    return base

# Real library by default.
# MUSIC_STUDIO_TEST_DB=1 → throwaway DB for automated tests
# STEMAI_DEV=1           → use local music_output/ folder (dev mode)
if os.environ.get("MUSIC_STUDIO_TEST_DB"):
    DB_PATH = "music_output/_test_library.db"
    AUDIO_DIR = "music_output"
elif os.environ.get("STEMAI_DEV"):
    DB_PATH = "music_output/library.db"
    AUDIO_DIR = "music_output"
else:
    _DATA = _data_dir()
    AUDIO_DIR = os.path.join(_DATA, "tracks")
    DB_PATH   = os.path.join(_DATA, "library.db")

os.makedirs(AUDIO_DIR, exist_ok=True)

_lock = threading.Lock()


def _conn():
    c = sqlite3.connect(DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with _lock, _conn() as c:
        c.execute("""
        create table if not exists tracks (
            id            integer primary key autoincrement,
            title         text,
            prompt        text not null,
            negative      text default '',
            duration      real,
            model         text,
            guidance      real,
            temperature   real,
            seed          integer,
            filepath      text not null,
            waveform_path text default '',
            cover_path    text default '',
            sample_rate   integer,
            bpm           real,
            musical_key   text,
            tags          text default '',
            favorite      integer default 0,
            rating        integer default 0,
            play_count    integer default 0,
            collection    text default 'All Tracks',
            synced        integer default 0,
            project_id    integer default 0,
            version       integer default 1,
            parent_id     integer default 0,
            edit_label    text default '',
            stems_json    text default '',
            created_at    text not null
        )
        """)
        c.execute("create index if not exists idx_created on tracks(created_at desc)")
        c.execute("create index if not exists idx_fav on tracks(favorite)")
        c.execute("create index if not exists idx_collection on tracks(collection)")
        # idempotent migrations for columns added after first release
        existing = {r["name"] for r in c.execute("pragma table_info(tracks)")}
        for col, decl in [("waveform_path", "text default ''"),
                          ("cover_path", "text default ''"),
                          ("project_id", "integer default 0"),
                          ("version", "integer default 1"),
                          ("parent_id", "integer default 0"),
                          ("edit_label", "text default ''"),
                          ("stems_json", "text default ''"),
                          ("notes", "text default ''")]:
            if col not in existing:
                c.execute(f"alter table tracks add column {col} {decl}")
        # index after the column is guaranteed to exist
        c.execute("create index if not exists idx_project on tracks(project_id)")

        # ── Playlists (many-to-many, ordered) ──────────────────────────────
        c.execute("""
        create table if not exists playlists (
            id          integer primary key autoincrement,
            name        text not null,
            created_at  text not null
        )
        """)
        c.execute("""
        create table if not exists playlist_tracks (
            playlist_id integer not null,
            track_id    integer not null,
            position    integer not null default 0,
            primary key (playlist_id, track_id)
        )
        """)
        c.execute("create index if not exists idx_pl_tracks on playlist_tracks(playlist_id, position)")


def _rel(path: str) -> str:
    """Store only the filename, not the full path. Survives username/machine changes."""
    return os.path.basename(path) if path else ""

def _abs(rel: str) -> str:
    """Resolve a stored filename back to its full path."""
    if not rel:
        return ""
    if os.path.isabs(rel):
        # Legacy absolute path from before this fix — transparently migrate it.
        return rel
    return os.path.join(AUDIO_DIR, rel)

def _resolve(row: dict) -> dict:
    """Expand relative path fields to absolute before returning to callers."""
    for col in ("filepath", "waveform_path", "cover_path"):
        if col in row and row[col]:
            row[col] = _abs(row[col])
    return row

def add_track(**kw) -> int:
    # Store only filenames, not full paths.
    for col in ("filepath", "waveform_path", "cover_path"):
        if kw.get(col):
            kw[col] = _rel(kw[col])
    cols = ["title", "prompt", "negative", "duration", "model", "guidance",
            "temperature", "seed", "filepath", "waveform_path", "cover_path",
            "sample_rate", "bpm", "musical_key", "tags", "favorite", "rating",
            "play_count", "collection", "project_id", "version", "parent_id",
            "edit_label", "stems_json", "notes", "created_at"]
    kw.setdefault("created_at", datetime.now(timezone.utc).isoformat())
    kw.setdefault("favorite", 0)
    kw.setdefault("rating", 0)
    kw.setdefault("play_count", 0)
    kw.setdefault("collection", "All Tracks")
    kw.setdefault("negative", "")
    kw.setdefault("tags", "")
    kw.setdefault("project_id", 0)
    kw.setdefault("version", 1)
    kw.setdefault("parent_id", 0)
    kw.setdefault("edit_label", "")
    kw.setdefault("stems_json", "")
    kw.setdefault("notes", "")
    vals = [kw.get(c) for c in cols]
    placeholders = ",".join("?" * len(cols))
    with _lock, _conn() as c:
        cur = c.execute(
            f"insert into tracks ({','.join(cols)}) values ({placeholders})", vals)
        new_id = cur.lastrowid
        # a brand-new track with no project becomes its own project (project_id = its id)
        if not kw.get("project_id"):
            c.execute("update tracks set project_id=? where id=?", (new_id, new_id))
    return new_id


def next_version(project_id: int) -> int:
    with _lock, _conn() as c:
        row = c.execute("select max(version) m from tracks where project_id=?",
                        (project_id,)).fetchone()
    return (row["m"] or 0) + 1


def add_version(parent_id: int, edit_label: str, **kw) -> int:
    """Add a new version to the SAME project as parent_id (an edit/derivative)."""
    parent = get_track(parent_id)
    pid = (parent or {}).get("project_id") or parent_id
    kw["project_id"] = pid
    kw["parent_id"] = parent_id
    kw["version"] = next_version(pid)
    kw["edit_label"] = edit_label
    return add_track(**kw)


def list_versions(project_id: int) -> list[dict]:
    with _lock, _conn() as c:
        rows = c.execute(
            "select * from tracks where project_id=? order by version asc",
            (project_id,)).fetchall()
    return [_resolve(dict(r)) for r in rows]


def update_track(track_id: int, **fields):
    if not fields:
        return
    for col in ("filepath", "waveform_path", "cover_path"):
        if fields.get(col):
            fields[col] = _rel(fields[col])
    sets = ",".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [track_id]
    with _lock, _conn() as c:
        c.execute(f"update tracks set {sets} where id=?", vals)


def delete_track(track_id: int, remove_file: bool = True):
    with _lock, _conn() as c:
        row = c.execute("select filepath from tracks where id=?", (track_id,)).fetchone()
        c.execute("delete from tracks where id=?", (track_id,))
    if remove_file and row and row["filepath"]:
        full = _abs(row["filepath"])
        if os.path.exists(full):
            try:
                os.remove(full)
            except OSError:
                pass


def get_track(track_id: int) -> Optional[dict]:
    with _lock, _conn() as c:
        row = c.execute("select * from tracks where id=?", (track_id,)).fetchone()
    return _resolve(dict(row)) if row else None


def duplicate_track(track_id: int) -> Optional[int]:
    """Copy a track (and its audio file) into a brand-new project so the
    original is never touched. Returns the new track id."""
    import shutil
    t = get_track(track_id)
    if not t:
        return None
    new_path = t["filepath"]
    if t["filepath"] and os.path.exists(t["filepath"]):
        root, ext = os.path.splitext(t["filepath"])
        new_path = f"{root}_copy_{datetime.now().strftime('%H%M%S')}{ext}"
        try:
            shutil.copy(t["filepath"], new_path)
        except OSError:
            new_path = t["filepath"]
    return add_track(
        title=(t["title"] or t["prompt"]) + " (copy)", prompt=t["prompt"],
        negative=t.get("negative", ""), duration=t["duration"], model=t["model"],
        guidance=t["guidance"], temperature=t.get("temperature"), seed=t["seed"],
        filepath=new_path, sample_rate=t["sample_rate"], bpm=t["bpm"],
        musical_key=t["musical_key"], tags=t.get("tags", ""),
        collection=t.get("collection", "All Tracks"))  # project_id=0 -> own project


def clone_track(track_id: int, new_filepath: str, edit_label: str = "") -> Optional[dict]:
    """Save a new version of a track pointing at a different audio file (e.g. after vocal merge)."""
    import shutil
    t = get_track(track_id)
    if not t:
        return None
    dest = os.path.join(AUDIO_DIR, os.path.basename(new_filepath))
    if new_filepath != dest:
        shutil.move(new_filepath, dest)
    new_id = add_track(
        title=t["title"], prompt=t["prompt"],
        negative=t.get("negative", ""), duration=t["duration"], model=t["model"],
        guidance=t["guidance"], temperature=t.get("temperature"), seed=t["seed"],
        filepath=dest, sample_rate=t["sample_rate"], bpm=t["bpm"],
        musical_key=t["musical_key"], tags=t.get("tags", ""),
        collection=t.get("collection", "All Tracks"),
        edit_label=edit_label,
    )
    return get_track(new_id)


def list_tracks(search: str = "", favorites_only: bool = False,
                collection: str = "", sort: str = "newest",
                min_duration: float = 0, max_duration: float = 0) -> list[dict]:
    q = "select * from tracks where 1=1"
    args: list = []
    if search:
        q += " and (prompt like ? or title like ? or tags like ?)"
        s = f"%{search}%"
        args += [s, s, s]
    if favorites_only:
        q += " and favorite=1"
    if collection and collection != "All Tracks":
        q += " and collection=?"
        args.append(collection)
    if min_duration > 0:
        q += " and duration >= ?"
        args.append(min_duration)
    if max_duration > 0:
        q += " and duration <= ?"
        args.append(max_duration)
    order = {
        "newest": "created_at desc",
        "oldest": "created_at asc",
        "rating": "rating desc, created_at desc",
        "plays": "play_count desc",
        "title": "title asc",
        "duration": "duration desc, created_at desc",
        "bpm": "bpm desc, created_at desc",
    }.get(sort, "created_at desc")
    q += f" order by {order}"
    with _lock, _conn() as c:
        rows = c.execute(q, args).fetchall()
    return [_resolve(dict(r)) for r in rows]


def list_collections() -> list[str]:
    with _lock, _conn() as c:
        rows = c.execute(
            "select distinct collection from tracks order by collection").fetchall()
    cols = [r["collection"] for r in rows if r["collection"]]
    if "All Tracks" not in cols:
        cols.insert(0, "All Tracks")
    return cols


# ── Playlists ────────────────────────────────────────────────────────────────
def create_playlist(name: str) -> int:
    name = (name or "Untitled Playlist").strip()[:120]
    with _lock, _conn() as c:
        cur = c.execute(
            "insert into playlists (name, created_at) values (?, ?)",
            (name, datetime.now(timezone.utc).isoformat()))
        return cur.lastrowid


def rename_playlist(playlist_id: int, name: str) -> None:
    name = (name or "Untitled Playlist").strip()[:120]
    with _lock, _conn() as c:
        c.execute("update playlists set name=? where id=?", (name, playlist_id))


def delete_playlist(playlist_id: int) -> None:
    with _lock, _conn() as c:
        c.execute("delete from playlist_tracks where playlist_id=?", (playlist_id,))
        c.execute("delete from playlists where id=?", (playlist_id,))


def list_playlists() -> list[dict]:
    """All playlists with track count + total duration."""
    with _lock, _conn() as c:
        rows = c.execute("""
            select p.id, p.name, p.created_at,
                   count(pt.track_id) as track_count,
                   coalesce(sum(t.duration), 0) as total_seconds
            from playlists p
            left join playlist_tracks pt on pt.playlist_id = p.id
            left join tracks t on t.id = pt.track_id
            group by p.id
            order by p.created_at desc
        """).fetchall()
    return [dict(r) for r in rows]


def get_playlist(playlist_id: int) -> dict | None:
    """One playlist with its tracks in order."""
    with _lock, _conn() as c:
        pl = c.execute("select * from playlists where id=?", (playlist_id,)).fetchone()
        if not pl:
            return None
        rows = c.execute("""
            select t.*, pt.position
            from playlist_tracks pt
            join tracks t on t.id = pt.track_id
            where pt.playlist_id = ?
            order by pt.position asc, pt.rowid asc
        """, (playlist_id,)).fetchall()
    return {**dict(pl), "tracks": [_resolve(dict(r)) for r in rows]}


def add_to_playlist(playlist_id: int, track_id: int) -> None:
    """Append a track to the end of a playlist (no-op if already present)."""
    with _lock, _conn() as c:
        exists = c.execute(
            "select 1 from playlist_tracks where playlist_id=? and track_id=?",
            (playlist_id, track_id)).fetchone()
        if exists:
            return
        nxt = c.execute(
            "select coalesce(max(position), -1) + 1 as p from playlist_tracks where playlist_id=?",
            (playlist_id,)).fetchone()["p"]
        c.execute(
            "insert into playlist_tracks (playlist_id, track_id, position) values (?, ?, ?)",
            (playlist_id, track_id, nxt))


def remove_from_playlist(playlist_id: int, track_id: int) -> None:
    with _lock, _conn() as c:
        c.execute("delete from playlist_tracks where playlist_id=? and track_id=?",
                  (playlist_id, track_id))


def reorder_playlist(playlist_id: int, track_ids: list[int]) -> None:
    """Set the order of a playlist from a full list of track ids."""
    with _lock, _conn() as c:
        for pos, tid in enumerate(track_ids):
            c.execute(
                "update playlist_tracks set position=? where playlist_id=? and track_id=?",
                (pos, playlist_id, tid))


def stats() -> dict:
    with _lock, _conn() as c:
        total = c.execute("select count(*) n from tracks").fetchone()["n"]
        favs = c.execute("select count(*) n from tracks where favorite=1").fetchone()["n"]
        plays = c.execute("select coalesce(sum(play_count),0) n from tracks").fetchone()["n"]
        dur = c.execute("select coalesce(sum(duration),0) n from tracks").fetchone()["n"]
    return {"total": total, "favorites": favs, "plays": plays, "total_seconds": dur}


def recover_orphans(audio_dir: str = AUDIO_DIR) -> int:
    """Re-import any .wav in the output folder that has no DB row.
    Rescues tracks whose metadata was lost. Skips stem_/_cover/_wave helpers."""
    import soundfile as sf
    with _lock, _conn() as c:
        known = {r["filepath"] for r in c.execute("select filepath from tracks")}
    recovered = 0
    SKIP = ("stem_",)
    SKIP_SUBSTR = ("_test", "_copy_", "_wave", "_cover")
    for fn in sorted(os.listdir(audio_dir)):
        if not fn.endswith(".wav"):
            continue
        if fn.startswith(SKIP) or any(s in fn for s in SKIP_SUBSTR):
            continue
        path = os.path.join(audio_dir, fn)
        # known may contain relative filenames or legacy absolute paths
        if path in known or fn in known:
            continue
        try:
            info = sf.info(path)
            dur = info.frames / info.samplerate
            sr = info.samplerate
        except Exception:
            dur, sr = 0, 32000
        # derive a title from the filename (strip timestamp prefix)
        title = fn.rsplit(".", 1)[0]
        parts = title.split("_", 3)
        nice = parts[3].replace("_", " ") if len(parts) > 3 else title
        add_track(title=nice[:60], prompt=nice, duration=dur, model="recovered",
                  guidance=0, seed=0, filepath=path, sample_rate=sr,
                  collection="Recovered")
        recovered += 1
    return recovered


# ── Optional Supabase sync ───────────────────────────────────────────────────────
_sb = None


def _supabase():
    global _sb
    if _sb is not None:
        return _sb
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return None
    try:
        from supabase import create_client
        _sb = create_client(url, key)
        return _sb
    except Exception as e:
        print(f"[library] Supabase unavailable: {e}")
        return None


def sync_to_supabase(track_id: int) -> bool:
    """Best-effort: upload metadata + audio file. Never blocks generation."""
    sb = _supabase()
    if not sb:
        return False
    t = get_track(track_id)
    if not t:
        return False
    try:
        # Upload audio to storage bucket "music"
        public_url = None
        if t["filepath"] and os.path.exists(t["filepath"]):
            with open(t["filepath"], "rb") as f:
                data = f.read()
            key = os.path.basename(t["filepath"])
            try:
                sb.storage.from_("music").upload(
                    key, data, {"content-type": "audio/wav", "upsert": "true"})
            except Exception:
                pass  # bucket may not exist yet; metadata still syncs
            try:
                public_url = sb.storage.from_("music").get_public_url(key)
            except Exception:
                public_url = None

        payload = {k: t[k] for k in (
            "title", "prompt", "negative", "duration", "model", "guidance",
            "temperature", "seed", "bpm", "musical_key", "tags", "favorite",
            "rating", "collection", "created_at")}
        payload["local_id"] = track_id
        payload["audio_url"] = public_url
        sb.table("music_tracks").upsert(payload, on_conflict="local_id").execute()
        update_track(track_id, synced=1)
        return True
    except Exception as e:
        print(f"[library] sync failed for {track_id}: {e}")
        return False


init_db()

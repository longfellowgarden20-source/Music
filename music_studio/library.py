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

DB_PATH = "music_output/music_library.db"
AUDIO_DIR = "music_output"
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
                          ("stems_json", "text default ''")]:
            if col not in existing:
                c.execute(f"alter table tracks add column {col} {decl}")
        # index after the column is guaranteed to exist
        c.execute("create index if not exists idx_project on tracks(project_id)")


def add_track(**kw) -> int:
    cols = ["title", "prompt", "negative", "duration", "model", "guidance",
            "temperature", "seed", "filepath", "waveform_path", "cover_path",
            "sample_rate", "bpm", "musical_key", "tags", "favorite", "rating",
            "play_count", "collection", "project_id", "version", "parent_id",
            "edit_label", "stems_json", "created_at"]
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
    return [dict(r) for r in rows]


def update_track(track_id: int, **fields):
    if not fields:
        return
    sets = ",".join(f"{k}=?" for k in fields)
    vals = list(fields.values()) + [track_id]
    with _lock, _conn() as c:
        c.execute(f"update tracks set {sets} where id=?", vals)


def delete_track(track_id: int, remove_file: bool = True):
    with _lock, _conn() as c:
        row = c.execute("select filepath from tracks where id=?", (track_id,)).fetchone()
        c.execute("delete from tracks where id=?", (track_id,))
    if remove_file and row and row["filepath"] and os.path.exists(row["filepath"]):
        try:
            os.remove(row["filepath"])
        except OSError:
            pass


def get_track(track_id: int) -> Optional[dict]:
    with _lock, _conn() as c:
        row = c.execute("select * from tracks where id=?", (track_id,)).fetchone()
    return dict(row) if row else None


def list_tracks(search: str = "", favorites_only: bool = False,
                collection: str = "", sort: str = "newest") -> list[dict]:
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
    order = {
        "newest": "created_at desc",
        "oldest": "created_at asc",
        "rating": "rating desc, created_at desc",
        "plays": "play_count desc",
        "title": "title asc",
    }.get(sort, "created_at desc")
    q += f" order by {order}"
    with _lock, _conn() as c:
        rows = c.execute(q, args).fetchall()
    return [dict(r) for r in rows]


def list_collections() -> list[str]:
    with _lock, _conn() as c:
        rows = c.execute(
            "select distinct collection from tracks order by collection").fetchall()
    cols = [r["collection"] for r in rows if r["collection"]]
    if "All Tracks" not in cols:
        cols.insert(0, "All Tracks")
    return cols


def stats() -> dict:
    with _lock, _conn() as c:
        total = c.execute("select count(*) n from tracks").fetchone()["n"]
        favs = c.execute("select count(*) n from tracks where favorite=1").fetchone()["n"]
        plays = c.execute("select coalesce(sum(play_count),0) n from tracks").fetchone()["n"]
        dur = c.execute("select coalesce(sum(duration),0) n from tracks").fetchone()["n"]
    return {"total": total, "favorites": favs, "plays": plays, "total_seconds": dur}


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

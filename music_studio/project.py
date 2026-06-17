"""
Server-side DAW project state.

Everything the DAW UI needs to fully restore a session — mixer settings per stem
(volume/pan/mute/solo), markers, song-structure sections, loop region, zoom/view,
playback speed — lives here as one JSON blob keyed by track_id, persisted in SQLite
so closing and reopening a track restores the whole workspace.

This is *separate* from the edit history (history.py): history is the undoable stack
of audio operations; this is the non-undoable UI/session state. Auto-saved on change.

Table: daw_project(track_id PK, state_json, updated_at)
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone

from . import library

# What a fresh project looks like. The UI deep-merges this with whatever it loads,
# so adding a new key here is forward-compatible with old saved projects.
DEFAULTS = {
    "mixer": {},          # {stem: {vol, pan, mute, solo}}
    "markers": [],        # [{id, time, label}]
    "sections": [],       # [{id, name, start, end, color}]  song structure
    "loop": {"on": False, "a": 0.0, "b": 0.0},
    "view": {"zoom": 1.0, "laneH": 88, "showGrid": True, "snap": True, "useBars": False},
    "rate": 1.0,
    "masterVol": 1.0,
}


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(library.DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def init():
    with library._lock, _conn() as c:
        c.execute("""
        create table if not exists daw_project (
            track_id   integer primary key,
            state_json text default '{}',
            updated_at text
        )
        """)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _merge(base: dict, over: dict) -> dict:
    """Shallow-deep merge: dict values merge one level down, everything else replaced."""
    out = dict(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
        else:
            out[k] = v
    return out


def get(track_id: int) -> dict:
    """Saved state merged over DEFAULTS, so the UI always gets every key."""
    init()
    with library._lock, _conn() as c:
        row = c.execute("select state_json from daw_project where track_id=?",
                        (track_id,)).fetchone()
    saved = {}
    if row:
        try:
            saved = json.loads(row["state_json"] or "{}")
        except Exception:
            saved = {}
    return {"track_id": track_id, "state": _merge(DEFAULTS, saved)}


def save(track_id: int, state: dict) -> dict:
    """Merge a partial state patch over what's saved (auto-save sends patches)."""
    init()
    with library._lock, _conn() as c:
        row = c.execute("select state_json from daw_project where track_id=?",
                        (track_id,)).fetchone()
        cur = {}
        if row:
            try:
                cur = json.loads(row["state_json"] or "{}")
            except Exception:
                cur = {}
        merged = _merge(cur, state or {})
        c.execute("""
            insert into daw_project (track_id, state_json, updated_at)
            values (?,?,?)
            on conflict(track_id) do update set
                state_json=excluded.state_json, updated_at=excluded.updated_at
        """, (track_id, json.dumps(merged), _now()))
    return {"track_id": track_id, "state": _merge(DEFAULTS, merged)}

"""
Server-side edit history for the DAW.

Each track has an *edit stack* (ordered list of clip operations) plus a pointer
(`head`) marking how many ops are currently "live". Undo decrements the pointer,
redo increments it, and pushing a new op truncates anything past the pointer
(standard undo-stack semantics) then appends.

Only ops[:head] are applied at render time, so undo/redo is non-destructive and
survives a page reload because the whole thing lives in SQLite.

Table: daw_history(track_id PK, ops_json, head, updated_at)
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone

from . import library


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(library.DB_PATH, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def init():
    with library._lock, _conn() as c:
        c.execute("""
        create table if not exists daw_history (
            track_id   integer primary key,
            ops_json   text default '[]',
            head       integer default 0,
            updated_at text
        )
        """)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _read(c, track_id: int) -> tuple[list, int]:
    row = c.execute("select ops_json, head from daw_history where track_id=?",
                    (track_id,)).fetchone()
    if not row:
        return [], 0
    try:
        ops = json.loads(row["ops_json"] or "[]")
    except Exception:
        ops = []
    return ops, int(row["head"] or 0)


def _write(c, track_id: int, ops: list, head: int):
    c.execute("""
        insert into daw_history (track_id, ops_json, head, updated_at)
        values (?,?,?,?)
        on conflict(track_id) do update set
            ops_json=excluded.ops_json, head=excluded.head, updated_at=excluded.updated_at
    """, (track_id, json.dumps(ops), head, _now()))


def get(track_id: int) -> dict:
    """Full state for the UI: every op, the live count, and undo/redo availability."""
    init()
    with library._lock, _conn() as c:
        ops, head = _read(c, track_id)
    return {
        "track_id": track_id,
        "ops": ops,
        "head": head,
        "live_ops": ops[:head],
        "can_undo": head > 0,
        "can_redo": head < len(ops),
    }


def push(track_id: int, op: dict) -> dict:
    """Add an op at the current head, discarding any redo-able ops past it."""
    init()
    with library._lock, _conn() as c:
        ops, head = _read(c, track_id)
        ops = ops[:head]            # truncate redo branch
        ops.append(op)
        head = len(ops)
        _write(c, track_id, ops, head)
    return get(track_id)


def undo(track_id: int) -> dict:
    init()
    with library._lock, _conn() as c:
        ops, head = _read(c, track_id)
        head = max(0, head - 1)
        _write(c, track_id, ops, head)
    return get(track_id)


def redo(track_id: int) -> dict:
    init()
    with library._lock, _conn() as c:
        ops, head = _read(c, track_id)
        head = min(len(ops), head + 1)
        _write(c, track_id, ops, head)
    return get(track_id)


def clear(track_id: int) -> dict:
    init()
    with library._lock, _conn() as c:
        _write(c, track_id, [], 0)
    return get(track_id)


def replace(track_id: int, ops: list, head: int | None = None) -> dict:
    """Overwrite the whole stack (used when the UI reorders/edits ops directly)."""
    init()
    head = len(ops) if head is None else max(0, min(head, len(ops)))
    with library._lock, _conn() as c:
        _write(c, track_id, ops, head)
    return get(track_id)

"use client";
import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api, fmtTime, type Playlist, type PlaylistDetail, type Track } from "../lib/api";
import { usePlayer } from "../components/PlayerProvider";

function fmtTotal(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function PlaylistsPage() {
  const { play, playQueue, current, playing, toggle } = usePlayer();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlaylistDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // add-tracks picker
  const [picking, setPicking] = useState(false);
  const [libTracks, setLibTracks] = useState<Track[]>([]);
  const [pickSearch, setPickSearch] = useState("");
  const [adding, setAdding] = useState<Set<number>>(new Set());

  const loadList = useCallback(() => {
    setLoading(true);
    api.playlists()
      .then(p => { setPlaylists(p); setLoading(false); setError(""); })
      .catch(() => { setError("Cannot reach API on :8765 — is the backend running?"); setLoading(false); });
  }, []);

  const loadDetail = useCallback((id: number) => {
    api.playlist(id).then(setDetail).catch(() => setDetail(null));
  }, []);

  // Initial + reactive data loads. loadList/loadDetail set loading state then
  // fetch async — the cascading-render rule is a false positive across the await.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    if (openId != null) { loadDetail(openId); return; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetail(null);
  }, [openId, loadDetail]);

  const createPlaylist = async () => {
    const name = newName.trim() || "Untitled Playlist";
    setCreating(true);
    try {
      const { id } = await api.createPlaylist(name);
      setNewName("");
      loadList();
      setOpenId(id);
    } finally { setCreating(false); }
  };

  const deletePlaylist = async (id: number, name: string) => {
    if (!confirm(`Delete playlist "${name}"? (Your tracks are not deleted.)`)) return;
    await api.deletePlaylist(id);
    if (openId === id) setOpenId(null);
    loadList();
  };

  const removeTrack = async (trackId: number) => {
    if (openId == null) return;
    await api.removeFromPlaylist(openId, trackId);
    loadDetail(openId);
    loadList();
  };

  const saveRename = async () => {
    if (openId == null) return;
    const name = renameVal.trim() || "Untitled Playlist";
    await api.renamePlaylist(openId, name);
    setRenaming(false);
    loadDetail(openId);
    loadList();
  };

  const playAll = (tracks: Track[]) => { if (tracks.length) playQueue(tracks, 0); };

  // open the "add tracks" picker — load the full library
  const openPicker = async () => {
    setPicking(true);
    setPickSearch("");
    try { setLibTracks(await api.tracks({ sort: "newest" })); } catch {}
  };

  const addTrackToOpen = async (tid: number) => {
    if (openId == null) return;
    setAdding(prev => new Set(prev).add(tid));
    try {
      await api.addToPlaylist(openId, tid);
      loadDetail(openId);
      loadList();
    } finally {
      setAdding(prev => { const n = new Set(prev); n.delete(tid); return n; });
    }
  };

  // drag-to-reorder within the open playlist
  const onDrop = async (targetIdx: number) => {
    if (dragIdx == null || openId == null || !detail || dragIdx === targetIdx) { setDragIdx(null); return; }
    const ids = detail.tracks.map(t => t.id);
    const [moved] = ids.splice(dragIdx, 1);
    ids.splice(targetIdx, 0, moved);
    // optimistic
    const reordered = ids.map(id => detail.tracks.find(t => t.id === id)!).filter(Boolean);
    setDetail({ ...detail, tracks: reordered });
    setDragIdx(null);
    await api.reorderPlaylist(openId, ids);
  };

  return (
    <div style={{ padding: "28px max(20px,4vw) 120px", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: -0.5, marginBottom: 4 }}>Playlists</h1>
      <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 24 }}>
        Group your tracks into ordered sets. Drag to reorder, play straight through.
      </p>

      {/* create */}
      <div style={{ display: "flex", gap: 8, marginBottom: 28, maxWidth: 460 }}>
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") createPlaylist(); }}
          placeholder="New playlist name…"
          style={{
            flex: 1, background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 8,
            padding: "10px 12px", color: "var(--text)", fontSize: 13, outline: "none",
          }} />
        <button onClick={createPlaylist} disabled={creating}
          style={{
            background: "var(--accent, #1db954)", color: "#000", border: "none", borderRadius: 8,
            padding: "0 18px", fontSize: 13, fontWeight: 700, cursor: creating ? "wait" : "pointer",
          }}>
          {creating ? "…" : "Create"}
        </button>
      </div>

      {error && <div style={{ color: "#f87171", fontSize: 13, marginBottom: 16 }}>{error}</div>}
      {loading && <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>}

      {!loading && !error && playlists.length === 0 && (
        <div style={{ color: "var(--muted)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
          No playlists yet. Create one above, then add tracks from your Library.
        </div>
      )}

      {/* playlist grid */}
      {!openId && playlists.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 14 }}>
          {playlists.map(p => (
            <div key={p.id}
              onClick={() => setOpenId(p.id)}
              style={{
                background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 12,
                padding: 16, cursor: "pointer", transition: "border-color .15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--accent, #1db954)")}
              onMouseLeave={e => (e.currentTarget.style.borderColor = "var(--line)")}>
              <div style={{
                width: 48, height: 48, borderRadius: 10, marginBottom: 12,
                background: "linear-gradient(135deg, #1db95433, #1db95411)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
              }}>♫</div>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {p.track_count} {p.track_count === 1 ? "track" : "tracks"}{p.total_seconds > 0 ? ` · ${fmtTotal(p.total_seconds)}` : ""}
              </div>
              <button onClick={e => { e.stopPropagation(); deletePlaylist(p.id, p.name); }}
                style={{ marginTop: 10, background: "none", border: "none", color: "var(--muted2,#888)", fontSize: 11, cursor: "pointer", padding: 0 }}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {/* opened playlist detail */}
      {openId && detail && (
        <div>
          <button onClick={() => setOpenId(null)}
            style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 13, cursor: "pointer", marginBottom: 16, padding: 0 }}>
            ← All playlists
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            {renaming ? (
              <input autoFocus value={renameVal} onChange={e => setRenameVal(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveRename(); if (e.key === "Escape") setRenaming(false); }}
                onBlur={saveRename}
                style={{ fontSize: 24, fontWeight: 800, background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 8, padding: "4px 10px", color: "var(--text)", outline: "none" }} />
            ) : (
              <h2 style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}
                onDoubleClick={() => { setRenameVal(detail.name); setRenaming(true); }}>
                {detail.name}
              </h2>
            )}
            <span style={{ fontSize: 13, color: "var(--muted)" }}>
              {detail.tracks.length} {detail.tracks.length === 1 ? "track" : "tracks"}
            </span>
            <div style={{ flex: 1 }} />
            <button onClick={openPicker}
              style={{ background: "var(--bg3)", color: "var(--accent,#1db954)", border: "1px solid var(--accent,#1db954)", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
              ＋ Add Tracks
            </button>
            <button onClick={() => playAll(detail.tracks)} disabled={!detail.tracks.length}
              style={{ background: "var(--accent,#1db954)", color: "#000", border: "none", borderRadius: 500, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: detail.tracks.length ? "pointer" : "default", opacity: detail.tracks.length ? 1 : 0.5 }}>
              ▶ Play all
            </button>
            <button onClick={() => { setRenameVal(detail.name); setRenaming(true); }}
              style={{ background: "var(--bg3)", color: "var(--text)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 14px", fontSize: 12, cursor: "pointer" }}>
              Rename
            </button>
          </div>

          {detail.tracks.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 14, padding: "40px 0", textAlign: "center" }}>
              This playlist is empty. Go to your <Link href="/" style={{ color: "var(--accent,#1db954)" }}>Library</Link> and use “+ Playlist” on a track.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {detail.tracks.map((t, i) => {
                const isCurrent = current?.id === t.id;
                return (
                  <div key={t.id}
                    draggable
                    onDragStart={() => setDragIdx(i)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => onDrop(i)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                      borderRadius: 8, background: isCurrent ? "var(--bg3)" : "transparent",
                      cursor: "grab", opacity: dragIdx === i ? 0.4 : 1,
                    }}
                    onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.background = "var(--bg2)"; }}
                    onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}>
                    <span style={{ width: 22, textAlign: "right", color: "var(--muted2,#888)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                    <button onClick={() => isCurrent ? toggle() : play(t, detail.tracks, i)}
                      style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: "var(--accent,#1db954)", color: "#000", cursor: "pointer", fontSize: 12, flexShrink: 0 }}>
                      {isCurrent && playing ? "❚❚" : "▶"}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: isCurrent ? "var(--accent,#1db954)" : "var(--text)" }}>
                        {t.title || t.prompt}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--muted)" }}>
                        {t.bpm ? `${Math.round(t.bpm)} BPM` : ""}{t.key ? ` · ${t.key}` : ""}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{fmtTime(t.duration)}</span>
                    <button onClick={() => removeTrack(t.id)}
                      title="Remove from playlist"
                      style={{ background: "none", border: "none", color: "var(--muted2,#888)", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>×</button>
                  </div>
                );
              })}
              <div style={{ fontSize: 11, color: "var(--muted2,#888)", marginTop: 10, textAlign: "center" }}>
                Drag tracks to reorder
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add-tracks picker modal */}
      {picking && detail && (
        <div onClick={() => setPicking(false)} style={{
          position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={e => e.stopPropagation()} style={{
            background: "var(--bg1,#181818)", border: "1px solid var(--line)", borderRadius: 14,
            width: "min(560px, 100%)", maxHeight: "80vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
          }}>
            <div style={{ padding: "16px 18px 12px", borderBottom: "1px solid var(--line)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <h3 style={{ fontSize: 17, fontWeight: 800 }}>Add tracks to “{detail.name}”</h3>
                <button onClick={() => setPicking(false)} style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
              </div>
              <input autoFocus value={pickSearch} onChange={e => setPickSearch(e.target.value)}
                placeholder="Search your library…"
                style={{ width: "100%", background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px", color: "var(--text)", fontSize: 13, outline: "none" }} />
            </div>
            <div style={{ overflowY: "auto", padding: 8 }}>
              {(() => {
                const inPlaylist = new Set(detail.tracks.map(t => t.id));
                const q = pickSearch.trim().toLowerCase();
                const filtered = libTracks.filter(t =>
                  !q || (t.title || t.prompt || "").toLowerCase().includes(q));
                if (filtered.length === 0) return <div style={{ color: "var(--muted)", fontSize: 13, padding: 24, textAlign: "center" }}>No tracks found.</div>;
                return filtered.map(t => {
                  const already = inPlaylist.has(t.id);
                  const busy = adding.has(t.id);
                  return (
                    <div key={t.id} style={{
                      display: "flex", alignItems: "center", gap: 12, padding: "9px 10px",
                      borderRadius: 8,
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg2)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <button onClick={() => play(t)} title="Preview"
                        style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: "var(--bg3)", color: "var(--text)", cursor: "pointer", fontSize: 11, flexShrink: 0 }}>▶</button>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title || t.prompt}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{t.bpm ? `${Math.round(t.bpm)} BPM` : ""}{t.key ? ` · ${t.key}` : ""} · {fmtTime(t.duration)}</div>
                      </div>
                      <button onClick={() => addTrackToOpen(t.id)} disabled={already || busy}
                        style={{
                          border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 700,
                          cursor: already ? "default" : "pointer", flexShrink: 0,
                          background: already ? "var(--bg3)" : "var(--accent,#1db954)",
                          color: already ? "var(--muted)" : "#000", opacity: busy ? 0.6 : 1,
                        }}>
                        {already ? "Added ✓" : busy ? "…" : "＋ Add"}
                      </button>
                    </div>
                  );
                });
              })()}
            </div>
            <div style={{ padding: "10px 18px", borderTop: "1px solid var(--line)", textAlign: "right" }}>
              <button onClick={() => setPicking(false)}
                style={{ background: "var(--accent,#1db954)", color: "#000", border: "none", borderRadius: 8, padding: "8px 20px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

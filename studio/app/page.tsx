"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { api, API, fmtTime, fmtDate, type Track, type Stats, type Playlist } from "./lib/api";
import { usePlayer } from "./components/PlayerProvider";
import Waveform from "./components/Waveform";

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "duration", label: "Longest" },
  { value: "rating", label: "Top rated" },
  { value: "bpm", label: "BPM ↓" },
];

const EXPORT_FORMATS = ["wav", "mp3", "flac", "aiff", "m4a", "ogg"];

export default function LibraryPage() {
  const router = useRouter();
  const { play, current, playing, toggle } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("");
  const [sort, setSort] = useState("newest");
  const [favOnly, setFavOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // new: client-side filters
  const [tagFilter, setTagFilter] = useState<string>("");
  const [bpmMin, setBpmMin] = useState<number | "">("");
  const [bpmMax, setBpmMax] = useState<number | "">("");
  const [keyFilter, setKeyFilter] = useState<string>("");

  // new: bulk select mode
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  // new: per-track tag editing
  const [tagEditId, setTagEditId] = useState<number | null>(null);
  const [tagEditVal, setTagEditVal] = useState("");

  // new: track details modal
  const [detailTrack, setDetailTrack] = useState<Track | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api.tracks({ search, collection, sort, favorites: favOnly })
      .then(t => { setTracks(t); setLoading(false); setError(""); })
      .catch(() => { setError("Cannot reach API on :8765 — is the backend running?"); setLoading(false); });
  }, [search, collection, sort, favOnly]);

  const refreshMeta = useCallback(() => {
    api.collections().then(setCollections).catch(() => {});
    api.stats().then(setStats).catch(() => {});
    api.allTags().then(setAllTags).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { refreshMeta(); }, [refreshMeta]);

  const onFav = async (t: Track) => { await api.favorite(t.id); load(); };
  const onDelete = async (t: Track) => {
    if (!confirm(`Delete "${t.title}"? This removes the file too.`)) return;
    await api.remove(t.id); load(); refreshMeta();
  };
  const onRate = async (t: Track, r: number) => {
    await api.rate(t.id, r);
    setTracks(prev => prev.map(x => x.id === t.id ? { ...x, rating: r } : x));
  };

  const saveTags = async (t: Track) => {
    await api.setTags(t.id, tagEditVal);
    setTracks(prev => prev.map(x => x.id === t.id ? { ...x, tags: tagEditVal.split(",").map(s => s.trim()).filter(Boolean).join(",") } : x));
    setTagEditId(null);
    refreshMeta();
  };

  const importFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setImporting(true);
    setImportMsg(`Importing ${list.length} file${list.length > 1 ? "s" : ""}…`);
    let ok = 0, fail = 0;
    for (const f of list) {
      try { await api.importAudio(f); ok++; }
      catch (e: any) { fail++; setImportMsg(`Failed: ${e.message}`); }
    }
    setImporting(false);
    setImportMsg(fail ? `${ok} imported, ${fail} failed` : `✅ ${ok} track${ok > 1 ? "s" : ""} imported`);
    load(); refreshMeta();
    setTimeout(() => setImportMsg(""), 4000);
  }, [load, refreshMeta]);

  // ── bulk ops ──────────────────────────────────────────────────────────────
  const toggleSelect = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const clearSelect = () => { setSelected(new Set()); setSelectMode(false); };

  const bulkDelete = async () => {
    if (!confirm(`Delete ${selected.size} track${selected.size > 1 ? "s" : ""}? Files are removed too.`)) return;
    await api.bulk([...selected], "delete");
    clearSelect(); load(); refreshMeta();
  };
  const bulkMove = async () => {
    const dest = prompt("Move selected tracks to which collection?", "All Tracks");
    if (!dest) return;
    await api.bulk([...selected], "collection", dest);
    clearSelect(); load(); refreshMeta();
  };
  const bulkTag = async () => {
    const tag = prompt("Add which tag to selected tracks?");
    if (!tag) return;
    await api.bulk([...selected], "add_tag", tag);
    clearSelect(); load(); refreshMeta();
  };
  const bulkFav = async () => {
    await api.bulk([...selected], "favorite", "1");
    clearSelect(); load(); refreshMeta();
  };

  // ── client-side filtering (tag / bpm / key) ───────────────────────────────
  const visible = tracks.filter(t => {
    if (tagFilter && !(t.tags || "").split(",").map(s => s.trim()).includes(tagFilter)) return false;
    if (keyFilter && t.key !== keyFilter) return false;
    if (bpmMin !== "" && (t.bpm ?? 0) < bpmMin) return false;
    if (bpmMax !== "" && (t.bpm ?? 9999) > bpmMax) return false;
    return true;
  });

  const availableKeys = Array.from(new Set(tracks.map(t => t.key).filter(Boolean))).sort() as string[];
  const filtersActive = tagFilter || keyFilter || bpmMin !== "" || bpmMax !== "";

  return (
    <div
      style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 100px" }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); importFiles(e.dataTransfer.files); }}
    >
      {dragOver && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center",
          background: "rgba(8,10,14,0.88)", border: "2px dashed var(--accent)", pointerEvents: "none",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 48 }}>🎵</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--accent)", marginTop: 12 }}>Drop audio files to import</div>
            <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 6 }}>WAV · MP3 · FLAC · OGG · M4A · AIFF · AAC · and more</div>
          </div>
        </div>
      )}

      {/* stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <StatChip label="Tracks" value={stats?.total ?? "—"} />
        <StatChip label="Favorites" value={stats?.favorites ?? "—"} />
        <StatChip label="Total time" value={stats ? fmtTime(stats.total_seconds) : "—"} />
        <StatChip label="Plays" value={stats?.plays ?? "—"} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {importMsg && <span style={{ fontSize: 12, color: importMsg.startsWith("✅") ? "var(--accent)" : importMsg.startsWith("Failed") ? "var(--red)" : "var(--muted)" }}>{importMsg}</span>}
          <button className="btn" onClick={() => { setSelectMode(m => !m); setSelected(new Set()); }}
            style={{ borderColor: selectMode ? "var(--accent)" : undefined, color: selectMode ? "var(--accent)" : "var(--muted)" }}>
            {selectMode ? "✓ Selecting" : "☑ Select"}
          </button>
          <label className="btn" style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, cursor: importing ? "default" : "pointer", opacity: importing ? 0.6 : 1 }}>
            {importing ? <span className="spinner" /> : "⬆"} Import
            <input type="file" multiple
              accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aiff,.aif,.aac,.opus,.wma"
              style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
              onChange={e => { if (e.target.files?.length) { importFiles(e.target.files); e.target.value = ""; } }}
            />
          </label>
          <button className="btn btn-primary" onClick={() => router.push("/generate")}>+ New Track</button>
        </div>
      </div>

      {/* bulk action bar */}
      {selectMode && (
        <div style={{
          display: "flex", gap: 8, alignItems: "center", marginBottom: 14, padding: "10px 14px",
          background: "var(--bg2)", border: "1px solid var(--accent)", borderRadius: 8,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent)" }}>{selected.size} selected</span>
          <button className="btn" style={{ fontSize: 12 }} disabled={!selected.size} onClick={bulkFav}>♥ Favorite</button>
          <button className="btn" style={{ fontSize: 12 }} disabled={!selected.size} onClick={bulkTag}>🏷 Add tag</button>
          <button className="btn" style={{ fontSize: 12 }} disabled={!selected.size} onClick={bulkMove}>📁 Move to…</button>
          <button className="btn" style={{ fontSize: 12, color: "var(--red)" }} disabled={!selected.size} onClick={bulkDelete}>🗑 Delete</button>
          <button className="btn" style={{ fontSize: 12, marginLeft: "auto", color: "var(--muted)" }}
            onClick={() => setSelected(new Set(visible.map(t => t.id)))}>Select all ({visible.length})</button>
          <button className="btn" style={{ fontSize: 12, color: "var(--muted)" }} onClick={clearSelect}>Cancel</button>
        </div>
      )}

      {/* filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" style={{ maxWidth: 240 }} placeholder="Search tracks…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input" style={{ width: "auto" }} value={collection} onChange={e => setCollection(e.target.value)}>
          <option value="">All collections</option>
          {collections.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" style={{ width: "auto" }} value={sort} onChange={e => setSort(e.target.value)}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="btn" onClick={() => setFavOnly(f => !f)}
          style={{ borderColor: favOnly ? "var(--pink)" : undefined, color: favOnly ? "var(--pink)" : undefined }}>♥ Favorites</button>
      </div>

      {/* DJ filters: BPM range + key + tags */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--muted2)", fontWeight: 700, letterSpacing: 1 }}>BPM</span>
        <input className="input" type="number" placeholder="min" style={{ width: 70 }}
          value={bpmMin} onChange={e => setBpmMin(e.target.value ? +e.target.value : "")} />
        <span style={{ color: "var(--muted2)" }}>–</span>
        <input className="input" type="number" placeholder="max" style={{ width: 70 }}
          value={bpmMax} onChange={e => setBpmMax(e.target.value ? +e.target.value : "")} />
        <select className="input" style={{ width: "auto" }} value={keyFilter} onChange={e => setKeyFilter(e.target.value)}>
          <option value="">Any key</option>
          {availableKeys.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <select className="input" style={{ width: "auto" }} value={tagFilter} onChange={e => setTagFilter(e.target.value)}>
          <option value="">Any tag</option>
          {allTags.map(t => <option key={t.tag} value={t.tag}>{t.tag} ({t.count})</option>)}
        </select>
        {filtersActive && (
          <button className="btn" style={{ fontSize: 12, color: "var(--muted)" }}
            onClick={() => { setTagFilter(""); setKeyFilter(""); setBpmMin(""); setBpmMax(""); }}>✕ Clear filters</button>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted2)" }}>{visible.length} of {tracks.length}</span>
      </div>

      {loading && <div style={{ color: "var(--muted)", textAlign: "center", padding: 60 }}>Loading…</div>}
      {error && <div style={{ color: "var(--red)", textAlign: "center", padding: 60 }}>{error}</div>}
      {!loading && !error && visible.length === 0 &&
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 60 }}>No tracks match.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
        {visible.map(t => {
          const isCurrent = current?.id === t.id;
          const isSel = selected.has(t.id);
          const tags = (t.tags || "").split(",").map(s => s.trim()).filter(Boolean);
          return (
            <div key={t.id} className="card" style={{
              padding: 14, display: "flex", flexDirection: "column", gap: 10,
              outline: isSel ? "2px solid var(--accent)" : "none",
              cursor: selectMode ? "pointer" : "default",
            }}
              onClick={selectMode ? () => toggleSelect(t.id) : undefined}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                {selectMode ? (
                  <div style={{
                    width: 38, height: 38, borderRadius: 8, flexShrink: 0, display: "flex",
                    alignItems: "center", justifyContent: "center", fontSize: 18,
                    border: `2px solid ${isSel ? "var(--accent)" : "var(--muted2)"}`,
                    color: isSel ? "var(--accent)" : "var(--muted2)",
                    background: isSel ? "rgba(34,197,94,0.12)" : "transparent",
                  }}>{isSel ? "✓" : ""}</div>
                ) : (
                  <button onClick={() => isCurrent ? toggle() : play(t, visible, visible.findIndex(x => x.id === t.id))} style={{
                    width: 38, height: 38, borderRadius: "50%", border: "none", flexShrink: 0,
                    background: "linear-gradient(95deg,var(--accent),var(--accent2))",
                    color: "#fff", fontSize: 14, cursor: "pointer"
                  }}>{isCurrent && playing ? "⏸" : "▶"}</button>
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    onClick={selectMode ? undefined : (e) => { e.stopPropagation(); setDetailTrack(t); }}
                    title="Click for full generation details"
                    style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: selectMode ? "inherit" : "pointer" }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                    <span>{fmtTime(t.duration)}</span>
                    {t.bpm && <span>{Math.round(t.bpm)} BPM</span>}
                    {t.key && <span>{t.key}</span>}
                    <span style={{ textTransform: "uppercase", opacity: .6 }}>{t.model}</span>
                  </div>
                </div>
                {!selectMode && (
                  <button onClick={() => onFav(t)} style={{
                    background: "none", border: "none", cursor: "pointer", fontSize: 16,
                    color: t.favorite ? "var(--pink)" : "var(--muted2)"
                  }}>{t.favorite ? "♥" : "♡"}</button>
                )}
              </div>

              <Waveform trackId={t.id} height={44} color={isCurrent ? "#1ed760" : "#1db954"} />

              {/* tags row */}
              {!selectMode && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", minHeight: 20 }} onClick={e => e.stopPropagation()}>
                  {tagEditId === t.id ? (
                    <input autoFocus className="input" style={{ fontSize: 11, padding: "3px 8px", height: 24 }}
                      value={tagEditVal} placeholder="tag1, tag2…"
                      onChange={e => setTagEditVal(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveTags(t); if (e.key === "Escape") setTagEditId(null); }}
                      onBlur={() => saveTags(t)} />
                  ) : (
                    <>
                      {tags.map(tag => (
                        <span key={tag} onClick={() => setTagFilter(tag)} style={{
                          fontSize: 10, color: "var(--accent2)", background: "var(--bg3)",
                          padding: "2px 7px", borderRadius: 5, cursor: "pointer",
                        }}>{tag}</span>
                      ))}
                      <button onClick={() => { setTagEditId(t.id); setTagEditVal(tags.join(", ")); }} style={{
                        fontSize: 10, color: "var(--muted2)", background: "none", border: "1px dashed var(--muted2)",
                        padding: "1px 6px", borderRadius: 5, cursor: "pointer",
                      }}>+ tag</button>
                    </>
                  )}
                </div>
              )}

              {/* rating */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", gap: 2 }}>
                  {[1, 2, 3, 4, 5].map(r => (
                    <button key={r} onClick={() => onRate(t, r === t.rating ? 0 : r)} style={{
                      background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0,
                      color: r <= t.rating ? "var(--amber)" : "var(--muted2)"
                    }}>★</button>
                  ))}
                </div>
                {t.edit_label && <span style={{ fontSize: 10, color: "var(--muted)", background: "var(--bg3)", padding: "2px 7px", borderRadius: 5 }}>{t.edit_label}</span>}
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted2)" }}>{fmtDate(t.created_at)}</span>
              </div>

              {/* actions */}
              {!selectMode && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
                  <button className="btn btn-primary" style={{ flex: "1 1 100%", padding: "6px 0", fontSize: 12, fontWeight: 700 }}
                    onClick={() => router.push(`/daw?id=${t.id}`)}>Open in DAW</button>
                  <button className="btn" style={{ padding: "6px 10px", fontSize: 12, color: "var(--muted)" }}
                    onClick={() => router.push(`/edit?id=${t.id}`)}>Edit</button>
                  <button className="btn" style={{ padding: "6px 9px", fontSize: 12, color: "var(--muted)" }}
                    title="Generation details" onClick={() => setDetailTrack(t)}>ⓘ</button>
                  <button className="btn" style={{ padding: "6px 12px", fontSize: 12, color: "var(--accent)" }}
                    onClick={() => router.push(`/vocals?track=${t.id}`)}>🎤</button>
                  <AddToPlaylistButton track={t} />
                  <ExportMenu track={t} />
                  <button className="btn" style={{ padding: "6px 8px", fontSize: 11, color: "#fa2d55" }}
                    title="Add to Apple Music"
                    onClick={async () => {
                      try {
                        const r = await fetch(`${API}/api/add-to-apple-music/${t.id}`, { method: "POST" });
                        const d = await r.json();
                        if (!r.ok) throw new Error(d.detail);
                        alert("Added to Apple Music ✓");
                      } catch (e: any) { alert(`Failed: ${e.message}`); }
                    }}>♫</button>
                  <button className="btn" style={{ padding: "6px 12px", fontSize: 12, color: "var(--red)" }}
                    onClick={() => onDelete(t)}>🗑</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {detailTrack && <TrackDetailModal track={detailTrack} onClose={() => setDetailTrack(null)} />}
    </div>
  );
}

// ── add-to-playlist popover ──────────────────────────────────────────────────
function AddToPlaylistButton({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [done, setDone] = useState<string>("");

  const openMenu = async () => {
    setOpen(o => !o);
    if (!open) {
      setLoading(true);
      try { setPlaylists(await api.playlists()); } catch {} finally { setLoading(false); }
    }
  };

  const addTo = async (pid: number, name: string) => {
    try {
      await api.addToPlaylist(pid, track.id);
      setDone(`Added to ${name}`);
      setTimeout(() => { setDone(""); setOpen(false); }, 900);
    } catch { setDone("Failed"); }
  };

  const createAndAdd = async () => {
    const name = newName.trim() || "Untitled Playlist";
    try {
      const { id } = await api.createPlaylist(name);
      await api.addToPlaylist(id, track.id);
      setNewName("");
      setDone(`Added to ${name}`);
      setTimeout(() => { setDone(""); setOpen(false); }, 900);
    } catch { setDone("Failed"); }
  };

  return (
    <div style={{ position: "relative" }}>
      <button className="btn" style={{ padding: "6px 10px", fontSize: 12, color: "var(--accent)" }}
        title="Add to playlist" onClick={openMenu}>＋♫</button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", right: 0, zIndex: 41,
            background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 10,
            boxShadow: "0 10px 28px rgba(0,0,0,0.5)", padding: 6, width: 220,
          }}>
            {done ? (
              <div style={{ fontSize: 12, color: "var(--accent,#1db954)", fontWeight: 700, padding: "8px 10px", textAlign: "center" }}>✓ {done}</div>
            ) : (
              <>
                <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: "var(--muted2,#888)", padding: "4px 8px 6px" }}>ADD TO PLAYLIST</div>
                {loading && <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 10px" }}>Loading…</div>}
                {!loading && playlists.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 10px" }}>No playlists yet.</div>
                )}
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  {playlists.map(p => (
                    <button key={p.id} onClick={() => addTo(p.id, p.name)} style={{
                      display: "flex", justifyContent: "space-between", width: "100%", gap: 8,
                      padding: "8px 10px", borderRadius: 6, border: "none", cursor: "pointer",
                      background: "transparent", color: "var(--text)", fontSize: 12, textAlign: "left",
                    }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                      <span style={{ color: "var(--muted2,#888)", fontSize: 11 }}>{p.track_count}</span>
                    </button>
                  ))}
                </div>
                <div style={{ height: 1, background: "var(--line)", margin: "5px 6px" }} />
                <div style={{ display: "flex", gap: 5, padding: "2px 4px" }}>
                  <input value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") createAndAdd(); }}
                    placeholder="New playlist…"
                    style={{ flex: 1, minWidth: 0, background: "var(--bg0,#111)", border: "1px solid var(--line)", borderRadius: 6, padding: "5px 8px", color: "var(--text)", fontSize: 11, outline: "none" }} />
                  <button onClick={createAndAdd} style={{ background: "var(--accent,#1db954)", color: "#000", border: "none", borderRadius: 6, padding: "0 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>+</button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── full generation-details modal ────────────────────────────────────────────
function TrackDetailModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const router = useRouter();
  const { play } = usePlayer();
  const [copied, setCopied] = useState(false);
  const [versions, setVersions] = useState<Track[] | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Load version history (each version is its own track row sharing project_id).
  useEffect(() => {
    let alive = true;
    api.versions(track.id).then(v => { if (alive) setVersions(v); }).catch(() => { if (alive) setVersions([]); });
    return () => { alive = false; };
  }, [track.id]);

  const buildGenUrl = (withSeed: boolean) => {
    const p = new URLSearchParams();
    p.set("prompt", track.prompt || "");
    if (track.negative) p.set("negative", track.negative);
    if (track.duration) p.set("duration", String(Math.round(track.duration)));
    if (track.model && track.model !== "IMPORT") p.set("model", track.model);
    if (track.guidance != null) p.set("guidance", String(track.guidance));
    if (track.temperature != null) p.set("temperature", String(track.temperature));
    if (withSeed && track.seed != null) p.set("seed", String(track.seed));
    return `/generate?${p.toString()}`;
  };
  const canReproduce = track.model !== "IMPORT" && track.seed != null;

  const copyPrompt = async () => {
    try { await navigator.clipboard.writeText(track.prompt || ""); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };

  const fmtNum = (v: number | null | undefined, digits = 2) =>
    v === null || v === undefined ? "—" : Number(v).toFixed(digits).replace(/\.?0+$/, "") || "0";

  const created = (() => {
    try { return new Date(track.created_at).toLocaleString(); } catch { return track.created_at; }
  })();

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 2000, background: "rgba(6,8,12,0.78)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div onClick={e => e.stopPropagation()} className="card" style={{
        width: "min(640px, 100%)", maxHeight: "85vh", overflowY: "auto", padding: 0,
        background: "var(--bg2)", border: "1px solid var(--accent)",
      }}>
        {/* header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10, padding: "16px 20px",
          borderBottom: "1px solid var(--bg3)", position: "sticky", top: 0, background: "var(--bg2)", zIndex: 1,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
            <div style={{ fontSize: 11, color: "var(--muted2)", marginTop: 2 }}>Track #{track.id} · v{track.version} · {created}</div>
          </div>
          <button className="btn" style={{ fontSize: 14, padding: "4px 10px", color: "var(--muted)" }} onClick={onClose}>✕</button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          {/* prompt */}
          <Section label="Prompt">
            <div style={{ position: "relative" }}>
              <div style={{
                fontSize: 13, lineHeight: 1.55, color: "var(--text, #e8e8ec)", background: "var(--bg, #0b0e13)",
                border: "1px solid var(--bg3)", borderRadius: 8, padding: "12px 14px", whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{track.prompt || "—"}</div>
              <button className="btn" onClick={copyPrompt} style={{
                position: "absolute", top: 8, right: 8, fontSize: 11, padding: "3px 9px",
                color: copied ? "var(--accent)" : "var(--muted)",
              }}>{copied ? "✓ Copied" : "Copy"}</button>
            </div>
          </Section>

          {/* negative prompt */}
          {track.negative ? (
            <Section label="Negative prompt">
              <div style={{
                fontSize: 13, lineHeight: 1.5, color: "var(--muted)", background: "var(--bg, #0b0e13)",
                border: "1px solid var(--bg3)", borderRadius: 8, padding: "10px 14px", whiteSpace: "pre-wrap",
              }}>{track.negative}</div>
            </Section>
          ) : null}

          {/* generation settings grid */}
          <Section label="Generation settings">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
              <Field label="Model" value={(track.model || "—").toUpperCase()} />
              <Field label="Guidance (CFG)" value={fmtNum(track.guidance)} />
              <Field label="Temperature" value={fmtNum(track.temperature)} />
              <Field label="Seed" value={track.seed != null ? String(track.seed) : "—"} mono />
              <Field label="Duration" value={`${fmtNum(track.duration, 1)}s`} />
              <Field label="Sample rate" value={track.sample_rate ? `${(track.sample_rate / 1000).toFixed(1)} kHz` : "—"} />
            </div>
          </Section>

          {/* musical analysis */}
          <Section label="Musical analysis">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 10 }}>
              <Field label="BPM" value={track.bpm ? String(Math.round(track.bpm)) : "—"} accent />
              <Field label="Key" value={track.key || "—"} accent />
              <Field label="Collection" value={track.collection || "—"} />
              <Field label="Rating" value={track.rating ? "★".repeat(track.rating) : "—"} />
            </div>
          </Section>

          {/* tags */}
          {track.tags ? (
            <Section label="Tags">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {track.tags.split(",").map(s => s.trim()).filter(Boolean).map(tag => (
                  <span key={tag} style={{ fontSize: 11, color: "var(--accent2)", background: "var(--bg3)", padding: "3px 9px", borderRadius: 6 }}>{tag}</span>
                ))}
              </div>
            </Section>
          ) : null}

          {/* notes */}
          {track.notes ? (
            <Section label="Notes">
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{track.notes}</div>
            </Section>
          ) : null}

          {/* version history */}
          {versions && versions.length > 1 && (
            <Section label={`Version history (${versions.length})`}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {versions.map(v => {
                  const isCurrent = v.id === track.id;
                  return (
                    <div key={v.id} style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8,
                      background: isCurrent ? "rgba(34,197,94,0.10)" : "var(--bg, #0b0e13)",
                      border: `1px solid ${isCurrent ? "var(--accent)" : "var(--bg3)"}`,
                    }}>
                      <span style={{
                        fontSize: 11, fontWeight: 800, color: isCurrent ? "var(--accent)" : "var(--muted2)",
                        fontFamily: "var(--mono, monospace)", minWidth: 28,
                      }}>v{v.version}</span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {v.edit_label || (v.version === 1 ? "Original" : "Edit")}
                          {isCurrent && <span style={{ color: "var(--accent)", fontSize: 10, marginLeft: 6 }}>● viewing</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--muted2)", marginTop: 1 }}>
                          {fmtTime(v.duration)}{v.bpm ? ` · ${Math.round(v.bpm)} BPM` : ""}{v.key ? ` · ${v.key}` : ""} · {fmtDate(v.created_at)}
                        </div>
                      </div>
                      <button className="btn" title="Play this version" style={{ padding: "4px 9px", fontSize: 11 }}
                        onClick={() => play(v)}>▶</button>
                      <button className="btn" title="Open this version in the DAW" style={{ padding: "4px 9px", fontSize: 11, color: "var(--accent)" }}
                        onClick={() => router.push(`/daw?id=${v.id}`)}>DAW</button>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* reproduce actions */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", borderTop: "1px solid var(--bg3)", paddingTop: 16 }}>
            {canReproduce && (
              <button className="btn btn-primary" style={{ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 700 }}
                onClick={() => router.push(buildGenUrl(true))}
                title="Open Generate pre-filled with the exact same seed + settings — produces an identical track">
                ♻ Regenerate (same seed)
              </button>
            )}
            <button className="btn" style={{ flex: 1, padding: "10px 0", fontSize: 13, color: "var(--accent)" }}
              onClick={() => router.push(buildGenUrl(false))}
              title="Open Generate with this prompt + settings, but a fresh random seed">
              🎲 New variation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1, color: "var(--muted2)", marginBottom: 8, textTransform: "uppercase" }}>{label}</div>
      {children}
    </div>
  );
}

function Field({ label, value, accent, mono }: { label: string; value: string; accent?: boolean; mono?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.6, color: "var(--muted2)", textTransform: "uppercase" }}>{label}</span>
      <span style={{
        fontSize: 14, fontWeight: 800, color: accent ? "var(--accent)" : "var(--text, #e8e8ec)",
        fontFamily: mono ? "var(--mono, ui-monospace, monospace)" : undefined,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{value}</span>
    </div>
  );
}

// ── per-track export dropdown (WAV/MP3/FLAC/AIFF/M4A/OGG + MIDI + stems zip) ──
function ExportMenu({ track }: { track: Track }) {
  const [open, setOpen] = useState(false);
  const [chords, setChords] = useState<string | null>(null);
  const [loadingChords, setLoadingChords] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const dl = (url: string) => {
    const a = document.createElement("a");
    a.href = url; a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
    setOpen(false);
  };

  const showChords = async () => {
    setLoadingChords(true);
    try {
      const r = await api.chords(track.id);
      setChords(r.progression || "—");
    } catch { setChords("detection failed"); }
    setLoadingChords(false);
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="btn" style={{ padding: "6px 10px", fontSize: 12, color: "var(--muted)" }}
        title="Download / export" onClick={() => setOpen(o => !o)}>↓</button>
      {open && (
        <div style={{
          position: "absolute", right: 0, bottom: "calc(100% + 6px)", zIndex: 50,
          background: "var(--bg2)", border: "1px solid var(--line, #2a2f3a)", borderRadius: 8,
          padding: 6, minWidth: 190, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 10, color: "var(--muted2)", padding: "4px 8px", fontWeight: 700, letterSpacing: 1 }}>AUDIO</div>
          {EXPORT_FORMATS.map(f => (
            <button key={f} onClick={() => dl(api.exportUrl(track.id, f))} style={menuItem}>
              {f.toUpperCase()} <span style={{ color: "var(--muted2)", fontSize: 10 }}>{f === "wav" ? "lossless" : f === "flac" ? "lossless" : ""}</span>
            </button>
          ))}
          <div style={{ height: 1, background: "var(--line, #2a2f3a)", margin: "4px 0" }} />
          <div style={{ fontSize: 10, color: "var(--muted2)", padding: "4px 8px", fontWeight: 700, letterSpacing: 1 }}>MIDI / STEMS</div>
          <button onClick={() => dl(api.midiUrl(track.id, "master"))} style={menuItem}>🎹 MIDI (.mid)</button>
          <button onClick={() => dl(`${API}/api/daw/${track.id}/export-zip`)} style={menuItem}>📦 Stems (.zip)</button>
          <button onClick={() => dl(`${API}/api/loop-pack/${track.id}?bars=4`)} style={menuItem}>🔁 Loop pack (.zip)</button>
          <div style={{ height: 1, background: "var(--line, #2a2f3a)", margin: "4px 0" }} />
          <button onClick={showChords} style={menuItem}>
            {loadingChords ? "Detecting…" : "🎼 Chords"}
          </button>
          {chords && (
            <div style={{ fontSize: 11, color: "var(--accent2)", padding: "4px 8px", lineHeight: 1.5, wordBreak: "break-word" }}>{chords}</div>
          )}
        </div>
      )}
    </div>
  );
}

const menuItem: React.CSSProperties = {
  display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
  color: "var(--text, #e8e8ec)", fontSize: 12, padding: "6px 8px", borderRadius: 5, cursor: "pointer",
};

function StatChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "8px 16px", display: "flex", flexDirection: "column" }}>
      <span className="label">{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: "var(--accent2)" }}>{value}</span>
    </div>
  );
}

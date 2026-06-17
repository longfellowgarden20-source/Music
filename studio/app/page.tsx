"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, fmtTime, fmtDate, type Track, type Stats } from "./lib/api";
import { usePlayer } from "./components/PlayerProvider";
import Waveform from "./components/Waveform";

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "duration", label: "Longest" },
  { value: "rating", label: "Top rated" },
];

export default function LibraryPage() {
  const router = useRouter();
  const { play, current, playing, toggle } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [collections, setCollections] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("");
  const [sort, setSort] = useState("newest");
  const [favOnly, setFavOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    api.tracks({ search, collection, sort, favorites: favOnly })
      .then(t => { setTracks(t); setLoading(false); setError(""); })
      .catch(() => { setError("Cannot reach API on :8765 — is the backend running?"); setLoading(false); });
  }, [search, collection, sort, favOnly]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.collections().then(setCollections).catch(() => {});
    api.stats().then(setStats).catch(() => {});
  }, []);

  const onFav = async (t: Track) => {
    await api.favorite(t.id);
    load();
  };
  const onDelete = async (t: Track) => {
    if (!confirm(`Delete "${t.title}"? This removes the file too.`)) return;
    await api.remove(t.id);
    load();
  };
  const onRate = async (t: Track, r: number) => {
    await api.rate(t.id, r);
    setTracks(prev => prev.map(x => x.id === t.id ? { ...x, rating: r } : x));
  };

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 24px 100px" }}>
      {/* stats bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
        <StatChip label="Tracks" value={stats?.total ?? "—"} />
        <StatChip label="Favorites" value={stats?.favorites ?? "—"} />
        <StatChip label="Total time" value={stats ? fmtTime(stats.total_seconds) : "—"} />
        <StatChip label="Plays" value={stats?.plays ?? "—"} />
        <button className="btn btn-primary" style={{ marginLeft: "auto" }}
          onClick={() => router.push("/generate")}>+ New Track</button>
      </div>

      {/* filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        <input className="input" style={{ maxWidth: 280 }} placeholder="Search tracks…"
          value={search} onChange={e => setSearch(e.target.value)} />
        <select className="input" style={{ width: "auto" }} value={collection}
          onChange={e => setCollection(e.target.value)}>
          <option value="">All collections</option>
          {collections.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="input" style={{ width: "auto" }} value={sort}
          onChange={e => setSort(e.target.value)}>
          {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <button className="btn" onClick={() => setFavOnly(f => !f)}
          style={{ borderColor: favOnly ? "var(--pink)" : undefined, color: favOnly ? "var(--pink)" : undefined }}>
          ♥ Favorites
        </button>
      </div>

      {loading && <div style={{ color: "var(--muted)", textAlign: "center", padding: 60 }}>Loading…</div>}
      {error && <div style={{ color: "var(--red)", textAlign: "center", padding: 60 }}>{error}</div>}
      {!loading && !error && tracks.length === 0 &&
        <div style={{ color: "var(--muted)", textAlign: "center", padding: 60 }}>No tracks found.</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 14 }}>
        {tracks.map(t => {
          const isCurrent = current?.id === t.id;
          return (
            <div key={t.id} className="card" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <button onClick={() => isCurrent ? toggle() : play(t)} style={{
                  width: 38, height: 38, borderRadius: "50%", border: "none", flexShrink: 0,
                  background: "linear-gradient(95deg,var(--accent),var(--accent2))",
                  color: "#fff", fontSize: 14, cursor: "pointer"
                }}>{isCurrent && playing ? "⏸" : "▶"}</button>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                    <span>{fmtTime(t.duration)}</span>
                    {t.bpm && <span>{Math.round(t.bpm)} BPM</span>}
                    {t.key && <span>{t.key}</span>}
                    <span style={{ textTransform: "uppercase", opacity: .6 }}>{t.model}</span>
                  </div>
                </div>
                <button onClick={() => onFav(t)} style={{
                  background: "none", border: "none", cursor: "pointer", fontSize: 16,
                  color: t.favorite ? "var(--pink)" : "var(--muted2)"
                }}>{t.favorite ? "♥" : "♡"}</button>
              </div>

              <Waveform trackId={t.id} height={44} color={isCurrent ? "#1ed760" : "#1db954"} />

              {/* rating + edit label */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ display: "flex", gap: 2 }}>
                  {[1, 2, 3, 4, 5].map(r => (
                    <button key={r} onClick={() => onRate(t, r === t.rating ? 0 : r)} style={{
                      background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: 0,
                      color: r <= t.rating ? "var(--amber)" : "var(--muted2)"
                    }}>★</button>
                  ))}
                </div>
                {t.edit_label && <span style={{ fontSize: 10, color: "var(--muted)",
                  background: "var(--bg3)", padding: "2px 7px", borderRadius: 5 }}>{t.edit_label}</span>}
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted2)" }}>{fmtDate(t.created_at)}</span>
              </div>

              {/* actions */}
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn btn-primary" style={{ flex: 1, padding: "6px 0", fontSize: 12, fontWeight: 700 }}
                  onClick={() => router.push(`/edit?id=${t.id}`)}>Open in DAW</button>
                <button className="btn" style={{ padding: "6px 12px", fontSize: 12, color: "var(--accent)" }}
                  onClick={() => router.push(`/vocals?track=${t.id}`)}>🎤</button>
                <button className="btn" style={{ padding: "6px 12px", fontSize: 12, color: "var(--red)" }}
                  onClick={() => onDelete(t)}>🗑</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "8px 16px", display: "flex", flexDirection: "column" }}>
      <span className="label">{label}</span>
      <span style={{ fontSize: 18, fontWeight: 800, color: "var(--accent2)" }}>{value}</span>
    </div>
  );
}

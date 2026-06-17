"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const API = "http://localhost:8765";

interface Track {
  id: number;
  title: string;
  duration: number;
  bpm: number | null;
  key: string | null;
  model: string;
  rating: number;
  collection: string;
  created_at: string;
}

export default function LibraryPage() {
  const router = useRouter();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/tracks?sort=newest`)
      .then(r => r.json())
      .then(data => { setTracks(data); setLoading(false); })
      .catch(() => {
        setError("Cannot reach API — make sure the music studio API is running (port 8765)");
        setLoading(false);
      });
  }, []);

  const filtered = tracks.filter(t =>
    t.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "var(--bg0)" }}>
      {/* Header */}
      <div style={{
        background: "var(--bg1)", borderBottom: "1px solid var(--line)",
        padding: "14px 24px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0
      }}>
        <div>
          <div style={{
            fontSize: 20, fontWeight: 800,
            background: "linear-gradient(90deg,#c4b0ff,#22d3ee)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
          }}>
            AI MUSIC STUDIO
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", letterSpacing: 2, textTransform: "uppercase", marginTop: 2 }}>
            DAW · pick a track to open
          </div>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search tracks…"
          style={{
            marginLeft: "auto", background: "var(--bg3)", border: "1px solid var(--line)",
            borderRadius: 8, color: "var(--text)", padding: "8px 14px", fontSize: 13,
            width: 280, outline: "none"
          }}
        />
        <a href="http://localhost:3002" style={{
          fontSize: 12, color: "var(--accent)", textDecoration: "none",
          padding: "8px 14px", border: "1px solid var(--accent)", borderRadius: 8
        }}>
          ← Studio
        </a>
      </div>

      {/* Track grid */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {loading && (
          <div style={{ color: "var(--muted)", textAlign: "center", paddingTop: 80, fontSize: 14 }}>
            Loading tracks…
          </div>
        )}
        {error && (
          <div style={{ color: "#f87171", textAlign: "center", paddingTop: 80, fontSize: 14, maxWidth: 400, margin: "0 auto" }}>
            {error}
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div style={{ color: "var(--muted)", textAlign: "center", paddingTop: 80 }}>No tracks found</div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
          {filtered.map(t => (
            <TrackCard key={t.id} track={t} onClick={() => router.push(`/studio/${t.id}`)} />
          ))}
        </div>
      </div>

      <div style={{
        padding: "10px 24px", borderTop: "1px solid var(--line)",
        fontSize: 11, color: "var(--muted)", flexShrink: 0
      }}>
        {filtered.length} tracks
      </div>
    </div>
  );
}

function TrackCard({ track, onClick }: { track: Track; onClick: () => void }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: "var(--bg2)", border: `1px solid ${hover ? "var(--accent)" : "var(--line)"}`,
        borderRadius: 12, padding: "16px 18px", textAlign: "left", cursor: "pointer",
        transform: hover ? "translateY(-2px)" : "none",
        transition: "all .15s", color: "var(--text)", width: "100%"
      }}
    >
      <div style={{
        fontWeight: 700, fontSize: 14, marginBottom: 6,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
      }}>
        {track.title}
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
        <span>{track.duration?.toFixed(0)}s</span>
        {track.bpm && <span>{Math.round(track.bpm)} BPM</span>}
        {track.key  && <span>{track.key}</span>}
        <span style={{ marginLeft: "auto", textTransform: "uppercase", letterSpacing: 1, opacity: 0.6 }}>
          {track.model}
        </span>
      </div>
      <div style={{ fontSize: 10, color: "#44445a", marginTop: 4 }}>
        {track.created_at?.slice(0, 10)}
      </div>
    </button>
  );
}

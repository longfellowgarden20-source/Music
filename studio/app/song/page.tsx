"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Track } from "../lib/api";
import { useProgress } from "../components/ProgressContext";
import { usePlayer } from "../components/PlayerProvider";

const STYLE_CHIPS = [
  "upbeat pop, female vocal", "emotional ballad, piano",
  "dark trap, male rap", "indie folk, acoustic",
  "R&B, smooth vocal", "rock anthem, energetic",
  "lo-fi chill, soft vocal", "EDM, catchy hook",
];

export default function SongPage() {
  const router = useRouter();
  const progress = useProgress();
  const { play } = usePlayer();
  const [mode, setMode] = useState<"theme" | "lyrics">("theme");
  const [theme, setTheme] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [style, setStyle] = useState("upbeat pop, female vocal");
  const [duration, setDuration] = useState(40);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<{ track: Track; lyrics: string } | null>(null);

  const make = async () => {
    if (mode === "theme" && !theme.trim()) { setStatus("⚠️ Enter what the song's about."); return; }
    if (mode === "lyrics" && !lyrics.trim()) { setStatus("⚠️ Paste your lyrics."); return; }
    setBusy(true); setResult(null);
    setStatus("Writing your song… (AI sings + plays — takes a couple minutes)");
    progress.set(8, "Writing song…");
    try {
      const r = await api.makeSong(
        { theme: mode === "theme" ? theme : "", lyrics: mode === "lyrics" ? lyrics : "", style, duration },
        (p) => progress.set(p.pct, `Writing song… (${p.state})`),
      );
      setResult({ track: r.track, lyrics: r.lyrics });
      setStatus(`✅ Saved #${r.id} → Songs`);
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Stopped" : `❌ ${msg}`);
    } finally {
      setBusy(false);
      progress.finish();
    }
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "28px 24px 100px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>🎤 Write a Song</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
        A complete song with <b style={{ color: "var(--text)" }}>real sung vocals</b> over music — from
        your lyrics, or just a theme and let the AI write them.
      </p>
      <div style={{ marginTop: 10, fontSize: 12, color: "var(--amber, #fbbf24)", background: "rgba(251,191,36,0.08)",
        border: "1px solid rgba(251,191,36,0.25)", borderRadius: 8, padding: "8px 12px", lineHeight: 1.5 }}>
        ⚠️ The singing model (ACE-Step) is large — it needs a Mac with <b>~32GB+ RAM</b>. On smaller
        machines this will say so instead of running. (Generate + Vocals work on any machine.)
      </div>

      {/* mode toggle */}
      <div style={{ display: "flex", gap: 6, marginTop: 18, marginBottom: 12 }}>
        <button className="btn" onClick={() => setMode("theme")}
          style={{ flex: 1, borderColor: mode === "theme" ? "var(--accent)" : undefined, color: mode === "theme" ? "var(--accent)" : "var(--muted)" }}>
          ✨ AI writes the lyrics
        </button>
        <button className="btn" onClick={() => setMode("lyrics")}
          style={{ flex: 1, borderColor: mode === "lyrics" ? "var(--accent)" : undefined, color: mode === "lyrics" ? "var(--accent)" : "var(--muted)" }}>
          ✍️ I'll write the lyrics
        </button>
      </div>

      {mode === "theme" ? (
        <input className="input" value={theme} onChange={e => setTheme(e.target.value)}
          placeholder="What's the song about? e.g. 'driving home at 2am, missing someone'" />
      ) : (
        <textarea className="input" value={lyrics} onChange={e => setLyrics(e.target.value)}
          rows={8} style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
          placeholder={"Paste your lyrics. Use [verse] and [chorus] tags for structure, e.g.:\n\n[verse]\nThe city lights are calling out my name\n[chorus]\nAnd I'm running, running back to you"} />
      )}

      {/* style */}
      <div style={{ marginTop: 16 }}>
        <div className="label" style={{ marginBottom: 6 }}>Style</div>
        <input className="input" value={style} onChange={e => setStyle(e.target.value)}
          placeholder="e.g. upbeat pop, female vocal, 120 BPM" />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {STYLE_CHIPS.map(s => (
            <button key={s} className="btn" style={{ fontSize: 11, padding: "4px 10px" }}
              onClick={() => setStyle(s)}>{s}</button>
          ))}
        </div>
      </div>

      {/* duration */}
      <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--muted)", minWidth: 80 }}>Length · {duration}s</span>
        <input type="range" min={20} max={90} step={5} value={duration}
          onChange={e => setDuration(parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
      </div>

      <button className="btn btn-primary" disabled={busy}
        style={{ width: "100%", marginTop: 20, padding: "13px 0", fontSize: 15, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
        onClick={make}>
        {busy ? <><span className="spinner" /> Writing your song…</> : "🎤 Make the song"}
      </button>

      {status && <div style={{ marginTop: 12, fontSize: 13, textAlign: "center",
        color: status.startsWith("✅") ? "var(--accent)" : status.startsWith("❌") ? "var(--red)" : "var(--muted)" }}>{status}</div>}

      {result && (
        <div className="card" style={{ marginTop: 20, padding: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>{result.track.title}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", margin: "4px 0 12px" }}>
            {result.track.bpm ? `${Math.round(result.track.bpm)} BPM · ` : ""}{result.track.key || ""}
          </div>
          {result.lyrics && (
            <pre style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "pre-wrap", lineHeight: 1.6,
              fontFamily: "inherit", margin: "0 0 14px", maxHeight: 180, overflowY: "auto" }}>{result.lyrics}</pre>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => router.push(`/edit?id=${result.track.id}`)}>Edit / refine →</button>
            <button className="btn" onClick={() => router.push("/")}>Library</button>
          </div>
        </div>
      )}

      <p style={{ fontSize: 11, color: "var(--muted2)", marginTop: 18, lineHeight: 1.5 }}>
        Tip: it runs in the background — you can navigate away and the song keeps generating.
        Saves to your “Songs” collection.
      </p>
    </div>
  );
}

"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { api, fmtTime, type Track } from "../lib/api";
import { useProgress } from "../components/ProgressContext";
import { usePlayer } from "../components/PlayerProvider";

const STEMS = ["master", "drums", "bass", "guitar", "piano", "other", "vocals"];
const STEM_LABEL: Record<string, string> = {
  master: "Full mix", drums: "Drums", bass: "Bass", guitar: "Guitar",
  piano: "Piano", other: "Other", vocals: "Vocals",
};

type Layer = { track: Track; stem: string; volume: number };

export default function MashupPage() {
  const router = useRouter();
  const progress = useProgress();
  const { play } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);
  const [title, setTitle] = useState("My Mashup");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => { api.tracks({ sort: "newest" }).then(setTracks).catch(() => {}); }, []);

  const addLayer = (t: Track) =>
    setLayers(ls => [...ls, { track: t, stem: "drums", volume: 1.0 }]);
  const removeLayer = (i: number) => setLayers(ls => ls.filter((_, k) => k !== i));
  const setStem = (i: number, stem: string) => setLayers(ls => ls.map((l, k) => k === i ? { ...l, stem } : l));
  const setVol = (i: number, v: number) => setLayers(ls => ls.map((l, k) => k === i ? { ...l, volume: v } : l));

  const create = useCallback(async () => {
    if (layers.length < 2) { setStatus("Add at least 2 layers to mash up."); return; }
    setBusy(true); setStatus("Building mashup… (separating stems can take a bit)");
    progress.set(8, "Mashup…");
    try {
      const r = await api.mashup(
        layers.map(l => ({ track_id: l.track.id, stem: l.stem, volume: l.volume })),
        title.trim() || "Mashup",
        (p) => progress.set(p.pct, `Mashup… (${p.state})`),
      );
      setStatus(`✅ Saved #${r.id} → Mashups`);
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Stopped" : `❌ ${msg}`);
    } finally {
      setBusy(false);
      progress.finish();
    }
  }, [layers, title, progress, play]);

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 24px 100px" }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, margin: 0 }}>🎚 Mashup Studio</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 8, lineHeight: 1.6 }}>
        Pull stems from different tracks and blend them into something new — drums from
        one, bass from another, a melody from a third. Everything is tempo-matched to
        your <b style={{ color: "var(--text)" }}>first</b> layer.
      </p>

      {/* current mashup layers */}
      <div style={{ marginTop: 20 }}>
        <div className="label" style={{ marginBottom: 8 }}>Your mix ({layers.length} layers)</div>
        {layers.length === 0 && (
          <div style={{ color: "var(--muted2)", fontSize: 13, padding: "16px 0" }}>
            Add tracks below to start. The first one sets the tempo + key.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {layers.map((l, i) => (
            <div key={i} className="card" style={{ padding: 12, display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: i === 0 ? "var(--accent)" : "var(--muted2)", minWidth: 46 }}>
                {i === 0 ? "TEMPO" : `#${i + 1}`}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.track.title}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{l.track.bpm ? `${Math.round(l.track.bpm)} BPM` : ""} {l.track.key || ""}</div>
              </div>
              <select className="input" style={{ width: "auto" }} value={l.stem} onChange={e => setStem(i, e.target.value)}>
                {STEMS.map(s => <option key={s} value={s}>{STEM_LABEL[s]}</option>)}
              </select>
              <input type="range" min={0} max={1.5} step={0.05} value={l.volume}
                onChange={e => setVol(i, parseFloat(e.target.value))}
                style={{ width: 80, accentColor: "var(--accent)" }} title={`Volume ${Math.round(l.volume * 100)}%`} />
              <button className="btn" style={{ padding: "5px 10px", fontSize: 12, color: "var(--red)" }}
                onClick={() => removeLayer(i)}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* create bar */}
      {layers.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginTop: 16, alignItems: "center", flexWrap: "wrap" }}>
          <input className="input" style={{ maxWidth: 240 }} value={title} onChange={e => setTitle(e.target.value)} placeholder="Mashup name" />
          <button className="btn btn-primary" disabled={busy || layers.length < 2}
            style={{ padding: "10px 22px", fontSize: 14, fontWeight: 700 }}
            onClick={create}>
            {busy ? <span className="spinner" /> : "🎚 Create mashup"}
          </button>
          {status && <span style={{ fontSize: 13, color: status.startsWith("✅") ? "var(--accent)" : status.startsWith("❌") ? "var(--red)" : "var(--muted)" }}>{status}</span>}
        </div>
      )}

      {/* track picker */}
      <div style={{ marginTop: 28 }}>
        <div className="label" style={{ marginBottom: 10 }}>Add a track</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 10 }}>
          {tracks.map(t => (
            <button key={t.id} className="card" onClick={() => addLayer(t)}
              style={{ padding: 12, textAlign: "left", cursor: "pointer", border: "1px solid var(--line)", background: "var(--bg2)", display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18, color: "var(--accent)" }}>＋</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {fmtTime(t.duration)}{t.bpm ? ` · ${Math.round(t.bpm)} BPM` : ""}{t.key ? ` · ${t.key}` : ""}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <button className="btn" onClick={() => router.push("/")}>← Back to Library</button>
      </div>
    </div>
  );
}

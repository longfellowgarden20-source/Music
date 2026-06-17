"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { API } from "../lib/api";

type Track = {
  id: number;
  title: string;
  duration: number;
  bpm: number | null;
  key: string | null;
  collection: string;
};

type Step = { label: string; status: "idle" | "running" | "done" | "error" };

function fmt(s: number) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function StepRow({ step, idx }: { step: Step; idx: number }) {
  const color =
    step.status === "done" ? "var(--green)"
    : step.status === "running" ? "var(--accent)"
    : step.status === "error" ? "var(--red)"
    : "var(--muted2)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12,
      opacity: step.status === "idle" ? 0.35 : 1, transition: "opacity .3s" }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 11, fontWeight: 800,
        background: step.status === "done" ? "var(--green)"
          : step.status === "running" ? "var(--accent)"
          : step.status === "error" ? "var(--red)" : "var(--bg3)",
        color: step.status === "idle" ? "var(--muted)" : "#fff",
        boxShadow: step.status === "running" ? `0 0 12px var(--accent)` : "none",
        transition: "all .3s",
      }}>
        {step.status === "done" ? "✓" : step.status === "error" ? "✕" : idx + 1}
      </div>
      <div style={{ fontSize: 13, color, fontWeight: step.status === "running" ? 700 : 500 }}>
        {step.label}
        {step.status === "running" && (
          <span style={{ marginLeft: 6, opacity: 0.6 }}>
            <Dots />
          </span>
        )}
      </div>
    </div>
  );
}

function Dots() {
  const [d, setD] = useState(".");
  useRef((() => {
    const id = setInterval(() => setD(p => p.length >= 3 ? "." : p + "."), 500);
    return () => clearInterval(id);
  })());
  return <span>{d}</span>;
}

function TrackCard({ track, label, accent, onDAW }: {
  track: Track; label: string; accent: string; onDAW: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { el.play(); setPlaying(true); }
  }

  return (
    <div style={{
      background: "var(--bg2)", border: `1px solid ${accent}40`,
      borderRadius: 14, padding: "18px 22px",
      display: "flex", flexDirection: "column", gap: 12,
      animation: "fadeUp .4s ease both",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ width: 7, height: 7, borderRadius: "50%", background: accent, marginTop: 6, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 10, color: accent, fontWeight: 800, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 4 }}>
            {label}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{track.title}</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, display: "flex", gap: 12 }}>
            {track.bpm && <span>{Math.round(track.bpm)} BPM</span>}
            {track.key && <span>{track.key}</span>}
            <span>{fmt(track.duration)}</span>
          </div>
        </div>
      </div>

      <audio ref={audioRef} src={`${API}/api/audio/${track.id}`}
        onEnded={() => setPlaying(false)} style={{ display: "none" }} />

      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={toggle} style={{
          flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
          background: accent, color: "#000", fontWeight: 700, fontSize: 13, cursor: "pointer",
        }}>
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button onClick={onDAW} style={{
          flex: 1, padding: "9px 0", borderRadius: 8,
          border: "1px solid var(--line2)", background: "var(--bg3)",
          color: "var(--text)", fontWeight: 700, fontSize: 13, cursor: "pointer",
        }}>
          Edit Studio
        </button>
        <a href={`${API}/api/audio/${track.id}`} download={`${track.title}.wav`} style={{
          padding: "9px 14px", borderRadius: 8, border: "1px solid var(--line2)",
          background: "var(--bg3)", color: "var(--muted)", fontWeight: 700, fontSize: 13,
          textDecoration: "none", display: "flex", alignItems: "center",
        }}>↓</a>
      </div>
    </div>
  );
}

const STEP_LABELS = [
  "Downloading audio from YouTube",
  "Separating stems & removing vocals (2–4 min)",
  "Applying your FX signature",
];

export default function YouTubePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [steps, setSteps] = useState<Step[]>(STEP_LABELS.map(label => ({ label, status: "idle" })));
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [instrumental, setInstrumental] = useState<Track | null>(null);
  const [revamp, setRevamp] = useState<Track | null>(null);
  const [stems, setStems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function reset() {
    setUrl(""); setError(null); setStatusMsg(null);
    setInstrumental(null); setRevamp(null); setStems([]);
    setBusy(false);
    setSteps(STEP_LABELS.map(label => ({ label, status: "idle" })));
  }

  function setStep(idx: number, status: Step["status"]) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, status } : s));
  }

  async function run() {
    if (!url.trim() || busy) return;
    reset();
    setUrl(url.trim());
    setBusy(true);
    setError(null);
    setSteps(STEP_LABELS.map(label => ({ label, status: "idle" })));
    setStep(0, "running");

    try {
      const res = await fetch(`${API}/api/youtube/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Server error ${res.status}`);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });

        // parse SSE chunks
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";

        for (const chunk of chunks) {
          const lines = chunk.trim().split("\n");
          const eventLine = lines.find(l => l.startsWith("event:"));
          const dataLine = lines.find(l => l.startsWith("data:"));
          if (!eventLine || !dataLine) continue;

          const event = eventLine.slice(7).trim();
          const data = JSON.parse(dataLine.slice(5).trim());

          if (event === "progress") {
            const stepIdx = (data.step as number) - 1;
            if (data.done) {
              setStep(stepIdx, "done");
              if (stepIdx + 1 < STEP_LABELS.length) setStep(stepIdx + 1, "running");
            } else {
              setStep(stepIdx, "running");
            }
            setStatusMsg(data.msg);
            if (data.instrumental) setInstrumental(data.instrumental);
            if (data.stems) setStems(data.stems);
          } else if (event === "done") {
            setStep(2, "done");
            setInstrumental(data.instrumental);
            setRevamp(data.revamp);
            setStems(data.stems || []);
            setStatusMsg(null);
            setBusy(false);
          } else if (event === "error") {
            setError(data.msg);
            setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "error" } : s));
            setBusy(false);
          }
        }
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "error" } : s));
      setBusy(false);
    }
  }

  const done = !!instrumental && !!revamp;

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", padding: "48px 24px" }}>
      <div style={{ marginBottom: 36 }}>
        <div style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5, marginBottom: 8 }}>
          YouTube → Instrumental
        </div>
        <div style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.6 }}>
          Paste any YouTube URL. We'll strip the vocals, keep the beat, and apply your FX touch.
        </div>
      </div>

      {/* URL input */}
      <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
        <input
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !busy && run()}
          placeholder="https://youtube.com/watch?v=..."
          disabled={busy}
          style={{
            flex: 1, padding: "13px 16px", borderRadius: 10,
            border: "1px solid var(--line2)", background: "var(--bg2)",
            color: "var(--text)", fontSize: 14, outline: "none",
            opacity: busy ? 0.5 : 1,
          }}
        />
        <button onClick={run} disabled={busy || !url.trim()} style={{
          padding: "13px 22px", borderRadius: 10, border: "none",
          background: busy || !url.trim() ? "var(--bg3)" : "var(--accent)",
          color: busy || !url.trim() ? "var(--muted)" : "#fff",
          fontWeight: 700, fontSize: 14,
          cursor: busy || !url.trim() ? "not-allowed" : "pointer",
          whiteSpace: "nowrap", transition: "all .15s",
        }}>
          {busy ? "Working…" : "Strip & Revamp"}
        </button>
      </div>

      {/* Progress */}
      {steps.some(s => s.status !== "idle") && (
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--line)",
          borderRadius: 14, padding: "22px 24px", marginBottom: 24,
          display: "flex", flexDirection: "column", gap: 16,
        }}>
          {steps.map((s, i) => <StepRow key={i} step={s} idx={i} />)}
          {statusMsg && (
            <div style={{ fontSize: 12, color: "var(--muted)", paddingLeft: 38, marginTop: -4 }}>
              {statusMsg}
            </div>
          )}
          {stems.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--muted2)", paddingLeft: 38 }}>
              Stems: {stems.join(" · ")}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: "#ef444418", border: "1px solid #ef444440",
          borderRadius: 10, padding: "14px 18px", marginBottom: 20,
          color: "#ef4444", fontSize: 13,
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      {done && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TrackCard
            track={instrumental!}
            label="Instrumental — vocals removed"
            accent="var(--accent2)"
            onDAW={() => router.push(`/edit?id=${instrumental!.id}`)}
          />
          <TrackCard
            track={revamp!}
            label="Revamped — your FX touch"
            accent="var(--accent)"
            onDAW={() => router.push(`/edit?id=${revamp!.id}`)}
          />
          <button onClick={reset} style={{
            marginTop: 6, padding: "10px 0", borderRadius: 10,
            border: "1px solid var(--line2)", background: "transparent",
            color: "var(--muted)", fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>
            Do another one
          </button>
        </div>
      )}

      <style>{`
        @keyframes fadeUp { from { opacity:0; transform:translateY(10px); } to { opacity:1; transform:none; } }
      `}</style>
    </div>
  );
}

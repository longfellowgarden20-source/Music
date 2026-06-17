"use client";
import { useState, useRef, useEffect } from "react";
import { API, type Track } from "../lib/api";

type Phase = "idle" | "armed" | "recording" | "review" | "merging" | "done" | "error";

export default function VocalRecorder({ track, onMerged }: {
  track: Track;
  onMerged: (newTrack: Track) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [vocalBlob, setVocalBlob] = useState<Blob | null>(null);
  const [vocalUrl, setVocalUrl] = useState("");

  const mediaRef    = useRef<MediaRecorder | null>(null);
  const chunksRef   = useRef<Blob[]>([]);
  const trackAudio  = useRef<HTMLAudioElement | null>(null);
  const vocalAudio  = useRef<HTMLAudioElement | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (vocalUrl) URL.revokeObjectURL(vocalUrl);
    };
  }, [vocalUrl]);

  function reset() {
    trackAudio.current?.pause();
    vocalAudio.current?.pause();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (vocalUrl) URL.revokeObjectURL(vocalUrl);
    setVocalBlob(null); setVocalUrl(""); setError("");
    setPhase("idle");
  }

  async function arm() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;
      setPhase("armed");
    } catch {
      setError("Microphone access denied. Allow mic access and try again.");
      setPhase("error");
    }
  }

  function startRecording() {
    if (!streamRef.current) return;
    chunksRef.current = [];
    const mr = new MediaRecorder(streamRef.current, { mimeType: "audio/webm" });
    mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      const url = URL.createObjectURL(blob);
      setVocalBlob(blob);
      setVocalUrl(url);
      setPhase("review");
      trackAudio.current?.pause();
    };
    mediaRef.current = mr;
    // Play the track + start recording simultaneously
    if (trackAudio.current) {
      trackAudio.current.currentTime = 0;
      trackAudio.current.play().catch(() => {});
    }
    mr.start(100);
    setPhase("recording");
  }

  function stopRecording() {
    mediaRef.current?.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
  }

  async function merge() {
    if (!vocalBlob) return;
    setPhase("merging");
    try {
      const form = new FormData();
      form.append("vocal", vocalBlob, "vocal.webm");
      const res = await fetch(`${API}/api/track/${track.id}/merge-vocal`, {
        method: "POST", body: form,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || "Merge failed");
      }
      const data = await res.json();
      setPhase("done");
      setTimeout(() => { reset(); onMerged(data.track); }, 1200);
    } catch (e) {
      setError((e as Error).message);
      setPhase("error");
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn"
        style={{ width: "100%", marginTop: 12, fontSize: 13, fontWeight: 700 }}
      >
        Record vocals over track
      </button>
    );
  }

  return (
    <div style={{
      marginTop: 12, background: "var(--bg2)", border: "1px solid var(--line)",
      borderRadius: 14, padding: "20px 22px",
      display: "flex", flexDirection: "column", gap: 14,
      animation: "fadeUp .25s ease both",
    }}>
      {/* Hidden audio players */}
      <audio ref={trackAudio} src={`${API}/api/audio/${track.id}`} />
      {vocalUrl && <audio ref={vocalAudio} src={vocalUrl} />}

      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--muted)" }}>
        Live Vocal Recording
      </div>

      {phase === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
            The track will play through your speakers while you record. When done, preview and merge.
          </p>
          <button onClick={arm} className="btn btn-primary" style={{ fontSize: 13 }}>
            Allow microphone
          </button>
        </div>
      )}

      {phase === "armed" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--accent)", fontWeight: 600 }}>
            Mic ready. Hit record — the track plays automatically.
          </p>
          <button
            onClick={startRecording}
            style={{
              padding: "12px 0", borderRadius: 10, border: "none",
              background: "var(--red)", color: "#fff",
              fontWeight: 800, fontSize: 15, cursor: "pointer",
            }}
          >
            Record
          </button>
        </div>
      )}

      {phase === "recording" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%", background: "var(--red)",
              display: "inline-block", animation: "pulse 1s ease-in-out infinite",
            }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--red)" }}>Recording…</span>
          </div>
          <button
            onClick={stopRecording}
            className="btn"
            style={{ fontSize: 13, fontWeight: 700 }}
          >
            Stop
          </button>
        </div>
      )}

      {phase === "review" && vocalUrl && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>
            Preview your vocal recording, then merge it onto the track.
          </p>
          <audio controls src={vocalUrl} style={{ width: "100%", height: 36 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={merge} className="btn btn-primary" style={{ flex: 1, fontSize: 13 }}>
              Merge onto track
            </button>
            <button onClick={() => setPhase("armed")} className="btn" style={{ flex: 1, fontSize: 13 }}>
              Re-record
            </button>
          </div>
        </div>
      )}

      {phase === "merging" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="spinner" />
          <span style={{ fontSize: 13, color: "var(--muted)" }}>Merging vocals onto track…</span>
        </div>
      )}

      {phase === "done" && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--accent)", fontWeight: 700 }}>
          Merged. New version saved to your library.
        </p>
      )}

      {(phase === "error") && error && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--red)" }}>{error}</p>
      )}

      <button
        onClick={() => { reset(); setOpen(false); }}
        style={{
          background: "none", border: "none", fontSize: 12,
          color: "var(--muted2)", cursor: "pointer", textAlign: "left", padding: 0,
        }}
      >
        Close
      </button>
    </div>
  );
}

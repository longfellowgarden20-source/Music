"use client";
import { useState } from "react";
import { api } from "../lib/api";

type Notes = {
  vibe?: string;
  strengths?: string[];
  suggestions?: string[];
  next?: string;
  error?: string;
};

export default function AiNotes({ trackId }: { trackId: number }) {
  const [notes, setNotes] = useState<Notes | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function analyze() {
    setBusy(true);
    setOpen(true);
    try {
      const data = await api.aiNotes(trackId);
      setNotes(data);
    } catch (e) {
      setNotes({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button
        onClick={open && notes ? () => { setOpen(false); setNotes(null); } : analyze}
        disabled={busy}
        className="btn"
        style={{
          width: "100%", fontSize: 13, fontWeight: 700,
          color: open ? "var(--muted)" : "var(--accent)",
          borderColor: open ? "var(--line)" : "var(--accent)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        {busy ? <><span className="spinner" /> Analyzing…</> : open && notes ? "Hide producer notes" : "Get producer notes"}
      </button>

      {open && (
        <div style={{
          marginTop: 12, background: "var(--bg2)", border: "1px solid var(--line)",
          borderRadius: 14, padding: "20px 22px",
          display: "flex", flexDirection: "column", gap: 16,
          animation: "fadeUp .25s ease both",
        }}>
          {notes?.error && (
            <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>{notes.error}</p>
          )}

          {notes?.vibe && (
            <div>
              <Label>Vibe</Label>
              <p style={{ margin: 0, fontSize: 14, color: "var(--text)", lineHeight: 1.6 }}>
                {notes.vibe}
              </p>
            </div>
          )}

          {notes?.strengths && notes.strengths.length > 0 && (
            <div>
              <Label>What works</Label>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {notes.strengths.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--text)" }}>
                    <span style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }}>✓</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notes?.suggestions && notes.suggestions.length > 0 && (
            <div>
              <Label>Suggestions</Label>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {notes.suggestions.map((s, i) => (
                  <li key={i} style={{ display: "flex", gap: 8, fontSize: 13, color: "var(--text)" }}>
                    <span style={{ color: "var(--amber)", flexShrink: 0, marginTop: 1 }}>→</span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {notes?.next && (
            <div style={{
              background: "var(--bg3)", borderRadius: 10, padding: "12px 14px",
              borderLeft: "3px solid var(--accent)",
            }}>
              <Label>Try next</Label>
              <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
                {notes.next}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
      textTransform: "uppercase", color: "var(--muted)",
      marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

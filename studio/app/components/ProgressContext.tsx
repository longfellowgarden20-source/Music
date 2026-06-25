"use client";
import { createContext, useContext, useState, useCallback, useRef } from "react";
import { API } from "../lib/api";

type GenResult = { id: number; seed: number; bpm: number | null; key: string | null; track: any };

type ProgressCtx = {
  start: (label?: string) => void;
  // set an EXACT percentage (0–100) and optional label — for real progress.
  set: (pct: number, label?: string) => void;
  finish: () => void;
  // Background generation that survives page navigation. Starts the job, polls it
  // here in the provider (which lives at the app root), and resolves when done.
  runGeneration: (body: Record<string, unknown>, label: string) => Promise<GenResult>;
  // cancel whatever background job is running (drives the global kill button)
  cancel: () => void;
  label: string;
  active: boolean;
  cancellable: boolean;
};

const Ctx = createContext<ProgressCtx>({
  start: () => {}, set: () => {}, finish: () => {},
  runGeneration: async () => { throw new Error("no provider"); },
  cancel: () => {}, label: "", active: false, cancellable: false,
});

export function useProgress() { return useContext(Ctx); }

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState("");
  const [pct, setPct] = useState(0);
  const [cancellable, setCancellable] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<string | null>(null);   // active background job id

  const start = useCallback((lbl = "Working…") => {
    setLabel(lbl);
    setActive(true);
    setPct(8);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setPct(p => p < 85 ? p + (85 - p) * 0.06 : p);
    }, 400);
  }, []);

  const set = useCallback((p: number, lbl?: string) => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setActive(true);
    setPct(Math.max(0, Math.min(100, p)));
    if (lbl !== undefined) setLabel(lbl);
  }, []);

  const finish = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setPct(100);
    setCancellable(false);
    setTimeout(() => { setActive(false); setPct(0); }, 500);
  }, []);

  // Cancel the running background job (kill button). The backend's /api/cancel
  // stops the in-flight generation; the poll loop then sees state=cancelled.
  const cancel = useCallback(() => {
    setLabel("Stopping…");
    fetch(`${API}/api/cancel`, { method: "POST" }).catch(() => {});
  }, []);

  const runGeneration = useCallback((body: Record<string, unknown>, lbl: string): Promise<GenResult> => {
    return new Promise<GenResult>(async (resolve, reject) => {
      try {
        const res = await fetch(`${API}/api/generate-start`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try { const j = await res.json(); msg = j.detail || msg; } catch {}
          reject(new Error(msg)); return;
        }
        const { job_id } = await res.json();
        jobIdRef.current = job_id;
        setActive(true); setCancellable(true); setLabel(lbl); set(15, lbl);

        let misses = 0;
        const poll = async () => {
          if (jobIdRef.current !== job_id) return; // superseded/cancelled
          try {
            const r = await fetch(`${API}/api/complete-status/${job_id}`);
            if (!r.ok) {
              if (++misses > 5) { jobIdRef.current = null; finish(); reject(new Error("Lost track of the job")); return; }
              setTimeout(poll, 1500); return;
            }
            misses = 0;
            const s = await r.json();
            if (s.state === "done") {
              jobIdRef.current = null; finish();
              resolve({ id: s.id, seed: s.seed, bpm: s.bpm, key: s.key, track: s.track }); return;
            }
            if (s.state === "error" || s.state === "cancelled") {
              jobIdRef.current = null; finish();
              reject(new Error(s.error || "Generation failed")); return;
            }
            set(s.pct ?? 30, lbl);
            setTimeout(poll, 1500);
          } catch {
            if (++misses > 8) { jobIdRef.current = null; finish(); reject(new Error("Connection lost")); return; }
            setTimeout(poll, 1500);
          }
        };
        poll();
      } catch (e) { jobIdRef.current = null; finish(); reject(e); }
    });
  }, [set, finish]);

  return (
    <Ctx.Provider value={{ start, set, finish, runGeneration, cancel, label, active, cancellable }}>
      {children}
      {/* Top progress bar — translucent track + solid fill, shown on every page. */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 4,
        zIndex: 9998, pointerEvents: "none",
        background: "rgba(29,185,84,0.12)",
        opacity: active ? 1 : 0, transition: "opacity .3s",
      }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: "linear-gradient(90deg, #1db954, #1ed760)",
          borderRadius: "0 2px 2px 0",
          transition: pct === 100 ? "width .15s ease" : "width .4s ease",
          boxShadow: "0 0 10px #1db954aa",
        }} />
      </div>
      {/* Label pill — translucent, with live % and (when a background job is
          running) a tiny kill button that works from any page. */}
      {active && label && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "rgba(20,24,30,0.72)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 20, padding: "7px 10px 7px 16px",
          fontSize: 12, fontWeight: 600, color: "rgba(232,232,236,0.92)",
          zIndex: 9998,
          boxShadow: "0 4px 24px rgba(0,0,0,.35)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--accent)", display: "inline-block",
            animation: "pulse 1.4s ease-in-out infinite", flexShrink: 0,
          }} />
          <span style={{ pointerEvents: "none" }}>{label}</span>
          {pct > 0 && pct < 100 && (
            <span style={{ color: "var(--accent)", fontVariantNumeric: "tabular-nums", pointerEvents: "none" }}>
              {Math.round(pct)}%
            </span>
          )}
          {cancellable && (
            <button
              onClick={cancel}
              title="Stop generation"
              style={{
                width: 18, height: 18, borderRadius: "50%", flexShrink: 0,
                border: "none", cursor: "pointer", marginLeft: 2,
                background: "rgba(239,68,68,0.9)", color: "#fff",
                fontSize: 11, lineHeight: 1, display: "flex",
                alignItems: "center", justifyContent: "center", padding: 0,
              }}>✕</button>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

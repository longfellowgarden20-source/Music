"use client";
import { createContext, useContext, useState, useCallback, useRef } from "react";

type ProgressCtx = {
  start: (label?: string) => void;
  // set an EXACT percentage (0–100) and optional label — for real progress
  // (e.g. the streaming "Complete the song" feature). Stops the fake crawl.
  set: (pct: number, label?: string) => void;
  finish: () => void;
  label: string;
  active: boolean;
};

const Ctx = createContext<ProgressCtx>({
  start: () => {}, set: () => {}, finish: () => {}, label: "", active: false,
});

export function useProgress() { return useContext(Ctx); }

export function ProgressProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [label, setLabel] = useState("");
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback((lbl = "Working…") => {
    setLabel(lbl);
    setActive(true);
    setPct(8);
    if (timer.current) clearInterval(timer.current);
    // Crawl toward 85% while work is running — snaps to 100 on finish().
    timer.current = setInterval(() => {
      setPct(p => p < 85 ? p + (85 - p) * 0.06 : p);
    }, 400);
  }, []);

  const set = useCallback((p: number, lbl?: string) => {
    // Real progress: cancel the fake crawl and pin the bar to the exact value.
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setActive(true);
    setPct(Math.max(0, Math.min(100, p)));
    if (lbl !== undefined) setLabel(lbl);
  }, []);

  const finish = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setPct(100);
    setTimeout(() => { setActive(false); setPct(0); }, 500);
  }, []);

  return (
    <Ctx.Provider value={{ start, set, finish, label, active }}>
      {children}
      {/* Top progress bar: a translucent full-width track with a solid fill,
          so you can see how far along it is at a glance without it blocking
          anything. Taller + see-through track per request. */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 4,
        zIndex: 9998, pointerEvents: "none",
        background: "rgba(29,185,84,0.12)",   // faint translucent track
        opacity: active ? 1 : 0, transition: "opacity .3s",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: "linear-gradient(90deg, #1db954, #1ed760)",
          borderRadius: "0 2px 2px 0",
          transition: pct === 100 ? "width .15s ease" : "width .4s ease",
          boxShadow: "0 0 10px #1db954aa",
        }} />
      </div>
      {/* Label pill — translucent so the UI shows through; includes live %. */}
      {active && label && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "rgba(20,24,30,0.72)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          border: "1px solid rgba(255,255,255,0.10)",
          borderRadius: 20, padding: "7px 16px",
          fontSize: 12, fontWeight: 600, color: "rgba(232,232,236,0.92)",
          zIndex: 9998, pointerEvents: "none",
          boxShadow: "0 4px 24px rgba(0,0,0,.35)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--accent)", display: "inline-block",
            animation: "pulse 1.4s ease-in-out infinite",
          }} />
          {label}
          {pct > 0 && pct < 100 && (
            <span style={{ color: "var(--accent)", fontVariantNumeric: "tabular-nums", marginLeft: 2 }}>
              {Math.round(pct)}%
            </span>
          )}
        </div>
      )}
    </Ctx.Provider>
  );
}

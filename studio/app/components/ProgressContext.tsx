"use client";
import { createContext, useContext, useState, useCallback, useRef } from "react";

type ProgressCtx = {
  start: (label?: string) => void;
  finish: () => void;
  label: string;
  active: boolean;
};

const Ctx = createContext<ProgressCtx>({
  start: () => {}, finish: () => {}, label: "", active: false,
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

  const finish = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    setPct(100);
    setTimeout(() => { setActive(false); setPct(0); }, 500);
  }, []);

  return (
    <Ctx.Provider value={{ start, finish, label, active }}>
      {children}
      {/* Slim bar fixed to the very top of the viewport */}
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, height: 3,
        zIndex: 9998, pointerEvents: "none",
        opacity: active ? 1 : 0, transition: "opacity .3s",
      }}>
        <div style={{
          height: "100%",
          width: `${pct}%`,
          background: "linear-gradient(90deg, #1db954, #1ed760)",
          borderRadius: "0 2px 2px 0",
          transition: pct === 100 ? "width .15s ease" : "width .4s ease",
          boxShadow: "0 0 8px #1db95480",
        }} />
      </div>
      {/* Label pill — only visible while active */}
      {active && label && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "var(--bg2)", border: "1px solid var(--line)",
          borderRadius: 20, padding: "7px 16px",
          fontSize: 12, fontWeight: 600, color: "var(--muted)",
          zIndex: 9998, pointerEvents: "none",
          boxShadow: "0 4px 20px rgba(0,0,0,.4)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "var(--accent)", display: "inline-block",
            animation: "pulse 1.4s ease-in-out infinite",
          }} />
          {label}
        </div>
      )}
    </Ctx.Provider>
  );
}

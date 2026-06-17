"use client";
import { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";
import { api, fmtTime, type Track } from "../lib/api";

interface PlayerCtx {
  current: Track | null;
  playing: boolean;
  play: (t: Track) => void;
  toggle: () => void;
  stop: () => void;
}

const Ctx = createContext<PlayerCtx | null>(null);
export const usePlayer = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlayer outside provider");
  return c;
};

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);

  useEffect(() => {
    const a = new Audio();
    audioRef.current = a;
    const onTime = () => setTime(a.currentTime);
    const onDur = () => setDur(a.duration || 0);
    const onEnd = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnd);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const play = useCallback((t: Track) => {
    const a = audioRef.current;
    if (!a) return;
    if (current?.id !== t.id) {
      a.src = api.audioUrl(t.id);
      setCurrent(t);
    }
    a.play();
    setPlaying(true);
  }, [current]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !current) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play(); setPlaying(true); }
  }, [playing, current]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause(); a.currentTime = 0; setPlaying(false);
  }, []);

  const seek = (pct: number) => {
    const a = audioRef.current;
    if (a && dur) { a.currentTime = pct * dur; setTime(pct * dur); }
  };

  return (
    <Ctx.Provider value={{ current, playing, play, toggle, stop }}>
      {children}
      {current && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, height: 64,
          background: "var(--bg1)", borderTop: "1px solid var(--line)",
          display: "flex", alignItems: "center", gap: 14, padding: "0 18px", zIndex: 50,
          backdropFilter: "blur(8px)"
        }}>
          <button onClick={toggle} style={{
            width: 40, height: 40, borderRadius: "50%", border: "none",
            background: "linear-gradient(95deg,var(--accent),var(--accent2))",
            color: "#fff", fontSize: 16, cursor: "pointer", flexShrink: 0
          }}>{playing ? "⏸" : "▶"}</button>
          <div style={{ minWidth: 0, width: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap",
              overflow: "hidden", textOverflow: "ellipsis" }}>{current.title}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {fmtTime(time)} / {fmtTime(dur)}
            </div>
          </div>
          <div
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              seek((e.clientX - r.left) / r.width);
            }}
            style={{ flex: 1, height: 6, background: "var(--bg3)", borderRadius: 3,
              cursor: "pointer", position: "relative" }}>
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0,
              width: `${dur ? (time / dur) * 100 : 0}%`,
              background: "linear-gradient(90deg,var(--accent),var(--accent2))",
              borderRadius: 3
            }} />
          </div>
          <button onClick={stop} className="btn" style={{ flexShrink: 0 }}>■</button>
        </div>
      )}
    </Ctx.Provider>
  );
}

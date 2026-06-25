"use client";
import { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";
import { api, fmtTime, type Track } from "../lib/api";

type RepeatMode = "off" | "all" | "one";

interface PlayerCtx {
  current: Track | null;
  playing: boolean;
  queue: Track[];
  queueIndex: number;
  shuffle: boolean;
  repeat: RepeatMode;
  play: (t: Track, queue?: Track[], index?: number) => void;
  playQueue: (tracks: Track[], startIndex?: number) => void;
  toggle: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
}

const Ctx = createContext<PlayerCtx | null>(null);
export const usePlayer = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePlayer outside provider");
  return c;
};

const REPEAT_LABEL: Record<RepeatMode, string> = { off: "Repeat off", all: "Repeat all", one: "Repeat one" };

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [current, setCurrent] = useState<Track | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [volume, setVolume] = useState(1);

  // queue state
  const [queue, setQueue] = useState<Track[]>([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  // shuffle order: a permutation of queue indices we walk through
  const shuffleOrderRef = useRef<number[]>([]);
  const shufflePosRef = useRef(0);

  // refs so the audio "ended" handler always sees current values
  const queueRef = useRef<Track[]>([]);
  const queueIndexRef = useRef(-1);
  const shuffleRef = useRef(false);
  const repeatRef = useRef<RepeatMode>("off");
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { shuffleRef.current = shuffle; }, [shuffle]);
  useEffect(() => { repeatRef.current = repeat; }, [repeat]);

  // Load + play a specific track object (sets audio src). Internal core.
  const loadAndPlay = useCallback((t: Track) => {
    const a = audioRef.current;
    if (!a) return;
    a.src = api.audioUrl(t.id);
    a.play().catch(() => {});
    setCurrent(t);
    setPlaying(true);
    setTime(0);
  }, []);

  // Build a fresh shuffle order for the current queue, optionally pinning a
  // starting index first so the chosen track plays now.
  const buildShuffleOrder = useCallback((len: number, startIdx: number) => {
    const idxs = Array.from({ length: len }, (_, i) => i).filter(i => i !== startIdx);
    for (let i = idxs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
    }
    shuffleOrderRef.current = startIdx >= 0 ? [startIdx, ...idxs] : idxs;
    shufflePosRef.current = 0;
  }, []);

  // Advance to the queue position after the current one (respects shuffle/repeat).
  // Returns the next Track or null if the queue is exhausted.
  const computeNext = useCallback((auto: boolean): { track: Track; index: number } | null => {
    const q = queueRef.current;
    if (q.length === 0) return null;

    // repeat one — replay the same track (only on auto-advance; manual skip moves on)
    if (auto && repeatRef.current === "one") {
      const idx = queueIndexRef.current;
      if (idx >= 0 && idx < q.length) return { track: q[idx], index: idx };
    }

    if (shuffleRef.current) {
      let pos = shufflePosRef.current + 1;
      if (pos >= shuffleOrderRef.current.length) {
        if (repeatRef.current === "all") { buildShuffleOrder(q.length, -1); pos = 0; }
        else return null;
      }
      shufflePosRef.current = pos;
      const idx = shuffleOrderRef.current[pos];
      return { track: q[idx], index: idx };
    }

    let idx = queueIndexRef.current + 1;
    if (idx >= q.length) {
      if (repeatRef.current === "all") idx = 0;
      else return null;
    }
    return { track: q[idx], index: idx };
  }, [buildShuffleOrder]);

  const computePrev = useCallback((): { track: Track; index: number } | null => {
    const q = queueRef.current;
    if (q.length === 0) return null;
    if (shuffleRef.current) {
      const pos = Math.max(0, shufflePosRef.current - 1);
      shufflePosRef.current = pos;
      const idx = shuffleOrderRef.current[pos] ?? queueIndexRef.current;
      return { track: q[idx], index: idx };
    }
    let idx = queueIndexRef.current - 1;
    if (idx < 0) idx = repeatRef.current === "all" ? q.length - 1 : 0;
    return { track: q[idx], index: idx };
  }, []);

  const next = useCallback((auto = false) => {
    const n = computeNext(auto);
    if (n) { setQueueIndex(n.index); loadAndPlay(n.track); }
    else { setPlaying(false); }
  }, [computeNext, loadAndPlay]);

  const prev = useCallback(() => {
    // if more than 3s in, restart the current track (Spotify behavior)
    const a = audioRef.current;
    if (a && a.currentTime > 3) { a.currentTime = 0; setTime(0); return; }
    const p = computePrev();
    if (p) { setQueueIndex(p.index); loadAndPlay(p.track); }
  }, [computePrev, loadAndPlay]);

  // audio element setup
  useEffect(() => {
    const a = new Audio();
    audioRef.current = a;
    a.volume = volume;
    const onTime = () => setTime(a.currentTime);
    const onDur = () => setDur(a.duration || 0);
    const onEnd = () => next(true);   // auto-advance
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnd);
    return () => {
      a.pause();
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep audio volume in sync
  useEffect(() => { if (audioRef.current) audioRef.current.volume = volume; }, [volume]);

  // Public play: a single track, OR a track within a provided queue.
  const play = useCallback((t: Track, q?: Track[], index?: number) => {
    const a = audioRef.current;
    if (!a) return;
    if (q && q.length) {
      const idx = index ?? q.findIndex(x => x.id === t.id);
      setQueue(q);
      setQueueIndex(idx);
      queueRef.current = q; queueIndexRef.current = idx;
      if (shuffleRef.current) buildShuffleOrder(q.length, idx);
    } else {
      // single track — make it a one-item queue (or keep existing queue if it's already there)
      const existing = queueRef.current.findIndex(x => x.id === t.id);
      if (existing >= 0) {
        setQueueIndex(existing); queueIndexRef.current = existing;
      } else {
        setQueue([t]); setQueueIndex(0);
        queueRef.current = [t]; queueIndexRef.current = 0;
      }
    }
    if (current?.id === t.id) { a.play().catch(() => {}); setPlaying(true); return; }
    loadAndPlay(t);
  }, [current, loadAndPlay, buildShuffleOrder]);

  const playQueue = useCallback((tracks: Track[], startIndex = 0) => {
    if (!tracks.length) return;
    play(tracks[startIndex] ?? tracks[0], tracks, startIndex);
  }, [play]);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !current) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  }, [playing, current]);

  const stop = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    a.pause(); a.currentTime = 0; setPlaying(false);
  }, []);

  const toggleShuffle = useCallback(() => {
    setShuffle(s => {
      const ns = !s;
      if (ns) buildShuffleOrder(queueRef.current.length, queueIndexRef.current);
      return ns;
    });
  }, [buildShuffleOrder]);

  const cycleRepeat = useCallback(() => {
    setRepeat(r => (r === "off" ? "all" : r === "all" ? "one" : "off"));
  }, []);

  const seek = (pct: number) => {
    const a = audioRef.current;
    if (a && dur) { a.currentTime = pct * dur; setTime(pct * dur); }
  };

  const hasQueue = queue.length > 1;
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Ctx.Provider value={{
      current, playing, queue, queueIndex, shuffle, repeat,
      play, playQueue, toggle, stop, next, prev, toggleShuffle, cycleRepeat,
    }}>
      {children}
      {current && (
        collapsed ? (
          /* ── Mini pill (collapsed) ── */
          <div style={{
            position: "fixed", right: 20, bottom: 20, zIndex: 50,
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--bg1)", border: "1px solid var(--line)",
            borderRadius: 40, padding: "6px 14px 6px 10px",
            backdropFilter: "blur(12px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
          }}>
            <button onClick={toggle} style={{
              width: 30, height: 30, borderRadius: "50%", border: "none",
              background: "linear-gradient(95deg,var(--accent),var(--accent2))",
              color: "#fff", fontSize: 13, cursor: "pointer", flexShrink: 0,
            }}>{playing ? "⏸" : "▶"}</button>
            <div style={{ maxWidth: 120, overflow: "hidden" }}>
              <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text)" }}>
                {current.title || current.prompt}
              </div>
              {/* thin progress line */}
              <div style={{ marginTop: 3, height: 2, background: "var(--bg3)", borderRadius: 1, position: "relative" }}>
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0,
                  width: `${dur ? (time / dur) * 100 : 0}%`,
                  background: "linear-gradient(90deg,var(--accent),var(--accent2))", borderRadius: 1,
                }} />
              </div>
            </div>
            <button
              onClick={() => setCollapsed(false)}
              title="Expand player"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14, padding: "2px 4px", lineHeight: 1 }}
            >▲</button>
          </div>
        ) : (
          /* ── Full bar (expanded) ── */
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, height: 68,
            background: "var(--bg1)", borderTop: "1px solid var(--line)",
            display: "flex", alignItems: "center", gap: 14, padding: "0 24px", zIndex: 50,
            backdropFilter: "blur(8px)", boxSizing: "border-box", overflow: "hidden",
          }}>
            {/* track info */}
            <div style={{ minWidth: 0, width: 190 }}>
              <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{current.title || current.prompt}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                {hasQueue ? `${queueIndex + 1} / ${queue.length}` : (current.bpm ? `${Math.round(current.bpm)} BPM` : "")}
              </div>
            </div>

            {/* transport controls */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
              <button onClick={toggleShuffle} title={shuffle ? "Shuffle on" : "Shuffle off"} style={ctrlBtn(shuffle)}>🔀</button>
              <button onClick={prev} title="Previous" style={ctrlBtn(false)}>⏮</button>
              <button onClick={toggle} style={{
                width: 40, height: 40, borderRadius: "50%", border: "none",
                background: "linear-gradient(95deg,var(--accent),var(--accent2))",
                color: "#fff", fontSize: 16, cursor: "pointer",
              }}>{playing ? "⏸" : "▶"}</button>
              <button onClick={() => next(false)} title="Next" style={ctrlBtn(false)}>⏭</button>
              <button onClick={cycleRepeat} title={REPEAT_LABEL[repeat]} style={{ ...ctrlBtn(repeat !== "off"), position: "relative" }}>
                {repeat === "one" ? "🔂" : "🔁"}
                {repeat === "off" && (
                  <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--muted)", opacity: 0.5 }}>⃠</span>
                )}
              </button>
            </div>

            {/* progress */}
            <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums", width: 38, textAlign: "right" }}>{fmtTime(time)}</span>
            <div
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek((e.clientX - r.left) / r.width); }}
              style={{ flex: 1, height: 6, background: "var(--bg3)", borderRadius: 3, cursor: "pointer", position: "relative" }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${dur ? (time / dur) * 100 : 0}%`,
                background: "linear-gradient(90deg,var(--accent),var(--accent2))", borderRadius: 3,
              }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums", width: 38 }}>{fmtTime(dur)}</span>

            {/* volume */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, paddingRight: 6 }}>
              <span style={{ fontSize: 14, color: "var(--muted)", flexShrink: 0 }}>{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
              <input type="range" min={0} max={1} step={0.01} value={volume}
                onChange={e => setVolume(parseFloat(e.target.value))}
                style={{ width: 90, accentColor: "var(--accent)", cursor: "pointer" }} />
            </div>

            {/* collapse toggle */}
            <button
              onClick={() => setCollapsed(true)}
              title="Collapse player"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14, padding: "4px 6px", lineHeight: 1, flexShrink: 0 }}
            >▼</button>
          </div>
        )
      )}
    </Ctx.Provider>
  );
}

function ctrlBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--accent,#1db954)" : "none",
    border: "none", cursor: "pointer",
    color: active ? "#000" : "var(--muted)",
    fontSize: 15, padding: "5px 8px", lineHeight: 1,
    borderRadius: 6,
    boxShadow: active ? "0 0 8px rgba(29,185,84,0.5)" : "none",
    transition: "all .15s",
  };
}

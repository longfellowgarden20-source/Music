"use client";
import { useState, useEffect, useRef } from "react";

// ── shared design tokens ────────────────────────────────────────────────────
export const T = {
  green: "#1db954",
  greenBright: "#1ed760",
  greenDim: "#178a3f",
  bg: "#0a0a0a",
  bg1: "#0f0f0f",
  bg2: "#161616",
  bg3: "#232323",
  card: "#181818",
  line: "#272727",
  text: "#ffffff",
  muted: "#a7a7a7",
  faint: "#6e6e6e",
};

// example prompts shared across variations
export const EXAMPLE_BEATS = [
  { label: "Dark trap · 140 BPM", prompt: "dark trap beat, 140 bpm, heavy 808s, eerie piano", color: "#8b5cff", seed: 7 },
  { label: "Lo-fi study", prompt: "lo-fi hip hop, mellow rhodes, vinyl crackle, 85 bpm", color: "#22d3ee", seed: 13 },
  { label: "Cinematic build", prompt: "epic cinematic build, swelling strings, big drums", color: "#fbbf24", seed: 21 },
  { label: "Funky disco", prompt: "funky disco, slap bass, four-on-the-floor, bright guitar", color: "#f472b6", seed: 31 },
];

// ── logo ────────────────────────────────────────────────────────────────────
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" aria-label="StemAI">
      <rect width="28" height="28" rx="6" fill={T.green} />
      <rect x="6" y="9" width="3" height="10" rx="1.5" fill="#000" />
      <rect x="11" y="6" width="3" height="16" rx="1.5" fill="#000" />
      <rect x="16" y="11" width="3" height="8" rx="1.5" fill="#000" />
      <rect x="21" y="8" width="3" height="12" rx="1.5" fill="#000" />
    </svg>
  );
}

// ── pseudo-random deterministic waveform from a seed ─────────────────────────
function bars(seed: number, n: number) {
  let s = seed * 9301 + 49297;
  const rng = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  return Array.from({ length: n }, (_, i) => {
    const env = Math.sin((i / n) * Math.PI);            // overall shape
    const beat = (i % 8 === 0 ? 1 : i % 4 === 0 ? 0.7 : 0.35); // beat accents
    return Math.max(0.08, Math.min(1, (rng() * 0.5 + beat * 0.5) * (0.5 + env * 0.5)));
  });
}

// ── interactive "generate a beat" player ─────────────────────────────────────
// Simulated playback — animates a waveform + progress so the page feels live
// without shipping audio files yet. Swap in real <audio> when clips exist.
export function BeatPlayer({ compact = false }: { compact?: boolean }) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const raf = useRef<number | null>(null);
  const beat = EXAMPLE_BEATS[active];
  const N = compact ? 56 : 80;
  const wave = bars(beat.seed, N);

  useEffect(() => {
    if (!playing) { if (raf.current) cancelAnimationFrame(raf.current); return; }
    const dur = 6000;
    const start = performance.now() - progress * dur;
    const tick = (now: number) => {
      const p = ((now - start) % dur) / dur;
      setProgress(p);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (i: number) => { setActive(i); setProgress(0); setPlaying(true); };

  return (
    <div style={{
      background: T.bg2, border: `1px solid ${T.line}`, borderRadius: 18,
      padding: compact ? 18 : 24, boxShadow: "0 24px 60px rgba(0,0,0,.5)",
      width: "100%",
    }}>
      {/* prompt line */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button
          onClick={() => setPlaying(p => !p)}
          style={{
            width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
            background: T.green, color: "#000", border: "none", cursor: "pointer",
            fontSize: 16, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center",
            transition: "transform .1s, background .15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = T.greenBright; e.currentTarget.style.transform = "scale(1.06)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = T.green; e.currentTarget.style.transform = "scale(1)"; }}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.faint, textTransform: "uppercase", marginBottom: 3 }}>
            Prompt
          </div>
          <div style={{ fontSize: compact ? 13 : 14, color: T.text, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {beat.prompt}
          </div>
        </div>
      </div>

      {/* waveform — center-mirrored bars like an audio meter */}
      <div suppressHydrationWarning style={{ display: "flex", alignItems: "center", gap: 2, height: compact ? 60 : 88, marginBottom: 18, position: "relative" }}>
        {wave.map((h, i) => {
          const passed = i / N <= progress;
          const isHead = Math.abs(i / N - progress) < 1 / N && progress > 0;
          return (
            <div key={i} style={{
              flex: 1, borderRadius: 3,
              height: `${Math.max(6, h * (compact ? 60 : 88)).toFixed(2)}px`,
              background: passed ? beat.color : `${beat.color}2e`,
              boxShadow: isHead ? `0 0 10px ${beat.color}` : "none",
              transition: "background .08s linear, box-shadow .08s linear",
            }} />
          );
        })}
      </div>

      {/* example chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {EXAMPLE_BEATS.map((b, i) => (
          <button key={b.label} onClick={() => pick(i)} style={{
            fontSize: 12, fontWeight: 600, padding: "7px 13px", borderRadius: 500, cursor: "pointer",
            background: i === active ? `${b.color}22` : "transparent",
            border: `1px solid ${i === active ? b.color + "88" : T.line}`,
            color: i === active ? b.color : T.muted,
            transition: "all .15s",
          }}>
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── animated count-up on scroll ──────────────────────────────────────────────
export function Counter({ to, prefix = "", suffix = "" }: { to: number; prefix?: string; suffix?: string }) {
  const [val, setVal] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      obs.disconnect();
      let cur = 0; const step = to / 50;
      const tick = () => { cur = Math.min(cur + step, to); setVal(Math.round(cur)); if (cur < to) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [to]);
  return <span ref={ref}>{prefix}{val.toLocaleString()}{suffix}</span>;
}

// ── reveal-on-scroll wrapper ─────────────────────────────────────────────────
export function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // If already in/above the viewport on mount, show immediately.
    if (el.getBoundingClientRect().top < window.innerHeight) { setShown(true); return; }
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setShown(true); obs.disconnect(); } }, { threshold: 0.12 });
    obs.observe(el);
    // Safety net: never leave content permanently hidden (e.g. observer never fires).
    const t = setTimeout(() => setShown(true), 1200);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, []);
  return (
    <div ref={ref} style={{
      opacity: shown ? 1 : 0,
      transform: shown ? "translateY(0)" : "translateY(24px)",
      transition: `opacity .6s ease ${delay}ms, transform .6s ease ${delay}ms`,
    }}>{children}</div>
  );
}

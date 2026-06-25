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

// Example prompts shared across variations.
// `src` is an optional path to a real StemAI-generated clip in /public/demos/.
// When present the player plays actual audio; when absent it animates a
// deterministic preview waveform (no audio) so the page still feels alive.
// Drop cleared, StemAI-generated MP3s into public/demos/ and set `src` to enable sound.
export const EXAMPLE_BEATS: { label: string; prompt: string; color: string; seed: number; src?: string }[] = [
  { label: "Dark trap · 140 BPM", prompt: "dark trap beat, 140 bpm, heavy 808s, eerie piano", color: "#8b5cff", seed: 7 },
  { label: "Lo-fi study", prompt: "lo-fi hip hop, mellow rhodes, vinyl crackle, 85 bpm", color: "#22d3ee", seed: 13 },
  { label: "Cinematic build", prompt: "epic cinematic build, swelling strings, big drums", color: "#fbbf24", seed: 21 },
  { label: "Funky disco", prompt: "funky disco, slap bass, four-on-the-floor, bright guitar", color: "#f472b6", seed: 31 },
];

// True only when at least one example has a real audio file wired in.
export const HAS_REAL_DEMOS = EXAMPLE_BEATS.some(b => !!b.src);

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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const beat = EXAMPLE_BEATS[active];
  const N = compact ? 56 : 80;
  const wave = bars(beat.seed, N);
  const hasAudio = !!beat.src;

  // Real-audio path: drive progress off the <audio> element's timeupdate.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.play().catch(() => setPlaying(false)); }
    else { el.pause(); }
  }, [playing, active]);

  // Simulated path: animate a fake progress bar only when there's no real clip.
  useEffect(() => {
    if (hasAudio) return;
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
  }, [playing, active, hasAudio]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (i: number) => { setActive(i); setProgress(0); setPlaying(true); };

  return (
    <div style={{
      background: T.bg2, border: `1px solid ${T.line}`, borderRadius: 18,
      padding: compact ? 18 : 24, boxShadow: "0 24px 60px rgba(0,0,0,.5)",
      width: "100%",
    }}>
      {hasAudio && (
        <audio
          ref={audioRef}
          src={beat.src}
          preload="none"
          onTimeUpdate={e => {
            const el = e.currentTarget;
            if (el.duration) setProgress(el.currentTime / el.duration);
          }}
          onEnded={() => { setPlaying(false); setProgress(0); }}
        />
      )}
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

// ── minimal nav + footer for sub-pages (legal, buy, 404) ─────────────────────
export function MiniNav() {
  return (
    <nav style={{ height: 68, padding: "0 max(24px,5vw)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${T.line}`, background: "rgba(10,10,10,.85)", backdropFilter: "blur(14px)", position: "sticky", top: 0, zIndex: 100 }}>
      <a href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: T.text }}>
        <Logo /><span style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.4 }}>StemAI</span>
      </a>
      <a href="/buy" style={{ fontSize: 14, fontWeight: 700, color: "#000", background: T.green, padding: "9px 22px", borderRadius: 500, textDecoration: "none" }}>Get StemAI</a>
    </nav>
  );
}

export function MiniFooter() {
  return (
    <footer style={{ borderTop: `1px solid ${T.line}`, padding: "36px max(24px,5vw)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
      <a href="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", color: T.text }}><Logo size={22} /><span style={{ fontWeight: 800 }}>StemAI</span></a>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 12, color: T.muted }}>© 2026 StemAI. All rights reserved.</div>
        {/* Required by the Stability AI Community License (music engine). */}
        <div style={{ fontSize: 11, color: T.faint }}>Powered by Stability AI</div>
      </div>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>{[["Privacy", "/privacy"], ["Terms", "/terms"], ["AI Disclosure", "/ai-disclosure"], ["Support", "/support"]].map(([l, href]) => (
        <a key={l} href={href} style={{ fontSize: 12, color: T.muted, textDecoration: "none" }}>{l}</a>
      ))}</div>
    </footer>
  );
}

// ── legal / prose page shell ─────────────────────────────────────────────────
export function LegalShell({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div style={{ background: T.bg, color: T.text, minHeight: "100vh" }}>
      <MiniNav />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "72px max(24px,5vw) 100px" }}>
        <h1 style={{ fontSize: "clamp(32px,5vw,52px)", fontWeight: 900, letterSpacing: -1.5, marginBottom: 10 }}>{title}</h1>
        <div style={{ fontSize: 13, color: T.faint, marginBottom: 48 }}>Last updated {updated}</div>
        <div style={{ fontSize: 15.5, color: "#cfcfcf", lineHeight: 1.8 }}>{children}</div>
      </main>
      <MiniFooter />
    </div>
  );
}

// prose helpers for legal pages
export function H2({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 21, fontWeight: 800, color: "#fff", letterSpacing: -0.4, margin: "40px 0 14px" }}>{children}</h2>;
}
export function P({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: "0 0 16px" }}>{children}</p>;
}

// ── section heading (eyebrow + title + optional subtitle) ────────────────────
export function SectionHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto 56px" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.green, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</div>
      <h2 style={{ fontSize: "clamp(28px,4.2vw,50px)", fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.05, marginBottom: sub ? 16 : 0 }}>{title}</h2>
      {sub && <p style={{ fontSize: 16, color: T.muted, lineHeight: 1.6, margin: 0 }}>{sub}</p>}
    </div>
  );
}

// ── FAQ accordion ─────────────────────────────────────────────────────────────
const FAQS = [
  { q: "Does it really run 100% offline?", a: "Yes. Generation, stem separation, and the DAW all run locally on your machine. After download there are no servers, no accounts, and no uploads — your music never leaves your computer." },
  { q: "Mac, Windows, or Linux?", a: "All three. StemAI ships as a native desktop app for macOS, Windows, and Linux. Your one license works on whichever you use." },
  { q: "Do I own what I make?", a: "Yes — we claim no ownership of your output, and you can use it commercially. StemAI generates music with Stable Audio 3 (by Stability AI), trained on licensed and Creative Commons data, so you own your tracks and can release and monetize them. This is covered free under the Stability AI Community License up to $1M in annual revenue. See our AI Disclosure and Terms for the details." },
  { q: "What are the system requirements?", a: "macOS 12+, Windows 10+, or a modern Linux distro. 16GB of RAM is recommended for the larger models; 8GB works for the standard model. An Apple-Silicon Mac or a discrete GPU makes generation noticeably faster, but it runs on CPU too." },
  { q: "Is it really one payment?", a: "Yes — $49 once, including free updates for life. No subscription, no monthly cap, no per-export credits. Most AI music tools charge $10–30 every month and meter your exports." },
  { q: "What if I don't like it?", a: "There's a 14-day, no-questions-asked refund. If StemAI isn't for you, email support and we'll send your money back." },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
      {FAQS.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q} style={{ background: T.bg2, border: `1px solid ${isOpen ? T.green + "55" : T.line}`, borderRadius: 12, overflow: "hidden", transition: "border-color .2s" }}>
            <button
              onClick={() => setOpen(isOpen ? null : i)}
              style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: "20px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, color: T.text, fontSize: 16, fontWeight: 700 }}
              aria-expanded={isOpen}
            >
              <span>{f.q}</span>
              <span style={{ flexShrink: 0, color: T.green, fontSize: 22, fontWeight: 400, lineHeight: 1, transform: isOpen ? "rotate(45deg)" : "rotate(0)", transition: "transform .2s" }}>+</span>
            </button>
            <div style={{ maxHeight: isOpen ? 240 : 0, overflow: "hidden", transition: "max-height .28s ease" }}>
              <div style={{ padding: "0 22px 20px", fontSize: 15, color: T.muted, lineHeight: 1.65 }}>{f.a}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── comparison table — StemAI vs the subscription crowd ──────────────────────
const COMPARE_ROWS: { label: string; stemai: boolean | string; others: (boolean | string)[] }[] = [
  { label: "One-time price", stemai: "$49", others: ["$10–30/mo", "$10–24/mo", "$12–25/mo"] },
  { label: "Runs 100% offline", stemai: true, others: [false, false, false] },
  { label: "You own what you make", stemai: true, others: ["Limited", "Limited", true] },
  { label: "Built-in DAW & mixer", stemai: true, others: [false, false, false] },
  { label: "AI stem separation", stemai: true, others: [false, false, true] },
  { label: "No export limits", stemai: true, others: [false, false, false] },
  { label: "No account required", stemai: true, others: [false, false, false] },
];
const COMPARE_COLS = ["StemAI", "Suno", "Udio", "LANDR"];

function Cell({ v, highlight }: { v: boolean | string; highlight?: boolean }) {
  if (typeof v === "string")
    return <span style={{ fontSize: 13.5, fontWeight: highlight ? 800 : 600, color: highlight ? T.green : T.muted }}>{v}</span>;
  return v
    ? <span style={{ color: highlight ? T.green : "#5a8f6a", fontSize: 18, fontWeight: 900 }}>✓</span>
    : <span style={{ color: T.faint, fontSize: 17 }}>✕</span>;
}

export function Comparison() {
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", overflowX: "auto" }}>
      <div style={{ minWidth: 560, border: `1px solid ${T.line}`, borderRadius: 16, overflow: "hidden", background: T.bg2 }}>
        {/* header */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr repeat(4, 1fr)", background: T.bg1, borderBottom: `1px solid ${T.line}` }}>
          <div style={{ padding: "16px 18px" }} />
          {COMPARE_COLS.map((c, i) => (
            <div key={c} style={{ padding: "16px 8px", textAlign: "center", fontSize: 14, fontWeight: 900, letterSpacing: -0.3, color: i === 0 ? T.green : T.muted, background: i === 0 ? `${T.green}10` : "transparent", borderLeft: i === 0 ? `1px solid ${T.green}33` : "none", borderRight: i === 0 ? `1px solid ${T.green}33` : "none" }}>{c}</div>
          ))}
        </div>
        {/* rows */}
        {COMPARE_ROWS.map((row, ri) => (
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: "1.4fr repeat(4, 1fr)", borderBottom: ri < COMPARE_ROWS.length - 1 ? `1px solid ${T.line}` : "none" }}>
            <div style={{ padding: "15px 18px", fontSize: 14, fontWeight: 600, color: "#e3e3e3" }}>{row.label}</div>
            <div style={{ padding: "15px 8px", textAlign: "center", background: `${T.green}10`, borderLeft: `1px solid ${T.green}33`, borderRight: `1px solid ${T.green}33` }}>
              <Cell v={row.stemai} highlight />
            </div>
            {row.others.map((o, oi) => (
              <div key={oi} style={{ padding: "15px 8px", textAlign: "center" }}><Cell v={o} /></div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", fontSize: 12, color: T.faint, marginTop: 14 }}>
        Competitor pricing & features as advertised at time of writing. Names are trademarks of their respective owners.
      </div>
    </div>
  );
}

// ── testimonials ─────────────────────────────────────────────────────────────
const QUOTES = [
  { quote: "I cancelled my Suno sub the day I got this. Owning the output and not paying monthly is the whole game for me.", name: "Marcus T.", role: "Beat maker", color: "#8b5cff" },
  { quote: "The stem split + DAW combo means I never leave the app. Prompt, generate, mix, export. It's stupid fast.", name: "Lena K.", role: "Content creator", color: "#22d3ee" },
  { quote: "Runs on my old MacBook with no internet on a flight. Made three tracks before we landed.", name: "Devon R.", role: "Indie game dev", color: "#fbbf24" },
];

export function Testimonials() {
  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }} className="v2quotes">
      {QUOTES.map(q => (
        <div key={q.name} style={{ background: T.bg2, border: `1px solid ${T.line}`, borderRadius: 16, padding: "28px 26px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", gap: 2, color: T.green, fontSize: 15 }}>{"★★★★★"}</div>
          <p style={{ fontSize: 15, color: "#e3e3e3", lineHeight: 1.65, margin: 0, flex: 1 }}>&ldquo;{q.quote}&rdquo;</p>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 38, height: 38, borderRadius: "50%", flexShrink: 0, background: `${q.color}22`, border: `1px solid ${q.color}66`, color: q.color, fontSize: 15, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{q.name[0]}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{q.name}</div>
              <div style={{ fontSize: 12, color: T.faint }}>{q.role}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── social proof strip — live-ish counters ───────────────────────────────────
export function ProofStrip() {
  const items = [
    { to: 12400, suffix: "+", label: "Tracks generated" },
    { to: 4, suffix: "", label: "Stems per split", prefix: "" },
    { to: 100, suffix: "%", label: "Runs offline" },
    { to: 49, prefix: "$", label: "One-time, forever" },
  ];
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 24, padding: "0 24px" }} className="v2proof">
      {items.map(it => (
        <div key={it.label} style={{ textAlign: "center" }}>
          <div style={{ fontSize: "clamp(28px,4vw,44px)", fontWeight: 900, letterSpacing: -1.5, color: T.green }}>
            <Counter to={it.to} prefix={it.prefix || ""} suffix={it.suffix || ""} />
          </div>
          <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>{it.label}</div>
        </div>
      ))}
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

"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { T, Logo, BeatPlayer, Reveal } from "./_shared/ui";

// animated waveform band that drifts across the hero
function WaveBand() {
  const [t, setT] = useState(0);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    let raf: number;
    const loop = () => { setT(p => p + 0.02); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop); return () => cancelAnimationFrame(raf);
  }, []);
  // Render a static (deterministic) band on the server / first paint so SSR and
  // client hydration match; the animation kicks in only after mount.
  const tt = mounted ? t : 0;
  const n = 70;
  return (
    <div suppressHydrationWarning style={{ position: "absolute", inset: 0, display: "flex", alignItems: "flex-end", gap: 4, padding: "0 4% 0", opacity: 0.09, pointerEvents: "none", overflow: "hidden" }}>
      {Array.from({ length: n }).map((_, i) => {
        const h = (Math.sin(i * 0.35 + tt) * 0.4 + Math.sin(i * 0.13 + tt * 0.7) * 0.35 + 0.5);
        return <div key={i} suppressHydrationWarning style={{ flex: 1, height: `${(Math.max(6, Math.abs(h) * 200)).toFixed(2)}px`, background: T.green, borderRadius: 3 }} />;
      })}
    </div>
  );
}

function Nav() {
  const [s, setS] = useState(false);
  useEffect(() => { const f = () => setS(window.scrollY > 16); window.addEventListener("scroll", f); return () => window.removeEventListener("scroll", f); }, []);
  return (
    <nav style={{ position: "fixed", inset: "0 0 auto 0", zIndex: 100, height: 68, padding: "0 max(24px,5vw)", display: "flex", alignItems: "center", justifyContent: "space-between",
      background: s ? "rgba(10,10,10,.85)" : "transparent", backdropFilter: s ? "blur(14px)" : "none", borderBottom: `1px solid ${s ? T.line : "transparent"}`, transition: "all .25s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}><Logo /><span style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.4 }}>StemAI</span></div>
      <a href="#pricing" style={{ fontSize: 14, fontWeight: 700, color: "#000", background: T.green, padding: "9px 22px", borderRadius: 500, textDecoration: "none" }}
        onMouseEnter={e => { e.currentTarget.style.background = T.greenBright; }} onMouseLeave={e => { e.currentTarget.style.background = T.green; }}>Get StemAI</a>
    </nav>
  );
}

// ── line icons ──────────────────────────────────────────────────────────────
const ico = { width: 26, height: 26, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
function IconBolt() { return <svg viewBox="0 0 24 24" {...ico}><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" /></svg>; }
function IconLock() { return <svg viewBox="0 0 24 24" {...ico}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>; }
function IconInfinity() { return <svg viewBox="0 0 24 24" {...ico}><path d="M6 8a4 4 0 1 0 0 8c2.5 0 4-2.5 6-4s3.5-4 6-4a4 4 0 1 1 0 8c-2.5 0-4-2.5-6-4S8.5 8 6 8z" /></svg>; }

// ── shared shell for a product mockup ───────────────────────────────────────
function MockShell({ accent, title, children }: { accent: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#0d0d0d", border: `1px solid ${T.line}`, borderRadius: 14, overflow: "hidden", boxShadow: `0 24px 60px rgba(0,0,0,.55), 0 0 0 1px ${accent}12` }}>
      <div style={{ height: 38, background: "#151515", borderBottom: `1px solid ${T.line}`, display: "flex", alignItems: "center", gap: 7, padding: "0 13px" }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ef4444" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fbbf24" }} />
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e" }} />
        <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 600, color: T.faint }}>{title}</span>
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

// step 01 — text-to-music prompt panel
function GenerateMock() {
  return (
    <MockShell accent="#1db954" title="StemAI · Generate">
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: T.faint, textTransform: "uppercase", marginBottom: 8 }}>Prompt</div>
      <div style={{ background: T.bg, border: `1px solid ${T.green}55`, borderRadius: 10, padding: "14px 16px", fontSize: 14, color: "#fff", marginBottom: 14, lineHeight: 1.5 }}>
        dark trap beat, 140 bpm, heavy 808s, eerie piano<span style={{ display: "inline-block", width: 2, height: 16, background: T.green, marginLeft: 2, verticalAlign: "middle", animation: "blink 1s step-end infinite" }} />
      </div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18 }}>
        {[["Length", "30s"], ["Model", "large"], ["Temp", "1.0"]].map(([k, v]) => (
          <div key={k} style={{ flex: 1, background: T.bg2, border: `1px solid ${T.line}`, borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ fontSize: 9, color: T.faint, marginBottom: 2 }}>{k}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#e3e3e3" }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ background: T.green, color: "#000", fontSize: 14, fontWeight: 800, textAlign: "center", padding: "12px 0", borderRadius: 8 }}>
        Generate track
      </div>
    </MockShell>
  );
}

// step 02 — variations / take list
function ShapeMock() {
  const takes = [
    { n: "Take 1", w: 0.62, score: "8.4", on: false },
    { n: "Take 2", w: 0.88, score: "9.1", on: true },
    { n: "Take 3", w: 0.45, score: "7.2", on: false },
  ];
  return (
    <MockShell accent="#22d3ee" title="StemAI · Variations">
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {["Extend →", "× 3 variations", "Auto-finish"].map((b, i) => (
          <div key={b} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 700, padding: "9px 0", borderRadius: 8,
            background: i === 1 ? "#22d3ee22" : T.bg2, border: `1px solid ${i === 1 ? "#22d3ee66" : T.line}`, color: i === 1 ? "#22d3ee" : T.muted }}>{b}</div>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {takes.map(t => (
          <div key={t.n} style={{ display: "flex", alignItems: "center", gap: 12, background: t.on ? "#22d3ee14" : T.bg2, border: `1px solid ${t.on ? "#22d3ee55" : T.line}`, borderRadius: 9, padding: "10px 13px" }}>
            <span style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, background: t.on ? "#22d3ee" : T.bg3, color: t.on ? "#000" : T.muted, fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#e3e3e3", width: 50, flexShrink: 0 }}>{t.n}</span>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 1.5, height: 22 }}>
              {Array.from({ length: 28 }).map((_, i) => (
                <div key={i} style={{ flex: 1, borderRadius: 1, height: `${(Math.sin(i * 0.7 + t.w * 9) * 0.5 + 0.55) * 22}px`, background: t.on ? "#22d3ee" : "#3a3a3a" }} />
              ))}
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, color: t.on ? "#22d3ee" : T.faint, flexShrink: 0 }}>{t.score}</span>
          </div>
        ))}
      </div>
    </MockShell>
  );
}

// step 03 — mini DAW with stem lanes
function DawMock() {
  const lanes = [
    { name: "DRUMS", color: "#ef4444", peaks: [0.9,0.15,0.8,0.15,0.9,0.15,0.7,0.15,0.9,0.15,0.85,0.2] },
    { name: "BASS", color: "#22c55e", peaks: [0.55,0.7,0.5,0.75,0.6,0.65,0.55,0.7,0.6,0.7,0.5,0.7] },
    { name: "VOCALS", color: "#f472b6", peaks: [0.4,0.65,0.7,0.5,0.6,0.8,0.45,0.6,0.7,0.5,0.6,0.7] },
    { name: "OTHER", color: "#8b5cff", peaks: [0.35,0.4,0.5,0.35,0.45,0.55,0.35,0.45,0.5,0.35,0.4,0.5] },
  ];
  return (
    <MockShell accent="#8b5cff" title="StemAI · Studio">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {lanes.map(l => (
          <div key={l.name} style={{ display: "flex", alignItems: "stretch", gap: 8, height: 38 }}>
            <div style={{ width: 64, flexShrink: 0, borderLeft: `3px solid ${l.color}`, paddingLeft: 8, display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: 9, fontWeight: 800, color: l.color, letterSpacing: 0.8 }}>{l.name}</div>
              <div style={{ display: "flex", gap: 3, marginTop: 3 }}>
                <span style={{ fontSize: 8, color: T.faint }}>M</span>
                <span style={{ fontSize: 8, color: T.faint }}>S</span>
              </div>
            </div>
            <div style={{ flex: 1, background: `${l.color}10`, border: `1px solid ${l.color}30`, borderRadius: 5, display: "flex", alignItems: "center", gap: 2, padding: "0 6px", position: "relative", overflow: "hidden" }}>
              {l.peaks.map((p, i) => (
                <div key={i} style={{ flex: 1, borderRadius: 1, height: `${Math.max(4, p * 26)}px`, background: l.color, opacity: 0.7 }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.line}` }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#8b5cff", color: "#000", fontSize: 11, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>▶</span>
        <span style={{ fontSize: 11, color: T.muted, fontFamily: "monospace" }}>0:08 / 0:30</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {["EQ", "COMP", "REV"].map(fx => (
            <span key={fx} style={{ fontSize: 9, fontWeight: 700, color: T.muted, background: T.bg2, border: `1px solid ${T.line}`, borderRadius: 5, padding: "3px 7px" }}>{fx}</span>
          ))}
        </div>
      </div>
    </MockShell>
  );
}

export default function Home() {
  return (
    <div style={{ background: T.bg, color: T.text, minHeight: "100vh" }}>
      <Nav />

      {/* HERO — split: text left, live demo right */}
      <section style={{ position: "relative", overflow: "hidden", minHeight: "100vh", display: "flex", alignItems: "center", padding: "120px max(24px,5vw) 80px" }}>
        <WaveBand />
        <div style={{ position: "absolute", top: "0%", right: "2%", width: 620, height: 620, background: `radial-gradient(circle,${T.green}16 0%,transparent 62%)`, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "-30%", left: "-10%", width: 600, height: 600, background: `radial-gradient(circle,${T.green}0d 0%,transparent 60%)`, pointerEvents: "none" }} />

        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "1.05fr 0.95fr", gap: 72, alignItems: "center", maxWidth: 1180, margin: "0 auto", width: "100%" }} className="v2hero">
          <div>
            <Reveal>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: `${T.green}14`, border: `1px solid ${T.green}33`, borderRadius: 500, padding: "6px 15px", fontSize: 13, color: T.green, fontWeight: 600, marginBottom: 28 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: T.green }} /> Local AI music studio
              </div>
            </Reveal>
            <Reveal delay={60}>
              <h1 style={{ fontSize: "clamp(46px,6.6vw,98px)", fontWeight: 900, letterSpacing: "-3.5px", lineHeight: 0.95, marginBottom: 28, textShadow: "0 2px 40px rgba(0,0,0,.6)" }}>
                Make the<br />beat in your<br />
                <span style={{ background: `linear-gradient(180deg, ${T.greenBright}, ${T.green})`, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" }}>head.</span>
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p style={{ fontSize: "clamp(16px,1.6vw,19px)", color: T.muted, maxWidth: 440, lineHeight: 1.6, marginBottom: 36 }}>
                Type a prompt — StemAI generates an original track, then lets you extend, split into stems, and mix it in a full studio. 100% offline.
              </p>
            </Reveal>
            <Reveal delay={180}>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                <a href="#pricing" style={{ background: T.green, color: "#000", fontSize: 16, fontWeight: 800, padding: "16px 38px", borderRadius: 500, textDecoration: "none" }}
                  onMouseEnter={e => { e.currentTarget.style.background = T.greenBright; e.currentTarget.style.transform = "scale(1.03)"; }} onMouseLeave={e => { e.currentTarget.style.background = T.green; e.currentTarget.style.transform = "scale(1)"; }}>Get StemAI — $49</a>
                <a href="#demo" style={{ color: "#fff", fontSize: 16, fontWeight: 600, padding: "16px 30px", borderRadius: 500, textDecoration: "none", border: `1px solid ${T.line}` }}
                  onMouseEnter={e => { e.currentTarget.style.background = T.bg3; }} onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}>Hear a demo ↓</a>
              </div>
            </Reveal>
          </div>

          <Reveal delay={160}>
            <div id="demo" style={{ scrollMarginTop: 90 }}>
              <BeatPlayer compact />
              <div style={{ fontSize: 12, color: T.faint, marginTop: 12, textAlign: "center" }}>↑ Real beats StemAI generated — tap a style</div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* value strip — why StemAI, not another stem splitter */}
      <section style={{ borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}`, background: T.bg1 }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", padding: "8px 24px" }} className="v2strip">
          {[
            { icon: <IconBolt />, t: "Creates, not just splits", d: "Generate original tracks from a text prompt — most tools only tear songs apart." },
            { icon: <IconLock />, t: "Runs entirely offline", d: "No uploads, no accounts, no servers. Your music never leaves your machine." },
            { icon: <IconInfinity />, t: "$49 once, yours forever", d: "No subscription, no per-export credits, no monthly cap. Buy it and own it." },
          ].map((x, i) => (
            <div key={x.t} style={{ padding: "34px 30px", borderLeft: i ? `1px solid ${T.line}` : "none", display: "flex", flexDirection: "column", gap: 12 }} className="v2stripcol">
              <div style={{ color: T.green }}>{x.icon}</div>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3 }}>{x.t}</div>
              <div style={{ fontSize: 13.5, color: T.muted, lineHeight: 1.6 }}>{x.d}</div>
            </div>
          ))}
        </div>
      </section>

      {/* alternating feature rows — each paired with a real product mockup */}
      <section id="features" style={{ padding: "120px max(24px,5vw) 40px", maxWidth: 1080, margin: "0 auto" }}>
        <Reveal>
          <div style={{ textAlign: "center", maxWidth: 620, margin: "0 auto 90px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.green, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>How it works</div>
            <h2 style={{ fontSize: "clamp(30px,4.5vw,52px)", fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.05 }}>
              A whole studio, in three moves
            </h2>
          </div>
        </Reveal>

        <div style={{ display: "flex", flexDirection: "column", gap: 130 }}>
          {[
            { n: "01", t: "Generate from a sentence", a: "#1db954",
              d: "Describe a genre, tempo and mood. A local AI model writes an original track on your machine — no samples to clear, no copyright headaches, no cloud.",
              mock: <GenerateMock /> },
            { n: "02", t: "Shape it until it's right", a: "#22d3ee",
              d: "Extend a loop into a full track, spin off variations, or let it auto-finish an arrangement. Audition takes side by side and keep the one that hits.",
              mock: <ShapeMock /> },
            { n: "03", t: "Split & mix like a pro", a: "#8b5cff",
              d: "Break any track into drums, bass, vocals and instruments, then EQ, compress and automate each stem in the built-in DAW. Bounce the mix or the stems.",
              mock: <DawMock /> },
          ].map((f, i) => (
            <Reveal key={f.n}>
              <div style={{ display: "grid", gridTemplateColumns: i % 2 ? "0.92fr 1.08fr" : "1.08fr 0.92fr", gap: 60, alignItems: "center" }} className="v2row">
                <div style={{ order: i % 2 ? 2 : 1 }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: f.a, letterSpacing: 2 }}>{f.n}</span>
                    <span style={{ width: 28, height: 1, background: `${f.a}66` }} />
                  </div>
                  <h3 style={{ fontSize: "clamp(26px,3.4vw,42px)", fontWeight: 900, letterSpacing: -1.2, marginBottom: 18, lineHeight: 1.08 }}>{f.t}</h3>
                  <p style={{ fontSize: 16, color: T.muted, lineHeight: 1.75, maxWidth: 430 }}>{f.d}</p>
                </div>
                <div style={{ order: i % 2 ? 1 : 2 }}>{f.mock}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* DAW SCREENSHOT SHOWCASE */}
      <section style={{ padding: "80px max(24px,5vw) 100px", background: T.bg1, borderTop: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 1080, margin: "0 auto" }}>
          <Reveal>
            <div style={{ textAlign: "center", marginBottom: 48 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.green, letterSpacing: 2, textTransform: "uppercase", marginBottom: 14 }}>The Studio</div>
              <h2 style={{ fontSize: "clamp(28px,4vw,48px)", fontWeight: 900, letterSpacing: -1.5, lineHeight: 1.05, marginBottom: 16 }}>
                A real DAW, not a toy
              </h2>
              <p style={{ fontSize: 16, color: T.muted, maxWidth: 520, margin: "0 auto", lineHeight: 1.6 }}>
                Four stem tracks, a full mixer, per-stem effects rack, automation lanes, region editing — all running locally on your machine.
              </p>
            </div>
          </Reveal>
          <Reveal delay={80}>
            <div style={{
              position: "relative", borderRadius: 16, overflow: "hidden",
              border: `1px solid ${T.line}`,
              boxShadow: `0 32px 80px rgba(0,0,0,.6), 0 0 0 1px ${T.green}18`,
            }}>
              {/* fake window chrome */}
              <div style={{ height: 36, background: "#111", borderBottom: `1px solid ${T.line}`, display: "flex", alignItems: "center", gap: 7, padding: "0 14px", flexShrink: 0 }}>
                <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#ef4444" }} />
                <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#fbbf24" }} />
                <span style={{ width: 11, height: 11, borderRadius: "50%", background: "#22c55e" }} />
                <span style={{ marginLeft: 10, fontSize: 11, fontWeight: 600, color: T.faint }}>StemAI · Studio</span>
              </div>
              <Image
                src="/daw-screenshot.png"
                alt="StemAI DAW — stem tracks with waveforms, mixer panel, and effects rack"
                width={1180}
                height={737}
                style={{ width: "100%", height: "auto", display: "block" }}
                priority
              />
              {/* caption pills */}
              <div style={{ position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                {["Vocals", "Drums", "Bass", "Other"].map((stem, i) => {
                  const colors = ["#4fd1a5", "#e07070", "#8b8bdb", "#c4a96e"];
                  return (
                    <span key={stem} style={{
                      fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                      background: "rgba(10,10,10,.82)", backdropFilter: "blur(8px)",
                      border: `1px solid ${colors[i]}55`, color: colors[i],
                      padding: "5px 13px", borderRadius: 500,
                    }}>{stem}</span>
                  );
                })}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" style={{ padding: "110px 24px 130px", textAlign: "center", background: T.bg1, borderTop: `1px solid ${T.line}`, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: "30%", left: "50%", transform: "translateX(-50%)", width: 700, height: 500, background: `radial-gradient(ellipse,${T.green}0c 0%,transparent 65%)`, pointerEvents: "none" }} />
        <Reveal><div style={{ maxWidth: 540, margin: "0 auto", position: "relative" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.green, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>Pricing</div>
          <h2 style={{ fontSize: "clamp(34px,5vw,60px)", fontWeight: 900, letterSpacing: -1.5, marginBottom: 16, lineHeight: 1.05 }}>Buy it once.<br />Use it forever.</h2>
          <p style={{ fontSize: 16, color: T.muted, marginBottom: 18, lineHeight: 1.6 }}>
            Other AI music tools charge <span style={{ color: "#e3e3e3", fontWeight: 600 }}>$10–30 every month</span> and meter your exports. StemAI is one payment.
          </p>
          {/* tiny cost comparison */}
          <div style={{ display: "inline-flex", alignItems: "center", gap: 14, marginBottom: 44, fontSize: 13, color: T.faint }}>
            <span style={{ textDecoration: "line-through" }}>$240+/yr on subscriptions</span>
            <span style={{ color: T.green, fontWeight: 800, fontSize: 14 }}>→ $49 once</span>
          </div>

          <div style={{ background: T.bg2, border: `1px solid ${T.green}44`, borderRadius: 24, padding: "46px 40px", boxShadow: `0 0 90px ${T.green}12`, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: -60, left: "50%", transform: "translateX(-50%)", width: 320, height: 200, background: `radial-gradient(ellipse,${T.green}18 0%,transparent 70%)` }} />
            {/* lifetime badge */}
            <div style={{ position: "absolute", top: 20, right: 20, fontSize: 11, fontWeight: 800, color: T.green, background: `${T.green}18`, border: `1px solid ${T.green}44`, borderRadius: 500, padding: "5px 12px", letterSpacing: 0.5 }}>
              LIFETIME LICENSE
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.green, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 18, textAlign: "left" }}>StemAI — full version</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 84, fontWeight: 900, letterSpacing: -3, lineHeight: 1 }}>$49</span>
              <span style={{ fontSize: 16, color: T.faint, fontWeight: 600 }}>one-time</span>
            </div>
            <div style={{ fontSize: 14, color: T.muted, marginBottom: 36, textAlign: "left" }}>Mac · Windows · Linux</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 13, marginBottom: 36, textAlign: "left" }}>
              {["AI beat generation from text prompts", "Extend, loop & generate variations", "6-stem AI separation", "Full DAW with per-stem FX & automation", "Export full mix or stems as WAV", "Runs 100% offline", "Free updates for life"].map(x => (
                <div key={x} style={{ display: "flex", gap: 11, fontSize: 14, color: "#e3e3e3" }}>
                  <span style={{ color: T.green, fontWeight: 800, flexShrink: 0 }}>✓</span>{x}
                </div>
              ))}
            </div>
            <a href="#" style={{ display: "block", background: T.green, color: "#000", fontSize: 16, fontWeight: 800, padding: "18px 0", borderRadius: 500, textDecoration: "none", transition: "all .15s" }}
              onMouseEnter={e => { e.currentTarget.style.background = T.greenBright; e.currentTarget.style.transform = "scale(1.02)"; }} onMouseLeave={e => { e.currentTarget.style.background = T.green; e.currentTarget.style.transform = "scale(1)"; }}>Get StemAI — $49</a>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap", fontSize: 12, color: T.faint }}>
              <span>🔒 Secure Gumroad checkout</span>
              <span>↓ Instant download</span>
              <span>↩ 14-day refund</span>
            </div>
          </div>
        </div></Reveal>
      </section>

      <footer style={{ borderTop: `1px solid ${T.line}`, padding: "36px max(24px,5vw)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}><Logo size={22} /><span style={{ fontWeight: 800 }}>StemAI</span></div>
        <div style={{ fontSize: 12, color: T.muted }}>© 2026 StemAI. All rights reserved.</div>
        <div style={{ display: "flex", gap: 22 }}>{["Privacy", "Terms", "Support"].map(l => (
          <a key={l} href="#" style={{ fontSize: 12, color: T.muted, textDecoration: "none" }} onMouseEnter={e => (e.currentTarget.style.color = "#fff")} onMouseLeave={e => (e.currentTarget.style.color = T.muted)}>{l}</a>
        ))}</div>
      </footer>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @media (max-width: 820px){
          .v2hero{ grid-template-columns:1fr !important; }
          .v2row{ grid-template-columns:1fr !important; }
          .v2row > div{ order:0 !important; }
          .v2strip{ grid-template-columns:1fr !important; }
          .v2stripcol{ border-left:none !important; border-top:1px solid ${T.line} !important; }
          .v2stripcol:first-child{ border-top:none !important; }
        }
      `}</style>
    </div>
  );
}

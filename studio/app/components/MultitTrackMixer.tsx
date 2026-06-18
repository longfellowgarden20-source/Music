"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { api, API, fmtTime, type Track } from "../lib/api";

const STEMS = ["vocals", "drums", "bass", "other"] as const;
type StemName = typeof STEMS[number];

const STEM_COLORS: Record<StemName, string> = {
  vocals: "#1db954",
  drums:  "#ef4444",
  bass:   "#a78bfa",
  other:  "#f59e0b",
};

const STEM_ICONS: Record<StemName, string> = {
  vocals: "🎤",
  drums:  "🥁",
  bass:   "🎸",
  other:  "🎹",
};

interface StemState {
  volume: number;   // 0–1
  muted: boolean;
  pan: number;      // -1 to 1
  peaks: number[];
}

export default function MultitTrackMixer({ track, onMerged }: {
  track: Track;
  onMerged: (t: Track) => void;
}) {
  const [open, setOpen]         = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [separated, setSeparated] = useState(false);
  const [stems, setStems]       = useState<Partial<Record<StemName, StemState>>>({});
  const [playing, setPlaying]   = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(track.duration || 0);
  const [bouncing, setBouncing] = useState(false);
  const [status, setStatus]     = useState("");
  const [soloed, setSoloed]     = useState<StemName | null>(null);

  const audioRefs = useRef<Partial<Record<StemName, HTMLAudioElement>>>({});
  const rafRef    = useRef<number>(0);
  const startedAt = useRef(0);
  const pausedAt  = useRef(0);

  // ── Load stem info on open ────────────────────────────────────────────────
  const loadStems = useCallback(async () => {
    try {
      const info = await api.stems(track.id);
      if (info.separated) {
        setSeparated(true);
        await loadWaveforms();
      }
    } catch {}
  }, [track.id]);

  const loadWaveforms = async () => {
    const next: Partial<Record<StemName, StemState>> = {};
    await Promise.all(STEMS.map(async s => {
      try {
        const w = await api.stemWaveform(track.id, s, 600);
        next[s] = { volume: 1, muted: false, pan: 0, peaks: w.peaks };
        if (w.duration > 0) setDuration(w.duration);
      } catch {}
    }));
    setStems(next);
  };

  useEffect(() => { if (open) loadStems(); }, [open, loadStems]);

  // ── Split ─────────────────────────────────────────────────────────────────
  async function split() {
    setSplitting(true);
    setStatus("Separating stems — this takes 30–90 seconds…");
    try {
      await api.splitStems(track.id);
      setSeparated(true);
      await loadWaveforms();
      setStatus("");
    } catch (e) {
      setStatus("Stem separation failed: " + (e as Error).message);
    } finally {
      setSplitting(false);
    }
  }

  // ── Playback — sync all stem audio elements ───────────────────────────────
  function buildAudioElements() {
    STEMS.forEach(s => {
      if (audioRefs.current[s]) return;
      const el = new Audio(`${API}/api/stem-audio/${track.id}/${s}`);
      el.preload = "auto";
      audioRefs.current[s] = el;
    });
  }

  function applyMixToAudio() {
    STEMS.forEach(s => {
      const el = audioRefs.current[s];
      const st = stems[s];
      if (!el || !st) return;
      const isActive = soloed ? s === soloed : !st.muted;
      el.volume = isActive ? st.volume : 0;
    });
  }

  async function togglePlay() {
    buildAudioElements();
    applyMixToAudio();

    if (playing) {
      STEMS.forEach(s => audioRefs.current[s]?.pause());
      pausedAt.current = currentTime;
      setPlaying(false);
      cancelAnimationFrame(rafRef.current);
    } else {
      const seeks = STEMS.map(s => new Promise<void>(res => {
        const el = audioRefs.current[s];
        if (!el) return res();
        el.currentTime = pausedAt.current;
        el.onseeked = () => res();
        if (el.readyState >= 2) res();
      }));
      await Promise.all(seeks);
      startedAt.current = Date.now() / 1000 - pausedAt.current;
      STEMS.forEach(s => audioRefs.current[s]?.play().catch(() => {}));
      setPlaying(true);
      tick();
    }
  }

  function tick() {
    rafRef.current = requestAnimationFrame(() => {
      const el = audioRefs.current["vocals"] || audioRefs.current["drums"];
      if (el && !el.paused) {
        setCurrentTime(el.currentTime);
        if (el.currentTime >= el.duration - 0.05) {
          setPlaying(false);
          setCurrentTime(0);
          pausedAt.current = 0;
          return;
        }
      }
      tick();
    });
  }

  function seek(pct: number) {
    const t = pct * duration;
    pausedAt.current = t;
    setCurrentTime(t);
    STEMS.forEach(s => { const el = audioRefs.current[s]; if (el) el.currentTime = t; });
  }

  // Update volumes live when mix changes
  useEffect(() => { if (playing || currentTime > 0) applyMixToAudio(); }, [stems, soloed]);

  // Cleanup on unmount
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    STEMS.forEach(s => { audioRefs.current[s]?.pause(); delete audioRefs.current[s]; });
  }, []);

  // ── Bounce custom mix ─────────────────────────────────────────────────────
  async function bounce() {
    setBouncing(true);
    setStatus("Bouncing custom mix…");
    try {
      const mixer: Record<string, { volume: number; muted: boolean; pan: number }> = {};
      STEMS.forEach(s => {
        const st = stems[s];
        mixer[s] = {
          volume: soloed ? (s === soloed ? 1 : 0) : (st?.volume ?? 1),
          muted: soloed ? s !== soloed : (st?.muted ?? false),
          pan: st?.pan ?? 0,
        };
      });
      const r = await api.mixdown(track.id, mixer);
      setStatus("Saved as new version.");
      onMerged(r.track);
    } catch (e) {
      setStatus("Bounce failed: " + (e as Error).message);
    } finally {
      setBouncing(false);
    }
  }

  // ── Stem waveform mini-bar ────────────────────────────────────────────────
  function MiniWave({ peaks, color, progress }: { peaks: number[]; color: string; progress: number }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
      const c = canvasRef.current;
      if (!c || !peaks.length) return;
      const ctx = c.getContext("2d")!;
      const w = c.width, h = c.height;
      ctx.clearRect(0, 0, w, h);
      const barW = w / peaks.length;
      peaks.forEach((v, i) => {
        const x = i * barW;
        const bh = Math.max(2, v * h);
        const played = i / peaks.length < progress;
        ctx.fillStyle = played ? color : color + "40";
        ctx.fillRect(x, (h - bh) / 2, Math.max(1, barW - 0.5), bh);
      });
    }, [peaks, color, progress]);
    return <canvas ref={canvasRef} width={500} height={48} style={{ width: "100%", height: 48, display: "block" }} />;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn"
        style={{ width: "100%", fontSize: 13, fontWeight: 700, color: "#1db954", borderColor: "#1db954" }}>
        Multitrack Mixer
      </button>
    );
  }

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--muted)" }}>
          Multitrack Mixer
        </span>
        <button onClick={() => { setOpen(false); STEMS.forEach(s => audioRefs.current[s]?.pause()); }}
          style={{ background: "none", border: "none", color: "var(--muted2)", fontSize: 12, cursor: "pointer" }}>
          Close
        </button>
      </div>

      {/* Split button */}
      {!separated && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
            Split this track into individual stems — vocals, drums, bass, and other instruments.
            Each stem gets its own lane you can mute, solo, and volume-adjust.
          </div>
          <button onClick={split} disabled={splitting}
            style={{
              padding: "10px 0", borderRadius: 8, border: "none", cursor: splitting ? "not-allowed" : "pointer",
              background: splitting ? "var(--bg3)" : "#1db954",
              color: splitting ? "var(--muted)" : "#000",
              fontWeight: 700, fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}>
            {splitting ? <><span className="spinner" /> Separating stems…</> : "Split into stems"}
          </button>
          {status && <div style={{ fontSize: 11, color: "var(--muted)", padding: "5px 9px", background: "var(--bg3)", borderRadius: 6 }}>{status}</div>}
        </div>
      )}

      {/* Multitrack lanes */}
      {separated && Object.keys(stems).length > 0 && (
        <>
          {/* Transport */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button onClick={togglePlay}
              style={{
                width: 36, height: 36, borderRadius: "50%", border: "none", cursor: "pointer",
                background: "#1db954", color: "#000", fontSize: 16, fontWeight: 700, flexShrink: 0,
              }}>
              {playing ? "⏸" : "▶"}
            </button>
            <div style={{ flex: 1, position: "relative", height: 6, background: "var(--bg3)", borderRadius: 3, cursor: "pointer" }}
              onClick={e => {
                const r = e.currentTarget.getBoundingClientRect();
                seek((e.clientX - r.left) / r.width);
              }}>
              <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${progress * 100}%`,
                background: "#1db954", borderRadius: 3, transition: "width .1s linear" }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums", minWidth: 70, textAlign: "right" }}>
              {fmtTime(currentTime)} / {fmtTime(duration)}
            </span>
          </div>

          {/* Stem lanes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {STEMS.filter(s => stems[s]).map(s => {
              const st = stems[s]!;
              const color = STEM_COLORS[s];
              const isSoloed = soloed === s;
              const isDimmed = soloed !== null && !isSoloed;

              return (
                <div key={s} style={{
                  background: "var(--bg3)", borderRadius: 10,
                  border: `1px solid ${isSoloed ? color : "var(--line)"}`,
                  padding: "10px 12px", opacity: isDimmed ? 0.4 : 1,
                  transition: "opacity .15s, border-color .15s",
                }}>
                  {/* Lane header */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 14 }}>{STEM_ICONS[s]}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color, textTransform: "capitalize", flex: 1 }}>{s}</span>

                    {/* Solo */}
                    <button onClick={() => setSoloed(soloed === s ? null : s)}
                      style={{
                        padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 800,
                        background: isSoloed ? color : "var(--bg2)",
                        color: isSoloed ? "#000" : "var(--muted)",
                      }}>S</button>

                    {/* Mute */}
                    <button onClick={() => setStems(prev => ({ ...prev, [s]: { ...prev[s]!, muted: !prev[s]!.muted } }))}
                      style={{
                        padding: "2px 8px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 800,
                        background: st.muted ? "#ef4444" : "var(--bg2)",
                        color: st.muted ? "#fff" : "var(--muted)",
                      }}>M</button>

                    {/* Download stem */}
                    <a href={api.stemAudioUrl(track.id, s)} download={`${track.title}_${s}.wav`}
                      style={{ padding: "2px 8px", borderRadius: 4, background: "var(--bg2)",
                        color: "var(--muted)", fontSize: 10, fontWeight: 800, textDecoration: "none" }}>
                      ↓
                    </a>
                  </div>

                  {/* Waveform */}
                  <div style={{ marginBottom: 8, borderRadius: 6, overflow: "hidden", background: "var(--bg2)" }}>
                    <MiniWave peaks={st.peaks} color={color} progress={progress} />
                  </div>

                  {/* Volume */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 10, color: "var(--muted2)", width: 28 }}>Vol</span>
                    <input type="range" min={0} max={1} step={0.01} value={st.volume}
                      onChange={e => setStems(prev => ({ ...prev, [s]: { ...prev[s]!, volume: parseFloat(e.target.value) } }))}
                      style={{ flex: 1, accentColor: color, cursor: "pointer" }} />
                    <span style={{ fontSize: 10, color, fontWeight: 600, width: 30, textAlign: "right" }}>
                      {Math.round(st.volume * 100)}%
                    </span>
                  </div>

                  {/* Pan */}
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 10, color: "var(--muted2)", width: 28 }}>Pan</span>
                    <input type="range" min={-1} max={1} step={0.01} value={st.pan}
                      onChange={e => setStems(prev => ({ ...prev, [s]: { ...prev[s]!, pan: parseFloat(e.target.value) } }))}
                      style={{ flex: 1, accentColor: color, cursor: "pointer" }} />
                    <span style={{ fontSize: 10, color: "var(--muted2)", width: 30, textAlign: "right" }}>
                      {st.pan === 0 ? "C" : st.pan < 0 ? `L${Math.round(-st.pan * 100)}` : `R${Math.round(st.pan * 100)}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bounce */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button onClick={bounce} disabled={bouncing}
              style={{
                padding: "10px 0", borderRadius: 8, border: "none", cursor: bouncing ? "not-allowed" : "pointer",
                background: bouncing ? "var(--bg3)" : "#1db954",
                color: bouncing ? "var(--muted)" : "#000",
                fontWeight: 700, fontSize: 13,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {bouncing ? <><span className="spinner" /> Bouncing mix…</> : "Bounce custom mix → new version"}
            </button>
            {status && (
              <div style={{ fontSize: 11, color: "var(--muted)", padding: "5px 9px", background: "var(--bg3)", borderRadius: 6 }}>
                {status}
              </div>
            )}
          </div>
        </>
      )}

      {/* Still splitting */}
      {separated && Object.keys(stems).length === 0 && (
        <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", padding: 20 }}>
          Loading stems…
        </div>
      )}
    </div>
  );
}

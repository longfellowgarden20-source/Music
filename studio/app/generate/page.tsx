"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, API, fmtTime, type Track } from "../lib/api";
import { usePlayer } from "../components/PlayerProvider";
import { useProgress } from "../components/ProgressContext";
import Waveform from "../components/Waveform";

const GENRE_GROUPS: { name: string; genres: string[] }[] = [
  {
    name: "Electronic",
    genres: [
      "synthwave", "deep house", "tech house", "progressive house", "electro",
      "daft punk style", "french house", "nu disco", "drum and bass", "dubstep",
      "ambient techno", "IDM", "trance", "hardstyle", "garage",
      "chillwave", "vaporwave", "retrowave", "darksynth", "outrun",
    ],
  },
  {
    name: "Hip-Hop / Beat",
    genres: [
      "lo-fi hip hop", "trap beat", "boom bap", "cloud rap beat", "drill beat",
      "phonk", "jersey club", "afrobeats", "grime beat",
    ],
  },
  {
    name: "Live Instruments",
    genres: [
      "acoustic folk", "jazz", "blues", "funk", "soul", "R&B",
      "classical piano", "cinematic orchestral", "string quartet", "flamenco",
      "bossa nova", "reggae", "afro-cuban", "bluegrass",
    ],
  },
  {
    name: "Rock / Metal",
    genres: [
      "rock", "indie rock", "punk rock", "post-rock", "shoegaze",
      "metal", "doom metal", "prog rock", "surf rock", "psychedelic rock",
    ],
  },
  {
    name: "Chill / Atmospheric",
    genres: [
      "ambient", "dark ambient", "new age", "meditation", "nature sounds",
      "film score", "video game OST", "anime OST",
    ],
  },
];
const MOODS = [
  "chill", "energetic", "dark", "happy", "dreamy", "epic",
  "melancholic", "aggressive", "romantic", "mysterious", "euphoric",
  "nostalgic", "tense", "uplifting", "hypnotic", "raw", "playful", "ethereal",
];
const INSTRUMENTS = [
  "electric guitar", "distorted guitar", "bass guitar", "drum machine",
  "analog synth", "moog synth", "808 bass", "vocoder", "talk box",
  "electric piano", "Rhodes", "strings", "brass section", "flute",
  "theremin", "sitar", "marimba", "vinyl crackle", "sub bass",
];
const KEYS = ["", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export default function GeneratePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { play } = usePlayer();
  const progress = useProgress();
  const [prompt, setPrompt] = useState("");
  const [negative, setNegative] = useState("");
  const [duration, setDuration] = useState(15);
  const [model, setModel] = useState("small");
  const [guidance, setGuidance] = useState(5);
  const [temperature, setTemperature] = useState(0.8);
  const [master, setMaster] = useState(true);
  // Reproduce: when set, generation reuses this exact seed for a deterministic re-roll.
  const [seed, setSeed] = useState<number | "">("");
  const [moods, setMoods] = useState<string[]>([]);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [keyRoot, setKeyRoot] = useState("");
  const [bpm, setBpm] = useState<number | "">("");
  const [collections, setCollections] = useState<string[]>([]);
  const [collection, setCollection] = useState("All Tracks");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<Track | null>(null);
  const [refText, setRefText] = useState("");
  // Which genre groups are expanded. First group open by default.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Electronic: true });

  useEffect(() => { api.collections().then(setCollections).catch(() => {}); }, []);

  // Prefill from URL params (used by "Regenerate" / "Reuse prompt" in the library).
  // The whole prompt is already baked, so put it in the prompt box directly.
  useEffect(() => {
    if (!params) return;
    const p = params.get("prompt"); if (p) setPrompt(p);
    const n = params.get("negative"); if (n) setNegative(n);
    const d = params.get("duration"); if (d) setDuration(+d);
    const m = params.get("model"); if (m) setModel(m);
    const g = params.get("guidance"); if (g) setGuidance(+g);
    const tm = params.get("temperature"); if (tm) setTemperature(+tm);
    const s = params.get("seed"); if (s) setSeed(+s);
  }, [params]);

  const toggleMood = (m: string) =>
    setMoods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  const toggleInstrument = (i: string) =>
    setInstruments(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
  const toggleGroup = (g: string) =>
    setOpenGroups(prev => ({ ...prev, [g]: !prev[g] }));

  const fullPrompt = () => {
    let p = prompt.trim();
    const extras: string[] = [];
    if (moods.length) extras.push(...moods);
    if (instruments.length) extras.push(...instruments);
    if (bpm) extras.push(`${bpm} BPM`);
    if (keyRoot) extras.push(`key of ${keyRoot}`);
    if (extras.length) p = p ? `${p}, ${extras.join(", ")}` : extras.join(", ");
    return p;
  };

  const onGenerate = async () => {
    const p = fullPrompt();
    if (!p) { setStatus("⚠️ Enter a prompt"); return; }
    setBusy(true); setStatus("Generating… (this can take 30–90s on CPU)"); setResult(null);
    progress.start("Generating track…");
    try {
      const r = await api.generate({
        prompt: p, negative, duration, model_size: model, guidance,
        temperature, master, collection,
        ...(seed !== "" ? { seed } : {}),
      });
      setResult(r.track);
      setStatus(`✅ Saved #${r.id}` + (r.bpm ? ` · ${Math.round(r.bpm)} BPM · ${r.key}` : ""));
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Generation stopped" : `❌ ${msg}`);
    } finally {
      setBusy(false);
      progress.finish();
    }
  };

  const onStop = async () => {
    setStatus("🛑 Stopping…");
    try { await api.cancel(); } catch { /* ignore */ }
  };

  // Kill switch on tab close / navigate away: tell the backend to stop the
  // in-flight generation so it doesn't keep churning after we're gone.
  useEffect(() => {
    if (!busy) return;
    const stop = () => {
      try { navigator.sendBeacon(`${API}/api/cancel`); } catch { /* ignore */ }
    };
    window.addEventListener("pagehide", stop);
    window.addEventListener("beforeunload", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("beforeunload", stop);
    };
  }, [busy]);

  const onSoundsLike = async () => {
    if (!refText.trim()) return;
    setStatus("Asking AI for a prompt…");
    try {
      const r = await api.soundsLike(refText);
      setPrompt(r.prompt);
      setStatus("✅ Prompt suggested");
    } catch (e) { setStatus(`❌ ${(e as Error).message}`); }
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px 100px",
      display: "grid", gridTemplateColumns: "1fr 360px", gap: 22 }}>
      {/* main column */}
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Generate a track</h1>

        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Describe your music</div>
            <textarea className="input" rows={3} value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="e.g. warm lo-fi hip hop with vinyl crackle, soft piano, mellow drums" />
          </div>

          {/* sounds-like */}
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" placeholder='Or: "sounds like Bon Iver" → AI writes the prompt'
              value={refText} onChange={e => setRefText(e.target.value)} />
            <button className="btn" onClick={onSoundsLike} disabled={busy}>✨ Suggest</button>
          </div>

          {/* genre chips — collapsible groups */}
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Quick genres</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {GENRE_GROUPS.map(group => {
                const open = !!openGroups[group.name];
                return (
                  <div key={group.name} style={{ border: "1px solid var(--line, #2a2a2a)", borderRadius: 8, overflow: "hidden" }}>
                    <button onClick={() => toggleGroup(group.name)}
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
                        padding: "8px 12px", background: "var(--bg3, #1a1a1a)", border: "none", cursor: "pointer",
                        color: "var(--text, #e5e5e5)", fontSize: 12, fontWeight: 700, textAlign: "left" }}>
                      <span>{group.name}</span>
                      <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                        {group.genres.length} · {open ? "▾" : "▸"}
                      </span>
                    </button>
                    {open && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: 10 }}>
                        {group.genres.map(g => (
                          <button key={g} onClick={() => setPrompt(p => p ? `${p}, ${g}` : g)}
                            className="btn" style={{ padding: "5px 11px", fontSize: 12 }}>{g}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* moods */}
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Mood</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {MOODS.map(m => (
                <button key={m} onClick={() => toggleMood(m)} className="btn"
                  style={{ padding: "5px 11px", fontSize: 12,
                    borderColor: moods.includes(m) ? "var(--accent)" : undefined,
                    color: moods.includes(m) ? "var(--accent)" : undefined,
                    background: moods.includes(m) ? "rgba(139,92,255,.12)" : undefined }}>{m}</button>
              ))}
            </div>
          </div>

          {/* instruments */}
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Instruments & sounds</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {INSTRUMENTS.map(i => (
                <button key={i} onClick={() => toggleInstrument(i)} className="btn"
                  style={{ padding: "5px 11px", fontSize: 12,
                    borderColor: instruments.includes(i) ? "#f59e0b" : undefined,
                    color: instruments.includes(i) ? "#f59e0b" : undefined,
                    background: instruments.includes(i) ? "rgba(245,158,11,.12)" : undefined }}>{i}</button>
              ))}
            </div>
          </div>

          {/* key + bpm */}
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ marginBottom: 6 }}>Key (optional)</div>
              <select className="input" value={keyRoot} onChange={e => setKeyRoot(e.target.value)}>
                {KEYS.map(k => <option key={k} value={k}>{k || "Any"}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <div className="label" style={{ marginBottom: 6 }}>BPM (optional)</div>
              <input className="input" type="number" value={bpm}
                onChange={e => setBpm(e.target.value ? Number(e.target.value) : "")} placeholder="e.g. 120" />
            </div>
          </div>

          <div>
            <div className="label" style={{ marginBottom: 6 }}>Avoid (negative prompt)</div>
            <input className="input" value={negative} onChange={e => setNegative(e.target.value)}
              placeholder="e.g. no vocals, no distortion" />
          </div>
        </div>

        {/* preview of merged prompt */}
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          <span className="label">Final prompt: </span>{fullPrompt() || "—"}
        </div>

        {/* result */}
        {result && (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div style={{ fontWeight: 700 }}>{result.title}</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => play(result)}>▶ Play</button>
                <button className="btn btn-primary" onClick={() => router.push(`/edit?id=${result.id}`)}>Edit →</button>
              </div>
            </div>
            <Waveform trackId={result.id} height={64} color="#1ed760" />
          </div>
        )}
      </div>

      {/* settings sidebar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          <Slider label={`Duration · ${duration}s`} min={4} max={60} step={1} value={duration} onChange={setDuration} />
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Model</div>
            <select className="input" value={model} onChange={e => setModel(e.target.value)}>
              <option value="small">Small (fast)</option>
              <option value="medium">Medium (better)</option>
            </select>
          </div>
          <Slider label={`Guidance · ${guidance}`} min={1} max={10} step={0.5} value={guidance} onChange={setGuidance} />
          <Slider label={`Temperature · ${temperature.toFixed(1)}`} min={0.3} max={1.5} step={0.1} value={temperature} onChange={setTemperature} />
          <div>
            <div className="label" style={{ marginBottom: 6, display: "flex", alignItems: "center", gap: 8 }}>
              Seed
              {seed !== "" && <span style={{ fontSize: 10, color: "var(--accent)", fontWeight: 700 }}>· reproducing</span>}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input className="input" type="number" placeholder="random" style={{ flex: 1 }}
                value={seed} onChange={e => setSeed(e.target.value ? +e.target.value : "")} />
              <button className="btn" title="Randomize (new seed each run)" onClick={() => setSeed("")}
                style={{ padding: "0 12px" }}>🎲</button>
            </div>
            <div style={{ fontSize: 10, color: "var(--muted2)", marginTop: 4 }}>
              {seed !== "" ? "Same seed + same settings = identical track" : "Leave blank for a fresh result each time"}
            </div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={master} onChange={e => setMaster(e.target.checked)}
              style={{ accentColor: "var(--accent)" }} />
            Auto-master (EQ + compression + loudness)
          </label>
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Save to</div>
            <select className="input" value={collection} onChange={e => setCollection(e.target.value)}>
              {(collections.length ? collections : ["All Tracks"]).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {busy ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled style={{ flex: 1, padding: "13px 0", fontSize: 15,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <span className="spinner" /> Generating…
            </button>
            <button className="btn" onClick={onStop} title="Stop generating now"
              style={{ padding: "13px 22px", fontSize: 15, fontWeight: 700,
                background: "var(--red, #ef4444)", color: "#fff", border: "none" }}>
              ■ Stop
            </button>
          </div>
        ) : (
          <button className="btn btn-primary" onClick={onGenerate}
            style={{ padding: "13px 0", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            🎵 Generate
          </button>
        )}
        {status && <div style={{ fontSize: 12, textAlign: "center",
          color: status.startsWith("✅") ? "var(--green)" : status.startsWith("❌") ? "var(--red)" : "var(--muted)" }}>
          {status}</div>}
        {busy && <div style={{ fontSize: 11, textAlign: "center", color: "var(--muted)", opacity: .7 }}>
          Closing this tab will also stop generation.</div>}
      </div>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: "100%", accentColor: "var(--accent)" }} />
    </div>
  );
}

"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, fmtTime, type Track } from "../lib/api";
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
// Drum / rhythm character. MusicGen responds well to specific drum vocabulary —
// without it, outputs default to generic beats (hence the "samey drums" problem).
const DRUMS = [
  "boom-bap drums", "trap hi-hats and 808s", "drill sliding 808s", "four-on-the-floor kick",
  "breakbeat", "amen break", "half-time drums", "double-time drums",
  "lo-fi dusty drums", "punchy acoustic kit", "live jazz brushes", "funk drum groove",
  "afrobeat percussion", "latin percussion", "reggaeton dembow", "UK garage shuffle",
  "house clap on 2 and 4", "techno drum machine", "rock drum kit", "blast beats",
  "trip-hop slow groove", "syncopated percussion", "minimal click rhythm", "tribal drums",
];
const KEYS = ["", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export default function GeneratePage() {
  const router = useRouter();
  const params = useSearchParams();
  const { play } = usePlayer();
  const progress = useProgress();
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(15);
  // model size is no longer user-facing (Stable Audio 3 is a single model); kept
  // as a constant only for the reference-match call which still takes the arg.
  const model = "small";
  const [guidance, setGuidance] = useState(5);
  // Stable Audio 3 quality dial: diffusion steps. 8 = fast (~3s), higher = cleaner/slower.
  const [steps, setSteps] = useState(8);
  const [master, setMaster] = useState(true);
  // Reproduce: when set, generation reuses this exact seed for a deterministic re-roll.
  const [seed, setSeed] = useState<number | "">("");
  const [moods, setMoods] = useState<string[]>([]);
  const [instruments, setInstruments] = useState<string[]>([]);
  const [drums, setDrums] = useState<string[]>([]);
  const [keyRoot, setKeyRoot] = useState("");
  const [bpm, setBpm] = useState<number | "">("");
  const [collections, setCollections] = useState<string[]>([]);
  const [collection, setCollection] = useState("All Tracks");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<Track | null>(null);
  // Variations of the current result (same prompt, fresh seeds). Original is kept.
  const [variations, setVariations] = useState<Track[]>([]);
  const [varying, setVarying] = useState(false);
  const [refText, setRefText] = useState("");
  const [refMode, setRefMode] = useState<"restyle" | "continue">("restyle");
  const [recording, setRecording] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  // Which genre groups are expanded. First group open by default.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ Electronic: true });

  useEffect(() => { api.collections().then(setCollections).catch(() => {}); }, []);

  // Prefill from URL params (used by "Regenerate" / "Reuse prompt" in the library).
  // The whole prompt is already baked, so put it in the prompt box directly.
  useEffect(() => {
    if (!params) return;
    const p = params.get("prompt"); if (p) setPrompt(p);
    const d = params.get("duration"); if (d) setDuration(+d);
    const g = params.get("guidance"); if (g) setGuidance(+g);
    const s = params.get("seed"); if (s) setSeed(+s);
  }, [params]);

  const toggleMood = (m: string) =>
    setMoods(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  const toggleInstrument = (i: string) =>
    setInstruments(prev => prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]);
  const toggleDrum = (d: string) =>
    setDrums(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]);
  const toggleGroup = (g: string) =>
    setOpenGroups(prev => ({ ...prev, [g]: !prev[g] }));

  const fullPrompt = () => {
    let p = prompt.trim();
    const extras: string[] = [];
    if (moods.length) extras.push(...moods);
    if (instruments.length) extras.push(...instruments);
    if (drums.length) extras.push(...drums);
    if (bpm) extras.push(`${bpm} BPM`);
    if (keyRoot) extras.push(`key of ${keyRoot}`);
    if (extras.length) p = p ? `${p}, ${extras.join(", ")}` : extras.join(", ");
    return p;
  };

  const onGenerate = async () => {
    const p = fullPrompt();
    if (!p) { setStatus("⚠️ Enter a prompt"); return; }
    setBusy(true); setStatus("Generating… you can navigate away — it keeps running."); setResult(null); setVariations([]);
    try {
      // Background job: runs in the provider so you can leave this page. The
      // global progress bar + kill button follow you anywhere.
      const r = await progress.runGeneration({
        prompt: p, duration, model_size: model, guidance,
        master, collection, steps,
        ...(seed !== "" ? { seed } : {}),
      }, "Generating track…");
      setResult(r.track);
      setStatus(`✅ Saved #${r.id}` + (r.bpm ? ` · ${Math.round(r.bpm)} BPM · ${r.key}` : ""));
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Generation stopped" : `❌ ${msg}`);
    } finally {
      setBusy(false);
    }
  };

  const onStop = () => { setStatus("🛑 Stopping…"); progress.cancel(); };

  // Create 3 variations of the current result: same prompt, fresh seeds. The
  // original `result` track is never modified — variations are saved separately
  // and shown below it so the user can compare and keep whichever they like.
  const onMakeVariations = async () => {
    if (!result) return;
    setVarying(true); setVariations([]);
    setStatus("Creating 3 variations…");
    try {
      const r = await api.variations(result.id, { count: 3, steps });
      setVariations(r.variations);
      setStatus(`✅ Created ${r.count} variations`);
    } catch (e) {
      setStatus(`❌ ${(e as Error).message || "Variations failed"}`);
    } finally {
      setVarying(false);
    }
  };

  // Reference track matching: upload a song → generate in its style (or continue it).
  const onReference = async (file: File) => {
    setBusy(true); setResult(null);
    setStatus(refMode === "continue" ? "Continuing from your track…" : "Matching its style…");
    progress.set(8, "Reference match…");
    try {
      const r = await api.referenceMatch(
        file,
        { prompt: fullPrompt(), mode: refMode, duration, model_size: model },
        (p) => progress.set(p.pct, "Reference match…"),
      );
      setResult(r.track);
      setStatus(`✅ Saved #${r.id} → References`);
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Stopped" : `❌ ${msg}`);
    } finally {
      setBusy(false);
      progress.finish();
    }
  };

  // Quick-capture: hum / beatbox an idea, AI turns it into a track (reference mode).
  const startHum = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        if (blob.size < 1000) { setStatus("⚠️ Recording too short — try again."); return; }
        const file = new File([blob], "hum.webm", { type: "audio/webm" });
        onReference(file);   // feed the hum into reference generation
      };
      mediaRef.current = mr;
      mr.start();
      setRecording(true);
      setStatus("🎤 Recording… hum or beatbox your idea, then Stop.");
    } catch {
      setStatus("❌ Microphone unavailable — allow mic access.");
    }
  };
  const stopHum = () => {
    setRecording(false);
    try { mediaRef.current?.stop(); } catch { /* ignore */ }
  };

  // NOTE: the old pagehide/beforeunload kill-switch is intentionally gone.
  // Generation now runs as a detached background job, so navigating away must
  // NOT cancel it — the global kill button (in the progress pill) is the only
  // way to stop it.

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

          {/* reference track matching — upload a song */}
          <div style={{ border: "1px solid var(--line, #2a2a2a)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="label">🎧 Match a reference track</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: -2 }}>
              Upload a song you like — AI matches its vibe, tempo, and feel.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" onClick={() => setRefMode("restyle")}
                style={{ flex: 1, fontSize: 12, borderColor: refMode === "restyle" ? "var(--accent)" : undefined, color: refMode === "restyle" ? "var(--accent)" : "var(--muted)" }}>
                New in its style
              </button>
              <button className="btn" onClick={() => setRefMode("continue")}
                style={{ flex: 1, fontSize: 12, borderColor: refMode === "continue" ? "var(--accent)" : undefined, color: refMode === "continue" ? "var(--accent)" : "var(--muted)" }}>
                Continue from it
              </button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <label className="btn" style={{ flex: 1, position: "relative", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1, textAlign: "center", fontSize: 12 }}>
                ⬆ Upload audio
                <input type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a,.aiff"
                  disabled={busy || recording}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                  onChange={e => { if (e.target.files?.[0]) { onReference(e.target.files[0]); e.target.value = ""; } }} />
              </label>
              <button className="btn" disabled={busy && !recording}
                onClick={recording ? stopHum : startHum}
                style={{ flex: 1, fontSize: 12, fontWeight: 700,
                  borderColor: recording ? "var(--red, #ef4444)" : undefined,
                  color: recording ? "var(--red, #ef4444)" : undefined }}>
                {recording ? "■ Stop & generate" : "🎤 Hum / beatbox an idea"}
              </button>
            </div>
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

          {/* drums / rhythm */}
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Drums & rhythm</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DRUMS.map(d => (
                <button key={d} onClick={() => toggleDrum(d)} className="btn"
                  style={{ padding: "5px 11px", fontSize: 12,
                    borderColor: drums.includes(d) ? "#4fd1a5" : undefined,
                    color: drums.includes(d) ? "#4fd1a5" : undefined,
                    background: drums.includes(d) ? "rgba(79,209,165,.12)" : undefined }}>{d}</button>
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

            {/* Create variations — keeps this original, makes 3 fresh takes below */}
            <button className="btn" onClick={onMakeVariations} disabled={varying}
              style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              {varying ? <><span className="spinner" /> Creating 3 variations…</> : "🎲 Create 3 variations"}
            </button>

            {variations.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 11, color: "var(--muted2)", fontWeight: 700, letterSpacing: 0.5 }}>
                  VARIATIONS · same prompt, different takes
                </div>
                {variations.map((v, i) => (
                  <div key={v.id} style={{ display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 11px", background: "var(--bg, #0b0e13)", border: "1px solid var(--bg3)", borderRadius: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: "var(--accent)", width: 18 }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Waveform trackId={v.id} height={32} color="#8b5cff" />
                    </div>
                    <button className="btn" style={{ fontSize: 12, padding: "5px 11px" }} onClick={() => play(v)}>▶</button>
                    <button className="btn" style={{ fontSize: 12, padding: "5px 11px" }}
                      onClick={() => router.push(`/edit?id=${v.id}`)}>Edit</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* settings sidebar */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
          <Slider label={`Duration · ${duration}s`} min={4} max={60} step={1} value={duration} onChange={setDuration} />
          <Slider
            label={`Quality · ${steps} steps ${steps <= 8 ? "(fastest)" : steps <= 16 ? "(balanced)" : "(best, slower)"}`}
            min={4} max={25} step={1} value={steps} onChange={setSteps} />
          <Slider
            label={`Prompt strength · ${guidance <= 3 ? "Subtle" : guidance >= 8 ? "Bold (more dramatic & varied)" : "Balanced"}`}
            min={1} max={10} step={0.5} value={guidance} onChange={setGuidance} />
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

        {/* Required attribution for the Stable Audio 3 music engine (Stability AI
            Community License). Shown where generation happens, to be safe. */}
        <div style={{ fontSize: 10, color: "var(--muted2)", textAlign: "center", marginTop: -4 }}>
          Powered by Stability AI
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

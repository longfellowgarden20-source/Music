"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { API, type Track } from "../lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────
type OscType = "triangle" | "sawtooth" | "square" | "sine" | "fatsawtooth" | "fatsquare" | "fattriangle" | "pulse" | "pwm";
type FilterType = "lowpass" | "highpass" | "bandpass" | "notch";
type PresetKey = "piano" | "guitar" | "bass" | "strings" | "synth" | "lead" | "drums" | "custom";

interface SynthParams {
  osc: OscType;
  attack: number; decay: number; sustain: number; release: number;
  detune: number;
  filterType: FilterType; filterFreq: number; filterQ: number;
  reverb: number; delay: number; delayTime: number; chorus: number;
  distortion: number; volume: number;
}

interface Preset { label: string; color: string; desc: string; p: SynthParams; sampled?: SampleSet; }

// Real recorded-sample instruments. Tone.Sampler pitch-shifts between the
// provided notes, so a handful of samples covers the whole keyboard.
// All files live in /public/samples/<dir>/ and ship with the app (offline-safe).
type SampleSet = {
  dir: string;
  urls: Record<string, string>;  // note -> filename
};

const SAMPLES: Record<string, SampleSet> = {
  piano: {
    dir: "piano",
    urls: {
      A0:"A0.mp3", C1:"C1.mp3", "D#1":"Ds1.mp3", "F#1":"Fs1.mp3", A1:"A1.mp3",
      C2:"C2.mp3", "D#2":"Ds2.mp3", "F#2":"Fs2.mp3", A2:"A2.mp3",
      C3:"C3.mp3", "D#3":"Ds3.mp3", "F#3":"Fs3.mp3", A3:"A3.mp3",
      C4:"C4.mp3", "D#4":"Ds4.mp3", "F#4":"Fs4.mp3", A4:"A4.mp3",
      C5:"C5.mp3", "D#5":"Ds5.mp3", "F#5":"Fs5.mp3", A5:"A5.mp3",
      C6:"C6.mp3", "D#6":"Ds6.mp3", "F#6":"Fs6.mp3", A6:"A6.mp3", C7:"C7.mp3",
    },
  },
  bass: {
    dir: "bass-electric",
    urls: {
      "A#1":"As1.mp3", "C#2":"Cs2.mp3", E2:"E2.mp3", G2:"G2.mp3",
      "A#2":"As2.mp3", "C#3":"Cs3.mp3", E3:"E3.mp3", G3:"G3.mp3",
      "A#3":"As3.mp3", "C#4":"Cs4.mp3", E4:"E4.mp3",
    },
  },
  guitar: {
    dir: "guitar-acoustic",
    urls: {
      A2:"A2.mp3", C3:"C3.mp3", E3:"E3.mp3", A3:"A3.mp3",
      C4:"C4.mp3", E4:"E4.mp3", A4:"A4.mp3",
    },
  },
  strings: {
    dir: "strings",
    urls: {
      A3:"A3.mp3", C4:"C4.mp3", E4:"E4.mp3", G4:"G4.mp3",
      A4:"A4.mp3", C5:"C5.mp3", E5:"E5.mp3",
    },
  },
};

const PRESETS: Record<PresetKey, Preset> = {
  piano: {
    label: "Piano", color: "#1db954", desc: "Real Steinway grand (recorded)",
    sampled: SAMPLES.piano,
    p: { osc:"triangle", attack:0.005, decay:0.6, sustain:0.4, release:1.2,
         detune:0, filterType:"lowpass", filterFreq:18000, filterQ:0.4,
         reverb:0.25, delay:0, delayTime:0.25, chorus:0, distortion:0, volume:-4 },
  },
  guitar: {
    label: "Guitar", color: "#eab308", desc: "Acoustic guitar (recorded)",
    sampled: SAMPLES.guitar,
    p: { osc:"triangle", attack:0.005, decay:0.5, sustain:0.4, release:1.0,
         detune:0, filterType:"lowpass", filterFreq:16000, filterQ:0.4,
         reverb:0.2, delay:0, delayTime:0.25, chorus:0.05, distortion:0, volume:-4 },
  },
  bass: {
    label: "Bass", color: "#a78bfa", desc: "Electric bass (recorded)",
    sampled: SAMPLES.bass,
    p: { osc:"square", attack:0.005, decay:0.3, sustain:0.7, release:0.4,
         detune:0, filterType:"lowpass", filterFreq:6000, filterQ:0.5,
         reverb:0.05, delay:0, delayTime:0.25, chorus:0, distortion:0, volume:-3 },
  },
  strings: {
    label: "Strings", color: "#f472b6", desc: "Lush bowed strings (recorded)",
    sampled: SAMPLES.strings,
    p: { osc:"fattriangle", attack:0.15, decay:0.3, sustain:0.9, release:1.8,
         detune:0, filterType:"lowpass", filterFreq:14000, filterQ:0.4,
         reverb:0.55, delay:0, delayTime:0.5, chorus:0.2, distortion:0, volume:-6 },
  },
  synth: {
    label: "Synth", color: "#22d3ee", desc: "Fat analog synth",
    p: { osc:"fatsawtooth", attack:0.04, decay:0.15, sustain:0.8, release:0.5,
         detune:12, filterType:"lowpass", filterFreq:3500, filterQ:4,
         reverb:0.25, delay:0.15, delayTime:0.375, chorus:0.4, distortion:0.08, volume:-9 },
  },
  lead: {
    label: "Lead", color: "#fb923c", desc: "Bright cutting lead",
    p: { osc:"fatsquare", attack:0.01, decay:0.08, sustain:0.6, release:0.4,
         detune:8, filterType:"lowpass", filterFreq:9000, filterQ:3,
         reverb:0.2, delay:0.25, delayTime:0.25, chorus:0.2, distortion:0.2, volume:-8 },
  },
  drums: {
    label: "Drums", color: "#fbbf24", desc: "808 / trap drum kit",
    p: { osc:"sine", attack:0.001, decay:0.3, sustain:0, release:0.1,
         detune:0, filterType:"lowpass", filterFreq:8000, filterQ:1,
         reverb:0.1, delay:0, delayTime:0.25, chorus:0, distortion:0.35, volume:-5 },
  },
  custom: {
    label: "Custom", color: "#94a3b8", desc: "Build your own synth",
    p: { osc:"fatsawtooth", attack:0.05, decay:0.2, sustain:0.5, release:0.5,
         detune:6, filterType:"lowpass", filterFreq:5000, filterQ:2,
         reverb:0.2, delay:0, delayTime:0.25, chorus:0.1, distortion:0, volume:-8 },
  },
};

// ─── Piano layout (2 octaves = 14 white + 10 black) ────────────────────────────
// Each entry is [noteName, octaveOffset] for 14 white keys across 2 octaves
const WHITE_KEYS: Array<[string, number]> = [
  ["C",0],["D",0],["E",0],["F",0],["G",0],["A",0],["B",0],
  ["C",1],["D",1],["E",1],["F",1],["G",1],["A",1],["B",1],
];
// Black keys: null = gap (no black key after E and B), string = note name, octaveOffset
// Aligned to white key index: between i and i+1
const BLACK_KEYS: Array<[string, number] | null> = [
  ["C#",0],["D#",0], null, ["F#",0],["G#",0],["A#",0], null,
  ["C#",1],["D#",1], null, ["F#",1],["G#",1],["A#",1], null,
];
// Keyboard shortcuts for white keys (index matches WHITE_KEYS)
const KB_WHITE = ["a","s","d","f","g","h","j","k","l",";","'","z","x","c"];
// Keyboard shortcuts for black keys (index 0..13, null positions skipped)
const KB_BLACK: Array<string|null> = ["w","e",null,"t","y","u",null,"o","p",null,"[","]",null,null];

// ─── Drum pads ─────────────────────────────────────────────────────────────────
const DRUM_PADS = [
  { label:"Kick",    key:"a", color:"#ef4444", type:"membrane" as const, pitch:"C1",  pitchDecay:0.08, octaves:10  },
  { label:"Snare",   key:"s", color:"#f97316", type:"metal"    as const, pitch:"D3",  resonance:2000, harmonicity:5.1 },
  { label:"Hi-Hat",  key:"d", color:"#eab308", type:"metal"    as const, pitch:"G5",  resonance:8000, harmonicity:8.5 },
  { label:"Open HH", key:"f", color:"#84cc16", type:"metal"    as const, pitch:"G5",  resonance:5000, harmonicity:7   },
  { label:"Tom Hi",  key:"g", color:"#06b6d4", type:"membrane" as const, pitch:"G2",  pitchDecay:0.12, octaves:6  },
  { label:"Tom Lo",  key:"h", color:"#8b5cf6", type:"membrane" as const, pitch:"C2",  pitchDecay:0.15, octaves:5  },
  { label:"Clap",    key:"j", color:"#ec4899", type:"metal"    as const, pitch:"A5",  resonance:4000, harmonicity:5.8 },
  { label:"Crash",   key:"k", color:"#f59e0b", type:"metal"    as const, pitch:"F5",  resonance:3000, harmonicity:9.5 },
];

// ─── Main component ─────────────────────────────────────────────────────────────
export default function InstrumentStudio({ track, onMerged }: {
  track: Track;
  onMerged: (t: Track) => void;
}) {
  const [open, setOpen]           = useState(false);
  const [preset, setPreset]       = useState<PresetKey>("piano");
  const [p, setP]                 = useState<SynthParams>(PRESETS.piano.p);
  const [octave, setOctave]       = useState(4);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [recording, setRecording] = useState(false);
  const [hasRecording, setHasRecording] = useState(false);
  const [merging, setMerging]     = useState(false);
  const [status, setStatus]       = useState("");
  const [tab, setTab]             = useState<"play"|"shape"|"fx"|"build">("play");
  const [loadingSamples, setLoadingSamples] = useState(false);

  const toneRef   = useRef<any>(null);   // Tone module
  const synthRef  = useRef<any>(null);
  const chainRef  = useRef<{ rev:any; dly:any; cho:any; dist:any; filt:any } | null>(null);
  const drumRefs  = useRef<any[]>([]);
  const recRef    = useRef<any>(null);
  const blobRef   = useRef<Blob|null>(null);
  const previewAudioRef = useRef<HTMLAudioElement|null>(null);
  const [previewing, setPreviewing] = useState(false);
  const initialized = useRef(false);

  // ── Load + init Tone once ──────────────────────────────────────────────────
  const getTone = useCallback(async () => {
    if (!toneRef.current) {
      toneRef.current = await import("tone");
    }
    const Tone = toneRef.current;
    if (!initialized.current) {
      await Tone.start();
      initialized.current = true;
    }
    return Tone;
  }, []);

  // ── Build full signal chain ───────────────────────────────────────────────
  const buildChain = useCallback(async (params: SynthParams, inst: PresetKey) => {
    const Tone = await getTone();

    // Tear down previous
    try {
      synthRef.current?.dispose();
      drumRefs.current.forEach(d => d?.dispose());
      drumRefs.current = [];
      if (chainRef.current) {
        Object.values(chainRef.current).forEach((n: any) => n?.dispose());
      }
    } catch {}

    // Build effects (shared for all synths)
    const filt = new Tone.Filter(params.filterFreq, params.filterType, -24);
    filt.Q.value = params.filterQ;
    const dist = new Tone.Distortion(params.distortion);
    const cho  = new Tone.Chorus(3.5, 2.5, params.chorus).start();
    const dly  = new Tone.FeedbackDelay(params.delayTime, 0.25);
    dly.wet.value = params.delay;
    const rev  = new Tone.Reverb({ decay: 2 + params.reverb * 5, wet: params.reverb });
    await rev.generate();
    chainRef.current = { filt, dist, cho, dly, rev };

    const sampled = PRESETS[inst]?.sampled;

    if (inst === "drums") {
      // Individual synths per drum pad — no PolySynth needed
      const drums = DRUM_PADS.map(pad => {
        if (pad.type === "membrane") {
          const s = new Tone.MembraneSynth({
            pitchDecay: pad.pitchDecay ?? 0.08,
            octaves: pad.octaves ?? 10,
            envelope: { attack: 0.001, decay: 0.4, sustain: 0, release: 0.1 },
            volume: params.volume,
          });
          s.chain(dist, filt, rev, Tone.getDestination());
          return s;
        } else {
          const s = new Tone.MetalSynth({
            frequency: 400,
            envelope: { attack: 0.001, decay: 0.15, release: 0.03 },
            harmonicity: pad.harmonicity ?? 5.1,
            modulationIndex: 32,
            resonance: pad.resonance ?? 4000,
            octaves: 1.5,
            volume: params.volume,
          });
          s.chain(dist, rev, Tone.getDestination());
          return s;
        }
      });
      drumRefs.current = drums;
      synthRef.current = null;
    } else if (sampled) {
      // Real recorded-sample instrument via Tone.Sampler.
      setLoadingSamples(true);
      const sampler = new Tone.Sampler({
        urls: sampled.urls,
        baseUrl: `/samples/${sampled.dir}/`,
        release: params.release,
        volume: params.volume,
        onload: () => setLoadingSamples(false),
        onerror: () => setLoadingSamples(false),
      });
      // Samples already sound real — keep the FX chain subtle (filter + reverb + delay).
      sampler.chain(filt, dly, rev, Tone.getDestination());
      synthRef.current = sampler;
    } else {
      const synth = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: params.osc },
        detune: params.detune,
        envelope: { attack: params.attack, decay: params.decay, sustain: params.sustain, release: params.release },
        volume: params.volume,
      });
      synth.chain(dist, cho, dly, filt, rev, Tone.getDestination());
      synthRef.current = synth;
    }
  }, [getTone]);

  // Full rebuild only when the instrument (preset) changes.
  useEffect(() => {
    if (!initialized.current) return;
    buildChain(p, preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // Live-adjust FX params without rebuilding (no sample re-download, no dropout).
  const liveTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(() => {
    if (!initialized.current) return;
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      const c = chainRef.current;
      const s = synthRef.current;
      try {
        if (c) {
          if (c.filt) { c.filt.frequency.value = p.filterFreq; c.filt.Q.value = p.filterQ; c.filt.type = p.filterType; }
          if (c.dist) c.dist.distortion = p.distortion;
          if (c.cho)  c.cho.wet.value = p.chorus;
          if (c.dly)  { c.dly.wet.value = p.delay; c.dly.delayTime.value = p.delayTime; }
          if (c.rev)  c.rev.wet.value = p.reverb;
        }
        if (s) {
          if (s.volume) s.volume.value = p.volume;
          // PolySynth: update oscillator + envelope live; Sampler ignores these.
          if (s.set) {
            const isSampler = !!PRESETS[preset]?.sampled;
            if (!isSampler && preset !== "drums") {
              s.set({
                oscillator: { type: p.osc },
                detune: p.detune,
                envelope: { attack: p.attack, decay: p.decay, sustain: p.sustain, release: p.release },
              });
            } else if (isSampler) {
              s.release = p.release;
            }
          }
        }
      } catch {}
    }, 40);
    return () => { if (liveTimer.current) clearTimeout(liveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p]);

  // Switch preset
  const switchPreset = useCallback((key: PresetKey) => {
    setPreset(key);
    if (key !== "custom") setP(PRESETS[key].p);
    setTab("play");
  }, []);

  // ── Note triggers ─────────────────────────────────────────────────────────
  const noteOn = useCallback(async (note: string, drumIdx?: number) => {
    await getTone();
    if (!initialized.current) return;
    setActiveKeys(s => new Set(s).add(note));
    try {
      if (drumIdx !== undefined) {
        const d = drumRefs.current[drumIdx];
        if (d) {
          // MembraneSynth uses triggerAttackRelease with pitch, MetalSynth just needs duration
          if (DRUM_PADS[drumIdx].type === "membrane") {
            d.triggerAttackRelease(DRUM_PADS[drumIdx].pitch, "8n");
          } else {
            d.triggerAttackRelease("16n");
          }
        }
      } else {
        synthRef.current?.triggerAttack(note, "+0");
      }
    } catch {}
  }, [getTone]);

  const noteOff = useCallback((note: string) => {
    setActiveKeys(s => { const n = new Set(s); n.delete(note); return n; });
    try { synthRef.current?.triggerRelease(note, "+0"); } catch {}
  }, []);

  // ── Keyboard events ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const held = new Set<string>();

    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT") return;
      const k = e.key.toLowerCase();
      if (held.has(k)) return;
      held.add(k);

      if (preset === "drums") {
        const idx = DRUM_PADS.findIndex(d => d.key === k);
        if (idx >= 0) noteOn(DRUM_PADS[idx].label, idx);
        return;
      }
      // White key
      const wi = KB_WHITE.indexOf(k);
      if (wi >= 0) {
        const [name, oct] = WHITE_KEYS[wi];
        noteOn(`${name}${octave + oct}`);
        return;
      }
      // Black key
      const bi = KB_BLACK.indexOf(k);
      if (bi >= 0 && BLACK_KEYS[bi]) {
        const [name, oct] = BLACK_KEYS[bi]!;
        noteOn(`${name}${octave + oct}`);
      }
    };

    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      held.delete(k);
      if (preset === "drums") return;
      const wi = KB_WHITE.indexOf(k);
      if (wi >= 0) {
        const [name, oct] = WHITE_KEYS[wi];
        noteOff(`${name}${octave + oct}`);
        return;
      }
      const bi = KB_BLACK.indexOf(k);
      if (bi >= 0 && BLACK_KEYS[bi]) {
        const [name, oct] = BLACK_KEYS[bi]!;
        noteOff(`${name}${octave + oct}`);
      }
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); };
  }, [open, preset, octave, noteOn, noteOff]);

  // ── Recording — isolated output node ─────────────────────────────────────
  // We route synths through a dedicated Gain → Recorder so we only capture
  // the instrument, not whatever else might be playing.
  const isoGainRef = useRef<any>(null);

  async function startRecording() {
    const Tone = await getTone();
    // Build chain fresh so recorder captures cleanly
    await buildChain(p, preset);

    const isoGain = new Tone.Gain(1);
    isoGainRef.current = isoGain;

    // Re-route synth through isoGain too (in addition to main destination)
    // Recorder taps isoGain only
    if (synthRef.current) synthRef.current.connect(isoGain);
    drumRefs.current.forEach(d => d?.connect(isoGain));

    const rec = new Tone.Recorder();
    isoGain.connect(rec);
    await rec.start();
    recRef.current = rec;
    blobRef.current = null;
    setHasRecording(false);
    setRecording(true);
    setStatus("Recording…");
  }

  async function stopRecording() {
    setRecording(false);
    try {
      const blob = await recRef.current?.stop();
      blobRef.current = blob ?? null;
      // Clean up any previous preview audio
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        URL.revokeObjectURL(previewAudioRef.current.src);
        previewAudioRef.current = null;
      }
      setPreviewing(false);
      setHasRecording(!!blob);
      setStatus(blob ? "Performance captured — preview or merge below." : "Nothing recorded.");
    } catch { setStatus("Recording failed."); }
  }

  function togglePreview() {
    if (!blobRef.current) return;
    if (previewing) {
      previewAudioRef.current?.pause();
      setPreviewing(false);
      return;
    }
    // Create fresh audio element from blob each time
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      URL.revokeObjectURL(previewAudioRef.current.src);
    }
    const url = URL.createObjectURL(blobRef.current);
    const audio = new Audio(url);
    previewAudioRef.current = audio;
    audio.onended = () => setPreviewing(false);
    audio.play().catch(() => {});
    setPreviewing(true);
  }

  async function mergeRecording() {
    if (!blobRef.current) return;
    setMerging(true); setStatus("Merging onto track…");
    try {
      const form = new FormData();
      form.append("vocal", blobRef.current, "instrument.webm");
      const res = await fetch(`${API}/api/track/${track.id}/merge-vocal`, { method:"POST", body:form });
      if (!res.ok) { const j = await res.json().catch(()=>({})); throw new Error(j.detail || "Merge failed"); }
      const data = await res.json();
      setStatus("Saved to library as new version.");
      blobRef.current = null; setHasRecording(false);
      onMerged(data.track);
    } catch (e) { setStatus((e as Error).message); }
    finally { setMerging(false); }
  }

  // ── Open: init audio context ───────────────────────────────────────────────
  const handleOpen = async () => {
    setOpen(true);
    // Build chain on first open
    const Tone = await getTone();
    if (!initialized.current) { initialized.current = true; await Tone.start(); }
    await buildChain(p, preset);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  if (!open) {
    return (
      <button onClick={handleOpen} className="btn"
        style={{ width:"100%", fontSize:13, fontWeight:700, color:"var(--accent)", borderColor:"var(--accent)" }}>
        Open Instrument Studio
      </button>
    );
  }

  const pr = PRESETS[preset];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:11, fontWeight:800, letterSpacing:1.5, textTransform:"uppercase", color:"var(--muted)" }}>
          Instrument Studio
        </span>
        <button onClick={() => setOpen(false)}
          style={{ background:"none", border:"none", color:"var(--muted2)", fontSize:12, cursor:"pointer" }}>
          Close
        </button>
      </div>

      {/* Preset row */}
      <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
        {(Object.keys(PRESETS) as PresetKey[]).map(k => (
          <button key={k} onClick={() => switchPreset(k)}
            style={{
              padding:"6px 11px", borderRadius:20, border:"none", cursor:"pointer", fontSize:11, fontWeight:700,
              background: preset===k ? PRESETS[k].color : "var(--bg3)",
              color: preset===k ? "#000" : "var(--muted)",
              transition:"all .12s",
            }}>
            {PRESETS[k].label}
          </button>
        ))}
      </div>
      <div style={{ fontSize:11, color:"var(--muted2)" }}>{pr.desc}</div>

      {/* Tab bar */}
      <div style={{ display:"flex", gap:2, background:"var(--bg3)", borderRadius:8, padding:3 }}>
        {(["play","shape","fx","build"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              flex:1, padding:"5px 0", borderRadius:6, border:"none", cursor:"pointer", fontSize:11, fontWeight:700,
              background: tab===t ? "var(--bg1)" : "transparent",
              color: tab===t ? "var(--accent)" : "var(--muted)",
            }}>
            {t === "play" ? "Play" : t === "shape" ? "Envelope" : t === "fx" ? "FX" : "Build"}
          </button>
        ))}
      </div>

      {/* Sample loading banner */}
      {loadingSamples && (
        <div style={{ fontSize:11, color:"var(--accent)", padding:"6px 10px",
          background:"var(--bg3)", borderRadius:6, display:"flex", alignItems:"center", gap:8 }}>
          <span className="spinner" /> Loading {pr.label.toLowerCase()} samples…
        </div>
      )}

      {/* ── PLAY TAB ── */}
      {tab === "play" && (
        preset === "drums" ? (
          <DrumPads activeKeys={activeKeys} onDown={noteOn} />
        ) : (
          <PianoKeys
            octave={octave} activeKeys={activeKeys}
            onOctaveChange={setOctave}
            onNoteOn={noteOn} onNoteOff={noteOff}
          />
        )
      )}

      {/* ── ENVELOPE TAB ── */}
      {tab === "shape" && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {pr.sampled ? (
            <>
              <div style={{ fontSize:11, color:"var(--muted2)", lineHeight:1.6, marginBottom:4 }}>
                This is a recorded instrument — its tone comes from real samples.
                Only release (how long notes ring out) applies here. Use the FX tab to shape it.
              </div>
              <Slider label="Release" value={p.release} min={0.05} max={6} step={0.01}
                display={v=>`${v.toFixed(2)}s`} onChange={v=>setP(pp=>({...pp,release:v}))} />
            </>
          ) : (
            <>
              {preset !== "drums" && (
                <div style={{ marginBottom:4 }}>
                  <ParamLabel>Oscillator</ParamLabel>
                  <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:4 }}>
                    {(["sine","triangle","sawtooth","square","fatsawtooth","fatsquare","fattriangle","pulse"] as OscType[]).map(o => (
                      <button key={o} onClick={() => setP(pp => ({ ...pp, osc:o }))}
                        style={{
                          padding:"4px 9px", borderRadius:6, border:"none", cursor:"pointer", fontSize:11, fontWeight:700,
                          background: p.osc===o ? pr.color : "var(--bg3)",
                          color: p.osc===o ? "#000" : "var(--muted)",
                        }}>
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <Slider label="Attack"  value={p.attack}  min={0.001} max={3}   step={0.001} display={v=>`${v.toFixed(3)}s`} onChange={v=>setP(pp=>({...pp,attack:v}))} />
              <Slider label="Decay"   value={p.decay}   min={0.01}  max={3}   step={0.01}  display={v=>`${v.toFixed(2)}s`} onChange={v=>setP(pp=>({...pp,decay:v}))} />
              <Slider label="Sustain" value={p.sustain} min={0}     max={1}   step={0.01}  display={v=>`${Math.round(v*100)}%`} onChange={v=>setP(pp=>({...pp,sustain:v}))} />
              <Slider label="Release" value={p.release} min={0.01}  max={6}   step={0.01}  display={v=>`${v.toFixed(2)}s`} onChange={v=>setP(pp=>({...pp,release:v}))} />
              {preset !== "drums" && (
                <Slider label="Detune" value={p.detune} min={-50} max={50} step={1} display={v=>`${v}¢`} onChange={v=>setP(pp=>({...pp,detune:v}))} />
              )}
            </>
          )}
        </div>
      )}

      {/* ── FX TAB ── */}
      {tab === "fx" && (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          <div style={{ marginBottom:4 }}>
            <ParamLabel>Filter type</ParamLabel>
            <div style={{ display:"flex", gap:4, marginTop:4 }}>
              {(["lowpass","highpass","bandpass","notch"] as FilterType[]).map(ft => (
                <button key={ft} onClick={() => setP(pp => ({ ...pp, filterType:ft }))}
                  style={{
                    padding:"4px 9px", borderRadius:6, border:"none", cursor:"pointer", fontSize:11, fontWeight:700,
                    background: p.filterType===ft ? pr.color : "var(--bg3)",
                    color: p.filterType===ft ? "#000" : "var(--muted)",
                  }}>
                  {ft}
                </button>
              ))}
            </div>
          </div>
          <Slider label="Filter cutoff" value={p.filterFreq} min={80} max={18000} step={50}
            display={v => v>=1000 ? `${(v/1000).toFixed(1)}k` : `${Math.round(v)}`}
            onChange={v=>setP(pp=>({...pp,filterFreq:v}))} />
          <Slider label="Filter Q (resonance)" value={p.filterQ} min={0.1} max={20} step={0.1}
            display={v=>`${v.toFixed(1)}`} onChange={v=>setP(pp=>({...pp,filterQ:v}))} />
          <Slider label="Reverb" value={p.reverb} min={0} max={1} step={0.01}
            display={v=>`${Math.round(v*100)}%`} onChange={v=>setP(pp=>({...pp,reverb:v}))} />
          <Slider label="Delay send" value={p.delay} min={0} max={1} step={0.01}
            display={v=>`${Math.round(v*100)}%`} onChange={v=>setP(pp=>({...pp,delay:v}))} />
          <Slider label="Delay time" value={p.delayTime} min={0.05} max={1} step={0.01}
            display={v=>`${v.toFixed(2)}s`} onChange={v=>setP(pp=>({...pp,delayTime:v}))} />
          <Slider label="Chorus" value={p.chorus} min={0} max={1} step={0.01}
            display={v=>`${Math.round(v*100)}%`} onChange={v=>setP(pp=>({...pp,chorus:v}))} />
          <Slider label="Drive" value={p.distortion} min={0} max={1} step={0.01}
            display={v=>`${Math.round(v*100)}%`} onChange={v=>setP(pp=>({...pp,distortion:v}))} />
          <Slider label="Volume" value={p.volume} min={-24} max={0} step={0.5}
            display={v=>`${v}dB`} onChange={v=>setP(pp=>({...pp,volume:v}))} />
        </div>
      )}

      {/* ── BUILD TAB (custom instrument) ── */}
      {tab === "build" && (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          <div style={{ fontSize:12, color:"var(--muted)", lineHeight:1.6 }}>
            Tweak every parameter freely. Switch to Custom preset to save as your own.
          </div>
          <button onClick={() => { setPreset("custom"); setP(pp => ({ ...pp })); }}
            style={{
              padding:"8px 0", borderRadius:8, border:"none", cursor:"pointer",
              background: preset==="custom" ? PRESETS.custom.color : "var(--bg3)",
              color: preset==="custom" ? "#000" : "var(--muted)",
              fontWeight:700, fontSize:12,
            }}>
            {preset==="custom" ? "Custom instrument active" : "Switch to Custom mode"}
          </button>
          <div style={{ fontSize:11, color:"var(--muted2)", lineHeight:1.7 }}>
            All Envelope and FX sliders apply live. Build your sound in those tabs,
            then record your performance below. Each recording saves as a new version.
          </div>
          {/* Live readout */}
          <div style={{ background:"var(--bg3)", borderRadius:8, padding:10, fontSize:10,
            color:"var(--muted)", fontFamily:"monospace", lineHeight:2 }}>
            osc={p.osc} · detune={p.detune}¢<br/>
            A={p.attack.toFixed(3)} D={p.decay.toFixed(2)} S={Math.round(p.sustain*100)}% R={p.release.toFixed(2)}<br/>
            filter={p.filterType} {p.filterFreq>=1000?`${(p.filterFreq/1000).toFixed(1)}k`:p.filterFreq}Hz Q={p.filterQ.toFixed(1)}<br/>
            rev={Math.round(p.reverb*100)}% dly={Math.round(p.delay*100)}%@{p.delayTime.toFixed(2)}s cho={Math.round(p.chorus*100)}%<br/>
            drive={Math.round(p.distortion*100)}% vol={p.volume}dB
          </div>
        </div>
      )}

      {/* ── Record + merge ── */}
      <div style={{ borderTop:"1px solid var(--line)", paddingTop:12, display:"flex", flexDirection:"column", gap:8 }}>
        <div style={{ display:"flex", gap:8 }}>
          {!recording ? (
            <button onClick={startRecording}
              style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", cursor:"pointer",
                background:"#ef4444", color:"#fff", fontWeight:700, fontSize:12 }}>
              Record performance
            </button>
          ) : (
            <button onClick={stopRecording}
              style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", cursor:"pointer",
                background:"var(--bg3)", color:"#ef4444", fontWeight:700, fontSize:12,
                display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#ef4444", display:"inline-block",
                animation:"pulse 0.8s ease-in-out infinite" }} />
              Stop recording
            </button>
          )}
          {hasRecording && !recording && (
            <>
              <button onClick={togglePreview}
                style={{ flex:1, padding:"9px 0", borderRadius:8, border:"none", cursor:"pointer",
                  background: previewing ? "var(--accent)" : "var(--bg3)",
                  color: previewing ? "#000" : "var(--muted)",
                  fontWeight:700, fontSize:12 }}>
                {previewing ? "Stop preview" : "Preview"}
              </button>
              <button onClick={mergeRecording} disabled={merging}
                className="btn btn-primary" style={{ flex:1, fontSize:12, fontWeight:700 }}>
                {merging ? <><span className="spinner" /> Merging…</> : "Merge onto track"}
              </button>
            </>
          )}
        </div>
        {status && (
          <div style={{ fontSize:11, color:"var(--muted)", padding:"5px 9px",
            background:"var(--bg3)", borderRadius:6 }}>
            {status}
          </div>
        )}
      </div>

      {/* Keyboard hint */}
      {tab === "play" && preset !== "drums" && (
        <div style={{ fontSize:10, color:"var(--muted2)", lineHeight:1.7 }}>
          White keys: <span style={{ color:"var(--muted)" }}>A S D F G H J K L ; '</span>
          &nbsp;&nbsp;Black: <span style={{ color:"var(--muted)" }}>W E · T Y U · O P</span>
        </div>
      )}
    </div>
  );
}

// ─── Piano keyboard ────────────────────────────────────────────────────────────
function PianoKeys({ octave, activeKeys, onOctaveChange, onNoteOn, onNoteOff }: {
  octave: number;
  activeKeys: Set<string>;
  onOctaveChange: (o: number) => void;
  onNoteOn: (note: string) => void;
  onNoteOff: (note: string) => void;
}) {
  const whiteCount = WHITE_KEYS.length; // 14

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      {/* Octave selector */}
      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
        <span style={{ fontSize:11, color:"var(--muted)", fontWeight:600 }}>Octave</span>
        {[2,3,4,5,6].map(o => (
          <button key={o} onClick={() => onOctaveChange(o)}
            style={{ width:26, height:26, borderRadius:6, border:"none", cursor:"pointer",
              background:octave===o ? "var(--accent)":"var(--bg3)",
              color:octave===o?"#000":"var(--muted)", fontWeight:700, fontSize:12 }}>
            {o}
          </button>
        ))}
      </div>

      {/* Keys container */}
      <div style={{ position:"relative", height:110, userSelect:"none" }}>
        {/* White keys */}
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${whiteCount}, 1fr)`, gap:2, height:"100%" }}>
          {WHITE_KEYS.map(([name, octOff], i) => {
            const note = `${name}${octave + octOff}`;
            const active = activeKeys.has(note);
            return (
              <div key={i}
                onPointerDown={e => { e.preventDefault(); onNoteOn(note); }}
                onPointerUp={() => onNoteOff(note)}
                onPointerLeave={() => onNoteOff(note)}
                style={{
                  borderRadius:"0 0 5px 5px", cursor:"pointer",
                  background: active ? "#1db954" : "#f0f0f0",
                  border:`1px solid ${active?"#1db954":"#b0b0b0"}`,
                  display:"flex", alignItems:"flex-end", justifyContent:"center",
                  paddingBottom:5, fontSize:8, color:active?"#000":"#aaa", fontWeight:700,
                  transition:"background .04s",
                  boxShadow: active ? "0 0 10px #1db95480" : "inset 0 -2px 4px rgba(0,0,0,.1)",
                }}>
                {KB_WHITE[i]?.toUpperCase()}
              </div>
            );
          })}
        </div>

        {/* Black keys — absolutely positioned above white keys */}
        <div style={{ position:"absolute", top:0, left:0, right:0, height:"60%",
          display:"grid", gridTemplateColumns:`repeat(${whiteCount}, 1fr)`, gap:2,
          pointerEvents:"none" }}>
          {BLACK_KEYS.map((bk, i) => {
            if (!bk) {
              // Empty slot — render gap spacer
              return <div key={i} />;
            }
            const [name, octOff] = bk;
            const note = `${name}${octave + octOff}`;
            const active = activeKeys.has(note);
            // Black key sits between white key i and i+1.
            // We use justify-self to center it spanning from right half of white[i] to left half of white[i+1].
            return (
              <div key={i}
                style={{ display:"flex", justifyContent:"center", alignItems:"flex-start" }}>
                <div
                  onPointerDown={e => { e.preventDefault(); e.stopPropagation(); onNoteOn(note); }}
                  onPointerUp={e => { e.stopPropagation(); onNoteOff(note); }}
                  onPointerLeave={() => onNoteOff(note)}
                  style={{
                    pointerEvents:"all",
                    width:"70%", height:"100%",
                    borderRadius:"0 0 4px 4px", cursor:"pointer",
                    background: active ? "#1db954" : "#1a1a1a",
                    border: active ? "none" : "1px solid #0a0a0a",
                    transition:"background .04s", zIndex:2,
                    boxShadow: active ? "0 0 10px #1db954" : "none",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Drum pads ────────────────────────────────────────────────────────────────
function DrumPads({ activeKeys, onDown }: {
  activeKeys: Set<string>;
  onDown: (note: string, idx: number) => void;
}) {
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
      {DRUM_PADS.map((pad, i) => {
        const active = activeKeys.has(pad.label);
        return (
          <button key={pad.label}
            onPointerDown={() => onDown(pad.label, i)}
            style={{
              height:68, borderRadius:10, border:"none", cursor:"pointer",
              background: active ? pad.color : "var(--bg3)",
              color: active ? "#000" : "var(--muted)",
              fontWeight:700, fontSize:12, transition:"all .05s",
              boxShadow: active ? `0 0 14px ${pad.color}90` : "none",
              display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:3,
            }}>
            <span>{pad.label}</span>
            <span style={{ fontSize:9, opacity:0.55 }}>[{pad.key.toUpperCase()}]</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Slider ────────────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  display: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom:4 }}>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
        <span style={{ fontSize:11, color:"var(--muted)" }}>{label}</span>
        <span style={{ fontSize:11, color:"var(--accent)", fontWeight:600 }}>{display(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width:"100%", accentColor:"var(--accent)", cursor:"pointer" }} />
    </div>
  );
}

function ParamLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize:10, fontWeight:800, letterSpacing:1.2, textTransform:"uppercase",
      color:"var(--muted2)" }}>
      {children}
    </div>
  );
}

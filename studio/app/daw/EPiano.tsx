"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import * as Tone from "tone";
// Import Piano from its deep path rather than the package index — the index also
// re-exports MidiInput, which requires the optional `webmidi` package we don't use
// (and isn't installed). The mouse/QWERTY panel never needs MIDI input.
import { Piano } from "@tonejs/piano/build/piano/Piano";
import { C, mono, ui, withAlpha } from "./theme";
import { getWafPlayer, loadPreset } from "./webAudioFont";
import { WAF_INSTRUMENTS, WAF_FAMILIES } from "./wafCatalog";

// A playable instrument panel with three swappable sound engines, all routed
// through Tone's shared audio context (the same one the DAW engine uses):
//
//   • "synth"      — built-in FM Rhodes voice. Zero load, always available.
//   • "salamander" — @tonejs/piano: CC0 Yamaha C5, 88 keys × velocity layers
//                    (~1000+ real samples) for a realistic acoustic grand.
//   • "gm"         — WebAudioFont GeneralUser GS: 128 General MIDI instruments
//                    (pianos, organs, strings, synths, basses…) loaded on demand.
//
// Play with the mouse or the QWERTY row — keys map A..K / W..U like a tracker.

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK = new Set([1, 3, 6, 8, 10]);

const KEYMAP: Record<string, number> = {
  a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11,
  k: 12, o: 13, l: 14, p: 15, ";": 16,
};

type Source = "synth" | "salamander" | "gm";

function midiToName(m: number): string {
  return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);
}

export default function EPiano() {
  const [source, setSource]   = useState<Source>("synth");
  const [octave, setOctave]   = useState(4);
  const [held, setHeld]       = useState<Set<number>>(new Set());
  const [bright, setBright]   = useState(0.55);
  const [reverb, setReverb]   = useState(0.28);
  const [volume, setVolume]   = useState(0.8);
  const [gmFile, setGmFile]   = useState(WAF_INSTRUMENTS[4].file); // default: Rhodes EP
  const [status, setStatus]   = useState<string>("");             // loading / error text

  // --- FM synth chain (built lazily, kept for the "synth" source) ---
  const synthRef  = useRef<Tone.PolySynth<Tone.FMSynth> | null>(null);
  const reverbRef = useRef<Tone.Reverb | null>(null);
  const chorusRef = useRef<Tone.Chorus | null>(null);
  const gainRef   = useRef<Tone.Gain | null>(null);

  // --- Salamander grand (@tonejs/piano) ---
  const pianoRef     = useRef<Piano | null>(null);
  const pianoLoadRef = useRef<Promise<void> | null>(null); // resolves when samples are decoded

  // --- WebAudioFont (GM bank) ---
  const wafRef       = useRef<Awaited<ReturnType<typeof getWafPlayer>> | null>(null);
  const wafPresetRef = useRef<unknown>(null);
  const wafGainRef   = useRef<GainNode | null>(null);
  // Track active WAF voices so we can stop them on key-up (WAF is fire-and-forget
  // by default, so we hold the envelope by scheduling a long note and cancelling).
  const wafVoicesRef = useRef<Map<number, { cancel?: () => void }>>(new Map());

  const octaveRef = useRef(octave);  octaveRef.current = octave;
  const sourceRef = useRef(source);  sourceRef.current = source;
  const volumeRef = useRef(volume);  volumeRef.current = volume;

  // Build the FM voice chain on first use.
  const ensureSynth = useCallback(async () => {
    if (synthRef.current) return;
    await Tone.start();
    const gain = new Tone.Gain(volume).toDestination();
    const reverbNode = new Tone.Reverb({ decay: 3, wet: reverb });
    const chorus = new Tone.Chorus({ frequency: 1.2, delayTime: 3.5, depth: 0.4, wet: 0.35 }).start();
    const synth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3.0,
      modulationIndex: 6 + bright * 12,
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 1.6, sustain: 0.18, release: 1.1 },
      modulation: { type: "sine" },
      modulationEnvelope: { attack: 0.004, decay: 0.9, sustain: 0.0, release: 0.4 },
    });
    synth.maxPolyphony = 24;
    synth.chain(chorus, reverbNode, gain);
    synthRef.current = synth; reverbRef.current = reverbNode;
    chorusRef.current = chorus; gainRef.current = gain;
  }, [volume, reverb, bright]);

  // Build / load the Salamander grand. Returns a promise that resolves once the
  // samples are decoded, so callers can await it before triggering a key (the
  // library throws "samples not loaded" otherwise). Built once; the promise is
  // cached so concurrent callers share the same in-flight load.
  const ensurePiano = useCallback((): Promise<void> => {
    if (pianoLoadRef.current) return pianoLoadRef.current;
    pianoLoadRef.current = (async () => {
      await Tone.start();
      setStatus("Loading grand piano samples…");
      // 2 velocity layers + no pedal noise = far fewer files to fetch/decode,
      // so the first sound arrives quickly. Bump velocities for more realism.
      const piano = new Piano({ velocities: 2, release: true, pedal: false });
      piano.toDestination();
      try {
        await piano.load();
        pianoRef.current = piano;
        setStatus("");
      } catch {
        setStatus("Couldn't load grand piano samples (offline?).");
        pianoLoadRef.current = null; // allow a retry
        throw new Error("piano load failed");
      }
    })();
    return pianoLoadRef.current;
  }, []);

  // Init / swap the WebAudioFont preset on first use or when gmFile changes.
  const ensureGm = useCallback(async (file: string) => {
    await Tone.start();
    const ctx = (Tone.getContext().rawContext ?? Tone.getContext()) as unknown as AudioContext;
    if (!wafRef.current) {
      setStatus("Loading instrument engine…");
      try {
        wafRef.current = await getWafPlayer();
        const g = ctx.createGain();
        g.gain.value = volumeRef.current;
        g.connect(ctx.destination);
        wafGainRef.current = g;
      } catch {
        setStatus("Couldn't load instrument engine (offline?).");
        return;
      }
    }
    setStatus("Loading instrument…");
    try {
      wafPresetRef.current = await loadPreset(wafRef.current, file, ctx);
      setStatus("");
    } catch {
      setStatus("Couldn't load that instrument.");
    }
  }, []);

  // Warm up whichever engine the source needs when it (or the GM patch) changes.
  useEffect(() => {
    if (source === "synth") void ensureSynth();
    else if (source === "salamander") void ensurePiano();
    else if (source === "gm") void ensureGm(gmFile);
  }, [source, gmFile, ensureSynth, ensurePiano, ensureGm]);

  // Tear everything down on unmount.
  useEffect(() => {
    return () => {
      synthRef.current?.releaseAll(); synthRef.current?.dispose();
      reverbRef.current?.dispose(); chorusRef.current?.dispose(); gainRef.current?.dispose();
      pianoRef.current?.dispose?.();
      try { wafGainRef.current?.disconnect(); } catch { /* noop */ }
    };
  }, []);

  // Live param updates (FM synth + WAF gain + Salamander volume).
  useEffect(() => {
    gainRef.current?.gain.rampTo(volume, 0.05);
    if (wafGainRef.current) wafGainRef.current.gain.value = volume;
  }, [volume]);
  useEffect(() => { reverbRef.current?.wet.rampTo(reverb, 0.1); }, [reverb]);
  useEffect(() => { synthRef.current?.set({ modulationIndex: 6 + bright * 12 }); }, [bright]);

  const noteOn = useCallback(async (midi: number) => {
    const src = sourceRef.current;
    if (src === "synth") {
      await ensureSynth();
      synthRef.current?.triggerAttack(Tone.Frequency(midi, "midi").toFrequency(), Tone.now(), 0.85);
    } else if (src === "salamander") {
      try { await ensurePiano(); } catch { return; } // load failed → no note
      // The user may have released the key (or switched source) during the load.
      if (sourceRef.current === "salamander" && pianoRef.current?.loaded) {
        pianoRef.current.keyDown({ midi, velocity: 0.7 });
      }
    } else {
      if (!wafRef.current || !wafPresetRef.current || !wafGainRef.current) await ensureGm(gmFile);
      const player = wafRef.current, preset = wafPresetRef.current, dest = wafGainRef.current;
      if (player && preset && dest) {
        const ctx = (Tone.getContext().rawContext ?? Tone.getContext()) as unknown as AudioContext;
        // Schedule a long note; we cancel it on key-up for a sustained feel.
        const voice = player.queueWaveTable(ctx, dest, preset, ctx.currentTime, midi, 9999, volumeRef.current);
        if (voice) wafVoicesRef.current.set(midi, voice);
      }
    }
    setHeld(prev => { const n = new Set(prev); n.add(midi); return n; });
  }, [ensureSynth, ensurePiano, ensureGm, gmFile]);

  const noteOff = useCallback((midi: number) => {
    const src = sourceRef.current;
    if (src === "synth") {
      synthRef.current?.triggerRelease(Tone.Frequency(midi, "midi").toFrequency(), Tone.now());
    } else if (src === "salamander") {
      pianoRef.current?.keyUp({ midi });
    } else {
      const voice = wafVoicesRef.current.get(midi);
      voice?.cancel?.();
      wafVoicesRef.current.delete(midi);
    }
    setHeld(prev => { const n = new Set(prev); n.delete(midi); return n; });
  }, []);

  // Computer-keyboard input.
  useEffect(() => {
    const down = new Set<string>();
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "z") { setOctave(o => Math.max(1, o - 1)); return; }
      if (k === "x") { setOctave(o => Math.min(7, o + 1)); return; }
      if (!(k in KEYMAP)) return;
      e.preventDefault();
      if (down.has(k)) return;
      down.add(k);
      void noteOn((octaveRef.current + 1) * 12 + KEYMAP[k]);
    };
    const onUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!(k in KEYMAP) || !down.has(k)) return;
      down.delete(k);
      noteOff((octaveRef.current + 1) * 12 + KEYMAP[k]);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onUp); };
  }, [noteOn, noteOff]);

  const lowMidi = (octave + 1) * 12;
  const keys: { midi: number; black: boolean }[] = [];
  for (let i = 0; i < 24; i++) keys.push({ midi: lowMidi + i, black: BLACK.has((lowMidi + i) % 12) });
  const whites = keys.filter(k => !k.black);

  return (
    <div style={{
      height: 260, borderTop: `1px solid ${C.line}`, background: C.bg1,
      display: "flex", flexDirection: "column", fontFamily: ui, overflow: "hidden",
    }}>
      {/* control strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "8px 14px", borderBottom: `1px solid ${C.line}`, flexShrink: 0, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: C.accent }}>INSTRUMENT</span>

        {/* sound-source picker */}
        <div style={{ display: "flex", gap: 2, background: C.bg0, padding: 2, borderRadius: 6 }}>
          {([["synth", "FM Synth"], ["salamander", "Grand Piano"], ["gm", "GM Bank"]] as const).map(([id, lbl]) => (
            <button key={id} onClick={() => setSource(id)} style={{
              padding: "4px 10px", borderRadius: 4, border: "none", cursor: "pointer",
              fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
              background: source === id ? `linear-gradient(180deg, ${C.accent}, ${C.accentDim})` : "transparent",
              color: source === id ? "#0c1714" : C.text3,
            }}>{lbl}</button>
          ))}
        </div>

        {/* GM instrument dropdown — only for the GM bank */}
        {source === "gm" && (
          <select value={gmFile} onChange={e => setGmFile(e.target.value)} style={{
            background: C.bg3, color: C.text, fontSize: 11, fontFamily: ui, cursor: "pointer",
            border: `1px solid ${C.line}`, borderRadius: 5, padding: "5px 8px", maxWidth: 220,
          }}>
            {WAF_FAMILIES.map(fam => {
              const items = WAF_INSTRUMENTS.filter(i => i.family === fam);
              if (!items.length) return null;
              return (
                <optgroup key={fam} label={fam}>
                  {items.map(i => <option key={i.file} value={i.file}>{i.program}. {i.name}</option>)}
                </optgroup>
              );
            })}
          </select>
        )}

        {source === "synth" && <Slider label="TONE" value={bright} onChange={setBright} />}
        {source === "synth" && <Slider label="REVERB" value={reverb} onChange={setReverb} />}
        <Slider label="VOLUME" value={volume} onChange={setVolume} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 8, color: C.text3, fontWeight: 700, letterSpacing: 1 }}>OCTAVE</span>
          <button onClick={() => setOctave(o => Math.max(1, o - 1))} style={octBtn}>−</button>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.text, fontFamily: mono, width: 16, textAlign: "center" }}>{octave}</span>
          <button onClick={() => setOctave(o => Math.min(7, o + 1))} style={octBtn}>+</button>
        </div>

        <span style={{ marginLeft: "auto", fontSize: 9, color: status ? C.warn : C.text4 }}>
          {status || "Mouse or A·W·S·E·D… keys · Z/X octave"}
        </span>
      </div>

      {/* keyboard */}
      <div style={{ flex: 1, position: "relative", padding: 14, minHeight: 0 }}>
        <div style={{ position: "relative", height: "100%", display: "flex", borderRadius: 6, overflow: "hidden", boxShadow: "inset 0 2px 8px rgba(0,0,0,0.5)" }}>
          {whites.map(k => {
            const on = held.has(k.midi);
            return (
              <div key={k.midi}
                onMouseDown={() => noteOn(k.midi)}
                onMouseUp={() => noteOff(k.midi)}
                onMouseLeave={() => on && noteOff(k.midi)}
                style={{
                  flex: 1, position: "relative", cursor: "pointer",
                  background: on ? `linear-gradient(180deg, ${C.accent}, ${C.accentDim})` : "linear-gradient(180deg, #f4f2ec 0%, #d8d4c8 100%)",
                  borderRight: "1px solid #0008", borderRadius: "0 0 4px 4px",
                  boxShadow: on ? `inset 0 0 12px ${withAlpha(C.accent, 0.6)}` : "inset 0 -6px 8px rgba(0,0,0,0.18)",
                  display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 6,
                  transition: "background .03s",
                }}>
                {k.midi % 12 === 0 && (
                  <span style={{ fontSize: 8, fontWeight: 700, color: on ? "#fff" : "#9a958a", fontFamily: mono }}>{midiToName(k.midi)}</span>
                )}
              </div>
            );
          })}

          {keys.map((k, i) => {
            if (!k.black) return null;
            const whitesBefore = keys.slice(0, i).filter(x => !x.black).length;
            const left = `calc(${whitesBefore} * (100% / ${whites.length}) - (100% / ${whites.length}) * 0.3)`;
            const on = held.has(k.midi);
            return (
              <div key={k.midi}
                onMouseDown={e => { e.stopPropagation(); noteOn(k.midi); }}
                onMouseUp={e => { e.stopPropagation(); noteOff(k.midi); }}
                onMouseLeave={() => on && noteOff(k.midi)}
                style={{
                  position: "absolute", top: 0, left,
                  width: `calc((100% / ${whites.length}) * 0.6)`, height: "62%",
                  background: on ? `linear-gradient(180deg, ${C.accentDim}, ${C.accent})` : "linear-gradient(180deg, #2a2a2e 0%, #0c0c0e 100%)",
                  borderRadius: "0 0 3px 3px", cursor: "pointer", zIndex: 2, border: "1px solid #000",
                  boxShadow: on ? `0 0 10px ${withAlpha(C.accent, 0.7)}` : "0 3px 4px rgba(0,0,0,0.6)",
                  transition: "background .03s",
                }} />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const octBtn: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 5, border: `1px solid ${C.line}`,
  background: C.bg3, color: C.text2, fontSize: 13, fontWeight: 800, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
};

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 8, color: C.text3, fontWeight: 700, letterSpacing: 1, width: 42 }}>{label}</span>
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={e => onChange(+e.target.value)}
        style={{ width: 72, accentColor: C.accent }} />
    </div>
  );
}

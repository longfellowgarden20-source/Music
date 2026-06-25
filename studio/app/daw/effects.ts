// Effect definitions — maps our TrackEffect model to real Tone.js DSP nodes.
// Each def lists its params (label, min, max, default, unit) for the UI knobs,
// plus build() (create the Tone node) and apply() (push params to the node).
import type { EffectType, TrackEffect } from "./dawTypes";

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  // optional curve: "log" makes knobs feel natural for freq/time
  curve?: "lin" | "log";
}

export interface EffectDef {
  type: EffectType;
  name: string;
  short: string;     // 3-letter rack label
  params: ParamDef[];
  build: (Tone: any, params: Record<string, number>) => any;
  apply: (node: any, params: Record<string, number>) => void;
}

// Some effects need more than one Tone node in series (e.g. EQ = 4 filters,
// Echo = delay + tone filter). A "composite" wraps a head (input) and tail
// (output) so the engine can connect: prev -> head ... tail -> next, and
// dispose every internal node. The engine checks for `_isComposite`.
export interface CompositeNode {
  _isComposite: true;
  _head: any;      // connect INTO this
  _tail: any;      // connect OUT of this
  _delay?: any;    // optional refs used by apply()
  _eqBands?: any;
  connect: (dest: any) => any;
  disconnect: () => void;
  dispose: () => void;
}

function makeComposite(head: any, tail: any): CompositeNode {
  return {
    _isComposite: true,
    _head: head,
    _tail: tail,
    _delay: head,     // for echo, head is the delay node
    connect(dest: any) {
      // dest may itself be a composite — connect to its head
      const target = dest && dest._isComposite ? dest._head : dest;
      tail.connect(target);
      return dest;
    },
    disconnect() { try { tail.disconnect(); } catch {} },
    dispose() {
      // dispose the whole internal graph: head, tail, plus any stashed band nodes.
      const seen = new Set<any>();
      const kill = (n: any) => { if (!n || seen.has(n)) return; seen.add(n); try { n.dispose(); } catch {} };
      kill(head); kill(tail);
      const bands = (this as any)._eqBands;
      if (bands) Object.values(bands).forEach(kill);
    },
  };
}

export const EFFECT_DEFS: Record<EffectType, EffectDef> = {
  eq3: {
    type: "eq3", name: "EQ Three", short: "EQ",
    params: [
      { key: "low", label: "Low", min: -24, max: 12, step: 0.5, default: -5, unit: "dB" },
      { key: "mid", label: "Mid", min: -24, max: 12, step: 0.5, default: 0, unit: "dB" },
      { key: "high", label: "High", min: -24, max: 12, step: 0.5, default: 2.5, unit: "dB" },
      { key: "lowFreq", label: "Lo X", min: 50, max: 600, step: 10, default: 250, unit: "Hz", curve: "log" },
      { key: "highFreq", label: "Hi X", min: 1000, max: 8000, step: 100, default: 2500, unit: "Hz", curve: "log" },
    ],
    build: (Tone, p) => new Tone.EQ3({ low: p.low, mid: p.mid, high: p.high, lowFrequency: p.lowFreq, highFrequency: p.highFreq }),
    apply: (n, p) => {
      n.low.value = p.low; n.mid.value = p.mid; n.high.value = p.high;
      n.lowFrequency.value = p.lowFreq; n.highFrequency.value = p.highFreq;
    },
  },
  compressor: {
    type: "compressor", name: "Compressor", short: "CMP",
    params: [
      { key: "threshold", label: "Thresh", min: -60, max: 0, step: 1, default: -18, unit: "dB" },
      { key: "ratio", label: "Ratio", min: 1, max: 20, step: 0.5, default: 3, unit: ":1" },
      { key: "attack", label: "Attack", min: 0.001, max: 1, step: 0.001, default: 0.02, unit: "s", curve: "log" },
      { key: "release", label: "Release", min: 0.01, max: 1, step: 0.01, default: 0.25, unit: "s", curve: "log" },
    ],
    build: (Tone, p) => new Tone.Compressor({ threshold: p.threshold, ratio: p.ratio, attack: p.attack, release: p.release }),
    apply: (n, p) => {
      n.threshold.value = p.threshold; n.ratio.value = p.ratio;
      n.attack.value = p.attack; n.release.value = p.release;
    },
  },
  reverb: {
    type: "reverb", name: "Reverb", short: "RVB",
    params: [
      { key: "decay", label: "Decay", min: 0.1, max: 10, step: 0.1, default: 2.5, unit: "s", curve: "log" },
      { key: "preDelay", label: "Pre", min: 0, max: 0.5, step: 0.01, default: 0.02, unit: "s" },
      { key: "wet", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
    build: (Tone, p) => new Tone.Reverb({ decay: p.decay, preDelay: p.preDelay, wet: p.wet }),
    apply: (n, p) => { n.decay = p.decay; n.preDelay = p.preDelay; n.wet.value = p.wet; },
  },
  delay: {
    type: "delay", name: "Ping-Pong Delay", short: "DLY",
    params: [
      { key: "delayTime", label: "Time", min: 0.01, max: 1, step: 0.01, default: 0.25, unit: "s", curve: "log" },
      { key: "feedback", label: "Fdbk", min: 0, max: 0.95, step: 0.01, default: 0.3 },
      { key: "wet", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.25 },
    ],
    build: (Tone, p) => new Tone.PingPongDelay({ delayTime: p.delayTime, feedback: p.feedback, wet: p.wet }),
    apply: (n, p) => { n.delayTime.value = p.delayTime; n.feedback.value = p.feedback; n.wet.value = p.wet; },
  },
  chorus: {
    type: "chorus", name: "Chorus", short: "CHR",
    params: [
      { key: "frequency", label: "Rate", min: 0.1, max: 8, step: 0.1, default: 1.5, unit: "Hz" },
      { key: "depth", label: "Depth", min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: "wet", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.4 },
    ],
    build: (Tone, p) => { const c = new Tone.Chorus({ frequency: p.frequency, depth: p.depth, wet: p.wet }); c.start(); return c; },
    apply: (n, p) => { n.frequency.value = p.frequency; n.depth = p.depth; n.wet.value = p.wet; },
  },
  distortion: {
    type: "distortion", name: "Distortion", short: "DST",
    params: [
      { key: "amount", label: "Drive", min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: "wet", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    build: (Tone, p) => new Tone.Distortion({ distortion: p.amount, wet: p.wet }),
    apply: (n, p) => { n.distortion = p.amount; n.wet.value = p.wet; },
  },
  // ── Vocal-focused effects ──────────────────────────────────────────────
  // Pitch shift — shifts the whole vocal up/down in semitones. Use small values
  // (±1–2) for a subtle "thickening", larger for chipmunk/deep effects.
  pitch: {
    type: "pitch", name: "Pitch Shift", short: "PCH",
    params: [
      { key: "pitch", label: "Semis", min: -12, max: 12, step: 1, default: 0, unit: "st" },
      { key: "windowSize", label: "Window", min: 0.01, max: 0.5, step: 0.01, default: 0.1, unit: "s", curve: "log" },
      { key: "wet", label: "Mix", min: 0, max: 1, step: 0.01, default: 1 },
    ],
    build: (Tone, p) => new Tone.PitchShift({ pitch: p.pitch, windowSize: p.windowSize, wet: p.wet }),
    apply: (n, p) => { n.pitch = p.pitch; n.windowSize = p.windowSize; n.wet.value = p.wet; },
  },
  // Doubler — duplicates the voice with a tiny pitch + time offset to create a
  // natural "two takes at once" thickness. Built from a detuned PitchShift in
  // parallel via wet mix.
  doubler: {
    type: "doubler", name: "Doubler", short: "DBL",
    params: [
      { key: "detune", label: "Detune", min: 0, max: 30, step: 1, default: 8, unit: "ct" },
      { key: "delay", label: "Spread", min: 0.005, max: 0.06, step: 0.001, default: 0.02, unit: "s" },
      { key: "wet", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    // Tone.Chorus with low rate + the detune mapped to depth = a stable doubler.
    build: (Tone, p) => {
      const c = new Tone.Chorus({
        frequency: 0.6, delayTime: p.delay * 1000, depth: Math.min(1, p.detune / 30),
        spread: 180, wet: p.wet,
      });
      c.start();
      return c;
    },
    apply: (n, p) => {
      n.delayTime = p.delay * 1000;
      n.depth = Math.min(1, p.detune / 30);
      n.wet.value = p.wet;
    },
  },
  // De-esser — tames harsh "S"/"T" sibilance by notching the 5–8 kHz band.
  // Implemented as a narrow peaking filter with negative gain.
  deesser: {
    type: "deesser", name: "De-Esser", short: "DSS",
    params: [
      { key: "freq", label: "Freq", min: 3000, max: 9000, step: 100, default: 6500, unit: "Hz", curve: "log" },
      { key: "amount", label: "Cut", min: 0, max: 24, step: 0.5, default: 8, unit: "dB" },
      { key: "q", label: "Width", min: 0.5, max: 8, step: 0.1, default: 3 },
    ],
    build: (Tone, p) => new Tone.Filter({ type: "peaking", frequency: p.freq, gain: -p.amount, Q: p.q }),
    apply: (n, p) => { n.frequency.value = p.freq; n.gain.value = -p.amount; n.Q.value = p.q; },
  },
  // Tempo-synced ping-pong echo — the classic vocal "throw" (1/4, 1/8 echoes
  // bouncing L↔R). delayTime is given in beat divisions mapped to seconds via BPM,
  // but here we expose seconds directly + a feedback "repeats" knob + tone filter.
  echo: {
    type: "echo", name: "Echo / Throw", short: "ECH",
    params: [
      { key: "time", label: "Time", min: 0.05, max: 1.2, step: 0.01, default: 0.375, unit: "s", curve: "log" },
      { key: "feedback", label: "Repeats", min: 0, max: 0.92, step: 0.01, default: 0.45 },
      { key: "tone", label: "Tone", min: 800, max: 12000, step: 100, default: 4000, unit: "Hz", curve: "log" },
      { key: "wet", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.3 },
    ],
    // PingPongDelay (the L↔R bounce) → lowpass for darker, analog-style tails.
    // Composite: signal enters the delay (head) and exits the lowpass (tail).
    build: (Tone, p) => {
      const d = new Tone.PingPongDelay({ delayTime: p.time, feedback: p.feedback, wet: p.wet });
      const lp = new Tone.Filter({ type: "lowpass", frequency: p.tone, Q: 0.5 });
      d.connect(lp);
      const node = makeComposite(d, lp);
      node._delay = d;
      return node;
    },
    apply: (n, p) => {
      const d = n._delay; const lp = n._tail;
      if (d) { d.delayTime.value = p.time; d.feedback.value = p.feedback; d.wet.value = p.wet; }
      if (lp) lp.frequency.value = p.tone;
    },
  },
  // 4-band parametric EQ — surgical tone shaping (low cut + low/mid/high bells).
  paramEq: {
    type: "paramEq", name: "Parametric EQ", short: "PEQ",
    params: [
      { key: "hpf",     label: "Lo Cut", min: 20,   max: 400,   step: 5,   default: 80,   unit: "Hz", curve: "log" },
      { key: "lowGain", label: "Low",    min: -18,  max: 18,    step: 0.5, default: 0,    unit: "dB" },
      { key: "lowFreq", label: "Lo f",   min: 100,  max: 600,   step: 10,  default: 250,  unit: "Hz", curve: "log" },
      { key: "midGain", label: "Mid",    min: -18,  max: 18,    step: 0.5, default: 0,    unit: "dB" },
      { key: "midFreq", label: "Mid f",  min: 400,  max: 4000,  step: 50,  default: 1500, unit: "Hz", curve: "log" },
      { key: "hiGain",  label: "High",   min: -18,  max: 18,    step: 0.5, default: 2,    unit: "dB" },
      { key: "hiFreq",  label: "Hi f",   min: 3000, max: 14000, step: 100, default: 8000, unit: "Hz", curve: "log" },
    ],
    build: (Tone, p) => {
      const hpf = new Tone.Filter({ type: "highpass", frequency: p.hpf, Q: 0.7 });
      const low = new Tone.Filter({ type: "peaking", frequency: p.lowFreq, gain: p.lowGain, Q: 1 });
      const mid = new Tone.Filter({ type: "peaking", frequency: p.midFreq, gain: p.midGain, Q: 1 });
      const hi  = new Tone.Filter({ type: "highshelf", frequency: p.hiFreq, gain: p.hiGain });
      hpf.connect(low); low.connect(mid); mid.connect(hi);
      const node = makeComposite(hpf, hi);
      node._eqBands = { hpf, low, mid, hi };
      return node;
    },
    apply: (n, p) => {
      const b = n._eqBands; if (!b) return;
      b.hpf.frequency.value = p.hpf;
      b.low.frequency.value = p.lowFreq; b.low.gain.value = p.lowGain;
      b.mid.frequency.value = p.midFreq; b.mid.gain.value = p.midGain;
      b.hi.frequency.value = p.hiFreq;   b.hi.gain.value = p.hiGain;
    },
  },
  // Noise gate — silences hiss / room tone / breaths below the threshold.
  gate: {
    type: "gate", name: "Noise Gate", short: "GAT",
    params: [
      { key: "threshold", label: "Thresh", min: -80, max: -10, step: 1, default: -45, unit: "dB" },
      { key: "attack", label: "Attack", min: 0, max: 0.1, step: 0.001, default: 0.005, unit: "s" },
      { key: "release", label: "Release", min: 0.01, max: 0.5, step: 0.01, default: 0.1, unit: "s" },
    ],
    build: (Tone, p) => new Tone.Gate({ threshold: p.threshold, smoothing: p.release }),
    apply: (n, p) => { n.threshold = p.threshold; n.smoothing = p.release; },
  },
  // Saturation / warmth — gentle tube-style harmonics. Softer than Distortion;
  // adds body & presence without sounding "broken".
  saturation: {
    type: "saturation", name: "Warmth / Saturation", short: "SAT",
    params: [
      { key: "drive", label: "Warmth", min: 0, max: 1, step: 0.01, default: 0.25 },
      { key: "wet", label: "Mix", min: 0, max: 1, step: 0.01, default: 0.7 },
    ],
    // Chebyshev adds even harmonics (tube-like) — order scaled by drive.
    build: (Tone, p) => new Tone.Chebyshev({ order: Math.max(1, Math.round(1 + p.drive * 8)), wet: p.wet }),
    apply: (n, p) => { n.order = Math.max(1, Math.round(1 + p.drive * 8)); n.wet.value = p.wet; },
  },
  // Stereo widener — spreads a mono vocal across the stereo field for size.
  widener: {
    type: "widener", name: "Stereo Width", short: "WID",
    params: [
      { key: "width", label: "Width", min: 0, max: 1, step: 0.01, default: 0.6 },
    ],
    build: (Tone, p) => new Tone.StereoWidener({ width: p.width }),
    apply: (n, p) => { n.width.value = p.width; },
  },
};

export const EFFECT_ORDER: EffectType[] = [
  "gate", "paramEq", "eq3", "deesser", "compressor", "saturation",
  "pitch", "doubler", "chorus", "echo", "delay", "reverb",
  "widener", "distortion",
];

let _eid = 0;
export function makeEffect(type: EffectType, overrides?: Record<string, number>): TrackEffect {
  const def = EFFECT_DEFS[type];
  const params: Record<string, number> = {};
  def.params.forEach(p => { params[p.key] = p.default; });
  if (overrides) Object.assign(params, overrides);
  return { id: `fx${++_eid}_${Math.random().toString(36).slice(2, 6)}`, type, enabled: true, params };
}

// ── Vocal preset chains ─────────────────────────────────────────────────────
// One-click "producer" chains. Each lists effects (in signal order) with tuned
// params. Applying a preset REPLACES the track's effect rack.
export interface VocalPreset {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  chain: { type: EffectType; params?: Record<string, number> }[];
}

export const VOCAL_PRESETS: VocalPreset[] = [
  {
    id: "clean", name: "Clean Vocal", emoji: "🎙️",
    blurb: "Gate, EQ, gentle compression — a polished, natural lead.",
    chain: [
      { type: "gate", params: { threshold: -48 } },
      { type: "paramEq", params: { hpf: 90, midGain: -1.5, midFreq: 400, hiGain: 3, hiFreq: 9000 } },
      { type: "deesser", params: { amount: 6 } },
      { type: "compressor", params: { threshold: -20, ratio: 3.5, attack: 0.01, release: 0.18 } },
      { type: "reverb", params: { decay: 1.4, wet: 0.14 } },
    ],
  },
  {
    id: "pop", name: "Pop Star", emoji: "✨",
    blurb: "Bright, thick, radio-ready with a wide doubled chorus.",
    chain: [
      { type: "gate", params: { threshold: -45 } },
      { type: "paramEq", params: { hpf: 100, lowGain: -2, midGain: 1.5, midFreq: 3000, hiGain: 4.5, hiFreq: 10000 } },
      { type: "deesser", params: { amount: 8 } },
      { type: "compressor", params: { threshold: -22, ratio: 4, attack: 0.006, release: 0.12 } },
      { type: "doubler", params: { detune: 10, wet: 0.4 } },
      { type: "saturation", params: { drive: 0.2, wet: 0.5 } },
      { type: "widener", params: { width: 0.5 } },
      { type: "echo", params: { time: 0.375, feedback: 0.35, wet: 0.18 } },
      { type: "reverb", params: { decay: 1.8, wet: 0.2 } },
    ],
  },
  {
    id: "rap", name: "Rap / Trap", emoji: "🔥",
    blurb: "Punchy, present, in-your-face with tight slap echo.",
    chain: [
      { type: "gate", params: { threshold: -42 } },
      { type: "paramEq", params: { hpf: 110, midGain: 2, midFreq: 2000, hiGain: 3, hiFreq: 8000 } },
      { type: "deesser", params: { amount: 7 } },
      { type: "compressor", params: { threshold: -18, ratio: 5, attack: 0.003, release: 0.1 } },
      { type: "saturation", params: { drive: 0.35, wet: 0.6 } },
      { type: "echo", params: { time: 0.25, feedback: 0.28, tone: 3000, wet: 0.15 } },
      { type: "reverb", params: { decay: 1.0, wet: 0.1 } },
    ],
  },
  {
    id: "singer", name: "Soul Singer", emoji: "🎤",
    blurb: "Warm, lush, big hall reverb for emotional performances.",
    chain: [
      { type: "gate", params: { threshold: -50 } },
      { type: "paramEq", params: { hpf: 80, lowGain: 1.5, lowFreq: 200, hiGain: 2.5, hiFreq: 9000 } },
      { type: "deesser", params: { amount: 5 } },
      { type: "compressor", params: { threshold: -24, ratio: 3, attack: 0.015, release: 0.25 } },
      { type: "saturation", params: { drive: 0.2, wet: 0.5 } },
      { type: "doubler", params: { detune: 6, wet: 0.25 } },
      { type: "reverb", params: { decay: 3.2, preDelay: 0.04, wet: 0.3 } },
    ],
  },
  {
    id: "lofi", name: "Lo-Fi", emoji: "📻",
    blurb: "Vintage, dusty, narrow — that bedroom tape character.",
    chain: [
      { type: "paramEq", params: { hpf: 180, hiGain: -6, hiFreq: 6000 } },
      { type: "saturation", params: { drive: 0.5, wet: 0.8 } },
      { type: "compressor", params: { threshold: -20, ratio: 4 } },
      { type: "echo", params: { time: 0.3, feedback: 0.4, tone: 2000, wet: 0.2 } },
      { type: "reverb", params: { decay: 1.6, wet: 0.22 } },
    ],
  },
  {
    id: "telephone", name: "Telephone", emoji: "☎️",
    blurb: "Thin, bandpassed phone/radio effect for FX vocals.",
    chain: [
      { type: "paramEq", params: { hpf: 400, lowGain: -12, midGain: 6, midFreq: 1500, hiGain: -18, hiFreq: 4000 } },
      { type: "saturation", params: { drive: 0.4, wet: 0.7 } },
      { type: "compressor", params: { threshold: -16, ratio: 6 } },
    ],
  },
  {
    id: "robot", name: "Robot / Hard Tune", emoji: "🤖",
    blurb: "Pitched, doubled, heavy effect — the modern auto-tune sound.",
    chain: [
      { type: "gate", params: { threshold: -45 } },
      { type: "paramEq", params: { hpf: 120, hiGain: 4, hiFreq: 9000 } },
      { type: "compressor", params: { threshold: -20, ratio: 6, attack: 0.002 } },
      { type: "pitch", params: { pitch: 0, windowSize: 0.03, wet: 1 } },
      { type: "doubler", params: { detune: 14, wet: 0.5 } },
      { type: "echo", params: { time: 0.375, feedback: 0.4, wet: 0.22 } },
      { type: "reverb", params: { decay: 2.0, wet: 0.25 } },
    ],
  },
];

export function buildPresetChain(preset: VocalPreset): TrackEffect[] {
  return preset.chain.map(c => makeEffect(c.type, c.params));
}

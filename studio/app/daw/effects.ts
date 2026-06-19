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
};

export const EFFECT_ORDER: EffectType[] = ["eq3", "compressor", "reverb", "delay", "chorus", "distortion"];

let _eid = 0;
export function makeEffect(type: EffectType): TrackEffect {
  const def = EFFECT_DEFS[type];
  const params: Record<string, number> = {};
  def.params.forEach(p => { params[p.key] = p.default; });
  return { id: `fx${++_eid}_${Math.random().toString(36).slice(2, 6)}`, type, enabled: true, params };
}

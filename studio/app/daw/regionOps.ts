// Non-destructive region editing. Each clip keeps its ORIGINAL decoded buffer
// plus an ordered list of RegionOps. To get the audio a clip should play, we
// replay every op over the original buffer in order. Ops come in two flavours:
//   - in-place: mutate sample values within [start,end) (gain, fade, reverse…)
//   - transforming: return a NEW buffer of possibly different length
//     (duplicate, delete, crop, insert-silence) or run an offline filter graph
//     (EQ / lowpass / telephone…). The original is never mutated → trivial undo.
import type { RegionOp, RegionOpType } from "./dawTypes";

let _opId = 0;
export function makeOp(type: RegionOpType, startSec: number, endSec: number, amount = 1, label?: string): RegionOp {
  return { id: `op${++_opId}_${Math.random().toString(36).slice(2, 6)}`, type, startSec, endSec, amount, label };
}

type AmountDef = { min: number; max: number; step: number; default: number; unit?: string };
export const OP_META: Record<RegionOpType, { name: string; icon: string; group: string; amount?: AmountDef; lengthChanging?: boolean; offline?: boolean }> = {
  // EDIT
  gain:           { name: "Gain",        icon: "⇕", group: "Edit", amount: { min: 0, max: 2, step: 0.01, default: 1, unit: "×" } },
  "fade-in":      { name: "Fade In",     icon: "◢", group: "Edit" },
  "fade-out":     { name: "Fade Out",    icon: "◣", group: "Edit" },
  silence:        { name: "Silence",     icon: "∅", group: "Edit" },
  reverse:        { name: "Reverse",     icon: "⇄", group: "Edit" },
  normalize:      { name: "Normalize",   icon: "⤒", group: "Edit" },
  invert:         { name: "Invert Phase",icon: "ø", group: "Edit" },
  duplicate:      { name: "Duplicate",   icon: "⧉", group: "Edit", lengthChanging: true },
  delete:         { name: "Delete",      icon: "⌫", group: "Edit", lengthChanging: true },
  crop:           { name: "Crop to Sel", icon: "⊡", group: "Edit", lengthChanging: true },
  "insert-silence": { name: "Insert Silence", icon: "▭", group: "Edit", lengthChanging: true },
  // TIME / PITCH
  pitch:          { name: "Pitch",       icon: "♪", group: "Time", amount: { min: -12, max: 12, step: 1, default: 0, unit: "st" } },
  stretch:        { name: "Stretch",     icon: "⟺", group: "Time", amount: { min: 0.5, max: 2, step: 0.05, default: 1, unit: "×" } },
  // EQ / FILTER (offline)
  lowpass:        { name: "Low-Pass",    icon: "⤵", group: "EQ", offline: true, amount: { min: 200, max: 18000, step: 100, default: 4000, unit: "Hz" } },
  highpass:       { name: "High-Pass",   icon: "⤴", group: "EQ", offline: true, amount: { min: 20, max: 4000, step: 20, default: 300, unit: "Hz" } },
  bandpass:       { name: "Band-Pass",   icon: "⌃", group: "EQ", offline: true, amount: { min: 100, max: 8000, step: 50, default: 1200, unit: "Hz" } },
  "eq-low":       { name: "EQ Low",      icon: "L", group: "EQ", offline: true, amount: { min: -18, max: 18, step: 0.5, default: 0, unit: "dB" } },
  "eq-mid":       { name: "EQ Mid",      icon: "M", group: "EQ", offline: true, amount: { min: -18, max: 18, step: 0.5, default: 0, unit: "dB" } },
  "eq-high":      { name: "EQ High",     icon: "H", group: "EQ", offline: true, amount: { min: -18, max: 18, step: 0.5, default: 0, unit: "dB" } },
  deess:          { name: "De-Ess",      icon: "ѕ", group: "EQ", offline: true, amount: { min: 0, max: 18, step: 0.5, default: 8, unit: "dB" } },
  mudcut:         { name: "Mud Cut",     icon: "▽", group: "EQ", offline: true, amount: { min: 0, max: 18, step: 0.5, default: 6, unit: "dB" } },
  telephone:      { name: "Telephone",   icon: "☎", group: "EQ", offline: true },
  // MIX / DYNAMICS (offline)
  compress:       { name: "Compress",    icon: "▣", group: "Mix", amount: { min: -50, max: 0, step: 1, default: -20, unit: "dB" } },
  limit:          { name: "Limit",       icon: "▔", group: "Mix", amount: { min: -24, max: 0, step: 0.5, default: -1, unit: "dB" } },
  gate:           { name: "Gate",        icon: "⊓", group: "Mix", amount: { min: -80, max: -10, step: 1, default: -45, unit: "dB" } },
  tremolo:        { name: "Tremolo",     icon: "∿", group: "Mix", amount: { min: 0.5, max: 16, step: 0.5, default: 5, unit: "Hz" } },
  autogain:       { name: "Auto Gain",   icon: "⊜", group: "Mix" },
  // TIME / PITCH musical
  "half-time":    { name: "Half-Time",   icon: "½", group: "Time" },
  "double-time":  { name: "Double-Time", icon: "2×", group: "Time" },
  stutter:        { name: "Stutter",     icon: "⋮", group: "Time", amount: { min: 2, max: 16, step: 1, default: 4, unit: "×" } },
  "tape-stop":    { name: "Tape Stop",   icon: "◖", group: "Time" },
  "pitch-scale":  { name: "Pitch→Scale", icon: "𝄞", group: "Time", amount: { min: 0, max: 11, step: 1, default: 0, unit: "key" } },
  autotune:       { name: "Auto-Tune",   icon: "✺", group: "Time" },
  // AI
  "ai-replace":   { name: "AI Regen",    icon: "✦", group: "AI" },
};

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// ── pitch detection + correction (autotune-lite) ────────────────────────────────
// Autocorrelation pitch detector for one window. Returns Hz or 0 if unvoiced.
function detectPitch(buf: Float32Array, sr: number): number {
  const n = buf.length;
  // RMS gate — skip silence
  let rms = 0; for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.01) return 0;

  const minLag = Math.floor(sr / 1000);  // 1000 Hz max
  const maxLag = Math.floor(sr / 70);    // 70 Hz min
  // normalized autocorrelation
  const corr = new Float32Array(maxLag + 1);
  let corr0 = 0; for (let i = 0; i < n; i++) corr0 += buf[i] * buf[i];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < n - lag; i++) c += buf[i] * buf[i + lag];
    corr[lag] = c / (corr0 || 1);
  }
  // find the global peak, then prefer the FIRST peak that's a strong fraction of it
  // (the fundamental) rather than a louder subharmonic at a longer lag.
  let peak = 0; for (let lag = minLag; lag <= maxLag; lag++) if (corr[lag] > peak) peak = corr[lag];
  if (peak < 0.3) return 0;
  const thresh = peak * 0.85;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] > thresh && corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
      // parabolic interpolation around the peak for sub-sample accuracy
      const a = corr[lag - 1], b = corr[lag], c = corr[lag + 1];
      const denom = a - 2 * b + c;
      const shift = denom !== 0 ? 0.5 * (a - c) / denom : 0;
      return sr / (lag + shift);
    }
  }
  return 0;
}

// Scale interval tables (semitone offsets from the root). Index = SCALE id.
export const SCALES: { id: number; name: string; degrees: number[] }[] = [
  { id: 0, name: "Major",       degrees: [0, 2, 4, 5, 7, 9, 11] },
  { id: 1, name: "Minor",       degrees: [0, 2, 3, 5, 7, 8, 10] },
  { id: 2, name: "Chromatic",   degrees: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { id: 3, name: "Pentatonic",  degrees: [0, 2, 4, 7, 9] },
  { id: 4, name: "Min Penta",   degrees: [0, 3, 5, 7, 10] },
  { id: 5, name: "Dorian",      degrees: [0, 2, 3, 5, 7, 9, 10] },
  { id: 6, name: "Harmonic Min",degrees: [0, 2, 3, 5, 7, 8, 11] },
  { id: 7, name: "Blues",       degrees: [0, 3, 5, 6, 7, 10] },
];
export const KEY_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Nearest in-scale frequency to f0, given a root pitch class + scale id.
function snapToScale(f0: number, root: number, scaleId: number): number {
  if (f0 <= 0) return f0;
  const degrees = (SCALES[scaleId] ?? SCALES[0]).degrees;
  const midi = 69 + 12 * Math.log2(f0 / 440);
  const pc = ((Math.round(midi) % 12) + 12) % 12;
  const octBase = Math.round(midi) - pc;
  let bestMidi = Math.round(midi), bestDist = Infinity;
  for (let oct = -1; oct <= 1; oct++) {
    for (const deg of degrees) {
      const cand = octBase + oct * 12 + ((root + deg) % 12);
      const d = Math.abs(cand - midi);
      if (d < bestDist) { bestDist = d; bestMidi = cand; }
    }
  }
  return 440 * Math.pow(2, (bestMidi - 69) / 12);
}

// Premium pitch correction across [i0,i1).
//   root     = key root pitch class (0=C..11=B)
//   scaleId  = index into SCALES
//   strength = 0..1 (0 = no correction, 1 = full hard snap)
//   speed    = 0..1 retune SPEED (1 = instant/robotic, lower = gliding/natural).
// Length-preserving windowed resampling (PSOLA-lite), overlap-add of grains.
function applyAutotune(data: Float32Array, sr: number, i0: number, i1: number,
                       root: number, scaleId: number, strength: number, speed: number) {
  const win = Math.floor(sr * 0.05);       // 50ms analysis windows
  if (i1 - i0 < win) return;
  const hop = Math.floor(win / 4);          // 75% overlap = smoother
  const out = new Float32Array(i1 - i0);
  const env = new Float32Array(i1 - i0);
  // Smoothed correction ratio carried across windows for "retune speed".
  let smoothedRatio = 1;
  const smooth = clamp(speed, 0, 1);        // 1 = snap instantly, <1 = glide
  for (let start = i0; start < i1 - win; start += hop) {
    const seg = data.subarray(start, start + win);
    const f0 = detectPitch(seg, sr);
    let targetRatio = 1;
    if (f0 > 0) {
      const snapped = snapToScale(f0, root, scaleId);
      const fullRatio = f0 / snapped;       // resample factor for full correction
      // Apply STRENGTH: interpolate (in log space) between no-shift (1) and full.
      targetRatio = Math.pow(fullRatio, clamp(strength, 0, 1));
      targetRatio = clamp(targetRatio, 0.5, 2);
    }
    // retune-speed smoothing: glide the ratio toward the target
    smoothedRatio = f0 > 0 ? smoothedRatio + (targetRatio - smoothedRatio) * smooth : 1;
    const ratio = f0 > 0 ? smoothedRatio : 1;
    for (let i = 0; i < win; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
      const srcPos = i * ratio;
      const j = Math.floor(srcPos), f = srcPos - j;
      const a = seg[clamp(j, 0, win - 1)], b = seg[clamp(j + 1, 0, win - 1)];
      const sample = (a + (b - a) * f) * w;
      const oi = start - i0 + i;
      if (oi >= 0 && oi < out.length) { out[oi] += sample; env[oi] += w; }
    }
  }
  for (let i = 0; i < out.length; i++) {
    data[i0 + i] = env[i] > 1e-4 ? out[i] / env[i] : data[i0 + i];
  }
}

// ── in-place ops (mutate channel data over [i0,i1)) ─────────────────────────────
function applyInPlace(data: Float32Array, sr: number, op: RegionOp) {
  const i0 = clamp(Math.floor(op.startSec * sr), 0, data.length);
  const i1 = clamp(Math.floor(op.endSec * sr), 0, data.length);
  const n = i1 - i0;
  if (n <= 0) return;
  switch (op.type) {
    case "gain":      for (let i = i0; i < i1; i++) data[i] *= op.amount; break;
    case "silence":   for (let i = i0; i < i1; i++) data[i] = 0; break;
    case "invert":    for (let i = i0; i < i1; i++) data[i] = -data[i]; break;
    case "reverse":   for (let a = i0, b = i1 - 1; a < b; a++, b--) { const t = data[a]; data[a] = data[b]; data[b] = t; } break;
    case "fade-in":   for (let i = i0; i < i1; i++) data[i] *= (i - i0) / n; break;
    case "fade-out":  for (let i = i0; i < i1; i++) data[i] *= 1 - (i - i0) / n; break;
    case "normalize": {
      let peak = 0; for (let i = i0; i < i1; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
      if (peak > 1e-4) { const g = 0.99 / peak; for (let i = i0; i < i1; i++) data[i] *= g; } break;
    }
    case "pitch": case "stretch": case "half-time": case "double-time": {
      const ratio = op.type === "pitch" ? Math.pow(2, op.amount / 12)
        : op.type === "stretch" ? 1 / op.amount
        : op.type === "half-time" ? 0.5 : 2;
      const src = data.slice(i0, i1);
      for (let i = 0; i < n; i++) {
        const p = i * ratio, j = Math.floor(p), f = p - j;
        const a = src[clamp(j, 0, src.length - 1)], b = src[clamp(j + 1, 0, src.length - 1)];
        data[i0 + i] = a + (b - a) * f;
      }
      break;
    }
    case "tremolo": {
      const rate = op.amount; // Hz
      for (let i = i0; i < i1; i++) {
        const t = (i - i0) / sr;
        data[i] *= 0.5 + 0.5 * Math.sin(2 * Math.PI * rate * t);
      }
      break;
    }
    case "autogain": {
      // RMS-normalize the region to a target of ~0.2 RMS
      let sum = 0; for (let i = i0; i < i1; i++) sum += data[i] * data[i];
      const rms = Math.sqrt(sum / n);
      if (rms > 1e-5) { const g = Math.min(8, 0.2 / rms); for (let i = i0; i < i1; i++) data[i] = Math.max(-1, Math.min(1, data[i] * g)); }
      break;
    }
    case "stutter": {
      // chop the region into `amount` equal grains, repeat the FIRST grain across all
      const slices = Math.max(2, Math.round(op.amount));
      const grain = Math.floor(n / slices);
      if (grain > 0) {
        const first = data.slice(i0, i0 + grain);
        for (let s = 0; s < slices; s++) {
          for (let k = 0; k < grain && i0 + s * grain + k < i1; k++) data[i0 + s * grain + k] = first[k];
        }
      }
      break;
    }
    case "tape-stop": {
      // accelerate the read position's slowdown: sample at an ever-decreasing rate
      const src = data.slice(i0, i1);
      let pos = 0, speed = 1;
      for (let i = 0; i < n; i++) {
        const j = Math.floor(pos), f = pos - j;
        const a = src[clamp(j, 0, src.length - 1)], b = src[clamp(j + 1, 0, src.length - 1)];
        data[i0 + i] = (a + (b - a) * f) * (1 - i / n); // also fade to silence
        pos += speed;
        speed *= 0.99985; // gradual slowdown
      }
      break;
    }
    case "pitch-scale": {
      // legacy: snap detected pitch to nearest note in key (major, full strength).
      applyAutotune(data, sr, i0, i1, Math.round(op.amount) % 12, 0, 1, 1);
      break;
    }
    case "autotune": {
      // premium pitch correction with key / scale / strength / speed.
      const p = op.params ?? {};
      const root = Math.round(p.key ?? 0) % 12;
      const scaleId = Math.round(p.scale ?? 0);
      const strength = p.strength ?? 1;
      const speed = p.speed ?? 1;
      applyAutotune(data, sr, i0, i1, root, scaleId, strength, speed);
      break;
    }
    case "compress": {
      // simple downward compressor: above threshold, apply 4:1 then makeup gain
      const thresh = Math.pow(10, op.amount / 20);
      const ratio = 4, makeup = 1.6;
      for (let i = i0; i < i1; i++) {
        const s = data[i], a = Math.abs(s);
        if (a > thresh) {
          const over = a - thresh;
          const comp = thresh + over / ratio;
          data[i] = Math.sign(s) * comp * makeup;
        } else { data[i] = s * makeup; }
        data[i] = Math.max(-1, Math.min(1, data[i]));
      }
      break;
    }
    case "limit": {
      const ceil = Math.pow(10, op.amount / 20);
      for (let i = i0; i < i1; i++) {
        const s = data[i];
        data[i] = Math.max(-ceil, Math.min(ceil, s));
      }
      break;
    }
    case "gate": {
      const thresh = Math.pow(10, op.amount / 20);
      // smooth gate over a small window to avoid clicks
      const win = Math.max(1, Math.floor(sr * 0.005));
      for (let i = i0; i < i1; i++) {
        let peak = 0;
        for (let k = -win; k <= win; k++) { const idx = i + k; if (idx >= i0 && idx < i1) peak = Math.max(peak, Math.abs(data[idx])); }
        if (peak < thresh) data[i] = 0;
      }
      break;
    }
  }
}

// ── structural ops (return a new buffer, possibly different length) ──────────────
function applyStructural(ctx: BaseAudioContext, buf: AudioBuffer, op: RegionOp): AudioBuffer {
  const sr = buf.sampleRate, ch = buf.numberOfChannels;
  const i0 = clamp(Math.floor(op.startSec * sr), 0, buf.length);
  const i1 = clamp(Math.floor(op.endSec * sr), 0, buf.length);
  const rn = i1 - i0;

  if (op.type === "crop") {
    const out = ctx.createBuffer(ch, Math.max(1, rn), sr);
    for (let c = 0; c < ch; c++) out.copyToChannel(buf.getChannelData(c).slice(i0, i1), c);
    return out;
  }
  if (op.type === "delete") {
    const out = ctx.createBuffer(ch, Math.max(1, buf.length - rn), sr);
    for (let c = 0; c < ch; c++) {
      const src = buf.getChannelData(c), dst = out.getChannelData(c);
      dst.set(src.subarray(0, i0), 0);
      dst.set(src.subarray(i1), i0);
    }
    return out;
  }
  if (op.type === "duplicate") {
    const out = ctx.createBuffer(ch, buf.length + rn, sr);
    for (let c = 0; c < ch; c++) {
      const src = buf.getChannelData(c), dst = out.getChannelData(c);
      dst.set(src.subarray(0, i1), 0);                       // up to end of region
      dst.set(src.subarray(i0, i1), i1);                     // the copy
      dst.set(src.subarray(i1), i1 + rn);                    // the rest
    }
    return out;
  }
  if (op.type === "insert-silence") {
    const out = ctx.createBuffer(ch, buf.length + rn, sr);
    for (let c = 0; c < ch; c++) {
      const src = buf.getChannelData(c), dst = out.getChannelData(c);
      dst.set(src.subarray(0, i0), 0);
      // [i0, i0+rn) left as zeros
      dst.set(src.subarray(i0), i0 + rn);
    }
    return out;
  }
  return buf;
}

// ── offline biquad render over a region ─────────────────────────────────────────
// Renders the whole buffer through a filter, then splices ONLY the region back
// in (so the filter only affects the selection).
async function applyOffline(buf: AudioBuffer, op: RegionOp): Promise<AudioBuffer> {
  const sr = buf.sampleRate, ch = buf.numberOfChannels;
  const OAC: typeof OfflineAudioContext =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (!OAC) return buf;
  const oac = new OAC(ch, buf.length, sr);
  const src = oac.createBufferSource();
  src.buffer = buf;

  // build the filter(s) for this op
  const nodes: BiquadFilterNode[] = [];
  const mk = (type: BiquadFilterType, freq: number, q = 1, gain = 0) => {
    const f = oac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.gain.value = gain;
    nodes.push(f); return f;
  };
  switch (op.type) {
    case "lowpass":  mk("lowpass", op.amount, 0.9); break;
    case "highpass": mk("highpass", op.amount, 0.9); break;
    case "bandpass": mk("bandpass", op.amount, 2); break;
    case "eq-low":   mk("lowshelf", 250, 1, op.amount); break;
    case "eq-mid":   mk("peaking", 1000, 1, op.amount); break;
    case "eq-high":  mk("highshelf", 3500, 1, op.amount); break;
    case "deess":    mk("peaking", 6500, 3, -Math.abs(op.amount)); break;
    case "mudcut":   mk("peaking", 300, 1.2, -Math.abs(op.amount)); break;
    case "telephone": mk("highpass", 300, 0.7); mk("lowpass", 3000, 0.7); break;
    default: break;
  }
  // chain: src -> n0 -> n1 -> ... -> destination
  let tail: AudioNode = src;
  for (const n of nodes) { tail.connect(n); tail = n; }
  tail.connect(oac.destination);
  src.start();
  const filtered = await oac.startRendering();

  // splice the filtered region into a copy of the original
  const result = oac.createBuffer(ch, buf.length, sr);
  const i0 = clamp(Math.floor(op.startSec * sr), 0, buf.length);
  const i1 = clamp(Math.floor(op.endSec * sr), 0, buf.length);
  for (let c = 0; c < ch; c++) {
    const orig = buf.getChannelData(c);
    const filt = filtered.getChannelData(c);
    const dst = Float32Array.from(orig);
    for (let i = i0; i < i1; i++) dst[i] = filt[i];
    result.copyToChannel(dst, c);
  }
  return result;
}

export function isOffline(type: RegionOpType): boolean { return !!OP_META[type].offline; }

// Synchronous render for in-place + structural ops only (instant).
export function renderClipBuffer(ctx: BaseAudioContext, original: AudioBuffer, ops: RegionOp[] | undefined): AudioBuffer {
  if (!ops || ops.length === 0) return original;
  let buf = cloneBuffer(ctx, original);
  for (const op of ops) {
    if (OP_META[op.type]?.lengthChanging) {
      buf = applyStructural(ctx, buf, op);
    } else if (OP_META[op.type]?.offline) {
      // offline ops are pre-baked into the chain as a stored result; skip here.
      // (handled by renderClipBufferAsync). For sync path, ignore.
    } else {
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const data = buf.getChannelData(c);
        applyInPlace(data, buf.sampleRate, op);
      }
    }
  }
  return buf;
}

// Async render that also applies offline (filter) ops. Used after adding an EQ op.
export async function renderClipBufferAsync(ctx: BaseAudioContext, original: AudioBuffer, ops: RegionOp[] | undefined): Promise<AudioBuffer> {
  if (!ops || ops.length === 0) return original;
  let buf = cloneBuffer(ctx, original);
  for (const op of ops) {
    if (OP_META[op.type]?.lengthChanging) {
      buf = applyStructural(ctx, buf, op);
    } else if (OP_META[op.type]?.offline) {
      buf = await applyOffline(buf, op);
    } else {
      for (let c = 0; c < buf.numberOfChannels; c++) {
        applyInPlace(buf.getChannelData(c), buf.sampleRate, op);
      }
    }
  }
  return buf;
}

function cloneBuffer(ctx: BaseAudioContext, src: AudioBuffer): AudioBuffer {
  const out = ctx.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
  for (let c = 0; c < src.numberOfChannels; c++) out.copyToChannel(Float32Array.from(src.getChannelData(c)), c);
  return out;
}

export function peaksFromBuffer(audio: AudioBuffer, targetSamples: number): Float32Array {
  const raw = audio.getChannelData(0);
  const blockSize = Math.max(1, Math.floor(raw.length / targetSamples));
  const peaks = new Float32Array(targetSamples);
  for (let i = 0; i < targetSamples; i++) {
    let max = 0; const start = i * blockSize;
    for (let j = 0; j < blockSize && start + j < raw.length; j++) {
      const v = Math.abs(raw[start + j]); if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

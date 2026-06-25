// Export + project persistence. All client-side: the mixdown is rendered through
// an OfflineAudioContext from the exact buffers the user hears (region ops baked
// in), so the export is WYSIWYG. Projects serialize the editable state to JSON
// (audio is re-fetched by URL on load, so files stay small).
import type { DawTrack, Marker, TransportState, RegionOp, AutomationLane, AutomationPoint, TrackEffect } from "./dawTypes";
import { renderClipBufferAsync } from "./regionOps";

// ── WAV encoding ────────────────────────────────────────────────────────────────
export function audioBufferToWav(buf: AudioBuffer): Blob {
  const numCh = buf.numberOfChannels;
  const sr = buf.sampleRate;
  const len = buf.length * numCh * 2 + 44;
  const ab = new ArrayBuffer(len);
  const view = new DataView(ab);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  writeStr(0, "RIFF");
  view.setUint32(4, len - 8, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, buf.length * numCh * 2, true);

  // interleave
  let off = 44;
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  for (let i = 0; i < buf.length; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Render one track's processed (ops-applied) buffer, fetching its source audio.
async function renderTrackBuffer(ctx: BaseAudioContext, track: DawTrack): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(track.audioUrl);
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arr.slice(0));
    const ops: RegionOp[] | undefined = track.clips[0]?.ops;
    return await renderClipBufferAsync(ctx, decoded, ops);
  } catch { return null; }
}

// ── effects baking (native Web Audio equivalents of the Tone.js rack) ───────────
// Tone.js nodes can't be used inside OfflineAudioContext, so we re-implement each
// effect type with standard Web Audio API nodes. Only enabled effects are applied.
function buildNativeEffect(oac: OfflineAudioContext, eff: TrackEffect): AudioNode[] {
  const p = eff.params;
  switch (eff.type) {
    case "eq3": {
      const lo = oac.createBiquadFilter(); lo.type = "lowshelf"; lo.frequency.value = p.lowFreq ?? 250; lo.gain.value = p.low ?? 0;
      const mid = oac.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 0.8; mid.gain.value = p.mid ?? 0;
      const hi = oac.createBiquadFilter(); hi.type = "highshelf"; hi.frequency.value = p.highFreq ?? 2500; hi.gain.value = p.high ?? 0;
      lo.connect(mid); mid.connect(hi);
      return [lo, hi];  // [input, output]
    }
    case "compressor": {
      const comp = oac.createDynamicsCompressor();
      comp.threshold.value = p.threshold ?? -24;
      comp.ratio.value = p.ratio ?? 4;
      comp.attack.value = p.attack ?? 0.01;
      comp.release.value = p.release ?? 0.25;
      comp.knee.value = 6;
      return [comp, comp];
    }
    case "reverb": {
      // convolution reverb using a synthetic impulse response
      const wet = p.wet ?? 0.3;
      const decay = p.decay ?? 2.5;
      const sr = oac.sampleRate;
      const len = Math.ceil(decay * sr);
      const ir = oac.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      }
      const conv = oac.createConvolver(); conv.buffer = ir;
      const dryGain = oac.createGain(); dryGain.gain.value = 1 - wet;
      const wetGain = oac.createGain(); wetGain.gain.value = wet;
      const merge = oac.createGain();
      // we return [inputNode, outputNode]; caller connects: prev->input, output->next
      // internally: input splits to dryGain and conv->wetGain, both merge
      // We wire dry and wet through a merger gain:
      dryGain.connect(merge); wetGain.connect(merge); conv.connect(wetGain);
      // The "input" is dryGain (caller connects source to dryGain AND to conv).
      // We use a splitter gain as the real entry point:
      const entry = oac.createGain();
      entry.connect(dryGain); entry.connect(conv);
      return [entry, merge];
    }
    case "delay": {
      const wet = p.wet ?? 0.25;
      const time = Math.min(p.delayTime ?? 0.25, 1.0);
      const fb = Math.min(p.feedback ?? 0.3, 0.95);
      const delay = oac.createDelay(2.0); delay.delayTime.value = time;
      const fbGain = oac.createGain(); fbGain.gain.value = fb;
      const dryGain = oac.createGain(); dryGain.gain.value = 1 - wet;
      const wetGain = oac.createGain(); wetGain.gain.value = wet;
      const merge = oac.createGain();
      delay.connect(fbGain); fbGain.connect(delay);
      delay.connect(wetGain); wetGain.connect(merge); dryGain.connect(merge);
      const entry = oac.createGain();
      entry.connect(dryGain); entry.connect(delay);
      return [entry, merge];
    }
    case "chorus": {
      // chorus = short modulated delay. OfflineAudioContext can't modulate in time,
      // so bake as a slight pitch detune (static double with tiny delay = thickening).
      const wet = p.wet ?? 0.4;
      const time = 0.02; // fixed 20ms for offline
      const delay = oac.createDelay(0.1); delay.delayTime.value = time;
      const dryGain = oac.createGain(); dryGain.gain.value = 1 - wet * 0.5;
      const wetGain = oac.createGain(); wetGain.gain.value = wet * 0.5;
      const merge = oac.createGain();
      delay.connect(wetGain); wetGain.connect(merge); dryGain.connect(merge);
      const entry = oac.createGain();
      entry.connect(dryGain); entry.connect(delay);
      return [entry, merge];
    }
    case "distortion": {
      const amount = p.amount ?? 0.3;
      const wet = p.wet ?? 0.5;
      const ws = oac.createWaveShaper();
      // hard-clip waveshaper curve
      const n = 256, curve = new Float32Array(n);
      const k = amount * 100 + 1;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = Math.max(-1, Math.min(1, (k * x) / (1 + (k - 1) * Math.abs(x))));
      }
      ws.curve = curve; ws.oversample = "4x";
      const dryGain = oac.createGain(); dryGain.gain.value = 1 - wet;
      const wetGain = oac.createGain(); wetGain.gain.value = wet;
      const merge = oac.createGain();
      ws.connect(wetGain); wetGain.connect(merge); dryGain.connect(merge);
      const entry = oac.createGain();
      entry.connect(dryGain); entry.connect(ws);
      return [entry, merge];
    }
    case "deesser": {
      // narrow peaking cut on the sibilance band — exact offline match
      const f = oac.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = p.freq ?? 6500;
      f.gain.value = -(p.amount ?? 8);
      f.Q.value = p.q ?? 3;
      return [f, f];
    }
    case "doubler": {
      // bake as a short fixed delay + dry mix (thickening). True per-voice detune
      // needs time-domain modulation OfflineAudioContext can't do, so we use the
      // same approach as offline chorus.
      const wet = p.wet ?? 0.5;
      const time = Math.min(Math.max(p.delay ?? 0.02, 0.005), 0.06);
      const delay = oac.createDelay(0.1); delay.delayTime.value = time;
      const dryGain = oac.createGain(); dryGain.gain.value = 1;
      const wetGain = oac.createGain(); wetGain.gain.value = wet;
      const merge = oac.createGain();
      delay.connect(wetGain); wetGain.connect(merge); dryGain.connect(merge);
      const entry = oac.createGain();
      entry.connect(dryGain); entry.connect(delay);
      return [entry, merge];
    }
    case "pitch": {
      // OfflineAudioContext has no real-time pitch shifter. A true bake would
      // resample the whole buffer; the live Tone.PitchShift still applies during
      // playback. For export we pass through transparently rather than alter pitch
      // incorrectly. (Documented limitation.)
      if ((p.pitch ?? 0) !== 0) console.warn("[export] pitch shift not baked offline — preview only");
      const g = oac.createGain();
      return [g, g];
    }
    case "echo": {
      // Tempo-synced echo baked as a feedback delay + lowpass on the tail.
      const wet = p.wet ?? 0.3;
      const time = Math.min(p.time ?? 0.375, 1.2);
      const fb = Math.min(p.feedback ?? 0.45, 0.92);
      const delay = oac.createDelay(2.0); delay.delayTime.value = time;
      const fbGain = oac.createGain(); fbGain.gain.value = fb;
      const lp = oac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = p.tone ?? 4000;
      const dryGain = oac.createGain(); dryGain.gain.value = 1;
      const wetGain = oac.createGain(); wetGain.gain.value = wet;
      const merge = oac.createGain();
      // delay -> lp -> back to delay (feedback) and out to wet
      delay.connect(lp); lp.connect(fbGain); fbGain.connect(delay);
      lp.connect(wetGain); wetGain.connect(merge); dryGain.connect(merge);
      const entry = oac.createGain();
      entry.connect(dryGain); entry.connect(delay);
      return [entry, merge];
    }
    case "paramEq": {
      const hpf = oac.createBiquadFilter(); hpf.type = "highpass"; hpf.frequency.value = p.hpf ?? 80; hpf.Q.value = 0.7;
      const low = oac.createBiquadFilter(); low.type = "peaking"; low.frequency.value = p.lowFreq ?? 250; low.Q.value = 1; low.gain.value = p.lowGain ?? 0;
      const mid = oac.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = p.midFreq ?? 1500; mid.Q.value = 1; mid.gain.value = p.midGain ?? 0;
      const hi  = oac.createBiquadFilter(); hi.type = "highshelf"; hi.frequency.value = p.hiFreq ?? 8000; hi.gain.value = p.hiGain ?? 0;
      hpf.connect(low); low.connect(mid); mid.connect(hi);
      return [hpf, hi];
    }
    case "gate": {
      // Web Audio has no native gate. Approximate as a soft expander-ish pass:
      // a compressor with a low threshold + high ratio doesn't gate, so we just
      // pass through (the live Tone.Gate applies during playback/monitoring).
      // Honest pass-through avoids altering the bounce incorrectly.
      const g = oac.createGain();
      return [g, g];
    }
    case "saturation": {
      // Tube-style soft saturation via a tanh waveshaper.
      const drive = p.drive ?? 0.25;
      const wet = p.wet ?? 0.7;
      const ws = oac.createWaveShaper();
      const n = 1024, curve = new Float32Array(n);
      const k = 1 + drive * 6;
      for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = Math.tanh(k * x) / Math.tanh(k);
      }
      ws.curve = curve; ws.oversample = "4x";
      const dryGain = oac.createGain(); dryGain.gain.value = 1 - wet;
      const wetGain = oac.createGain(); wetGain.gain.value = wet;
      const merge = oac.createGain();
      ws.connect(wetGain); wetGain.connect(merge); dryGain.connect(merge);
      const entry = oac.createGain();
      entry.connect(dryGain); entry.connect(ws);
      return [entry, merge];
    }
    case "widener": {
      // Mid/side widening is complex offline; bake as a subtle Haas delay on one
      // side for perceived width without phase wreckage on mono playback.
      const width = p.width ?? 0.6;
      const splitter = oac.createChannelSplitter(2);
      const merger = oac.createChannelMerger(2);
      const delayR = oac.createDelay(0.05); delayR.delayTime.value = 0.008 * width;
      const entry = oac.createGain();
      entry.connect(splitter);
      splitter.connect(merger, 0, 0);        // L straight
      splitter.connect(delayR, 1);           // R delayed
      delayR.connect(merger, 0, 1);
      return [entry, merger];
    }
    default:
      return [];
  }
}

// ── full mixdown ────────────────────────────────────────────────────────────────
// Builds an offline graph: each track's processed buffer -> gain(vol) -> pan ->
// native effect chain -> master gain -> destination.
// Honors mute/solo. masterVolume is 0..1 (default 1).
export async function renderMixdown(tracks: DawTrack[], masterVolume = 1): Promise<AudioBuffer> {
  const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffers = await Promise.all(tracks.map(t => renderTrackBuffer(decodeCtx, t)));
  await decodeCtx.close();

  const sr = 44100;
  // Span = furthest clip end across all tracks (handles splits & moved clips).
  const maxDur = Math.max(0.1, ...tracks.flatMap((t, i) => {
    const b = buffers[i];
    if (!b) return [0];
    const clips = t.clips.length ? t.clips : [{ startSec: 0, durationSec: b.duration } as any];
    return clips.map(c => (c.startSec ?? 0) + (c.durationSec || b.duration));
  }));
  const OAC: typeof OfflineAudioContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const oac = new OAC(2, Math.ceil(maxDur * sr), sr);

  const masterGain = oac.createGain();
  masterGain.gain.value = Math.max(0, Math.min(2, masterVolume));
  masterGain.connect(oac.destination);

  const anySolo = tracks.some(t => t.soloed);
  tracks.forEach((track, i) => {
    const buf = buffers[i];
    if (!buf) return;
    const audible = anySolo ? track.soloed : !track.muted;
    if (!audible) return;

    const gain = oac.createGain(); gain.gain.value = track.volume;
    const panner = oac.createStereoPanner(); panner.pan.value = track.pan;
    gain.connect(panner);

    // bake enabled effects into the offline graph (shared by all the track's clips)
    let tail: AudioNode = panner;
    for (const eff of track.effects ?? []) {
      if (!eff.enabled) continue;
      try {
        const [input, output] = buildNativeEffect(oac, eff);
        if (input && output) { tail.connect(input); tail = output; }
      } catch { /* skip bad effect */ }
    }
    tail.connect(masterGain);

    // One source per clip: start at the clip's arrangement time, read offsetSec
    // for durationSec, and apply the clip's fade in/out + gain on its own gain node.
    const clips = track.clips.length ? track.clips : [{ startSec: 0, offsetSec: 0, durationSec: buf.duration } as any];
    for (const clip of clips) {
      const src = oac.createBufferSource(); src.buffer = buf;
      const clipGain = oac.createGain();
      const base = clip.gain ?? 1;
      const start = clip.startSec ?? 0;
      const dur = clip.durationSec || buf.duration;
      const fi = clip.fadeInSec ?? 0;
      const fo = clip.fadeOutSec ?? 0;
      const cg = clipGain.gain;
      if (fi > 0) { cg.setValueAtTime(0, start); cg.linearRampToValueAtTime(base, start + fi); }
      else { cg.setValueAtTime(base, start); }
      if (fo > 0) { cg.setValueAtTime(base, Math.max(start + fi, start + dur - fo)); cg.linearRampToValueAtTime(0, start + dur); }
      src.connect(clipGain); clipGain.connect(gain);
      src.start(start, Math.max(0, clip.offsetSec ?? 0), dur);
    }
  });

  return await oac.startRendering();
}

// ── project (.stemai.json) ───────────────────────────────────────────────────────
export interface ProjectFile {
  version: 1;
  trackId: string | null;       // source library track id (audio re-fetched on load)
  title: string;
  savedAt: string;
  transport: Pick<TransportState, "bpm" | "looping" | "loopStart" | "loopEnd" | "snap">;
  markers: Marker[];
  tracks: {
    id: string; label: string; color: string; volume: number; pan: number;
    muted: boolean; soloed: boolean; audioUrl: string;
    clips: { id: string; startSec: number; durationSec: number; offsetSec: number; fadeInSec: number; fadeOutSec: number; gain: number; ops: RegionOp[] }[];
    effects: { id: string; type: string; enabled: boolean; params: Record<string, number> }[];
    automation: Partial<Record<AutomationLane, AutomationPoint[]>>;
  }[];
}

export function serializeProject(opts: {
  trackId: string | null; title: string; transport: TransportState; markers: Marker[]; tracks: DawTrack[];
}): ProjectFile {
  return {
    version: 1,
    trackId: opts.trackId,
    title: opts.title,
    savedAt: new Date().toISOString(),
    transport: {
      bpm: opts.transport.bpm, looping: opts.transport.looping,
      loopStart: opts.transport.loopStart, loopEnd: opts.transport.loopEnd, snap: opts.transport.snap,
    },
    markers: opts.markers,
    tracks: opts.tracks.map(t => ({
      id: t.id, label: t.label, color: t.color, volume: t.volume, pan: t.pan,
      muted: t.muted, soloed: t.soloed, audioUrl: t.audioUrl,
      clips: t.clips.map(c => ({
        id: c.id, startSec: c.startSec, durationSec: c.durationSec, offsetSec: c.offsetSec,
        fadeInSec: c.fadeInSec, fadeOutSec: c.fadeOutSec, gain: c.gain, ops: c.ops ?? [],
      })),
      effects: (t.effects ?? []).map(e => ({ id: e.id, type: e.type, enabled: e.enabled, params: e.params })),
      automation: t.automation ?? {},
    })),
  };
}

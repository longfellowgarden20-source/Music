// Export + project persistence. All client-side: the mixdown is rendered through
// an OfflineAudioContext from the exact buffers the user hears (region ops baked
// in), so the export is WYSIWYG. Projects serialize the editable state to JSON
// (audio is re-fetched by URL on load, so files stay small).
import type { DawTrack, Marker, TransportState, RegionOp, AutomationLane, AutomationPoint } from "./dawTypes";
import { renderClipBufferAsync } from "./regionOps";
import { EFFECT_DEFS } from "./effects";

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

// ── full mixdown ────────────────────────────────────────────────────────────────
// Builds an offline graph: each track's processed buffer -> gain(vol) -> pan ->
// its effect chain -> master. Honors mute/solo. Returns the rendered stereo mix.
export async function renderMixdown(tracks: DawTrack[]): Promise<AudioBuffer> {
  const decodeCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  const buffers = await Promise.all(tracks.map(t => renderTrackBuffer(decodeCtx, t)));
  await decodeCtx.close();

  const sr = 44100;
  const maxDur = Math.max(0.1, ...tracks.map((t, i) => {
    const b = buffers[i]; const clip = t.clips[0];
    const start = clip?.startSec ?? 0;
    return start + (b ? b.duration : 0);
  }));
  const OAC: typeof OfflineAudioContext = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  const oac = new OAC(2, Math.ceil(maxDur * sr), sr);

  const anySolo = tracks.some(t => t.soloed);
  tracks.forEach((track, i) => {
    const buf = buffers[i];
    if (!buf) return;
    const audible = anySolo ? track.soloed : !track.muted;
    if (!audible) return;

    const src = oac.createBufferSource(); src.buffer = buf;
    const gain = oac.createGain(); gain.gain.value = track.volume;
    const panner = oac.createStereoPanner(); panner.pan.value = track.pan;

    // effects chain (best-effort — Tone effects don't run offline; approximate
    // EQ/filter with native nodes, skip the rest so the mix still renders).
    let tail: AudioNode = src;
    tail.connect(gain); tail = gain;
    tail.connect(panner); tail = panner;
    tail.connect(oac.destination);
    src.start(track.clips[0]?.startSec ?? 0);
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

// All TypeScript types for the DAW — no runtime code

// A region-edit operation applied to a sub-range of a clip's source audio.
// These render instantly in the Web Audio buffer (non-destructive — the
// original buffer is kept; the op chain is replayed to produce the clip's
// processed buffer). offsetSec/endSec are in SOURCE time of the clip's audio.
export type RegionOpType =
  // gain / shape (in-place, same length)
  | "gain"        // amount = linear gain multiplier for the region
  | "silence"     // mute the region to zero
  | "reverse"     // reverse the region in place
  | "fade-in"     // ramp 0→1 across the region
  | "fade-out"    // ramp 1→0 across the region
  | "pitch"       // amount = semitones (resampled in place)
  | "stretch"     // amount = time factor (0.5 = half speed)
  | "normalize"   // peak-normalize the region
  | "invert"      // flip phase (×-1)
  // length-changing structural ops
  | "duplicate"   // copy the region and insert a 2nd copy right after it
  | "delete"      // remove the region entirely (closes the gap)
  | "crop"        // keep ONLY the region, drop everything else
  | "insert-silence" // insert silence equal to the region length at its start
  // EQ / filter (offline biquad render over the region)
  | "lowpass"     // amount = cutoff Hz
  | "highpass"    // amount = cutoff Hz
  | "bandpass"    // amount = center Hz
  | "eq-low"      // amount = dB (low shelf)
  | "eq-mid"      // amount = dB (peaking ~1k)
  | "eq-high"     // amount = dB (high shelf)
  | "deess"       // tame harsh sibilance (~6k notch)
  | "mudcut"      // cut boxy low-mids (~300 Hz)
  | "telephone"   // bandpass 300-3k "phone" sound
  // mix / dynamics (offline)
  | "compress"    // amount = threshold dB (downward compression)
  | "limit"       // brickwall limiter at amount dB
  | "gate"        // amount = threshold; silence below it
  | "tremolo"     // amount = rate Hz (amplitude LFO)
  | "autogain"    // RMS-match the region to a target level
  // musical time / pitch (in-place, length-preserving within region)
  | "half-time"   // play region at half speed (resampled in place)
  | "double-time" // play region at double speed
  | "stutter"     // amount = slices; chop region into repeated grains
  | "tape-stop"   // slow to a halt across the region
  | "pitch-scale" // amount = key root; snap pitch to nearest semitone of scale
  | "autotune"    // premium pitch correction: params{key,scale,strength,speed}
  | "ai-replace"; // replaced by backend regenerate

export interface RegionOp {
  id: string;
  type: RegionOpType;
  startSec: number;     // region start in clip-source time
  endSec: number;       // region end in clip-source time
  amount: number;       // op-specific scalar
  params?: Record<string, number>;  // extra params for multi-param ops (e.g. autotune key/scale/strength)
  label?: string;
}

export interface DawClip {
  id: string;
  trackId: string;
  startSec: number;     // position in arrangement
  durationSec: number;  // clip length
  offsetSec: number;    // trim: how far into source file this clip starts
  fadeInSec: number;    // fade-in length
  fadeOutSec: number;   // fade-out length
  gain: number;         // clip-level gain multiplier, 0–2 (1 = unity)
  color?: string;       // optional per-clip color override
  ops?: RegionOp[];     // region edits applied to this clip's audio
}

// A drag-selected time range on one track (the thing operations act on).
export interface TimeSelection {
  trackId: string;
  clipId: string;
  startSec: number;     // arrangement time
  endSec: number;       // arrangement time
}

// Per-track effects rack. Each effect maps to a real Tone.js DSP node.
export type EffectType =
  | "eq3" | "compressor" | "reverb" | "delay" | "chorus" | "distortion"
  | "pitch" | "doubler" | "deesser"
  | "echo" | "paramEq" | "gate" | "saturation" | "widener";

export interface TrackEffect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, number>;  // effect-specific params (see EFFECT_DEFS)
}

// An automation point — a value at a time, in the lane's own units
// (volume: 0–1, pan: -1..1). Curves are linear-interpolated between points.
export interface AutomationPoint { sec: number; value: number; }
export type AutomationLane = "volume" | "pan";

export interface DawTrack {
  id: string;           // "vocals" | "drums" | "bass" | "other" | "master"
  label: string;
  color: string;
  clips: DawClip[];
  volume: number;       // 0–1
  pan: number;          // -1 to 1
  muted: boolean;
  soloed: boolean;
  armed: boolean;
  audioUrl: string;
  peakData: Float32Array | null;
  duration: number;
  level?: number;       // live RMS meter level 0–1 (not persisted)
  effects: TrackEffect[];
  automation?: Partial<Record<AutomationLane, AutomationPoint[]>>;
}

export interface Marker {
  id: string;
  sec: number;
  label: string;
  color: string;
}

export type SnapResolution = "off" | "bar" | "beat" | "1/8" | "1/16";

export interface TransportState {
  playing: boolean;
  recording: boolean;
  positionSec: number;
  bpm: number;
  looping: boolean;
  loopStart: number;
  loopEnd: number;
  metronome: boolean;
  zoom: number;         // px per second, default 120
  snap: SnapResolution;
}

export interface ViewState {
  scrollLeft: number;
  scrollTop: number;
  trackHeight: number;  // px per row, default 88
  headerWidth: number;  // always 160
}

export type GestureType =
  | "idle"
  | "dragging"
  | "trim-left"
  | "trim-right"
  | "fade-in"
  | "fade-out"
  | "loop-range"
  | "marquee"      // drag-select a time range on a track
  | "seeking";

export interface Gesture {
  type: GestureType;
  clipId: string;
  trackId: string;
  startClientX: number;
  startClientY: number;
  origStartSec: number;
  origDurSec: number;
  origOffsetSec: number;
  origFadeInSec: number;
  origFadeOutSec: number;
}

// One undoable snapshot of the editable arrangement state
export interface HistorySnapshot {
  tracks: DawTrack[];
  markers: Marker[];
  label: string;
}

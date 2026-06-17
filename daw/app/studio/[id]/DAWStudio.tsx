"use client";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";

const API = "http://localhost:8765";

// ── Types ─────────────────────────────────────────────────────────────────────
interface TrackMeta {
  id: number; title: string; prompt: string; duration: number;
  bpm: number | null; key: string | null; model: string; notes: string;
}
interface Clip { id: number; start: number; end: number; dur: number; peak?: number; }
// per-stem live effects rack (WebAudio, non-destructive — applied at playback & mixdown)
interface StemFx {
  eqLow: number;   // dB  -12..+12  (low shelf ~120Hz)
  eqMid: number;   // dB  -12..+12  (peaking ~1kHz)
  eqHigh: number;  // dB  -12..+12  (high shelf ~6kHz)
  comp: number;    // 0..1 compression amount (0 = off)
  reverb: number;  // 0..1 reverb send
  delay: number;   // 0..1 delay send
}
const FX_DEFAULT: StemFx = { eqLow: 0, eqMid: 0, eqHigh: 0, comp: 0, reverb: 0, delay: 0 };
// automation: an ordered list of breakpoints {t (sec), v}. vol v in 0..1, pan v in -1..1.
// empty list → no automation, the static mixer value is used.
interface AutoPoint { t: number; v: number; }
interface StemAuto { vol: AutoPoint[]; pan: AutoPoint[]; }
const AUTO_DEFAULT: StemAuto = { vol: [], pan: [] };
type AutoLane = "vol" | "pan";
const AUTO_LANE_H = 46;
interface StemState {
  name: string; label: string; color: string; colorDim: string;
  peaks: number[]; duration: number;
  clips: Clip[]; clipsLoaded: boolean;
  muted: boolean; solo: boolean; volume: number; pan: number;
  fx: StemFx;
  auto: StemAuto;
  audioBuffer: AudioBuffer | null; loaded: boolean;
  level: number;   // live VU 0..1
}
interface Marker { id: number; time: number; label: string; }
interface Section { id: number; name: string; start: number; end: number; color: string; }

// preset section names → colors (cycled for new sections)
const SECTION_PRESETS = ["Intro", "Verse", "Chorus", "Bridge", "Drop", "Break", "Outro"];
const SECTION_COLORS = ["#22d3ee", "#8b5cff", "#f472b6", "#fbbf24", "#ef4444", "#34d399", "#60a5fa"];
const SECTION_LANE_H = 26;

const STEM_DEFS = [
  { name: "master", label: "MASTER",  color: "#22d3ee", colorDim: "#0e4a55" },
  { name: "drums",  label: "DRUMS",   color: "#ef4444", colorDim: "#4a0e0e" },
  { name: "bass",   label: "BASS",    color: "#22c55e", colorDim: "#0e3a1e" },
  { name: "other",  label: "OTHER",   color: "#8b5cff", colorDim: "#2a1a55" },
  { name: "vocals", label: "VOCALS",  color: "#f472b6", colorDim: "#4a1a35" },
];

const BASE_PX_PER_SEC = 80;
const TRACK_H_DEFAULT  = 88;
const LABEL_W = 168;
const RULER_H = 30;
const MIN_CLIP_W = 2;

// piecewise-linear value of an automation curve at time t. empty → fallback.
function autoValueAt(points: AutoPoint[], t: number, fallback: number): number {
  if (!points.length) return fallback;
  const p = [...points].sort((a, b) => a.t - b.t);
  if (t <= p[0].t) return p[0].v;
  if (t >= p[p.length - 1].t) return p[p.length - 1].v;
  for (let i = 0; i < p.length - 1; i++) {
    if (t >= p[i].t && t <= p[i + 1].t) {
      const span = p[i + 1].t - p[i].t || 1e-9;
      const f = (t - p[i].t) / span;
      return p[i].v + (p[i + 1].v - p[i].v) * f;
    }
  }
  return fallback;
}
// the value range for a lane type
const AUTO_RANGE: Record<AutoLane, { min: number; max: number; mid: number; label: string }> = {
  vol: { min: 0, max: 1, mid: 0.5, label: "Volume" },
  pan: { min: -1, max: 1, mid: 0, label: "Pan" },
};

export default function DAWStudio({ trackId }: { trackId: number }) {
  const [track, setTrack] = useState<TrackMeta | null>(null);
  const [stems, setStems] = useState<StemState[]>([]);
  const [stemsSplit, setStemsSplit] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [splitMsg, setSplitMsg] = useState("");

  // playback
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(1);          // playback speed
  const [masterVol, setMasterVol] = useState(1);
  const [metronome, setMetronome] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const stemNodesRef = useRef<Record<string, { gain: GainNode; pan: StereoPannerNode; analyser: AnalyserNode }>>({});
  // per-stem live effects nodes (rebuilt on each play), keyed by stem name
  const fxNodesRef = useRef<Record<string, {
    eqLow: BiquadFilterNode; eqMid: BiquadFilterNode; eqHigh: BiquadFilterNode;
    comp: DynamicsCompressorNode; dry: GainNode; revSend: GainNode; delSend: GainNode;
  }>>({});
  const limiterRef = useRef<DynamicsCompressorNode | null>(null);
  const reverbBusRef = useRef<{ conv: ConvolverNode; wet: GainNode } | null>(null);
  const delayBusRef = useRef<{ delay: DelayNode; fb: GainNode; wet: GainNode } | null>(null);
  // master limiter + A/B (bypass all fx) toggles
  const [limiterOn, setLimiterOn] = useState(true);
  const [fxBypass, setFxBypass] = useState(false);   // A/B: true = hear the raw mix
  // band-split meters: when stems aren't split, tap the master into per-lane
  // frequency bands so each lane's VU still reacts during playback.
  const bandAnalysersRef = useRef<Record<string, AnalyserNode>>({});
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const metroRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const offsetRef = useRef(0);
  const rafRef = useRef<number>(0);

  // view
  const [zoom, setZoom] = useState(1);
  const [laneH, setLaneH] = useState(TRACK_H_DEFAULT);
  const [showGrid, setShowGrid] = useState(true);
  const [snap, setSnap] = useState(true);
  const [useBars, setUseBars] = useState(false);
  const [followPlayhead, setFollowPlayhead] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  // automation: which curve (if any) is shown/editable under each lane
  const [autoLane, setAutoLane] = useState<AutoLane | null>(null);

  // loop region
  const [loopOn, setLoopOn] = useState(false);
  const [loopA, setLoopA] = useState(0);
  const [loopB, setLoopB] = useState(0);

  // selection / clips
  const [selectedClip, setSelectedClip] = useState<{ stem: string; clip: Clip } | null>(null);
  const [soloClipLoop, setSoloClipLoop] = useState(false);
  // multi-select: which stem + set of selected clip ids
  const [selStem, setSelStem] = useState<string | null>(null);
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  // drag-box rubber-band: {stem, x0, x1} in px within the lane
  const [dragBox, setDragBox] = useState<{ stem: string; x0: number; x1: number } | null>(null);
  // production panel + the 5-layer strip-down for the current selection
  const [prodOpen, setProdOpen] = useState(false);
  const [layers, setLayers] = useState<{ name: string; lo: number; hi: number; color: string;
    energy: number; level: number; env: number[] }[]>([]);
  const [layersLoading, setLayersLoading] = useState(false);
  const [harmonics, setHarmonics] = useState<{ fundamental: { freq: number; note: string } | null;
    harmonics: { n: number; freq: number; note: string; strength: number }[] }>({ fundamental: null, harmonics: [] });

  // markers
  const [markers, setMarkers] = useState<Marker[]>([]);

  // song-structure sections (drawn on a lane above the stems)
  const [sections, setSections] = useState<Section[]>([]);
  const [activeSection, setActiveSection] = useState<number | null>(null);
  // drag state for moving/resizing a section block on the lane
  const sectionDragRef = useRef<{ id: number; mode: "move" | "l" | "r"; x0: number; s0: number; e0: number } | null>(null);

  // project state: loaded once, then auto-saved on change
  const projectLoadedRef = useRef(false);
  const [exporting, setExporting] = useState(false);

  // notes + ui
  const [notes, setNotes] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [bottomTab, setBottomTab] = useState<"mixer" | "edit" | "song" | "clip" | "notes" | "info">("mixer");
  const [statusMsg, setStatusMsg] = useState("");

  // context menu
  const [ctxMenu, setCtxMenu] = useState<{ clip: Clip; stem: string; x: number; y: number } | null>(null);
  const closeCtx = () => setCtxMenu(null);

  // ── non-destructive edit history (backend-persisted) ─────────────────────────
  interface EditOp { op: string; stem: string; start?: number; end?: number; at?: number;
    db?: number; shape?: string; from_db?: number; to_db?: number; dur?: number; }
  const [editHist, setEditHist] = useState<{ ops: EditOp[]; head: number; can_undo: boolean; can_redo: boolean }>(
    { ops: [], head: 0, can_undo: false, can_redo: false });
  const [clipboard, setClipboard] = useState<{ stem: string; start: number; end: number } | null>(null);
  const [rendering, setRendering] = useState(false);
  const [splitMode, setSplitMode] = useState(false);   // Layer 4: clip scissors mode
  const splitAtPlayheadRef = useRef<(() => void) | null>(null);
  // generative (AI) stem editing
  const [aiBusy, setAiBusy] = useState<string>("");   // "" idle, else the action label

  const bpm = track?.bpm || 120;
  const secPerBeat = 60 / bpm;
  const pxPerSec = BASE_PX_PER_SEC * zoom;
  const totalPx = duration * pxPerSec;

  // ── data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/track/${trackId}`).then(r => r.json()).then((t: TrackMeta) => {
      setTrack(t); setDuration(t.duration); setNotes(t.notes || "");
      setLoopB(t.duration);
    });
  }, [trackId]);

  useEffect(() => {
    if (!track) return;
    setStems(STEM_DEFS.map(d => ({
      ...d, peaks: [], duration: track.duration, clips: [], clipsLoaded: false,
      muted: false, solo: false, volume: 1, pan: 0, fx: { ...FX_DEFAULT }, auto: { vol: [], pan: [] },
      audioBuffer: null, loaded: false, level: 0,
    })));
    fetch(`${API}/api/waveform/${trackId}?points=2600`).then(r => r.json()).then(data => {
      setStems(prev => prev.map(s => s.name === "master"
        ? { ...s, peaks: data.peaks, duration: data.duration } : s));
    }).catch(() => {});
    fetch(`${API}/api/transients/${trackId}/master`).then(r => r.json()).then(data => {
      setStems(prev => prev.map(s => s.name === "master"
        ? { ...s, clips: data.clips, clipsLoaded: true } : s));
    }).catch(() => {});
    fetch(`${API}/api/stems/${trackId}`).then(r => r.json()).then(data => {
      if (data.separated) { setStemsSplit(true); loadStems(); }
    }).catch(() => {});
    loadBuffer("master");
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadStems = useCallback(() => {
    ["drums", "bass", "other", "vocals"].forEach(name => {
      fetch(`${API}/api/waveform-stem/${trackId}/${name}?points=2600`).then(r => r.json())
        .then(data => setStems(prev => prev.map(s => s.name === name
          ? { ...s, peaks: data.peaks, duration: data.duration } : s))).catch(() => {});
      fetch(`${API}/api/transients/${trackId}/${name}`).then(r => r.json())
        .then(data => setStems(prev => prev.map(s => s.name === name
          ? { ...s, clips: data.clips, clipsLoaded: true } : s))).catch(() => {});
      loadBuffer(name);
    });
  }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

  // build a short synthetic impulse response for the reverb convolver
  const makeImpulse = (ctx: AudioContext, seconds = 2.2, decay = 2.5) => {
    const rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  };

  const ensureCtx = () => {
    if (!audioCtxRef.current) {
      const ctx = new AudioContext();
      const mg = ctx.createGain();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      // master limiter — a fast brick-wall-ish compressor that catches peaks
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20;
      lim.attack.value = 0.002; lim.release.value = 0.15;
      // shared reverb + delay send buses (stems send into these, they sum into master)
      const conv = ctx.createConvolver(); conv.buffer = makeImpulse(ctx);
      const revWet = ctx.createGain(); revWet.gain.value = 1;
      conv.connect(revWet); revWet.connect(mg);
      const delay = ctx.createDelay(1.5); delay.delayTime.value = 0.33;
      const fb = ctx.createGain(); fb.gain.value = 0.35;
      const delWet = ctx.createGain(); delWet.gain.value = 1;
      delay.connect(fb); fb.connect(delay); delay.connect(delWet); delWet.connect(mg);

      // master chain: mg → analyser → (limiter) → destination
      mg.connect(an);
      an.connect(lim); lim.connect(ctx.destination);
      audioCtxRef.current = ctx; masterGainRef.current = mg; analyserRef.current = an;
      limiterRef.current = lim;
      reverbBusRef.current = { conv, wet: revWet };
      delayBusRef.current = { delay, fb, wet: delWet };
    }
    return audioCtxRef.current;
  };

  // toggle the limiter in/out of the master chain live
  useEffect(() => {
    const an = analyserRef.current, lim = limiterRef.current, ctx = audioCtxRef.current;
    if (!an || !lim || !ctx) return;
    try { an.disconnect(); } catch {}
    if (limiterOn) { an.connect(lim); lim.connect(ctx.destination); }
    else { try { lim.disconnect(); } catch {} an.connect(ctx.destination); }
  }, [limiterOn]);

  const loadBuffer = useCallback(async (name: string) => {
    const url = name === "master" ? `${API}/api/audio/${trackId}` : `${API}/api/stem-audio/${trackId}/${name}`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const buf = await res.arrayBuffer();
      const ctx = ensureCtx();
      const decoded = await ctx.decodeAudioData(buf);
      setStems(prev => prev.map(s => s.name === name ? { ...s, audioBuffer: decoded, loaded: true } : s));
    } catch {}
  }, [trackId]);

  useEffect(() => { if (masterGainRef.current) masterGainRef.current.gain.value = masterVol; }, [masterVol]);

  // ── split ─────────────────────────────────────────────────────────────────
  const handleSplit = async () => {
    setSplitting(true); setSplitMsg("Splitting stems — 2–3 min on CPU…");
    try {
      const r = await fetch(`${API}/api/stems/${trackId}/split`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      setStemsSplit(true); setSplitMsg("✅ Split done!"); loadStems();
    } catch (e) { setSplitMsg(`❌ ${(e as Error).message}`); }
    finally { setSplitting(false); }
  };

  // ── playback engine ─────────────────────────────────────────────────────────
  // map a stem's fx values onto its live WebAudio nodes (used by play() + the live update effect)
  const applyFxToNodes = useCallback((name: string, fx: StemFx) => {
    const n = fxNodesRef.current[name];
    if (!n) return;
    n.eqLow.gain.value = fx.eqLow;
    n.eqMid.gain.value = fx.eqMid;
    n.eqHigh.gain.value = fx.eqHigh;
    // compression: amount 0..1 → threshold 0..-40dB, ratio 1..12
    n.comp.threshold.value = -40 * fx.comp;
    n.comp.ratio.value = 1 + fx.comp * 11;
    n.comp.knee.value = 24;
    n.revSend.gain.value = fx.reverb;
    n.delSend.gain.value = fx.delay;
  }, []);

  // schedule an automation curve onto an AudioParam, mapping envelope-time → ctx-time.
  // `from` is the playback start (sec), `rate` the playback speed, `base` the static
  // value to hold before/after the curve (and when the curve is empty).
  const scheduleAuto = useCallback((param: AudioParam, points: AutoPoint[],
      ctx: AudioContext, from: number, playRate: number, base: number) => {
    param.cancelScheduledValues(ctx.currentTime);
    if (!points.length) { param.setValueAtTime(base, ctx.currentTime); return; }
    const p = [...points].sort((a, b) => a.t - b.t);
    // value right now (at `from`)
    param.setValueAtTime(autoValueAt(p, from, base), ctx.currentTime);
    // ramp through every breakpoint after `from`
    for (const pt of p) {
      if (pt.t <= from) continue;
      const when = ctx.currentTime + (pt.t - from) / playRate;
      param.linearRampToValueAtTime(pt.v, when);
    }
  }, []);

  const stopAll = useCallback(() => {
    sourcesRef.current.forEach(s => { try { s.stop(); } catch {} });
    sourcesRef.current = [];
    bandAnalysersRef.current = {};
    fxNodesRef.current = {};
    cancelAnimationFrame(rafRef.current);
    if (metroRef.current) { clearInterval(metroRef.current); metroRef.current = 0; }
    setPlaying(false);
    setStems(prev => prev.map(s => ({ ...s, level: 0 })));
  }, []);

  const clickMetro = (ctx: AudioContext, accent: boolean) => {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.18, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.06);
  };

  const play = useCallback((fromOverride?: number) => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") ctx.resume();
    stopAll();
    const soloActive = stems.some(s => s.solo);
    const from = fromOverride ?? playhead;
    startTimeRef.current = ctx.currentTime;
    offsetRef.current = from;
    stemNodesRef.current = {};

    fxNodesRef.current = {};
    stems.forEach(s => {
      if (!s.audioBuffer || s.muted) return;
      if (soloActive && !s.solo) return;
      const src = ctx.createBufferSource();
      src.buffer = s.audioBuffer;
      src.playbackRate.value = rate;
      const gain = ctx.createGain(); gain.gain.value = s.volume;
      const panner = ctx.createStereoPanner(); panner.pan.value = s.pan;
      const an = ctx.createAnalyser(); an.fftSize = 256;
      // automation: schedule vol/pan curves onto the params (falls back to static)
      scheduleAuto(gain.gain, s.auto.vol, ctx, from, rate, s.volume);
      scheduleAuto(panner.pan, s.auto.pan, ctx, from, rate, s.pan);
      src.connect(gain); gain.connect(panner);

      // per-stem effects rack (unless A/B bypass is on, or this is the master lane)
      if (!fxBypass && s.name !== "master") {
        const eqLow = ctx.createBiquadFilter(); eqLow.type = "lowshelf"; eqLow.frequency.value = 120;
        const eqMid = ctx.createBiquadFilter(); eqMid.type = "peaking"; eqMid.frequency.value = 1000; eqMid.Q.value = 1;
        const eqHigh = ctx.createBiquadFilter(); eqHigh.type = "highshelf"; eqHigh.frequency.value = 6000;
        const comp = ctx.createDynamicsCompressor();
        const dry = ctx.createGain();
        const revSend = ctx.createGain();
        const delSend = ctx.createGain();
        panner.connect(eqLow); eqLow.connect(eqMid); eqMid.connect(eqHigh); eqHigh.connect(comp);
        comp.connect(dry); dry.connect(an);
        comp.connect(revSend); if (reverbBusRef.current) revSend.connect(reverbBusRef.current.conv);
        comp.connect(delSend); if (delayBusRef.current) delSend.connect(delayBusRef.current.delay);
        fxNodesRef.current[s.name] = { eqLow, eqMid, eqHigh, comp, dry, revSend, delSend };
        applyFxToNodes(s.name, s.fx);
      } else {
        panner.connect(an);
      }
      an.connect(masterGainRef.current!);
      src.start(0, from);
      stemNodesRef.current[s.name] = { gain, pan: panner, analyser: an };
      sourcesRef.current.push(src);
    });

    // If stems aren't split, only the master is playing — tap it into per-lane
    // frequency bands so drums/bass/other/vocals VU meters still move live.
    // These taps are metering-only (never connected to output → no audio change).
    bandAnalysersRef.current = {};
    if (!stemsSplit) {
      const masterNode = stemNodesRef.current["master"];
      if (masterNode) {
        const bands: Record<string, [BiquadFilterType, number, number]> = {
          // [filter type, frequency, Q]
          drums:  ["lowpass", 150, 1],     // kick / low thump
          bass:   ["bandpass", 110, 1.2],  // bass fundamentals
          other:  ["bandpass", 900, 0.8],  // mids / instruments
          vocals: ["bandpass", 3000, 1],   // presence / vocals
        };
        Object.entries(bands).forEach(([name, [type, freq, q]]) => {
          const filt = ctx.createBiquadFilter();
          filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
          const ban = ctx.createAnalyser(); ban.fftSize = 256;
          masterNode.gain.connect(filt); filt.connect(ban);  // dead-ends here, no destination
          bandAnalysersRef.current[name] = ban;
        });
      }
    }
    setPlaying(true);

    if (metronome) {
      const data = new Uint8Array(1);
      let beat = Math.floor(from / secPerBeat);
      metroRef.current = window.setInterval(() => {
        clickMetro(ctx, beat % 4 === 0); beat++; void data;
      }, secPerBeat * 1000 / rate);
    }

    const buf = new Uint8Array(128);
    const tick = () => {
      const elapsed = (ctx.currentTime - startTimeRef.current) * rate;
      let pos = offsetRef.current + elapsed;
      const end = (loopOn && loopB > loopA) ? loopB : duration;
      if (pos >= end) {
        if (loopOn && loopB > loopA) { play(loopA); return; }
        stopAll(); setPlayhead(0); return;
      }
      setPlayhead(pos);
      // VU levels — use the lane's own playing node, else its band tap of master
      setStems(prev => prev.map(s => {
        const analyser = stemNodesRef.current[s.name]?.analyser ?? bandAnalysersRef.current[s.name];
        if (!analyser) return s.level ? { ...s, level: 0 } : s;
        analyser.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128) / 128);
        // band taps read quieter than the full mix → scale them up a touch
        const isBand = !stemNodesRef.current[s.name] && bandAnalysersRef.current[s.name];
        return { ...s, level: isBand ? Math.min(1, peak * 2.2) : peak };
      }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stems, stemsSplit, playhead, duration, rate, metronome, secPerBeat, loopOn, loopA, loopB, stopAll, fxBypass, applyFxToNodes, scheduleAuto]);

  const togglePlay = useCallback(() => { playing ? stopAll() : play(); }, [playing, stopAll, play]);

  // live update gain/pan/fx while playing
  useEffect(() => {
    stems.forEach(s => {
      const node = stemNodesRef.current[s.name];
      if (node) { node.gain.gain.value = s.muted ? 0 : s.volume; node.pan.pan.value = s.pan; }
      applyFxToNodes(s.name, s.fx);
    });
  }, [stems, applyFxToNodes]);

  const snapTime = useCallback((t: number) => {
    if (!snap) return t;
    const beat = secPerBeat;
    return Math.round(t / beat) * beat;
  }, [snap, secPerBeat]);

  const seekTo = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0);
    let t = Math.max(0, Math.min(x / pxPerSec, duration));
    t = snapTime(t);
    setPlayhead(t);
    if (playing) play(t);
  };

  const playClip = (stem: StemState, clip: Clip) => {
    const ctx = ensureCtx();
    if (ctx.state === "suspended") ctx.resume();
    if (!stem.audioBuffer) return;
    const src = ctx.createBufferSource(); src.buffer = stem.audioBuffer;
    const gain = ctx.createGain(); gain.gain.value = stem.volume;
    src.connect(gain); gain.connect(masterGainRef.current!);
    src.start(0, clip.start, clip.dur);
  };

  // ── keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "TEXTAREA" || (e.target as HTMLElement).tagName === "INPUT") return;
      switch (e.key) {
        case " ": e.preventDefault(); togglePlay(); break;
        case "Home": setPlayhead(0); if (playing) play(0); break;
        case "ArrowRight": setPlayhead(p => Math.min(duration, p + 5)); break;
        case "ArrowLeft": setPlayhead(p => Math.max(0, p - 5)); break;
        case "l": case "L": setLoopOn(o => !o); break;
        case "m": case "M": setMetronome(m => !m); break;
        case "+": case "=": setZoom(z => Math.min(z * 1.5, 12)); break;
        case "-": setZoom(z => Math.max(z / 1.5, 0.2)); break;
        case "g": case "G": setShowGrid(g => !g); break;
        case "s": case "S": setSnap(s => !s); break;
        case "x": case "X": setSplitMode(m => !m); break;
        case "b": case "B": splitAtPlayheadRef.current?.(); break;
        case "a": case "A": setAutoLane(l => l === null ? "vol" : l === "vol" ? "pan" : null); break;
        case "?": setShowShortcuts(s => !s); break;
        case "i": setLoopA(playhead); break;
        case "o": setLoopB(playhead); break;
        case "Escape": setShowShortcuts(false); setSelectedClip(null); setProdOpen(false); clearSelection(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, playing, play, duration, playhead]);

  // follow playhead
  useEffect(() => {
    if (!playing || !followPlayhead || !scrollRef.current) return;
    const px = playhead * pxPerSec;
    const el = scrollRef.current;
    if (px > el.scrollLeft + el.clientWidth - 120 || px < el.scrollLeft) {
      el.scrollLeft = px - el.clientWidth * 0.25;
    }
  }, [playhead, playing, followPlayhead, pxPerSec]);

  // wheel-to-zoom (ctrl) — must be a non-passive native listener so preventDefault works
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom(z => Math.max(0.2, Math.min(12, z * (e.deltaY < 0 ? 1.12 : 0.89))));
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const fitToWindow = () => {
    if (!scrollRef.current || !duration) return;
    const w = scrollRef.current.clientWidth - 20;
    setZoom(Math.max(0.2, Math.min(12, w / (duration * BASE_PX_PER_SEC))));
  };

  // ── stem controls ───────────────────────────────────────────────────────────
  const updateStem = (name: string, patch: Partial<StemState>) =>
    setStems(prev => prev.map(s => s.name === name ? { ...s, ...patch } : s));
  const resetMix = () => setStems(prev => prev.map(s => ({ ...s, muted: false, solo: false, volume: 1, pan: 0, fx: { ...FX_DEFAULT } })));
  const updateFx = (name: string, patch: Partial<StemFx>) =>
    setStems(prev => prev.map(s => s.name === name ? { ...s, fx: { ...s.fx, ...patch } } : s));
  // A/B: flip the fx-bypass and (if playing) rebuild the graph so it takes effect now
  const toggleBypass = useCallback(() => {
    setFxBypass(b => !b);
    if (playing) requestAnimationFrame(() => play());
  }, [playing, play]);

  // ── automation curves (per-stem vol/pan over time) ──────────────────────────
  const reschedulePlaying = useCallback(() => { if (playing) requestAnimationFrame(() => play()); }, [playing, play]);

  const setStemAuto = useCallback((name: string, lane: AutoLane, fn: (pts: AutoPoint[]) => AutoPoint[]) => {
    setStems(prev => prev.map(s => s.name === name
      ? { ...s, auto: { ...s.auto, [lane]: fn(s.auto[lane]).sort((a, b) => a.t - b.t) } } : s));
  }, []);

  // add or move a point. if a point already sits ~at this time, replace its value.
  const addAutoPoint = useCallback((name: string, lane: AutoLane, t: number, v: number) => {
    const r = AUTO_RANGE[lane];
    const vv = Math.max(r.min, Math.min(r.max, v));
    const tt = Math.max(0, Math.min(t, duration));
    setStemAuto(name, lane, pts => {
      const near = pts.find(p => Math.abs(p.t - tt) < 0.04);
      if (near) return pts.map(p => p === near ? { t: tt, v: vv } : p);
      return [...pts, { t: tt, v: vv }];
    });
    reschedulePlaying();
  }, [duration, setStemAuto, reschedulePlaying]);

  const moveAutoPoint = useCallback((name: string, lane: AutoLane, idx: number, t: number, v: number) => {
    const r = AUTO_RANGE[lane];
    setStemAuto(name, lane, pts => pts.map((p, i) => i === idx
      ? { t: Math.max(0, Math.min(t, duration)), v: Math.max(r.min, Math.min(r.max, v)) } : p));
  }, [duration, setStemAuto]);

  const deleteAutoPoint = useCallback((name: string, lane: AutoLane, idx: number) => {
    setStemAuto(name, lane, pts => pts.filter((_, i) => i !== idx));
    reschedulePlaying();
  }, [setStemAuto, reschedulePlaying]);

  const clearAuto = useCallback((name: string, lane: AutoLane) => {
    setStems(prev => prev.map(s => s.name === name ? { ...s, auto: { ...s.auto, [lane]: [] } } : s));
    reschedulePlaying();
    setStatusMsg(`Cleared ${AUTO_RANGE[lane].label.toLowerCase()} automation on ${name}`);
  }, [reschedulePlaying]);

  const addMarker = () => setMarkers(m => [...m, { id: Date.now(), time: playhead, label: `M${m.length + 1}` }]);

  // ── song-structure sections ─────────────────────────────────────────────────
  const addSection = useCallback(() => {
    setSections(prev => {
      const i = prev.length;
      const start = prev.length ? prev[prev.length - 1].end : 0;
      const end = Math.min(duration, start + Math.max(4, duration / 6));
      const nm = SECTION_PRESETS[i % SECTION_PRESETS.length];
      const next = [...prev, { id: Date.now(), name: nm, start, end,
        color: SECTION_COLORS[i % SECTION_COLORS.length] }];
      return next;
    });
  }, [duration]);

  const updateSection = (id: number, patch: Partial<Section>) =>
    setSections(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  const deleteSection = (id: number) =>
    setSections(prev => prev.filter(s => s.id !== id));

  // build sections automatically from the markers (each marker → a section boundary)
  const sectionsFromMarkers = useCallback(() => {
    const ms = [...markers].sort((a, b) => a.time - b.time);
    const bounds = [0, ...ms.map(m => m.time), duration].filter((v, i, a) => i === 0 || v > a[i - 1]);
    const next: Section[] = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      next.push({ id: Date.now() + i, name: SECTION_PRESETS[i % SECTION_PRESETS.length],
        start: bounds[i], end: bounds[i + 1], color: SECTION_COLORS[i % SECTION_COLORS.length] });
    }
    setSections(next);
    setStatusMsg(`Built ${next.length} sections from markers`);
  }, [markers, duration]);

  // jump the playhead to a section start (and play it if currently playing)
  const goToSection = (sec: Section) => { setPlayhead(sec.start); setActiveSection(sec.id); if (playing) play(sec.start); };

  // dragging a section block on the lane (move / resize either edge)
  const onSectionDragStart = (e: React.MouseEvent, sec: Section, mode: "move" | "l" | "r") => {
    e.stopPropagation();
    sectionDragRef.current = { id: sec.id, mode, x0: e.clientX, s0: sec.start, e0: sec.end };
    const onMove = (ev: MouseEvent) => {
      const d = sectionDragRef.current; if (!d) return;
      let dt = (ev.clientX - d.x0) / pxPerSec;
      if (snap) dt = Math.round(dt / secPerBeat) * secPerBeat;
      setSections(prev => prev.map(s => {
        if (s.id !== d.id) return s;
        if (d.mode === "move") {
          const len = d.e0 - d.s0;
          let ns = Math.max(0, Math.min(d.s0 + dt, duration - len));
          return { ...s, start: ns, end: ns + len };
        }
        if (d.mode === "l") return { ...s, start: Math.max(0, Math.min(d.s0 + dt, s.end - 0.25)) };
        return { ...s, end: Math.min(duration, Math.max(d.e0 + dt, s.start + 0.25)) };
      }));
    };
    const onUp = () => { sectionDragRef.current = null;
      window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const saveNotes = async () => {
    await fetch(`${API}/api/track/${trackId}/notes`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes }),
    });
    setNotesSaved(true); setTimeout(() => setNotesSaved(false), 1800);
  };

  const doMixdown = async () => {
    setStatusMsg("Mixing down…");
    try {
      const r = await fetch(`${API}/api/stems/${trackId}/mixdown`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stems: mixdownConfig() }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setStatusMsg(`✅ Mixed down${data.fx_baked ? " (FX baked)" : ""} → new track #${data.id}`);
    } catch (e) { setStatusMsg(`❌ ${(e as Error).message}`); }
  };

  // ── selection (multi-select notes) ───────────────────────────────────────────
  const selectedClips = useMemo(() => {
    if (!selStem) return [] as Clip[];
    const lane = stems.find(s => s.name === selStem);
    if (!lane) return [];
    return lane.clips.filter(c => selIds.has(c.id)).sort((a, b) => a.start - b.start);
  }, [selStem, selIds, stems]);

  const selRange = useMemo(() => {
    if (!selectedClips.length) return null;
    return { start: selectedClips[0].start, end: selectedClips[selectedClips.length - 1].end };
  }, [selectedClips]);

  // clicking notes: shift toggles into the set, plain click selects just one
  const onNoteClick = (stem: StemState, clip: Clip, shift: boolean) => {
    setSelStem(prev => {
      const sameLane = prev === stem.name;
      setSelIds(ids => {
        const next = new Set(shift && sameLane ? ids : []);
        if (shift && sameLane && next.has(clip.id)) next.delete(clip.id);
        else next.add(clip.id);
        return next;
      });
      return stem.name;
    });
    setSelectedClip({ stem: stem.name, clip });
    setProdOpen(true);
    if (!shift) playClip(stem, clip);
  };

  const clearSelection = () => { setSelIds(new Set()); setSelStem(null); setLayers([]);
    setHarmonics({ fundamental: null, harmonics: [] }); };

  // fetch the band layers + note harmonics whenever the selection range changes
  const selRangeStart = selRange?.start ?? null;
  const selRangeEnd = selRange?.end ?? null;
  useEffect(() => {
    if (!selStem || selRangeStart === null || selRangeEnd === null) {
      setLayers([]); setHarmonics({ fundamental: null, harmonics: [] }); return;
    }
    setLayersLoading(true);
    const ctrl = new AbortController();
    const q = `?start=${selRangeStart}&end=${selRangeEnd}`;
    Promise.all([
      fetch(`${API}/api/layers/${trackId}/${selStem}${q}&points=64`, { signal: ctrl.signal }).then(r => r.json()),
      fetch(`${API}/api/harmonics/${trackId}/${selStem}${q}&n=8`, { signal: ctrl.signal }).then(r => r.json()),
    ]).then(([lay, harm]) => {
      setLayers(lay.layers || []);
      setHarmonics({ fundamental: harm.fundamental ?? null, harmonics: harm.harmonics || [] });
    }).catch(() => {}).finally(() => setLayersLoading(false));
    return () => ctrl.abort();
  }, [selStem, selRangeStart, selRangeEnd, trackId]);

  // ── production operations (all save a new version) ───────────────────────────
  const [effectDefs, setEffectDefs] = useState<{ name: string; params: { key: string; min: number; max: number; default: number; label: string }[] }[]>([]);
  useEffect(() => { fetch(`${API}/api/effects`).then(r => r.json()).then(setEffectDefs).catch(() => {}); }, []);

  const runProd = async (path: string, body: object | null, label: string) => {
    setStatusMsg(`${label}…`);
    try {
      const r = await fetch(`${API}/api/track/${trackId}/${path}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setStatusMsg(`✅ ${label} → new track #${data.id}`);
    } catch (e) { setStatusMsg(`❌ ${(e as Error).message}`); }
  };

  // ── edit ops + history (delete/duplicate/silence/… on the selection) ─────────
  // load any saved edit stack for this track on mount
  useEffect(() => {
    fetch(`${API}/api/daw/${trackId}/history`).then(r => r.json())
      .then(h => setEditHist({ ops: h.ops || [], head: h.head || 0,
        can_undo: h.can_undo, can_redo: h.can_redo })).catch(() => {});
  }, [trackId]);

  // ── project state: restore the whole workspace on mount, auto-save on change ──
  useEffect(() => {
    fetch(`${API}/api/daw/${trackId}/project`).then(r => r.json()).then(({ state }) => {
      if (!state) return;
      if (Array.isArray(state.markers)) setMarkers(state.markers);
      if (Array.isArray(state.sections)) setSections(state.sections);
      if (state.loop) { setLoopOn(!!state.loop.on); setLoopA(state.loop.a ?? 0); setLoopB(state.loop.b ?? 0); }
      if (state.view) {
        if (state.view.zoom) setZoom(state.view.zoom);
        if (state.view.laneH) setLaneH(state.view.laneH);
        if (typeof state.view.showGrid === "boolean") setShowGrid(state.view.showGrid);
        if (typeof state.view.snap === "boolean") setSnap(state.view.snap);
        if (typeof state.view.useBars === "boolean") setUseBars(state.view.useBars);
      }
      if (typeof state.rate === "number") setRate(state.rate);
      if (typeof state.masterVol === "number") setMasterVol(state.masterVol);
      // mixer is applied once stems exist (separate effect below)
      if (state.mixer && Object.keys(state.mixer).length) {
        setStems(prev => prev.map(s => state.mixer[s.name]
          ? { ...s, volume: state.mixer[s.name].vol ?? s.volume, pan: state.mixer[s.name].pan ?? s.pan,
              muted: state.mixer[s.name].mute ?? s.muted, solo: state.mixer[s.name].solo ?? s.solo,
              fx: { ...FX_DEFAULT, ...(state.mixer[s.name].fx || {}) },
              auto: { vol: state.mixer[s.name].auto?.vol || [], pan: state.mixer[s.name].auto?.pan || [] } } : s));
      }
      if (typeof state.limiterOn === "boolean") setLimiterOn(state.limiterOn);
    }).catch(() => {}).finally(() => { projectLoadedRef.current = true; });
  }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

  // debounced auto-save of the full workspace whenever any tracked piece changes
  useEffect(() => {
    if (!projectLoadedRef.current) return;   // don't save the initial defaults over the restore
    const mixer: Record<string, { vol: number; pan: number; mute: boolean; solo: boolean; fx: StemFx; auto: StemAuto }> = {};
    stems.filter(s => s.name !== "master").forEach(s =>
      { mixer[s.name] = { vol: s.volume, pan: s.pan, mute: s.muted, solo: s.solo, fx: s.fx, auto: s.auto }; });
    const state = {
      mixer, markers, sections,
      loop: { on: loopOn, a: loopA, b: loopB },
      view: { zoom, laneH, showGrid, snap, useBars },
      rate, masterVol, limiterOn,
    };
    const id = setTimeout(() => {
      fetch(`${API}/api/daw/${trackId}/project`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(id);
  }, [trackId, stems, markers, sections, loopOn, loopA, loopB, zoom, laneH, showGrid, snap, useBars, rate, masterVol, limiterOn]);

  // re-fetch one stem's waveform with live edits applied, so the lane updates
  const refreshStemPreview = useCallback((stemName: string) => {
    if (!stemName || stemName === "master") return;   // master has no stem file
    fetch(`${API}/api/daw/${trackId}/preview-stem/${stemName}?points=2600`)
      .then(r => r.ok ? r.json() : null).then(data => {
        if (!data || !Array.isArray(data.peaks)) return;
        setStems(prev => prev.map(s => s.name === stemName
          ? { ...s, peaks: data.peaks, duration: data.duration ?? s.duration } : s));
      }).catch(() => {});
  }, [trackId]);

  const applyHist = (h: { ops?: EditOp[]; head?: number; can_undo?: boolean; can_redo?: boolean }) =>
    setEditHist({ ops: h.ops || [], head: h.head || 0, can_undo: !!h.can_undo, can_redo: !!h.can_redo });

  // push one edit op, persist it, and refresh affected lanes
  const pushOp = useCallback(async (op: EditOp, label: string) => {
    setStatusMsg(`${label}…`);
    try {
      const r = await fetch(`${API}/api/daw/${trackId}/history/push`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op }),
      });
      if (!r.ok) throw new Error(await r.text());
      applyHist(await r.json());
      refreshStemPreview(op.stem);
      // affected stems whose timeline length changed → also refresh master view later on render
      setStatusMsg(`✅ ${label}`);
    } catch (e) { setStatusMsg(`❌ ${(e as Error).message}`); }
  }, [trackId, refreshStemPreview]);

  const histAction = useCallback(async (action: "undo" | "redo" | "clear") => {
    try {
      const r = await fetch(`${API}/api/daw/${trackId}/history/${action}`, { method: "POST" });
      const h = await r.json(); applyHist(h);
      // refresh every stem that appears in the (new) live stack + any previously edited
      const live = (h.ops || []).slice(0, h.head);
      const touched = new Set<string>([...live.map((o: EditOp) => o.stem),
        ...(h.ops || []).map((o: EditOp) => o.stem)]);
      touched.forEach(name => refreshStemPreview(name));
      setStatusMsg(action === "clear" ? "Cleared all edits" : `${action} ✓`);
    } catch (e) { setStatusMsg(`❌ ${(e as Error).message}`); }
  }, [trackId, refreshStemPreview]);

  // the current selection as a (stem, start, end) edit target
  const editTarget = useMemo(() => {
    if (!selStem || !selRange || selStem === "master") return null;
    return { stem: selStem, start: selRange.start, end: selRange.end };
  }, [selStem, selRange]);

  const requireSel = (): { stem: string; start: number; end: number } | null => {
    if (!editTarget) { setStatusMsg("Select clip(s) in a stem lane first (split stems to edit)"); return null; }
    return editTarget;
  };

  const editDelete    = () => { const t = requireSel(); if (t) pushOp({ op: "delete", ...t }, "Delete region"); };
  const editSilence   = () => { const t = requireSel(); if (t) pushOp({ op: "silence", ...t }, "Silence region"); };
  const editDuplicate = () => { const t = requireSel(); if (t) pushOp({ op: "duplicate", ...t, at: t.end }, "Duplicate"); };
  const editToPlayhead= () => { const t = requireSel(); if (t) pushOp({ op: "duplicate", ...t, at: playhead }, "Paste at playhead"); };
  const editReverse   = () => { const t = requireSel(); if (t) pushOp({ op: "reverse", ...t }, "Reverse region"); };
  const editFadeIn    = () => { const t = requireSel(); if (t) pushOp({ op: "fade", ...t, shape: "in" }, "Fade in"); };
  const editFadeOut   = () => { const t = requireSel(); if (t) pushOp({ op: "fade", ...t, shape: "out" }, "Fade out"); };
  const editGain      = (db: number) => { const t = requireSel(); if (t) pushOp({ op: "gain", ...t, db }, `Gain ${db > 0 ? "+" : ""}${db}dB`); };
  const editMoveTo    = () => { const t = requireSel(); if (t) pushOp({ op: "move", ...t, at: playhead }, "Move to playhead"); };
  const editCopy      = () => { const t = requireSel(); if (t) { setClipboard(t); setStatusMsg("Copied region — paste at playhead"); } };
  const editPaste     = () => {
    if (!clipboard) { setStatusMsg("Nothing copied yet"); return; }
    pushOp({ op: "duplicate", stem: clipboard.stem, start: clipboard.start, end: clipboard.end, at: playhead }, "Paste");
  };

  // ── Layer 4: real clip manipulation ──────────────────────────────────────────
  // These map direct clip gestures onto the same non-destructive edit stack:
  //   • drag clip body  → `move` op   (cut the region, re-insert at the new start)
  //   • drag an edge     → `delete` op (remove the trimmed-off slice; timeline shrinks)
  //   • split at playhead→ UI-only: break one visual clip into two so each piece can
  //                         be selected / moved / trimmed independently.
  // Update the visual clip list immediately so the lane reflects the gesture; the
  // server re-detects exact clips on the next preview refresh after the op renders.

  const setClips = useCallback((stemName: string, fn: (clips: Clip[]) => Clip[]) => {
    setStems(prev => prev.map(s => s.name === stemName ? { ...s, clips: fn(s.clips) } : s));
  }, []);

  // split the clip under the playhead (or a given clip) into two at `time`
  const splitClipAt = useCallback((stemName: string, time: number) => {
    setClips(stemName, clips => {
      const hit = clips.find(c => time > c.start + 0.02 && time < c.end - 0.02);
      if (!hit) return clips;
      // snap only if the snapped point stays inside the clip (transient clips can be
      // shorter than one beat, in which case snapping would fall outside — use raw time)
      const snapped = snapTime(time);
      const t = (snapped > hit.start + 0.02 && snapped < hit.end - 0.02) ? snapped : time;
      if (t <= hit.start + 0.02 || t >= hit.end - 0.02) return clips;
      const base = Date.now();
      const left:  Clip = { id: base,     start: hit.start, end: t,        dur: t - hit.start,   peak: hit.peak };
      const right: Clip = { id: base + 1, start: t,         end: hit.end,  dur: hit.end - t,     peak: hit.peak };
      setStatusMsg(`Split ${stemName} @ ${t.toFixed(2)}s`);
      return clips.flatMap(c => c.id === hit.id ? [left, right] : [c]);
    });
  }, [setClips, snapTime]);

  const splitAtPlayhead = () => {
    const t = selStem && selStem !== "master" ? selStem : null;
    const target = t || stems.find(s => s.name !== "master" && s.clipsLoaded)?.name;
    if (!target) { setStatusMsg("Split stems first to manipulate clips"); return; }
    splitClipAt(target, playhead);
  };
  splitAtPlayheadRef.current = splitAtPlayhead;

  // commit a clip drag-move: cut [start,end] out, re-insert at `newStart`
  const moveClip = useCallback((stemName: string, clip: Clip, newStart: number) => {
    const at = Math.max(0, snapTime(newStart));
    if (Math.abs(at - clip.start) < 0.01) return;           // no real movement
    // visually shift the clip immediately
    setClips(stemName, clips => clips.map(c => c.id === clip.id
      ? { ...c, start: at, end: at + c.dur } : c));
    pushOp({ op: "move", stem: stemName, start: clip.start, end: clip.end, at }, "Move clip");
  }, [setClips, snapTime, pushOp]);

  // commit a clip edge-trim: delete the sliver between the old and new edge
  const trimClip = useCallback((stemName: string, clip: Clip, edge: "l" | "r", newTime: number) => {
    const t = snapTime(newTime);
    if (edge === "l") {
      if (t <= clip.start + 0.02 || t >= clip.end - 0.02) return;
      setClips(stemName, clips => clips.map(c => c.id === clip.id ? { ...c, start: t, dur: c.end - t } : c));
      pushOp({ op: "delete", stem: stemName, start: clip.start, end: t }, "Trim clip start");
    } else {
      if (t >= clip.end - 0.02 || t <= clip.start + 0.02) return;
      setClips(stemName, clips => clips.map(c => c.id === clip.id ? { ...c, end: t, dur: t - c.start } : c));
      pushOp({ op: "delete", stem: stemName, start: t, end: clip.end }, "Trim clip end");
    }
  }, [setClips, snapTime, pushOp]);

  // per-stem config sent to render/mixdown — includes the live FX rack + pan so the
  // server bakes exactly what's monitored. When the FX rack is bypassed (A/B → RAW),
  // send flat fx so the export matches the dry monitor.
  const mixdownConfig = () => {
    const cfg: Record<string, { vol: number; mute: boolean; pan: number; fx: StemFx; auto: StemAuto }> = {};
    stems.filter(s => s.name !== "master").forEach(s => {
      cfg[s.name] = { vol: s.volume, mute: s.muted, pan: s.pan,
        fx: fxBypass ? { ...FX_DEFAULT } : s.fx, auto: s.auto };
    });
    return cfg;
  };

  const doRender = async () => {
    if (!editHist.head) { setStatusMsg("No edits to render yet"); return; }
    setRendering(true); setStatusMsg("Rendering edits…");
    const cfg = mixdownConfig();
    try {
      const r = await fetch(`${API}/api/daw/${trackId}/render`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stems: cfg }),
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setStatusMsg(`✅ Rendered ${data.ops} edits${data.fx_baked ? " (FX baked)" : ""} → new track #${data.id}`);
    } catch (e) { setStatusMsg(`❌ ${(e as Error).message}`); }
    finally { setRendering(false); }
  };

  const exportStem = async (stemName: string) => {
    setStatusMsg(`Exporting ${stemName}…`);
    try {
      const r = await fetch(`${API}/api/daw/${trackId}/export-stem/${stemName}`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setStatusMsg(`✅ Exported ${stemName} → #${data.id}`);
    } catch (e) { setStatusMsg(`❌ ${(e as Error).message}`); }
  };

  // download all four edited stems as a zip
  const exportZip = async () => {
    if (!stemsSplit) { setStatusMsg("Split into stems first"); return; }
    setExporting(true); setStatusMsg("Bundling stems…");
    try {
      const r = await fetch(`${API}/api/daw/${trackId}/export-zip`);
      if (!r.ok) throw new Error(await r.text());
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${(track?.title || "track").replace(/[^\w-]+/g, "_")}_stems.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setStatusMsg("✅ Downloaded stems.zip");
    } catch (e) { setStatusMsg(`❌ ${(e as Error).message}`); }
    finally { setExporting(false); }
  };

  // ── generative (AI) stem editing ─────────────────────────────────────────────
  // all of these mutate one stem on the server, then refresh that lane's waveform
  const aiCall = useCallback(async (action: "stem-regenerate" | "stem-extend" | "stem-swap" | "stem-revert",
    stem: string, body: object | null, label: string) => {
    setAiBusy(label); setStatusMsg(`${label}… (AI — may take ~30–90s)`);
    try {
      const r = await fetch(`${API}/api/daw/${trackId}/${action}/${stem}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!r.ok) {
        if (r.status === 499) { setStatusMsg("AI action cancelled"); return; }
        throw new Error(await r.text());
      }
      const data = await r.json();
      refreshStemPreview(stem);
      // a length change (extend) means the whole timeline grew — refresh duration
      if (data.duration && data.duration > duration) setDuration(data.duration);
      setStatusMsg(`✅ ${label} → ${stem} (${(data.duration || 0).toFixed(1)}s)`);
    } catch (e) { setStatusMsg(`❌ ${(e as Error).message}`); }
    finally { setAiBusy(""); }
  }, [trackId, refreshStemPreview, duration]);

  const aiRegenerate = (stem: string, prompt: string) => {
    const t = editTarget;
    aiCall("stem-regenerate", stem, { prompt, start: t?.start ?? 0, end: t?.end ?? 0 }, "AI regenerate region");
  };
  const aiExtend = (stem: string, prompt: string, addDuration: number) =>
    aiCall("stem-extend", stem, { prompt, add_duration: addDuration }, "AI extend stem");
  const aiSwap = (stem: string, prompt: string) =>
    aiCall("stem-swap", stem, { prompt }, "AI swap instrument");
  const aiRevert = (stem: string) => aiCall("stem-revert", stem, null, "Revert AI edits");

  const aiCancel = useCallback(() => { fetch(`${API}/api/cancel`, { method: "POST" }).catch(() => {}); }, []);

  // cancel any running AI job if the tab is closed mid-generation
  useEffect(() => {
    const beacon = () => { if (aiBusy) navigator.sendBeacon(`${API}/api/cancel`); };
    window.addEventListener("pagehide", beacon);
    window.addEventListener("beforeunload", beacon);
    return () => { window.removeEventListener("pagehide", beacon); window.removeEventListener("beforeunload", beacon); };
  }, [aiBusy]);

  // edit keyboard shortcuts (defined here so they close over the edit fns above)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); histAction(e.shiftKey ? "redo" : "undo"); }
      else if (mod && (e.key === "d" || e.key === "D")) { e.preventDefault(); editDuplicate(); }
      else if (mod && (e.key === "c" || e.key === "C")) { e.preventDefault(); editCopy(); setStatusMsg("Copied — ⌘V to paste at playhead"); }
      else if (mod && (e.key === "x" || e.key === "X")) { e.preventDefault(); editCopy(); editDelete(); setStatusMsg("Cut"); }
      else if (mod && (e.key === "v" || e.key === "V")) { e.preventDefault(); editPaste(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && editTarget) { e.preventDefault(); editDelete(); }
      else if (e.key === "Escape") { closeCtx(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [histAction, editDuplicate, editCopy, editPaste, editDelete, editTarget, closeCtx]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(Math.floor(s % 60)).toString().padStart(2, "0")}`;
  const fmtBars = (s: number) => {
    const beat = s / secPerBeat;
    const bar = Math.floor(beat / 4) + 1;
    const b = Math.floor(beat % 4) + 1;
    return `${bar}.${b}`;
  };
  const fmtPos = (s: number) => useBars ? fmtBars(s) : fmt(s);

  const totalClips = useMemo(() => stems.reduce((n, s) => n + s.clips.length, 0), [stems]);

  if (!track) {
    return <div style={{ height: "100vh", display: "flex", alignItems: "center",
      justifyContent: "center", color: "var(--muted)" }}>Loading…</div>;
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column",
      background: "var(--bg0)", overflow: "hidden", userSelect: "none" }}>

      {/* TOP BAR */}
      <div style={{ height: 54, background: "var(--bg1)", borderBottom: "1px solid var(--line)",
        display: "flex", alignItems: "center", gap: 10, padding: "0 14px", flexShrink: 0, zIndex: 30 }}>
        <a href="/" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 18, padding: "4px 6px" }}>←</a>
        <div style={{ fontSize: 14, fontWeight: 800, maxWidth: 200, overflow: "hidden",
          textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{track.title}</div>
        <Chip>{Math.round(bpm)} BPM</Chip>
        {track.key && <Chip>{track.key}</Chip>}

        {/* transport */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 14 }}>
          <IconBtn title="Restart (Home)" onClick={() => { setPlayhead(0); if (playing) play(0); }}>⏮</IconBtn>
          <IconBtn title="Back 5s (←)" onClick={() => setPlayhead(p => Math.max(0, p - 5))}>«</IconBtn>
          <button onClick={togglePlay} style={{
            background: playing ? "linear-gradient(95deg,#ef4444,#f87171)" : "linear-gradient(95deg,#8b5cff,#22d3ee)",
            border: "none", borderRadius: 8, color: "#fff", fontSize: 15, fontWeight: 700,
            padding: "6px 20px", cursor: "pointer" }}>{playing ? "⏸" : "▶"}</button>
          <IconBtn title="Stop" onClick={() => { stopAll(); }}>■</IconBtn>
          <IconBtn title="Fwd 5s (→)" onClick={() => setPlayhead(p => Math.min(duration, p + 5))}>»</IconBtn>
        </div>

        <div style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: "var(--accent2)",
          background: "var(--bg3)", padding: "5px 12px", borderRadius: 8, letterSpacing: 1, cursor: "pointer" }}
          onClick={() => setUseBars(b => !b)} title="Click: toggle time / bars">
          {fmtPos(playhead)} / {fmtPos(duration)}
        </div>

        {/* toggles */}
        <Toggle active={loopOn} onClick={() => setLoopOn(o => !o)} title="Loop (L)">🔁 Loop</Toggle>
        <Toggle active={metronome} onClick={() => setMetronome(m => !m)} title="Metronome (M)">🎵 Click</Toggle>

        {/* speed */}
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 10, color: "var(--muted)" }}>×{rate.toFixed(2)}</span>
          <input type="range" min={0.5} max={1.5} step={0.05} value={rate}
            onChange={e => setRate(parseFloat(e.target.value))}
            style={{ width: 64, accentColor: "var(--accent)" }} title="Playback speed" />
        </div>

        {/* zoom group */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <IconBtn title="Zoom out (-)" onClick={() => setZoom(z => Math.max(0.2, z / 1.5))}>−</IconBtn>
          <input type="range" min={0.2} max={12} step={0.1} value={zoom}
            onChange={e => setZoom(parseFloat(e.target.value))}
            style={{ width: 90, accentColor: "var(--accent)" }} />
          <IconBtn title="Zoom in (+)" onClick={() => setZoom(z => Math.min(12, z * 1.5))}>+</IconBtn>
          <IconBtn title="Fit to window" onClick={fitToWindow}>⛶</IconBtn>
          <Toggle active={showGrid} onClick={() => setShowGrid(g => !g)} title="Grid (G)">▦</Toggle>
          <Toggle active={snap} onClick={() => setSnap(s => !s)} title="Snap (S)">🧲</Toggle>
          <Toggle active={splitMode} onClick={() => setSplitMode(m => !m)} title="Scissors — click a clip to split (X)">✂️</Toggle>
          <IconBtn title="Split at playhead (B)" onClick={() => splitAtPlayheadRef.current?.()}>⊟</IconBtn>
          <Toggle active={autoLane === "vol"}
            onClick={() => setAutoLane(l => l === "vol" ? null : "vol")}
            title="Volume automation lane (A) — click to add points, drag to move, dbl-click to delete">⌁V</Toggle>
          <Toggle active={autoLane === "pan"}
            onClick={() => setAutoLane(l => l === "pan" ? null : "pan")}
            title="Pan automation lane — click to add points, drag to move, dbl-click to delete">⌁P</Toggle>
          <Toggle active={followPlayhead} onClick={() => setFollowPlayhead(f => !f)} title="Follow playhead">👁</Toggle>
          <IconBtn title="Shortcuts (?)" onClick={() => setShowShortcuts(true)}>⌨</IconBtn>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* LEFT: lane headers */}
        <div style={{ width: LABEL_W, flexShrink: 0, background: "var(--bg1)",
          borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ height: RULER_H, borderBottom: "1px solid var(--line)", display: "flex",
            alignItems: "center", justifyContent: "space-between", padding: "0 10px",
            fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>
            <span>{useBars ? "BARS" : "TIME"}</span>
            <span>{totalClips} clips</span>
          </div>
          {/* spacer aligning headers with the section lane */}
          <div style={{ height: SECTION_LANE_H, borderBottom: "1px solid var(--line)",
            display: "flex", alignItems: "center", padding: "0 10px", fontSize: 9,
            color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, flexShrink: 0 }}>Sections</div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {stems.map(s => (
              <div key={s.name}>
                <LaneHeader stem={s} height={laneH}
                  onMute={() => updateStem(s.name, { muted: !s.muted })}
                  onSolo={() => updateStem(s.name, { solo: !s.solo })}
                  onVol={v => updateStem(s.name, { volume: v })}
                  onPan={p => updateStem(s.name, { pan: p })}
                />
                {autoLane && (
                  <div style={{ height: AUTO_LANE_H, borderBottom: "1px solid var(--line)",
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "0 10px", fontSize: 9, color: "var(--muted)",
                    background: "rgba(0,0,0,.22)", letterSpacing: .5 }}>
                    <span>{AUTO_RANGE[autoLane].label} auto</span>
                    <span style={{ fontFamily: "monospace" }}>{s.auto[autoLane].length || "—"}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: scrollable timeline */}
        <div ref={scrollRef}
          style={{ flex: 1, overflowX: "auto", overflowY: "auto", position: "relative" }}>
          <div style={{ width: Math.max(totalPx, 100), position: "relative" }}>
            {/* ruler */}
            <Ruler duration={duration} pxPerSec={pxPerSec} height={RULER_H}
              secPerBeat={secPerBeat} useBars={useBars} onSeek={seekTo}
              markers={markers} loopOn={loopOn} loopA={loopA} loopB={loopB} />

            {/* song-structure lane */}
            <div style={{ position: "relative", height: SECTION_LANE_H, background: "var(--bg2)",
              borderBottom: "1px solid var(--line)" }}>
              {sections.map(sec => {
                const left = sec.start * pxPerSec;
                const width = Math.max(8, (sec.end - sec.start) * pxPerSec);
                const isActive = activeSection === sec.id;
                return (
                  <div key={sec.id} onMouseDown={e => onSectionDragStart(e, sec, "move")}
                    onDoubleClick={() => goToSection(sec)}
                    title={`${sec.name} · ${fmt(sec.start)}–${fmt(sec.end)} (drag to move, edges to resize, double-click to jump)`}
                    style={{ position: "absolute", top: 2, bottom: 2, left, width,
                      background: sec.color + "33", border: `1px solid ${sec.color}`,
                      borderRadius: 4, display: "flex", alignItems: "center", padding: "0 6px",
                      fontSize: 10, fontWeight: 700, color: sec.color, overflow: "hidden",
                      whiteSpace: "nowrap", cursor: "grab", boxShadow: isActive ? `0 0 0 1px ${sec.color}` : "none" }}>
                    <div onMouseDown={e => onSectionDragStart(e, sec, "l")}
                      style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" }} />
                    {sec.name}
                    <div onMouseDown={e => onSectionDragStart(e, sec, "r")}
                      style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 6, cursor: "ew-resize" }} />
                  </div>
                );
              })}
            </div>

            {/* lanes */}
            {stems.map(s => (
              <div key={s.name}>
                <Lane stem={s} pxPerSec={pxPerSec} height={laneH}
                  showGrid={showGrid} secPerBeat={secPerBeat} duration={duration}
                  selectedIds={selStem === s.name ? selIds : null}
                  primaryId={selectedClip?.stem === s.name ? selectedClip.clip.id : null}
                  dragBox={dragBox?.stem === s.name ? dragBox : null}
                  splitMode={splitMode} editable={s.name !== "master"} snapTime={snapTime}
                  onMoveClip={(clip, newStart) => moveClip(s.name, clip, newStart)}
                  onTrimClip={(clip, edge, t) => trimClip(s.name, clip, edge, t)}
                  onSplitClip={(t) => splitClipAt(s.name, t)}
                  onNoteClick={(clip, shift) => onNoteClick(s, clip, shift)}
                  onBoxStart={(x) => setDragBox({ stem: s.name, x0: x, x1: x })}
                  onBoxMove={(x) => setDragBox(b => b && b.stem === s.name ? { ...b, x1: x } : b)}
                  onBoxEnd={() => {
                    if (dragBox && dragBox.stem === s.name) {
                      const lo = Math.min(dragBox.x0, dragBox.x1) / pxPerSec;
                      const hi = Math.max(dragBox.x0, dragBox.x1) / pxPerSec;
                      if (hi - lo > 0.01) {
                        const hits = s.clips.filter(c => c.start < hi && c.end > lo).map(c => c.id);
                        if (hits.length) {
                          setSelStem(s.name); setSelIds(new Set(hits)); setProdOpen(true);
                          setSelectedClip({ stem: s.name, clip: s.clips.find(c => c.id === hits[0])! });
                        }
                      }
                    }
                    setDragBox(null);
                  }}
                  onSeek={seekTo}
                  onCtxMenu={(clip, x, y) => { onNoteClick(s, clip, false); setCtxMenu({ clip, stem: s.name, x, y }); }} />
                {autoLane && (
                  <AutomationLane stem={s} lane={autoLane} pxPerSec={pxPerSec} duration={duration}
                    secPerBeat={secPerBeat} showGrid={showGrid}
                    onAdd={(t, v) => addAutoPoint(s.name, autoLane, t, v)}
                    onMove={(idx, t, v) => moveAutoPoint(s.name, autoLane, idx, t, v)}
                    onDelete={(idx) => deleteAutoPoint(s.name, autoLane, idx)}
                    onClear={() => clearAuto(s.name, autoLane)} />
                )}
              </div>
            ))}

            {/* loop region overlay */}
            {loopOn && loopB > loopA && (
              <div style={{ position: "absolute", top: RULER_H + SECTION_LANE_H, bottom: 0,
                left: loopA * pxPerSec, width: (loopB - loopA) * pxPerSec,
                background: "rgba(251,191,36,0.07)", borderLeft: "2px solid #fbbf24",
                borderRight: "2px solid #fbbf24", pointerEvents: "none", zIndex: 8 }} />
            )}

            {/* markers */}
            {markers.map(m => (
              <div key={m.id} style={{ position: "absolute", top: RULER_H + SECTION_LANE_H, bottom: 0,
                left: m.time * pxPerSec, width: 1, background: "#fbbf24", pointerEvents: "none", zIndex: 9 }} />
            ))}

            {/* playhead */}
            <div style={{ position: "absolute", top: 0, bottom: 0, left: playhead * pxPerSec,
              width: 2, background: "#fff", opacity: 0.9, pointerEvents: "none", zIndex: 20,
              boxShadow: "0 0 8px 2px rgba(255,255,255,.4)" }} />
          </div>
        </div>

        {/* RIGHT: production panel (slides in when notes are selected) */}
        {prodOpen && selRange && (
          <ProductionPanel
            stemName={selStem!} count={selIds.size} range={selRange} fmt={fmt}
            layers={layers} layersLoading={layersLoading} harmonics={harmonics}
            effectDefs={effectDefs} statusMsg={statusMsg}
            onClose={() => { setProdOpen(false); clearSelection(); }}
            onLoopSelection={() => { setLoopA(selRange.start); setLoopB(selRange.end); setLoopOn(true); play(selRange.start); }}
            onRegion={(prompt) => runProd("region", { start: selRange.start, end: selRange.end, prompt }, "AI rewrite")}
            onArrange={(op) => runProd("arrange", { op, a: selRange.start, b: selRange.end }, op)}
            onPitch={(semi) => runProd("pitch", { semitones: semi }, `pitch ${semi > 0 ? "+" : ""}${semi}st`)}
            onSpeed={(pct) => runProd("speed", { speed_pct: pct }, `speed ${pct}%`)}
            onFade={(fi, fo) => runProd("fade", { fade_in: fi, fade_out: fo }, "fade")}
            onNormalize={() => runProd("normalize", null, "normalize")}
            onPreset={(p) => runProd("preset", { preset: p }, p)}
            onEffect={(name, params) => runProd("effect", { effect: name, params }, name)}
          />
        )}
      </div>

      {/* BOTTOM PANEL */}
      <div style={{ height: 200, background: "var(--bg1)", borderTop: "1px solid var(--line)",
        display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {/* tabs */}
        <div style={{ display: "flex", gap: 2, borderBottom: "1px solid var(--line)", padding: "0 10px",
          alignItems: "center" }}>
          {(["mixer", "edit", "song", "clip", "notes", "info"] as const).map(t => (
            <button key={t} onClick={() => setBottomTab(t)} style={{
              background: "none", border: "none", borderBottom: `2px solid ${bottomTab === t ? "var(--accent)" : "transparent"}`,
              color: bottomTab === t ? "var(--text)" : "var(--muted)", padding: "10px 14px",
              fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, cursor: "pointer" }}>{t}</button>
          ))}
          {/* lane height + markers + mixdown shortcuts */}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, paddingRight: 6 }}>
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Lane H</span>
            <input type="range" min={56} max={160} step={4} value={laneH}
              onChange={e => setLaneH(parseInt(e.target.value))} style={{ width: 70, accentColor: "var(--accent)" }} />
            <button className="mini" onClick={addMarker} style={miniBtn}>+ Marker</button>
            <button className="mini" onClick={() => { setLoopA(playhead); }} style={miniBtn}>Set A</button>
            <button className="mini" onClick={() => { setLoopB(playhead); }} style={miniBtn}>Set B</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
          {bottomTab === "mixer" && (
            <MixerPanel stems={stems} stemsSplit={stemsSplit} splitting={splitting} splitMsg={splitMsg}
              masterVol={masterVol} statusMsg={statusMsg}
              onSplit={handleSplit} onUpdate={updateStem} onMaster={setMasterVol}
              onReset={resetMix} onMixdown={doMixdown}
              onFx={updateFx} limiterOn={limiterOn} onLimiter={() => setLimiterOn(o => !o)}
              fxBypass={fxBypass} onBypass={toggleBypass} />
          )}
          {bottomTab === "edit" && (
            <EditPanel
              stemsSplit={stemsSplit} target={editTarget} count={selIds.size} fmt={fmt}
              hist={editHist} clipboard={clipboard} rendering={rendering}
              onDelete={editDelete} onSilence={editSilence} onDuplicate={editDuplicate}
              onPasteHere={editToPlayhead} onReverse={editReverse}
              onFadeIn={editFadeIn} onFadeOut={editFadeOut} onGain={editGain}
              onMoveTo={editMoveTo} onCopy={editCopy} onPaste={editPaste}
              onUndo={() => histAction("undo")} onRedo={() => histAction("redo")}
              onClear={() => histAction("clear")} onRender={doRender}
              onExportStem={exportStem} onSplit={handleSplit}
              stemNames={STEM_DEFS.filter(s => s.name !== "master").map(s => s.name)}
              aiBusy={aiBusy} onAiRegenerate={aiRegenerate} onAiExtend={aiExtend}
              onAiSwap={aiSwap} onAiRevert={aiRevert} onAiCancel={aiCancel} />
          )}
          {bottomTab === "song" && (
            <SectionsPanel sections={sections} fmt={fmt} duration={duration}
              activeId={activeSection} markerCount={markers.length} exporting={exporting}
              onAdd={addSection} onFromMarkers={sectionsFromMarkers}
              onUpdate={updateSection} onDelete={deleteSection} onGoto={goToSection}
              onClear={() => setSections([])} onExportZip={exportZip}
              presets={SECTION_PRESETS} colors={SECTION_COLORS} />
          )}
          {bottomTab === "clip" && <ClipPanel selectedClip={selectedClip} fmt={fmt} />}
          {bottomTab === "notes" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Notes about this track…" style={{ flex: 1, background: "var(--bg2)",
                  border: "1px solid var(--line)", borderRadius: 8, color: "var(--text)",
                  padding: 10, fontSize: 12, resize: "none", outline: "none", fontFamily: "inherit" }} />
              <button onClick={saveNotes} style={{ ...miniBtn, alignSelf: "flex-start",
                color: notesSaved ? "#4ade80" : "var(--text)", borderColor: notesSaved ? "#4ade80" : "var(--line)" }}>
                {notesSaved ? "Saved ✓" : "Save notes"}</button>
            </div>
          )}
          {bottomTab === "info" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
              <Info label="Duration" v={fmt(track.duration)} />
              <Info label="BPM" v={Math.round(bpm)} />
              <Info label="Key" v={track.key || "—"} />
              <Info label="Model" v={track.model} />
              <Info label="Clips" v={totalClips} />
              <Info label="Track ID" v={`#${track.id}`} />
              <Info label="Markers" v={markers.length} />
              <Info label="Stems" v={stemsSplit ? "split" : "not split"} />
            </div>
          )}
        </div>
      </div>

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {/* clip context menu */}
      {ctxMenu && (
        <>
          {/* click-away backdrop */}
          <div onMouseDown={closeCtx}
            style={{ position: "fixed", inset: 0, zIndex: 998 }} />
          <ClipContextMenu
            x={ctxMenu.x} y={ctxMenu.y}
            clip={ctxMenu.clip} stemName={ctxMenu.stem}
            selected={selIds.has(ctxMenu.clip.id)}
            fmt={fmt}
            stemMuted={stems.find(s => s.name === ctxMenu.stem)?.muted ?? false}
            hasPaste={!!clipboard}
            onClose={closeCtx}
            onCopy={() => { editCopy(); setStatusMsg("Copied — ⌘V to paste at playhead"); }}
            onCut={() => { editCopy(); editDelete(); }}
            onPaste={editPaste}
            onDuplicate={editDuplicate}
            onDelete={editDelete}
            onSilence={editSilence}
            onFadeIn={editFadeIn}
            onFadeOut={editFadeOut}
            onReverse={editReverse}
            onSplitHere={() => splitClipAt(ctxMenu.stem, playhead)}
            onMuteToggle={() => updateStem(ctxMenu.stem, { muted: !stems.find(s => s.name === ctxMenu.stem)?.muted })}
            onLoopThis={() => { setLoopA(ctxMenu.clip.start); setLoopB(ctxMenu.clip.end); setLoopOn(true); play(ctxMenu.clip.start); }}
          />
        </>
      )}
    </div>
  );
}

// ── small UI helpers ──────────────────────────────────────────────────────────
const miniBtn: React.CSSProperties = { background: "var(--bg3)", border: "1px solid var(--line)",
  color: "var(--muted)", borderRadius: 6, padding: "4px 9px", fontSize: 10, cursor: "pointer", fontWeight: 600 };

function Chip({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: "var(--muted)", background: "var(--bg3)",
    padding: "3px 8px", borderRadius: 6 }}>{children}</div>;
}
function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title?: string }) {
  return <button onClick={onClick} title={title} style={{ background: "var(--bg3)", border: "1px solid var(--line)",
    color: "var(--text)", borderRadius: 6, minWidth: 28, height: 28, cursor: "pointer", fontSize: 13,
    display: "flex", alignItems: "center", justifyContent: "center", padding: "0 6px" }}>{children}</button>;
}
function Toggle({ children, active, onClick, title }: { children: React.ReactNode; active: boolean; onClick: () => void; title?: string }) {
  return <button onClick={onClick} title={title} style={{
    background: active ? "rgba(139,92,255,.2)" : "var(--bg3)",
    border: `1px solid ${active ? "var(--accent)" : "var(--line)"}`,
    color: active ? "var(--accent)" : "var(--muted)", borderRadius: 6, height: 28,
    padding: "0 9px", cursor: "pointer", fontSize: 11, fontWeight: 600 }}>{children}</button>;
}
function Info({ label, v }: { label: string; v: React.ReactNode }) {
  return <div><div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 700 }}>{v}</div></div>;
}

// ── LaneHeader (with pan + VU) ──────────────────────────────────────────────
function LaneHeader({ stem, height, onMute, onSolo, onVol, onPan }: {
  stem: StemState; height: number; onMute: () => void; onSolo: () => void;
  onVol: (v: number) => void; onPan: (p: number) => void;
}) {
  return (
    <div style={{ height, borderBottom: "1px solid var(--line)", borderLeft: `3px solid ${stem.color}`,
      padding: "6px 9px", display: "flex", flexDirection: "column", gap: 4, justifyContent: "center",
      opacity: stem.muted ? 0.45 : 1, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: stem.color, letterSpacing: 1 }}>{stem.label}</span>
        {/* VU meter */}
        <div style={{ flex: 1, height: 4, background: "var(--bg3)", borderRadius: 2, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(100, stem.level * 130)}%`,
            background: stem.level > 0.8 ? "#ef4444" : stem.color, transition: "width .05s" }} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <MiniToggle label="M" active={stem.muted} color="#ef4444" onClick={onMute} />
        <MiniToggle label="S" active={stem.solo} color="#fbbf24" onClick={onSolo} />
        <input type="range" min={0} max={1.4} step={0.01} value={stem.volume}
          onChange={e => onVol(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: stem.color, height: 3 }} title="Volume" />
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 8, color: "var(--muted)" }}>L</span>
        <input type="range" min={-1} max={1} step={0.05} value={stem.pan}
          onChange={e => onPan(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: "var(--accent2)", height: 3 }} title="Pan" />
        <span style={{ fontSize: 8, color: "var(--muted)" }}>R</span>
      </div>
    </div>
  );
}
function MiniToggle({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return <button onClick={e => { e.stopPropagation(); onClick(); }} style={{
    background: active ? color : "var(--bg3)", border: `1px solid ${active ? color : "var(--line)"}`,
    color: active ? "#000" : "var(--muted)", borderRadius: 4, width: 20, height: 16, fontSize: 9,
    fontWeight: 800, cursor: "pointer", padding: 0 }}>{label}</button>;
}

// ── Ruler ───────────────────────────────────────────────────────────────────
function Ruler({ duration, pxPerSec, height, secPerBeat, useBars, onSeek, markers, loopOn, loopA, loopB }: {
  duration: number; pxPerSec: number; height: number; secPerBeat: number; useBars: boolean;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void; markers: Marker[];
  loopOn: boolean; loopA: number; loopB: number;
}) {
  const totalPx = duration * pxPerSec;
  const ticks: React.ReactNode[] = [];
  if (useBars) {
    const barSec = secPerBeat * 4;
    for (let t = 0, bar = 1; t <= duration; t += barSec, bar++) {
      ticks.push(<Tick key={t} x={t * pxPerSec} label={`${bar}`} big />);
    }
  } else {
    const step = pxPerSec >= 160 ? 1 : pxPerSec >= 60 ? 2 : pxPerSec >= 30 ? 5 : 10;
    for (let t = 0; t <= duration; t += step) {
      ticks.push(<Tick key={t} x={t * pxPerSec} label={`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`} big />);
    }
  }
  return (
    <div onClick={onSeek} style={{ height, background: "var(--bg2)", borderBottom: "1px solid var(--line)",
      position: "relative", width: totalPx, cursor: "pointer", zIndex: 10 }}>
      {ticks}
      {markers.map(m => (
        <div key={m.id} style={{ position: "absolute", left: m.time * pxPerSec, top: 0,
          fontSize: 8, color: "#fbbf24", paddingLeft: 3, fontWeight: 700 }}>▼{m.label}</div>
      ))}
    </div>
  );
}
function Tick({ x, label, big }: { x: number; label: string; big?: boolean }) {
  return <div style={{ position: "absolute", left: x, top: 0, bottom: 0, width: 1,
    background: big ? "#44445a" : "#2a2a3a" }}>
    <span style={{ position: "absolute", left: 3, top: 6, fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap" }}>{label}</span>
  </div>;
}

// ── Clip context menu ─────────────────────────────────────────────────────────
interface CtxMenuProps {
  x: number; y: number; clip: Clip; stemName: string; selected: boolean;
  onClose: () => void;
  onCopy: () => void; onCut: () => void; onPaste: () => void; hasPaste: boolean;
  onDuplicate: () => void; onDelete: () => void; onSilence: () => void;
  onFadeIn: () => void; onFadeOut: () => void; onReverse: () => void;
  onSplitHere: () => void; onMuteToggle: () => void; stemMuted: boolean;
  onLoopThis: () => void;
  fmt: (s: number) => string;
}
function ClipContextMenu({ x, y, clip, stemName, selected, onClose,
  onCopy, onCut, onPaste, hasPaste, onDuplicate, onDelete, onSilence,
  onFadeIn, onFadeOut, onReverse, onSplitHere, onMuteToggle, stemMuted,
  onLoopThis, fmt }: CtxMenuProps) {
  // keep menu on screen
  const menuW = 220, menuH = 340;
  const left = Math.min(x, window.innerWidth - menuW - 8);
  const top  = Math.min(y, window.innerHeight - menuH - 8);

  const item = (label: string, action: () => void, shortcut?: string, danger?: boolean) => (
    <button onMouseDown={e => { e.stopPropagation(); action(); onClose(); }} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      width: "100%", padding: "7px 14px", background: "none", border: "none",
      color: danger ? "#f87171" : "var(--text)", fontSize: 13, cursor: "pointer",
      textAlign: "left", gap: 12,
    }}
    onMouseEnter={e => (e.currentTarget.style.background = "rgba(139,92,255,.18)")}
    onMouseLeave={e => (e.currentTarget.style.background = "none")}>
      <span>{label}</span>
      {shortcut && <kbd style={{ fontSize: 10, color: "var(--muted)", background: "var(--bg3)",
        padding: "1px 5px", borderRadius: 3 }}>{shortcut}</kbd>}
    </button>
  );
  const divider = () => <div style={{ height: 1, background: "var(--line)", margin: "3px 0" }} />;
  const header = (label: string) => (
    <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: 1.2, textTransform: "uppercase",
      padding: "6px 14px 2px", fontWeight: 700 }}>{label}</div>
  );

  return (
    <div onMouseDown={e => e.stopPropagation()} style={{
      position: "fixed", left, top, zIndex: 999, minWidth: menuW,
      background: "var(--bg1)", border: "1px solid var(--line2)",
      borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.04)",
      overflow: "hidden", userSelect: "none",
    }}>
      {/* clip info header */}
      <div style={{ padding: "9px 14px 6px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent2)",
          textTransform: "uppercase", letterSpacing: .5 }}>{stemName}</div>
        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
          {fmt(clip.start)} – {fmt(clip.end)} · {(clip.dur).toFixed(2)}s
        </div>
      </div>
      {header("Edit")}
      {item("Copy",      onCopy,      "⌘C")}
      {item("Cut",       onCut,       "⌘X")}
      {item("Paste",     onPaste,     "⌘V")}
      {item("Duplicate", onDuplicate, "⌘D")}
      {divider()}
      {header("Region")}
      {item("Fade In",   onFadeIn)}
      {item("Fade Out",  onFadeOut)}
      {item("Reverse",   onReverse)}
      {item("Silence",   onSilence)}
      {item("Split here",onSplitHere,"B")}
      {item("Loop this", onLoopThis)}
      {divider()}
      {item(stemMuted ? "Unmute stem" : "Mute stem", onMuteToggle)}
      {divider()}
      {item("Delete", onDelete, "⌫", true)}
    </div>
  );
}

// ── Lane (waveform + clip blocks + beat grid + multi-select) ──────────────────
function Lane({ stem, pxPerSec, height, showGrid, secPerBeat, duration, selectedIds, primaryId,
  dragBox, splitMode, editable, snapTime, onNoteClick, onBoxStart, onBoxMove, onBoxEnd, onSeek,
  onMoveClip, onTrimClip, onSplitClip, onCtxMenu }: {
  stem: StemState; pxPerSec: number; height: number; showGrid: boolean; secPerBeat: number;
  duration: number; selectedIds: Set<number> | null; primaryId: number | null;
  dragBox: { x0: number; x1: number } | null; splitMode: boolean; editable: boolean;
  snapTime: (t: number) => number;
  onNoteClick: (c: Clip, shift: boolean) => void;
  onBoxStart: (x: number) => void; onBoxMove: (x: number) => void; onBoxEnd: () => void;
  onSeek: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMoveClip: (c: Clip, newStart: number) => void;
  onTrimClip: (c: Clip, edge: "l" | "r", newTime: number) => void;
  onSplitClip: (time: number) => void;
  onCtxMenu: (clip: Clip, x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const totalPx = Math.max(1, stem.duration * pxPerSec);
  const dragging = useRef(false);
  // live preview of a clip gesture (move / trim) before it's committed on mouse-up
  const [ghost, setGhost] = useState<{ id: number; start: number; end: number } | null>(null);
  const ghostRef = useRef<{ id: number; start: number; end: number } | null>(null);
  const setGhostBoth = (g: { id: number; start: number; end: number } | null) => { ghostRef.current = g; setGhost(g); };
  const clipDrag = useRef<{ id: number; mode: "move" | "l" | "r"; x0: number; s0: number; e0: number; moved: boolean } | null>(null);
  const EDGE = 7;  // px hot-zone for edge trim

  const localX = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return e.clientX - rect.left;
  };

  // begin a clip move/trim drag; resolves edge vs body from where in the clip we grabbed
  const onClipDown = (e: React.MouseEvent, clip: Clip) => {
    e.stopPropagation();
    if (splitMode) return;   // split mode handles its own click
    if (!editable) { onNoteClick(clip, e.shiftKey); return; }   // master: select only
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offX = e.clientX - rect.left;
    const w = rect.width;
    const shiftKey = e.shiftKey;
    const mode: "move" | "l" | "r" = offX <= EDGE ? "l" : offX >= w - EDGE ? "r" : "move";
    clipDrag.current = { id: clip.id, mode, x0: e.clientX, s0: clip.start, e0: clip.end, moved: false };
    const onMove = (ev: MouseEvent) => {
      const d = clipDrag.current; if (!d) return;
      const dt = (ev.clientX - d.x0) / pxPerSec;
      if (Math.abs(ev.clientX - d.x0) > 3) d.moved = true;
      if (d.mode === "move") {
        const len = d.e0 - d.s0;
        let ns = Math.max(0, snapTime(d.s0 + dt));
        setGhostBoth({ id: d.id, start: ns, end: ns + len });
      } else if (d.mode === "l") {
        const ns = Math.min(snapTime(d.s0 + dt), d.e0 - 0.05);
        setGhostBoth({ id: d.id, start: Math.max(0, ns), end: d.e0 });
      } else {
        const ne = Math.max(snapTime(d.e0 + dt), d.s0 + 0.05);
        setGhostBoth({ id: d.id, start: d.s0, end: Math.min(duration, ne) });
      }
    };
    const onUp = () => {
      const d = clipDrag.current; clipDrag.current = null;
      window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp);
      // capture the final previewed position, clear the ghost, THEN commit to the
      // parent — never call a parent setState from inside this component's updater.
      const g = ghostRef.current;
      setGhostBoth(null);
      if (d && d.moved && g && g.id === d.id && isFinite(g.start) && isFinite(g.end)) {
        if (d.mode === "move") onMoveClip(clip, g.start);
        else if (d.mode === "l") onTrimClip(clip, "l", g.start);
        else onTrimClip(clip, "r", g.end);
      } else if (d && !d.moved) {
        onNoteClick(clip, shiftKey);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    const c = canvasRef.current; if (!c || !stem.peaks?.length) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    // Scale for device pixel ratio — prevents blur on retina/HiDPI displays
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, Math.round(totalPx));
    const cssH = height;
    // Only resize backing store when dimensions actually changed (avoids white-flash
    // caused by the browser clearing the canvas every time width is reassigned)
    if (c.width !== Math.round(cssW * dpr) || c.height !== Math.round(cssH * dpr)) {
      c.width  = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width  = `${cssW}px`;
      c.style.height = `${cssH}px`;
    }
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);
    const step = stem.peaks.length / cssW;
    const mid = cssH / 2;
    ctx.globalAlpha = stem.muted ? 0.3 : 0.65;
    ctx.strokeStyle = stem.muted ? stem.colorDim : stem.color;
    ctx.lineWidth = 1;
    for (let x = 0; x < cssW; x++) {
      const p = stem.peaks[Math.floor(x * step)] ?? 0;
      const h = Math.max(1, p * (mid - 3));
      ctx.beginPath(); ctx.moveTo(x, mid - h); ctx.lineTo(x, mid + h); ctx.stroke();
    }
    ctx.restore();
  }, [stem.peaks, stem.muted, stem.color, stem.colorDim, totalPx, height]);

  // beat grid lines
  const gridLines: React.ReactNode[] = [];
  if (showGrid && secPerBeat > 0) {
    for (let t = 0, i = 0; t <= duration; t += secPerBeat, i++) {
      gridLines.push(<div key={i} style={{ position: "absolute", left: t * pxPerSec, top: 0, bottom: 0,
        width: 1, background: i % 4 === 0 ? "rgba(255,255,255,.07)" : "rgba(255,255,255,.03)" }} />);
    }
  }

  return (
    <div
      onMouseDown={e => {
        // start a rubber-band drag only on empty lane area (not on a clip)
        if ((e.target as HTMLElement).dataset.clip) return;
        dragging.current = true; onBoxStart(localX(e));
      }}
      onMouseMove={e => { if (dragging.current) onBoxMove(localX(e)); }}
      onMouseUp={e => {
        if (dragging.current) {
          dragging.current = false;
          const moved = dragBox && Math.abs(dragBox.x1 - dragBox.x0) > 4;
          if (moved) { onBoxEnd(); } else { onBoxEnd(); onSeek(e); }   // tiny drag = seek
        }
      }}
      onMouseLeave={() => { if (dragging.current) { dragging.current = false; onBoxEnd(); } }}
      style={{ height, borderBottom: "1px solid var(--line)", position: "relative",
        width: totalPx, background: stem.muted ? "rgba(0,0,0,.3)" : "transparent",
        overflow: "hidden", cursor: "crosshair" }}>
      {gridLines}
      <canvas ref={canvasRef} style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }} />
      {/* clip blocks under the notes */}
      {stem.clips.map(clip => {
        const g = ghost && ghost.id === clip.id ? ghost : null;
        const cs = g ? g.start : clip.start;
        const ce = g ? g.end : clip.end;
        if (!isFinite(cs) || !isFinite(ce)) return null;   // guard malformed clip
        const x = cs * pxPerSec;
        const w = Math.max(MIN_CLIP_W, (ce - cs) * pxPerSec);
        const sel = selectedIds?.has(clip.id) ?? false;
        const primary = primaryId === clip.id;
        const intensity = Math.max(0, Math.min(1, clip.peak ?? 0.4));
        // parse stem.color (#rrggbb) → r,g,b so we can use rgba() for opacity
        // avoids the hex-opacity math that caused white flashes at extreme zoom levels
        const hex = stem.color.replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16);
        const g2 = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        const clipBg = g
          ? `rgba(${r},${g2},${b},0.67)`
          : sel
          ? `rgba(${r},${g2},${b},0.53)`
          : `rgba(${r},${g2},${b},${(0.08 + intensity * 0.22).toFixed(2)})`;
        const cur = !editable ? "pointer" : splitMode ? "col-resize" : "grab";
        return (
          <div key={clip.id} data-clip="1"
            onContextMenu={e => { e.preventDefault(); e.stopPropagation();
              onNoteClick(clip, false);   // select it first
              onCtxMenu(clip, e.clientX, e.clientY); }}
            onMouseDown={e => {
              if (editable && splitMode) { e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onSplitClip((cs * pxPerSec + (e.clientX - rect.left)) / pxPerSec); return; }
              onClipDown(e, clip);
            }}
            title={!editable
              ? `${cs.toFixed(2)}s – ${ce.toFixed(2)}s (master — edit on stem lanes)`
              : splitMode
              ? `Click to split at cursor`
              : `${cs.toFixed(2)}s – ${ce.toFixed(2)}s · ${(ce - cs).toFixed(2)}s — drag body to move, drag edges to trim`}
            style={{ position: "absolute", left: x, top: 7, height: height - 14, width: w,
              background: clipBg,
              border: `1px solid ${g ? "rgba(255,255,255,0.8)" : sel ? "rgba(255,255,255,0.6)" : `rgba(${r},${g2},${b},0.33)`}`, borderRadius: 3, cursor: cur,
              zIndex: g ? 8 : sel ? 6 : 5, boxShadow: g ? `0 0 12px ${stem.color}` : primary ? `0 0 10px ${stem.color}` : sel ? `0 0 5px ${stem.color}` : "none",
              transition: g ? "none" : "background .1s" }}>
            {/* edge trim handles (hidden in split mode / on master) */}
            {editable && !splitMode && w > 14 && <>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: EDGE,
                cursor: "ew-resize", background: "rgba(255,255,255,.08)" }} />
              <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: EDGE,
                cursor: "ew-resize", background: "rgba(255,255,255,.08)" }} />
            </>}
          </div>
        );
      })}
      {/* rubber-band selection box */}
      {dragBox && (
        <div style={{ position: "absolute", top: 4, bottom: 4,
          left: Math.min(dragBox.x0, dragBox.x1), width: Math.abs(dragBox.x1 - dragBox.x0),
          background: `${stem.color}22`, border: `1px dashed ${stem.color}`,
          pointerEvents: "none", zIndex: 7, borderRadius: 3 }} />
      )}
    </div>
  );
}

// ── Automation lane — draw a vol/pan curve over time under a stem ─────────────
function AutomationLane({ stem, lane, pxPerSec, duration, secPerBeat, showGrid,
  onAdd, onMove, onDelete, onClear }: {
  stem: StemState; lane: AutoLane; pxPerSec: number; duration: number;
  secPerBeat: number; showGrid: boolean;
  onAdd: (t: number, v: number) => void;
  onMove: (idx: number, t: number, v: number) => void;
  onDelete: (idx: number) => void; onClear: () => void;
}) {
  const H = AUTO_LANE_H;
  const totalPx = Math.max(1, duration * pxPerSec);
  const r = AUTO_RANGE[lane];
  const pts = [...stem.auto[lane]].map((p, i) => ({ ...p, i })).sort((a, b) => a.t - b.t);
  const drag = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // value → y (top = max), x → time
  const toY = (v: number) => H - ((v - r.min) / (r.max - r.min)) * (H - 6) - 3;
  const toX = (t: number) => t * pxPerSec;
  const fromXY = (px: number, py: number) => {
    const t = Math.max(0, Math.min(px / pxPerSec, duration));
    const v = r.min + (1 - (py - 3) / (H - 6)) * (r.max - r.min);
    return { t, v: Math.max(r.min, Math.min(r.max, v)) };
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  // build the curve path (with implicit flat ends to the static value)
  const base = lane === "vol" ? stem.volume : stem.pan;
  const seq = pts.length ? pts : [{ t: 0, v: base, i: -1 }, { t: duration, v: base, i: -2 }];
  let d = "";
  if (pts.length) {
    d = `M ${toX(0)} ${toY(pts[0].v)} `;
    for (const p of pts) d += `L ${toX(p.t)} ${toY(p.v)} `;
    d += `L ${toX(duration)} ${toY(pts[pts.length - 1].v)}`;
  } else {
    d = `M ${toX(0)} ${toY(base)} L ${toX(duration)} ${toY(base)}`;
  }

  const startDrag = (idx: number, e: React.MouseEvent) => {
    e.stopPropagation(); drag.current = idx;
    const onMv = (ev: MouseEvent) => {
      if (drag.current == null) return;
      const { px, py } = local(ev);
      const { t, v } = fromXY(px, py);
      onMove(drag.current, t, v);
    };
    const onUp = () => { drag.current = null;
      window.removeEventListener("mousemove", onMv); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMv); window.addEventListener("mouseup", onUp);
  };

  const grid: React.ReactNode[] = [];
  if (showGrid && secPerBeat > 0) {
    for (let t = 0, i = 0; t <= duration; t += secPerBeat, i++)
      grid.push(<line key={i} x1={toX(t)} x2={toX(t)} y1={0} y2={H}
        stroke={i % 4 === 0 ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.025)"} strokeWidth={1} />);
  }

  return (
    <div style={{ height: H, borderBottom: "1px solid var(--line)", position: "relative",
      width: totalPx, background: "rgba(0,0,0,.22)" }}>
      <svg ref={svgRef} width={totalPx} height={H} style={{ display: "block", cursor: "crosshair" }}
        onMouseDown={e => {
          if ((e.target as SVGElement).dataset.pt) return;   // a point handles itself
          const { px, py } = local(e); const { t, v } = fromXY(px, py); onAdd(t, v);
        }}>
        {grid}
        {/* mid / zero reference line */}
        <line x1={0} x2={totalPx} y1={toY(r.mid)} y2={toY(r.mid)}
          stroke="rgba(255,255,255,.12)" strokeDasharray="3 4" strokeWidth={1} />
        {/* filled area under curve for readability */}
        <path d={`${d} L ${toX(duration)} ${H} L 0 ${H} Z`} fill={`${stem.color}1f`} stroke="none" />
        <path d={d} fill="none" stroke={stem.color} strokeWidth={1.8} />
        {pts.map(p => (
          <circle key={p.i} data-pt="1" cx={toX(p.t)} cy={toY(p.v)} r={4.5}
            fill={stem.color} stroke="#fff" strokeWidth={1}
            style={{ cursor: "grab" }}
            onMouseDown={e => startDrag(p.i, e)}
            onDoubleClick={e => { e.stopPropagation(); onDelete(p.i); }}
            onContextMenu={e => { e.preventDefault(); onDelete(p.i); }}>
            <title>{`${p.t.toFixed(2)}s · ${lane === "pan" ? (p.v > 0 ? "R" : p.v < 0 ? "L" : "C") + Math.round(Math.abs(p.v) * 100) : Math.round(p.v * 100) + "%"} — drag to move, dbl-click to delete`}</title>
          </circle>
        ))}
        <text x={4} y={11} fill="var(--muted)" fontSize={9} style={{ pointerEvents: "none" }}>
          {stem.label} · {r.label}{pts.length ? ` (${pts.length})` : ""}</text>
        {seq.length === 0 && null}
      </svg>
      {pts.length > 0 && (
        <button onClick={onClear} title="Clear this automation"
          style={{ position: "absolute", top: 3, right: 4, fontSize: 9, padding: "1px 5px",
            background: "var(--bg3)", border: "1px solid var(--line)", color: "var(--muted)",
            borderRadius: 4, cursor: "pointer" }}>clear</button>
      )}
    </div>
  );
}

// ── Sections panel — song structure + project export ─────────────────────────
function SectionsPanel({ sections, fmt, duration, activeId, markerCount, exporting,
  onAdd, onFromMarkers, onUpdate, onDelete, onGoto, onClear, onExportZip, presets, colors }: {
  sections: Section[]; fmt: (s: number) => string; duration: number;
  activeId: number | null; markerCount: number; exporting: boolean;
  onAdd: () => void; onFromMarkers: () => void;
  onUpdate: (id: number, patch: Partial<Section>) => void; onDelete: (id: number) => void;
  onGoto: (sec: Section) => void; onClear: () => void; onExportZip: () => void;
  presets: string[]; colors: string[];
}) {
  const eb: React.CSSProperties = { background: "var(--bg3)", border: "1px solid var(--line)",
    color: "var(--text)", borderRadius: 7, padding: "6px 11px", fontSize: 12, cursor: "pointer", fontWeight: 600 };
  const sorted = [...sections].sort((a, b) => a.start - b.start);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
        <button style={{ ...eb, background: "linear-gradient(95deg,#8b5cff,#22d3ee)", color: "#fff", border: "none" }} onClick={onAdd}>+ Section</button>
        <button style={markerCount ? eb : { ...eb, opacity: .4, cursor: "not-allowed" }} onClick={onFromMarkers}
          title="Turn every marker into a section boundary">⤵ From markers ({markerCount})</button>
        <button style={sections.length ? eb : { ...eb, opacity: .4, cursor: "not-allowed" }} onClick={onClear}>✕ Clear</button>
        <button onClick={onExportZip} disabled={exporting}
          style={{ ...eb, marginLeft: "auto", background: "linear-gradient(95deg,#22c55e,#4ade80)",
            color: "#04210f", border: "none", fontWeight: 800, opacity: exporting ? 0.6 : 1 }}>
          {exporting ? "Bundling…" : "⬇ Export stems (.zip)"}</button>
      </div>

      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
        {sorted.length === 0 && (
          <div style={{ fontSize: 12, color: "var(--muted)", opacity: .7 }}>
            No sections yet. Add one, or drop markers (+ Marker) and click “From markers”.
            Drag a block on the lane to move it; drag its edges to resize; double-click to jump.</div>
        )}
        {sorted.map(sec => (
          <div key={sec.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px",
            background: activeId === sec.id ? "var(--bg3)" : "transparent",
            border: "1px solid " + (activeId === sec.id ? sec.color : "var(--line)"), borderRadius: 6 }}>
            <button onClick={() => onGoto(sec)} title="Jump here"
              style={{ width: 14, height: 14, borderRadius: 3, background: sec.color, border: "none", cursor: "pointer", flexShrink: 0 }} />
            <input value={sec.name} onChange={e => onUpdate(sec.id, { name: e.target.value })}
              list="section-presets" style={{ width: 110, background: "var(--bg2)", border: "1px solid var(--line)",
                borderRadius: 5, color: "var(--text)", padding: "3px 6px", fontSize: 12, fontWeight: 600 }} />
            <span style={{ fontSize: 11, color: "var(--muted)", fontFamily: "monospace" }}>
              {fmt(sec.start)}–{fmt(sec.end)} · {(sec.end - sec.start).toFixed(1)}s</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
              {colors.map(c => (
                <button key={c} onClick={() => onUpdate(sec.id, { color: c })} title="Recolor"
                  style={{ width: 13, height: 13, borderRadius: 3, background: c, cursor: "pointer",
                    border: sec.color === c ? "2px solid var(--text)" : "1px solid var(--line)" }} />
              ))}
              <button onClick={() => onDelete(sec.id)} title="Delete section"
                style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>
            </div>
          </div>
        ))}
      </div>
      <datalist id="section-presets">{presets.map(p => <option key={p} value={p} />)}</datalist>
    </div>
  );
}

// ── AI tools — generative stem editing (regenerate / extend / swap) ──────────
function AiTools({ target, stemNames, busy, onRegenerate, onExtend, onSwap, onRevert, onCancel, fmt }: {
  target: { stem: string; start: number; end: number } | null; stemNames: string[];
  busy: string; fmt: (s: number) => string;
  onRegenerate: (stem: string, prompt: string) => void;
  onExtend: (stem: string, prompt: string, addDuration: number) => void;
  onSwap: (stem: string, prompt: string) => void;
  onRevert: (stem: string) => void; onCancel: () => void;
}) {
  const [stem, setStem] = useState(stemNames[0] || "vocals");
  const [prompt, setPrompt] = useState("");
  const [addDur, setAddDur] = useState(8);
  // when a region is selected, AI ops default to that stem
  useEffect(() => { if (target) setStem(target.stem); }, [target]);

  const eb: React.CSSProperties = { background: "var(--bg3)", border: "1px solid var(--line)",
    color: "var(--text)", borderRadius: 7, padding: "7px 11px", fontSize: 12, cursor: "pointer", fontWeight: 600 };
  const busyEb: React.CSSProperties = { ...eb, opacity: 0.4, cursor: "not-allowed" };
  const isBusy = !!busy;
  const inp: React.CSSProperties = { background: "var(--bg2)", border: "1px solid var(--line)",
    borderRadius: 6, color: "var(--text)", padding: "6px 8px", fontSize: 12, outline: "none" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9, borderTop: "1px dashed var(--line)", paddingTop: 10, marginTop: 4 }}>
      <div style={{ fontSize: 10, color: "var(--accent2)", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        🤖 AI tools {target ? `· region ${fmt(target.start)}–${fmt(target.end)}` : "· whole stem"}</div>

      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        <select value={stem} onChange={e => setStem(e.target.value)} style={{ ...inp, width: 92 }}>
          {stemNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <input value={prompt} onChange={e => setPrompt(e.target.value)}
          placeholder="describe the sound (e.g. 'punchier 808 bass', 'airy female harmony')"
          style={{ ...inp, flex: 1, minWidth: 200 }} />
      </div>

      <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
        <button style={isBusy ? busyEb : eb} disabled={isBusy}
          onClick={() => onRegenerate(stem, prompt)}
          title="Regenerate the selected region of this stem from the prompt (rest kept)">
          ✨ Regenerate {target ? "region" : "(select a region)"}</button>
        <button style={isBusy ? busyEb : eb} disabled={isBusy}
          onClick={() => onSwap(stem, prompt)}
          title="Replace the whole stem with a new instrument/sound, keeping the vibe">
          🔁 Swap instrument</button>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>+</span>
        <input type="number" min={2} max={30} value={addDur}
          onChange={e => setAddDur(Math.max(2, Math.min(30, parseInt(e.target.value) || 8)))}
          style={{ ...inp, width: 56 }} />
        <span style={{ fontSize: 11, color: "var(--muted)" }}>s</span>
        <button style={isBusy ? busyEb : eb} disabled={isBusy}
          onClick={() => onExtend(stem, prompt, addDur)}
          title="AI-continue this stem so it flows from its own ending (lengthens it)">
          ➕ Extend stem</button>
        <button style={isBusy ? busyEb : eb} disabled={isBusy}
          onClick={() => onRevert(stem)} title="Restore this stem to before any AI edits">↺ Revert AI</button>
        {isBusy && (
          <button onClick={onCancel}
            style={{ ...eb, background: "linear-gradient(95deg,#ef4444,#f87171)", color: "#fff", border: "none", marginLeft: "auto" }}>
            ■ Stop ({busy})</button>
        )}
      </div>
      {isBusy && <div style={{ fontSize: 10, color: "var(--muted)" }}>AI is generating — closing this tab will stop it.</div>}
    </div>
  );
}

// ── Edit panel — non-destructive clip editing + history ──────────────────────
function EditPanel({ stemsSplit, target, count, fmt, hist, clipboard, rendering,
  onDelete, onSilence, onDuplicate, onPasteHere, onReverse, onFadeIn, onFadeOut, onGain,
  onMoveTo, onCopy, onPaste, onUndo, onRedo, onClear, onRender, onExportStem, onSplit, stemNames,
  aiBusy, onAiRegenerate, onAiExtend, onAiSwap, onAiRevert, onAiCancel }: {
  stemsSplit: boolean; target: { stem: string; start: number; end: number } | null; count: number;
  fmt: (s: number) => string;
  hist: { ops: { op: string; stem: string; start?: number; end?: number }[]; head: number; can_undo: boolean; can_redo: boolean };
  clipboard: { stem: string } | null; rendering: boolean;
  onDelete: () => void; onSilence: () => void; onDuplicate: () => void; onPasteHere: () => void;
  onReverse: () => void; onFadeIn: () => void; onFadeOut: () => void; onGain: (db: number) => void;
  onMoveTo: () => void; onCopy: () => void; onPaste: () => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void; onRender: () => void;
  onExportStem: (s: string) => void; onSplit: () => void; stemNames: string[];
  aiBusy: string;
  onAiRegenerate: (stem: string, prompt: string) => void;
  onAiExtend: (stem: string, prompt: string, addDuration: number) => void;
  onAiSwap: (stem: string, prompt: string) => void;
  onAiRevert: (stem: string) => void; onAiCancel: () => void;
}) {
  const eb: React.CSSProperties = { background: "var(--bg3)", border: "1px solid var(--line)",
    color: "var(--text)", borderRadius: 7, padding: "7px 12px", fontSize: 12, cursor: "pointer", fontWeight: 600 };
  const disabledEb: React.CSSProperties = { ...eb, opacity: 0.4, cursor: "not-allowed" };

  if (!stemsSplit) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        height: "100%", gap: 12, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>
        <div>Split the track into stems to edit individual parts<br/>(delete vocals, duplicate drums, fade, reverse…).</div>
        <button onClick={onSplit} style={{ ...eb, background: "linear-gradient(95deg,#8b5cff,#22d3ee)", color: "#fff", border: "none", padding: "9px 18px" }}>🔪 Split into stems</button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, height: "100%" }}>
      {/* LEFT: tools */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, overflow: "auto" }}>
        <div style={{ fontSize: 11, color: "var(--muted)" }}>
          {target
            ? <>Editing <b style={{ color: "var(--text)", textTransform: "uppercase" }}>{target.stem}</b> · {count} clip{count !== 1 ? "s" : ""} · {fmt(target.start)}–{fmt(target.end)}</>
            : "Select clip(s) in a stem lane (drag-box or click) to edit that region."}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          <button style={target ? eb : disabledEb} onClick={onDelete} title="Remove this region (timeline shrinks) — Del">🗑 Delete</button>
          <button style={target ? eb : disabledEb} onClick={onSilence} title="Mute this region in place (keeps timing)">🔇 Silence</button>
          <button style={target ? eb : disabledEb} onClick={onDuplicate} title="Copy this region right after itself — ⌘D">⧉ Duplicate</button>
          <button style={target ? eb : disabledEb} onClick={onPasteHere} title="Insert a copy at the playhead">📋 Copy → playhead</button>
          <button style={target ? eb : disabledEb} onClick={onMoveTo} title="Cut this region and move it to the playhead">↔ Move → playhead</button>
          <button style={target ? eb : disabledEb} onClick={onReverse} title="Reverse this region">⏪ Reverse</button>
          <button style={target ? eb : disabledEb} onClick={onFadeIn} title="Fade in across the region">▁▂▃ Fade in</button>
          <button style={target ? eb : disabledEb} onClick={onFadeOut} title="Fade out across the region">▃▂▁ Fade out</button>
          <button style={target ? eb : disabledEb} onClick={onCopy} title="Copy region to clipboard — ⌘C">⎘ Copy</button>
          <button style={clipboard ? eb : disabledEb} onClick={onPaste} title="Paste clipboard at playhead — ⌘V">📥 Paste{clipboard ? ` (${clipboard.stem})` : ""}</button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Gain:</span>
          {[-6, -3, +3, +6].map(db => (
            <button key={db} style={target ? eb : disabledEb} onClick={() => onGain(db)}>{db > 0 ? "+" : ""}{db}dB</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, flexWrap: "wrap" }}>
          <button style={hist.can_undo ? eb : disabledEb} onClick={onUndo} title="Undo — ⌘Z">↶ Undo</button>
          <button style={hist.can_redo ? eb : disabledEb} onClick={onRedo} title="Redo — ⌘⇧Z">↷ Redo</button>
          <button style={hist.ops.length ? eb : disabledEb} onClick={onClear} title="Discard all edits">✕ Clear</button>
          <button onClick={onRender} disabled={!hist.head || rendering}
            style={{ ...eb, marginLeft: "auto", background: hist.head ? "linear-gradient(95deg,#22c55e,#4ade80)" : "var(--bg3)",
              color: hist.head ? "#04210f" : "var(--muted)", border: "none", fontWeight: 800,
              opacity: rendering ? 0.6 : 1 }}>
            {rendering ? "Rendering…" : `⬇ Render (${hist.head})`}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 2, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Export one stem:</span>
          {stemNames.map(n => (
            <button key={n} style={eb} onClick={() => onExportStem(n)} title={`Render just ${n} (with its edits) to a new track`}>{n}</button>
          ))}
        </div>

        <AiTools target={target} stemNames={stemNames} busy={aiBusy} fmt={fmt}
          onRegenerate={onAiRegenerate} onExtend={onAiExtend} onSwap={onAiSwap}
          onRevert={onAiRevert} onCancel={onAiCancel} />
      </div>

      {/* RIGHT: history stack */}
      <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 14, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
          History ({hist.head}/{hist.ops.length})</div>
        <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 3 }}>
          {hist.ops.length === 0 && <div style={{ fontSize: 11, color: "var(--muted)", opacity: .6 }}>No edits yet.</div>}
          {hist.ops.map((o, i) => {
            const live = i < hist.head;
            return (
              <div key={i} style={{ fontSize: 11, padding: "4px 8px", borderRadius: 5,
                background: live ? "var(--bg3)" : "transparent",
                color: live ? "var(--text)" : "var(--muted)", opacity: live ? 1 : 0.45,
                border: "1px solid " + (live ? "var(--line)" : "transparent"),
                textDecoration: live ? "none" : "line-through" }}>
                <b style={{ textTransform: "capitalize" }}>{o.op}</b> · {o.stem}
                {o.start !== undefined && o.end !== undefined ? ` · ${fmt(o.start)}–${fmt(o.end)}` : ""}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Fx knob — compact labeled slider for the per-stem effects rack ───────────
function FxKnob({ label, v, min, max, step, unit, pct, color, onChange }: {
  label: string; v: number; min: number; max: number; step: number;
  unit?: string; pct?: boolean; color: string; onChange: (v: number) => void;
}) {
  const display = pct ? `${Math.round(v * 100)}` : (v > 0 ? `+${v}` : `${v}`);
  const active = v !== 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ fontSize: 8, color: active ? color : "var(--muted)", width: 24, fontWeight: 700, letterSpacing: .5 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={v}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ accentColor: color, width: 38, height: 12 }} title={`${label}: ${display}${unit || (pct ? "%" : "")}`} />
      <span style={{ fontSize: 8, color: "var(--muted)", width: 16, textAlign: "right" }}>{display}</span>
    </div>
  );
}

// ── Mixer panel ────────────────────────────────────────────────────────────
function MixerPanel({ stems, stemsSplit, splitting, splitMsg, masterVol, statusMsg,
  onSplit, onUpdate, onMaster, onReset, onMixdown,
  onFx, limiterOn, onLimiter, fxBypass, onBypass }: {
  stems: StemState[]; stemsSplit: boolean; splitting: boolean; splitMsg: string;
  masterVol: number; statusMsg: string;
  onSplit: () => void; onUpdate: (n: string, p: Partial<StemState>) => void;
  onMaster: (v: number) => void; onReset: () => void; onMixdown: () => void;
  onFx: (n: string, p: Partial<StemFx>) => void;
  limiterOn: boolean; onLimiter: () => void; fxBypass: boolean; onBypass: () => void;
}) {
  if (!stemsSplit) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
        <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
          Split into <b>Drums / Bass / Other / Vocals</b> to mix each independently and see every sound as its own colored lane of clip blocks.
          <br /><span style={{ color: "#f472b6" }}>Screeching noise lands in “Other” → mute it, then mix down.</span>
        </div>
        <button onClick={onSplit} disabled={splitting} style={{
          background: splitting ? "var(--bg3)" : "linear-gradient(95deg,#8b5cff,#22d3ee)",
          border: "none", borderRadius: 8, color: "#fff", padding: "8px 16px", fontSize: 12,
          fontWeight: 700, cursor: splitting ? "not-allowed" : "pointer", alignSelf: "flex-start" }}>
          {splitting ? "Splitting…" : "🔪 Split into stems"}</button>
        {splitMsg && <div style={{ fontSize: 11, color: splitMsg.startsWith("✅") ? "#4ade80" : "#f87171" }}>{splitMsg}</div>}
      </div>
    );
  }
  const channels = stems.filter(s => s.name !== "master");
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
      {channels.map(s => (
        <div key={s.name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
          background: "var(--bg2)", border: `1px solid ${s.muted ? "var(--line)" : s.color + "55"}`,
          borderRadius: 8, padding: "10px 8px", width: 84 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: s.color, letterSpacing: 1 }}>{s.label}</span>
          <div style={{ height: 70, width: 6, background: "var(--bg3)", borderRadius: 3, overflow: "hidden",
            display: "flex", flexDirection: "column-reverse" }}>
            <div style={{ width: "100%", height: `${Math.min(100, s.level * 130)}%`,
              background: s.level > 0.8 ? "#ef4444" : s.color, transition: "height .05s" }} />
          </div>
          <input type="range" min={0} max={1.4} step={0.01} value={s.volume}
            onChange={e => onUpdate(s.name, { volume: parseFloat(e.target.value) })}
            style={{ accentColor: s.color, width: 70 }} />
          <div style={{ fontSize: 9, color: "var(--muted)" }}>{Math.round(s.volume * 100)}%</div>
          <input type="range" min={-1} max={1} step={0.05} value={s.pan}
            onChange={e => onUpdate(s.name, { pan: parseFloat(e.target.value) })}
            style={{ accentColor: "var(--accent2)", width: 70 }} title="Pan" />
          <div style={{ display: "flex", gap: 4 }}>
            <MiniToggle label="M" active={s.muted} color="#ef4444" onClick={() => onUpdate(s.name, { muted: !s.muted })} />
            <MiniToggle label="S" active={s.solo} color="#fbbf24" onClick={() => onUpdate(s.name, { solo: !s.solo })} />
          </div>
          {/* per-stem effects rack */}
          <div style={{ width: 70, borderTop: "1px solid var(--line)", paddingTop: 6, marginTop: 2,
            display: "flex", flexDirection: "column", gap: 3, opacity: fxBypass ? 0.4 : 1 }}>
            <FxKnob label="LOW"  v={s.fx.eqLow}  min={-12} max={12} step={1} unit="dB" color={s.color} onChange={v => onFx(s.name, { eqLow: v })} />
            <FxKnob label="MID"  v={s.fx.eqMid}  min={-12} max={12} step={1} unit="dB" color={s.color} onChange={v => onFx(s.name, { eqMid: v })} />
            <FxKnob label="HIGH" v={s.fx.eqHigh} min={-12} max={12} step={1} unit="dB" color={s.color} onChange={v => onFx(s.name, { eqHigh: v })} />
            <FxKnob label="COMP" v={s.fx.comp}   min={0} max={1} step={0.05} pct color="#fbbf24" onChange={v => onFx(s.name, { comp: v })} />
            <FxKnob label="REV"  v={s.fx.reverb} min={0} max={1} step={0.05} pct color="#22d3ee" onChange={v => onFx(s.name, { reverb: v })} />
            <FxKnob label="DLY"  v={s.fx.delay}  min={0} max={1} step={0.05} pct color="#8b5cff" onChange={v => onFx(s.name, { delay: v })} />
          </div>
        </div>
      ))}
      {/* master + actions */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        background: "var(--bg2)", border: "1px solid #22d3ee55", borderRadius: 8, padding: "10px 8px", width: 84 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: "#22d3ee", letterSpacing: 1 }}>MASTER</span>
        <input type="range" min={0} max={1.4} step={0.01} value={masterVol}
          onChange={e => onMaster(parseFloat(e.target.value))} style={{ accentColor: "#22d3ee", width: 70, marginTop: 64 }} />
        <div style={{ fontSize: 9, color: "var(--muted)" }}>{Math.round(masterVol * 100)}%</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={onLimiter} title="Master brick-wall limiter — catches peaks/clipping"
            style={{ ...miniBtn, padding: "7px 12px", fontSize: 11,
              background: limiterOn ? "linear-gradient(95deg,#22c55e,#4ade80)" : "var(--bg3)",
              color: limiterOn ? "#04210f" : "var(--muted)", border: "none", fontWeight: 700 }}>
            🛡 Limiter {limiterOn ? "ON" : "OFF"}</button>
          <button onClick={onBypass} title="A/B — hear the mix with all effects bypassed (must restart playback)"
            style={{ ...miniBtn, padding: "7px 12px", fontSize: 11,
              background: fxBypass ? "linear-gradient(95deg,#fbbf24,#f59e0b)" : "var(--bg3)",
              color: fxBypass ? "#231400" : "var(--text)", border: "none", fontWeight: 700 }}>
            {fxBypass ? "A · RAW" : "B · FX"}</button>
        </div>
        <button onClick={onMixdown} style={{ ...miniBtn, background: "linear-gradient(95deg,#8b5cff,#22d3ee)",
          color: "#fff", border: "none", padding: "8px 14px", fontSize: 11 }}>⬇ Mix down to new track</button>
        <button onClick={onReset} style={{ ...miniBtn, padding: "7px 14px" }}>↺ Reset mix</button>
        {statusMsg && <div style={{ fontSize: 11, maxWidth: 160,
          color: statusMsg.startsWith("✅") ? "#4ade80" : statusMsg.startsWith("❌") ? "#f87171" : "var(--muted)" }}>{statusMsg}</div>}
      </div>
    </div>
  );
}

// ── Clip panel ────────────────────────────────────────────────────────────
function ClipPanel({ selectedClip, fmt }: { selectedClip: { stem: string; clip: Clip } | null; fmt: (s: number) => string }) {
  if (!selectedClip) return <div style={{ fontSize: 12, color: "var(--muted)" }}>Click a clip block in any lane to inspect it.</div>;
  const { stem, clip } = selectedClip;
  return (
    <div style={{ display: "flex", gap: 30 }}>
      <Info label="Lane" v={stem.toUpperCase()} />
      <Info label="Start" v={fmt(clip.start)} />
      <Info label="End" v={fmt(clip.end)} />
      <Info label="Length" v={`${clip.dur.toFixed(3)}s`} />
      <Info label="Clip ID" v={`#${clip.id}`} />
    </div>
  );
}

// ── Shortcuts modal ──────────────────────────────────────────────────────────
function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const rows = [
    ["Space", "Play / pause"], ["Home", "Return to start"], ["← / →", "Skip ±5s"],
    ["L", "Toggle loop"], ["I / O", "Set loop in / out at playhead"],
    ["M", "Metronome"], ["G", "Toggle grid"], ["S", "Toggle snap"],
    ["X", "Scissors (split) mode"], ["B", "Split clip at playhead"],
    ["A", "Automation lane (vol → pan → off)"],
    ["+ / −", "Zoom in / out"], ["Ctrl+wheel", "Zoom"], ["? ", "This help"], ["Esc", "Close / deselect"],
  ];
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "var(--bg1)", border: "1px solid var(--line)",
        borderRadius: 12, padding: 24, width: 340 }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 14 }}>⌨ Keyboard shortcuts</div>
        {rows.map(([k, d]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0",
            fontSize: 12, borderBottom: "1px solid var(--line)" }}>
            <kbd style={{ background: "var(--bg3)", padding: "2px 8px", borderRadius: 4,
              fontSize: 11, color: "var(--accent2)" }}>{k}</kbd>
            <span style={{ color: "var(--muted)" }}>{d}</span>
          </div>
        ))}
        <button onClick={onClose} style={{ ...miniBtn, marginTop: 14, width: "100%", padding: "8px" }}>Close</button>
      </div>
    </div>
  );
}

// ── Production panel (right side) ─────────────────────────────────────────────
interface Layer { name: string; lo: number; hi: number; color: string; energy: number; level: number; env: number[]; }
interface EffectDef { name: string; params: { key: string; min: number; max: number; default: number; label: string }[]; }
interface Harmonic { n: number; freq: number; note: string; strength: number; }
interface HarmonicData { fundamental: { freq: number; note: string } | null; harmonics: Harmonic[]; }

function ProductionPanel({ stemName, count, range, fmt, layers, layersLoading, harmonics, effectDefs, statusMsg,
  onClose, onLoopSelection, onRegion, onArrange, onPitch, onSpeed, onFade, onNormalize, onPreset, onEffect }: {
  stemName: string; count: number; range: { start: number; end: number }; fmt: (s: number) => string;
  layers: Layer[]; layersLoading: boolean; harmonics: HarmonicData; effectDefs: EffectDef[]; statusMsg: string;
  onClose: () => void; onLoopSelection: () => void;
  onRegion: (prompt: string) => void; onArrange: (op: string) => void;
  onPitch: (semi: number) => void; onSpeed: (pct: number) => void;
  onFade: (fi: number, fo: number) => void; onNormalize: () => void;
  onPreset: (p: string) => void; onEffect: (name: string, params: Record<string, number>) => void;
}) {
  const [open, setOpen] = useState<string>("layers");
  const [prompt, setPrompt] = useState("");
  const [semi, setSemi] = useState(0);
  const [spd, setSpd] = useState(100);
  const [fadeIn, setFadeIn] = useState(0.5);
  const [fadeOut, setFadeOut] = useState(0.5);
  const [fx, setFx] = useState<string>("");
  const [fxParams, setFxParams] = useState<Record<string, number>>({});
  const curFx = effectDefs.find(e => e.name === fx);
  const toggle = useCallback((id: string) => setOpen(o => o === id ? "" : id), []);
  const act: React.CSSProperties = { ...miniBtn, padding: "7px 12px", fontSize: 11 };
  const primaryAct: React.CSSProperties = { ...act, background: "linear-gradient(95deg,#8b5cff,#22d3ee)", color: "#fff", border: "none" };

  return (
    <div style={{ width: 320, flexShrink: 0, background: "var(--bg1)", borderLeft: "1px solid var(--line)",
      display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* header */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--line)", display: "flex",
        justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 800 }}>PRODUCTION</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {count} note{count !== 1 ? "s" : ""} · {stemName.toUpperCase()} · {fmt(range.start)}–{fmt(range.end)}
          </div>
        </div>
        <button onClick={onClose} style={{ ...miniBtn, padding: "3px 8px" }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* 5-layer strip-down */}
        <Section id="layers" title="🎚 Sound layers (the parts that make this sound)" open={open} onToggle={toggle}>
          {layersLoading && <div style={{ fontSize: 11, color: "var(--muted)" }}>Stripping…</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {layers.map(l => (
              <div key={l.name} style={{ background: "var(--bg2)", border: `1px solid ${l.color}55`,
                borderRadius: 6, padding: "8px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
                  <span style={{ fontWeight: 700, color: l.color }}>{l.name}</span>
                  <span style={{ color: "var(--muted)" }}>{l.lo}–{l.hi}Hz · {Math.round(l.level * 100)}%</span>
                </div>
                {/* mini energy-envelope block */}
                <div style={{ display: "flex", alignItems: "flex-end", gap: 1, height: 26 }}>
                  {l.env.map((v, i) => (
                    <div key={i} style={{ flex: 1, height: `${Math.max(4, v * 100)}%`,
                      background: l.color, opacity: 0.35 + l.level * 0.6, borderRadius: 1 }} />
                  ))}
                </div>
              </div>
            ))}
            {!layersLoading && !layers.length && <div style={{ fontSize: 11, color: "var(--muted)" }}>No layer data.</div>}
          </div>
        </Section>

        {/* harmonic decomposition — the strings of notes that make up this sound */}
        <Section id="harmonics" title="🎻 Note harmonics (the notes inside this sound)" open={open} onToggle={toggle}>
          {harmonics.fundamental ? (
            <>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                Fundamental <b style={{ color: "var(--text)" }}>{harmonics.fundamental.note}</b> ({harmonics.fundamental.freq}Hz)
                — built from these overtone strings:
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {harmonics.harmonics.map(h => (
                  <div key={h.n} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                    <span style={{ width: 22, color: "var(--muted)" }}>H{h.n}</span>
                    <span style={{ width: 34, fontWeight: 700,
                      color: h.n === 1 ? "var(--accent2)" : "var(--text)" }}>{h.note}</span>
                    <span style={{ width: 56, color: "var(--muted)", fontSize: 10 }}>{h.freq}Hz</span>
                    {/* the "string" — length = strength */}
                    <div style={{ flex: 1, height: 8, background: "var(--bg3)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(2, h.strength * 100)}%`,
                        background: h.n === 1 ? "var(--accent2)" : "var(--accent)", borderRadius: 4 }} />
                    </div>
                    <span style={{ width: 30, textAlign: "right", color: "var(--muted)", fontSize: 10 }}>{Math.round(h.strength * 100)}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {layersLoading ? "Analysing…" : "No clear pitch in this selection (percussive / noisy)."}
            </div>
          )}
        </Section>

        <Section id="ai" title="✨ AI rewrite this section" open={open} onToggle={toggle}>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. replace with a soaring string melody" style={{ width: "100%", height: 56,
              background: "var(--bg2)", border: "1px solid var(--line)", borderRadius: 6, color: "var(--text)",
              padding: 8, fontSize: 12, resize: "none", outline: "none", fontFamily: "inherit", marginBottom: 8 }} />
          <button onClick={() => prompt.trim() && onRegion(prompt.trim())} style={{ ...primaryAct, width: "100%" }}>
            Regenerate selection</button>
          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 6 }}>Replaces {fmt(range.start)}–{fmt(range.end)} with new AI audio, crossfaded in.</div>
        </Section>

        <Section id="pitch" title="🎵 Pitch & speed" open={open} onToggle={toggle}>
          <Row label={`Pitch  ${semi > 0 ? "+" : ""}${semi} st`}>
            <input type="range" min={-12} max={12} step={1} value={semi}
              onChange={e => setSemi(parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
            <button onClick={() => onPitch(semi)} style={act}>Apply</button>
          </Row>
          <Row label={`Speed  ${spd}%`}>
            <input type="range" min={50} max={150} step={5} value={spd}
              onChange={e => setSpd(parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
            <button onClick={() => onSpeed(spd)} style={act}>Apply</button>
          </Row>
        </Section>

        <Section id="arrange" title="✂️ Arrange" open={open} onToggle={toggle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button onClick={() => onArrange("trim")} style={act}>Trim to selection</button>
            <button onClick={() => onArrange("reverse")} style={act}>Reverse</button>
            <button onClick={onLoopSelection} style={act}>🔁 Loop selection</button>
            <button onClick={onNormalize} style={act}>Normalize</button>
          </div>
          <Row label={`Fade in ${fadeIn}s / out ${fadeOut}s`}>
            <input type="range" min={0} max={3} step={0.1} value={fadeIn}
              onChange={e => setFadeIn(parseFloat(e.target.value))} style={{ flex: 1, accentColor: "var(--accent2)" }} />
            <input type="range" min={0} max={3} step={0.1} value={fadeOut}
              onChange={e => setFadeOut(parseFloat(e.target.value))} style={{ flex: 1, accentColor: "var(--accent2)" }} />
            <button onClick={() => onFade(fadeIn, fadeOut)} style={act}>Apply</button>
          </Row>
        </Section>

        <Section id="fx" title="🎛 Effects" open={open} onToggle={toggle}>
          <select value={fx} onChange={e => { setFx(e.target.value);
            const d = effectDefs.find(x => x.name === e.target.value);
            setFxParams(d ? Object.fromEntries(d.params.map(p => [p.key, p.default])) : {}); }}
            style={{ width: "100%", background: "var(--bg2)", border: "1px solid var(--line)", color: "var(--text)",
              borderRadius: 6, padding: "7px 8px", fontSize: 12, marginBottom: 8 }}>
            <option value="">Choose an effect…</option>
            {effectDefs.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
          </select>
          {curFx && curFx.params.map(p => (
            <Row key={p.key} label={`${p.label}  ${(fxParams[p.key] ?? p.default).toFixed(2)}`}>
              <input type="range" min={p.min} max={p.max} step={(p.max - p.min) / 100}
                value={fxParams[p.key] ?? p.default}
                onChange={e => setFxParams(s => ({ ...s, [p.key]: parseFloat(e.target.value) }))}
                style={{ flex: 1, accentColor: "var(--accent)" }} />
            </Row>
          ))}
          {curFx && <button onClick={() => onEffect(fx, fxParams)} style={{ ...primaryAct, width: "100%", marginTop: 4 }}>Apply {fx}</button>}
        </Section>

        <Section id="presets" title="⭐ One-tap presets" open={open} onToggle={toggle}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {["bass-boost", "lofi", "stream-master", "stereo-widen", "cut-silence"].map(p => (
              <button key={p} onClick={() => onPreset(p)} style={act}>{p}</button>
            ))}
          </div>
        </Section>
      </div>

      {statusMsg && (
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)", fontSize: 11,
          color: statusMsg.startsWith("✅") ? "#4ade80" : statusMsg.startsWith("❌") ? "#f87171" : "var(--muted)" }}>
          {statusMsg}</div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>{children}</div>
    </div>
  );
}

// Hoisted to module scope so it isn't recreated each render (that caused the
// panel to remount + lose input focus = the "glitchy" feel).
function Section({ id, title, open, onToggle, children }: {
  id: string; title: string; open: string; onToggle: (id: string) => void; children: React.ReactNode;
}) {
  const isOpen = open === id;
  return (
    <div style={{ borderBottom: "1px solid var(--line)" }}>
      <button onClick={() => onToggle(id)} style={{ width: "100%", textAlign: "left",
        background: "none", border: "none", color: "var(--text)", padding: "11px 14px", cursor: "pointer",
        fontSize: 12, fontWeight: 700, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>{title}</span><span style={{ color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</span>
      </button>
      {isOpen && <div style={{ padding: "0 14px 14px" }}>{children}</div>}
    </div>
  );
}

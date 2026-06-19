"use client";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import type { DawTrack, TrackEffect, RegionOp, AutomationPoint } from "./dawTypes";
import { EFFECT_DEFS } from "./effects";
import { renderClipBuffer, renderClipBufferAsync, peaksFromBuffer } from "./regionOps";

function toDb(vol: number) {
  if (vol <= 0) return -Infinity;
  return 20 * Math.log10(vol);
}

interface TrackNodes {
  player: any;
  fadeGain: any;   // automated for clip fade in/out + clip gain
  channel: any;    // volume / pan / mute / solo
  meter: any;      // for VU metering
  fxNodes: Map<string, any>;  // effectId -> Tone effect node
  original: AudioBuffer | null;  // pristine decoded audio (region ops never touch this)
}

export interface DawEngine {
  getAnalyser(): AnalyserNode | null;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(sec: number): void;
  setBpm(bpm: number): void;
  setLoop(on: boolean, start: number, end: number): void;
  setMetronome(on: boolean): void;
  startRecording(): Promise<boolean>;
  stopRecording(): Promise<{ url: string; duration: number } | null>;
  setTrackVolume(id: string, vol: number): void;
  setTrackPan(id: string, pan: number): void;
  setTrackMute(id: string, muted: boolean): void;
  setTrackSolo(id: string, soloed: boolean): void;
  loadTracks(tracks: DawTrack[]): Promise<DawTrack[]>;
  scheduleFades(tracks: DawTrack[]): void;
  scheduleAutomation(tracks: DawTrack[]): void;
  rebuildEffects(track: DawTrack): void;
  applyEffectParams(trackId: string, effect: TrackEffect): void;
  // Re-render a clip's audio from its original buffer + region ops, swap into the
  // player, and return fresh peaks + new duration. Async because EQ/filter ops
  // render through an OfflineAudioContext. Instant + non-destructive.
  applyClipOps(trackId: string, ops: RegionOp[]): Promise<{ peaks: Float32Array; duration: number } | null>;
  setMasterVolume(vol: number): void;
  getPosition(): number;
  getLevels(): Record<string, number>;
  isLoaded: boolean;
  loadError: string | null;
}

export function useDawEngine(): DawEngine {
  const toneRef = useRef<any>(null);
  const nodesRef = useRef<Map<string, TrackNodes>>(new Map());
  const metroRef = useRef<any>(null);   // { synth, loop }
  const recRef = useRef<any>(null);     // { mic, recorder, startedAt }
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const getTone = useCallback(async () => {
    if (!toneRef.current) {
      toneRef.current = await import("tone");
    }
    return toneRef.current;
  }, []);

  const disposeAll = useCallback(() => {
    nodesRef.current.forEach(n => {
      try { n.player.unsync(); n.player.dispose(); } catch {}
      try { n.fadeGain.dispose(); } catch {}
      n.fxNodes?.forEach((fx: any) => { try { fx.dispose(); } catch {} });
      try { n.channel.dispose(); } catch {}
      try { n.meter.dispose(); } catch {}
    });
    nodesRef.current.clear();
  }, []);

  // (Re)wire the per-track signal chain: fadeGain -> [enabled fx...] -> channel.
  // Disposes old fx nodes and builds fresh from the track's effects list.
  const wireChain = useCallback((Tone: any, n: TrackNodes, effects: TrackEffect[]) => {
    // tear down old fx
    n.fxNodes.forEach(fx => { try { fx.disconnect(); fx.dispose(); } catch {} });
    n.fxNodes.clear();
    try { n.fadeGain.disconnect(); } catch {}

    let tail: any = n.fadeGain;
    for (const eff of effects) {
      if (!eff.enabled) continue;
      const def = EFFECT_DEFS[eff.type];
      if (!def) continue;
      try {
        const node = def.build(Tone, eff.params);
        n.fxNodes.set(eff.id, node);
        tail.connect(node);
        tail = node;
      } catch (e) {
        console.warn(`[daw] failed to build effect ${eff.type}:`, e);
      }
    }
    tail.connect(n.channel);
  }, []);

  // cleanup on unmount
  useEffect(() => {
    return () => {
      disposeAll();
      if (toneRef.current) {
        try {
          const t = toneRef.current.getTransport();
          t.stop(); t.cancel();
        } catch {}
      }
    };
  }, [disposeAll]);

  const loadTracks = useCallback(async (tracks: DawTrack[]): Promise<DawTrack[]> => {
    setIsLoaded(false);
    setLoadError(null);
    const Tone = await getTone();

    disposeAll();

    // Wire a native AnalyserNode to tap the master output for the spectrum display.
    // We connect Tone.Destination → analyser in PARALLEL (not in series), so we
    // never break Tone's internal routing. The analyser just listens passively.
    try {
      const ctx: AudioContext = Tone.getContext().rawContext ?? Tone.getContext();
      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 4096;
        analyser.smoothingTimeConstant = 0.8;
        // Tone.Destination's underlying gain node — connect it to our analyser
        // as a parallel tap. This never disconnects existing routing.
        const toneDest = Tone.getDestination();
        toneDest.connect(analyser as any);
        analyserRef.current = analyser;
      }
    } catch (e) {
      console.warn("[engine] analyser wiring failed:", e);
    }

    const updated: DawTrack[] = [];
    const failed: string[] = [];

    for (const track of tracks) {
      try {
        // Fetch + decode the audio ONCE. This both verifies it's real audio
        // (not a JSON 404 body) and gives us a buffer we use for BOTH the player
        // and the waveform peaks — so they can never disagree or silently fail.
        const res = await fetch(track.audioUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ctype = res.headers.get("content-type") || "";
        if (ctype.includes("application/json")) {
          const txt = await res.text();
          throw new Error(`not audio: ${txt.slice(0, 100)}`);
        }
        const arr = await res.arrayBuffer();
        const ctx = Tone.getContext();
        const original = await ctx.decodeAudioData(arr.slice(0));

        // apply any persisted region ops (clip 0) to get the buffer we play
        const ops = track.clips[0]?.ops;
        const audioBuf = await renderClipBufferAsync(ctx.rawContext ?? ctx, original, ops);

        const channel = new Tone.Channel(toDb(track.volume), track.pan * 100);
        channel.mute = track.muted;
        const meter = new Tone.Meter({ smoothing: 0.7 });
        const fadeGain = new Tone.Gain(1);
        // hand the decoded buffer directly to the player (no second network load)
        const player = new Tone.Player(new Tone.ToneAudioBuffer(audioBuf));
        player.loop = false;

        // player -> fadeGain -> [fx chain] -> channel -> meter -> destination
        player.connect(fadeGain);
        channel.connect(meter);
        channel.toDestination();

        const nodes: TrackNodes = { player, fadeGain, channel, meter, fxNodes: new Map(), original };
        wireChain(Tone, nodes, track.effects ?? []);

        // sync() makes the player follow Tone.Transport; start(0) = start at bar 0
        player.sync().start(0);

        nodesRef.current.set(track.id, nodes);

        // peaks from the rendered buffer (1 peak per ~5ms => 200/sec)
        const dur = audioBuf.duration || track.duration;
        const peakData = peaksFromBuffer(audioBuf, Math.ceil(dur * 200));
        updated.push({ ...track, peakData, duration: dur });
      } catch (e: any) {
        console.error(`[daw] failed to load track ${track.id}:`, e);
        failed.push(`${track.label}: ${e.message || e}`);
        updated.push({ ...track, peakData: null });
      }
    }

    try { await Tone.loaded(); } catch { /* no players yet = ok */ }

    // Set transport loopEnd well past the longest track so Tone never
    // wraps playback early. loopEnd fires even when loop=false in Tone 15.
    const maxDur = Math.max(...updated.map(t => t.duration ?? 0), 60);
    try {
      const t = Tone.getTransport();
      t.loop = false;
      t.loopEnd = maxDur + 30;
    } catch {}

    setIsLoaded(true);
    setLoadError(failed.length ? failed.join(" · ") : null);
    return updated;
  }, [getTone, disposeAll, wireChain]);

  // Schedule clip fade-in/out + clip gain envelopes on the per-track fadeGain.
  // Called whenever transport (re)starts or fades change. Uses the AudioParam
  // automation relative to the clip's arrangement position.
  const scheduleFades = useCallback((tracks: DawTrack[]) => {
    const Tone = toneRef.current;
    if (!Tone) return;
    for (const track of tracks) {
      const n = nodesRef.current.get(track.id);
      if (!n) continue;
      const g = n.fadeGain.gain;
      try { g.cancelScheduledValues(0); } catch {}
      // Single-clip model (one clip per stem track for now). Build the envelope.
      const clip = track.clips[0];
      if (!clip) { g.value = 1; continue; }
      const base = clip.gain ?? 1;
      const start = clip.startSec;
      const end = clip.startSec + clip.durationSec;
      const fi = clip.fadeInSec ?? 0;
      const fo = clip.fadeOutSec ?? 0;
      // Tone Transport schedules via transport-time. We set ramps along the timeline.
      try {
        if (fi > 0) {
          g.setValueAtTime(0, start);
          g.linearRampToValueAtTime(base, start + fi);
        } else {
          g.setValueAtTime(base, start);
        }
        if (fo > 0) {
          g.setValueAtTime(base, Math.max(start + fi, end - fo));
          g.linearRampToValueAtTime(0, end);
        }
      } catch {
        g.value = base;
      }
    }
  }, []);

  // Schedule volume/pan automation curves on each track's channel params along
  // the transport timeline. Linear ramps between points; if no points for a lane,
  // hold the track's static value. Called whenever play (re)starts.
  const scheduleAutomation = useCallback((tracks: DawTrack[]) => {
    const Tone = toneRef.current;
    if (!Tone) return;
    for (const track of tracks) {
      const n = nodesRef.current.get(track.id);
      if (!n) continue;
      const auto = track.automation;
      // volume lane → channel.volume (dB)
      const volPts = auto?.volume;
      try {
        const vp = n.channel.volume;
        vp.cancelScheduledValues(0);
        if (volPts && volPts.length) {
          const sorted = [...volPts].sort((a, b) => a.sec - b.sec);
          vp.setValueAtTime(toDb(sorted[0].value), Math.max(0, sorted[0].sec));
          for (const pt of sorted) vp.linearRampToValueAtTime(toDb(Math.max(0.0001, pt.value)), pt.sec);
        } else {
          vp.value = toDb(track.volume);
        }
      } catch {}
      // pan lane → channel.pan (-1..1)
      const panPts = auto?.pan;
      try {
        const pp = n.channel.pan;
        pp.cancelScheduledValues(0);
        if (panPts && panPts.length) {
          const sorted = [...panPts].sort((a, b) => a.sec - b.sec);
          pp.setValueAtTime(sorted[0].value, Math.max(0, sorted[0].sec));
          for (const pt of sorted) pp.linearRampToValueAtTime(pt.value, pt.sec);
        } else {
          pp.value = track.pan;
        }
      } catch {}
    }
  }, []);

  // Rebuild the whole fx chain for a track (add/remove/reorder/toggle effect).
  const rebuildEffects = useCallback((track: DawTrack) => {
    const Tone = toneRef.current;
    if (!Tone) return;
    const n = nodesRef.current.get(track.id);
    if (!n) return;
    wireChain(Tone, n, track.effects ?? []);
  }, [wireChain]);

  // Re-render a clip from original buffer + ops, hot-swap the player's buffer,
  // and return fresh peaks. Preserves transport position so edits don't restart.
  const applyClipOps = useCallback(async (trackId: string, ops: RegionOp[]): Promise<{ peaks: Float32Array; duration: number } | null> => {
    const Tone = toneRef.current;
    if (!Tone) return null;
    const n = nodesRef.current.get(trackId);
    if (!n || !n.original) return null;
    const ctx = Tone.getContext();
    const raw = ctx.rawContext ?? ctx;
    const hasOffline = ops.some(o => o.type === "lowpass" || o.type === "highpass" || o.type === "bandpass"
      || o.type.startsWith("eq-") || o.type === "deess" || o.type === "mudcut" || o.type === "telephone");
    const rendered = hasOffline
      ? await renderClipBufferAsync(raw, n.original, ops)
      : renderClipBuffer(raw, n.original, ops);
    try {
      n.player.buffer = new Tone.ToneAudioBuffer(rendered);
    } catch (e) {
      console.warn("[daw] applyClipOps buffer swap failed:", e);
    }
    return { peaks: peaksFromBuffer(rendered, Math.ceil(rendered.duration * 200)), duration: rendered.duration };
  }, []);

  // Push a single effect's params to its live node (knob turns) — no rewire.
  const applyEffectParams = useCallback((trackId: string, effect: TrackEffect) => {
    const n = nodesRef.current.get(trackId);
    if (!n) return;
    const node = n.fxNodes.get(effect.id);
    if (!node) return;
    try { EFFECT_DEFS[effect.type].apply(node, effect.params); } catch {}
  }, []);

  const play = useCallback(async () => {
    const Tone = await getTone();
    const ctx = Tone.getContext();
    if (ctx.state === "suspended") await ctx.resume();
    const t = Tone.getTransport();
    // Only extend loopEnd when NOT in user loop mode, to prevent early wrap-around.
    // When t.loop=true the user has set their own range — don't overwrite it.
    if (!t.loop) {
      const maxDur = Math.max(
        ...Array.from(nodesRef.current.values()).map(n => n.player?.buffer?.duration ?? 0),
        60
      );
      t.loopEnd = maxDur + 10;
    }
    t.start();
  }, [getTone]);

  const pause = useCallback(async () => {
    const Tone = await getTone();
    Tone.getTransport().pause();
  }, [getTone]);

  const stop = useCallback(async () => {
    const Tone = await getTone();
    const t = Tone.getTransport();
    t.stop();
    t.seconds = 0;
  }, [getTone]);

  const seekTo = useCallback(async (sec: number) => {
    const Tone = await getTone();
    const t = Tone.getTransport();
    const wasPlaying = t.state === "started";
    t.pause();
    t.seconds = Math.max(0, sec);
    if (wasPlaying) t.start();
  }, [getTone]);

  const setBpm = useCallback(async (bpm: number) => {
    const Tone = await getTone();
    Tone.getTransport().bpm.value = bpm;
  }, [getTone]);

  const setLoop = useCallback(async (on: boolean, start: number, end: number) => {
    const Tone = await getTone();
    const t = Tone.getTransport();
    t.loop = on;
    t.loopStart = start;
    t.loopEnd = end;
  }, [getTone]);

  // Metronome: a short click synth fired every quarter note via a Tone.Loop.
  // Accent (higher pitch) on beat 1 of each bar.
  const setMetronome = useCallback(async (on: boolean) => {
    const Tone = await getTone();
    if (on) {
      if (!metroRef.current) {
        const synth = new Tone.MembraneSynth({
          pitchDecay: 0.008, octaves: 2,
          envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
          volume: -6,
        }).toDestination();
        let beat = 0;
        const loop = new Tone.Loop((time: number) => {
          const accent = beat % 4 === 0;
          synth.triggerAttackRelease(accent ? "C5" : "C4", "32n", time);
          beat++;
        }, "4n");
        loop.start(0);
        metroRef.current = { synth, loop };
      }
    } else if (metroRef.current) {
      try { metroRef.current.loop.dispose(); metroRef.current.synth.dispose(); } catch {}
      metroRef.current = null;
    }
  }, [getTone]);

  // Microphone recording via Tone.UserMedia -> Tone.Recorder. Returns false if
  // mic permission is denied. stopRecording returns a blob URL + duration.
  const startRecording = useCallback(async (): Promise<boolean> => {
    const Tone = await getTone();
    try {
      const ctx = Tone.getContext();
      if (ctx.state === "suspended") await ctx.resume();
      const mic = new Tone.UserMedia();
      await mic.open();              // prompts for permission
      const recorder = new Tone.Recorder();
      mic.connect(recorder);
      recorder.start();
      recRef.current = { mic, recorder, startedAt: Date.now() };
      return true;
    } catch (e) {
      console.warn("[daw] mic recording failed:", e);
      if (recRef.current) { try { recRef.current.mic.close(); } catch {} recRef.current = null; }
      return false;
    }
  }, [getTone]);

  const stopRecording = useCallback(async (): Promise<{ url: string; duration: number } | null> => {
    const r = recRef.current;
    if (!r) return null;
    recRef.current = null;
    try {
      const blob = await r.recorder.stop();
      try { r.mic.close(); r.recorder.dispose(); } catch {}
      const url = URL.createObjectURL(blob);
      const duration = (Date.now() - r.startedAt) / 1000;
      return { url, duration };
    } catch (e) {
      console.warn("[daw] stopRecording failed:", e);
      try { r.mic.close(); } catch {}
      return null;
    }
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    if (!toneRef.current) return;
    try {
      // Tone.Destination exposes a volume param in dB
      toneRef.current.getDestination().volume.value = toDb(Math.max(0.0001, vol));
    } catch {}
  }, []);

  const setTrackVolume = useCallback((id: string, vol: number) => {
    const n = nodesRef.current.get(id);
    if (n) n.channel.volume.value = toDb(vol);
  }, []);

  const setTrackPan = useCallback((id: string, pan: number) => {
    const n = nodesRef.current.get(id);
    if (n) n.channel.pan.value = pan;
  }, []);

  const setTrackMute = useCallback((id: string, muted: boolean) => {
    const n = nodesRef.current.get(id);
    if (n) n.channel.mute = muted;
  }, []);

  const setTrackSolo = useCallback((id: string, soloed: boolean) => {
    // Tone.js Channel.solo isolates automatically when channels share Destination.
    // We set it on the target track, then sync all others so Tone's solo bus
    // correctly silences non-soloed tracks.
    nodesRef.current.forEach((n, tid) => {
      if (tid === id) {
        n.channel.solo = soloed;
      } else if (!soloed) {
        // un-solo: restore each channel to its own solo state (not force-soloed)
        n.channel.solo = n.channel.solo;
      }
    });
  }, []);

  const getPosition = useCallback(() => {
    if (!toneRef.current) return 0;
    return toneRef.current.getTransport().seconds ?? 0;
  }, []);

  const getLevels = useCallback((): Record<string, number> => {
    const out: Record<string, number> = {};
    nodesRef.current.forEach((n, id) => {
      try {
        const db = n.meter.getValue();
        const v = typeof db === "number" ? db : -Infinity;
        // map -60..0 dB to 0..1
        out[id] = v <= -60 ? 0 : Math.min(1, (v + 60) / 60);
      } catch { out[id] = 0; }
    });
    return out;
  }, []);

  const getAnalyser = useCallback((): AnalyserNode | null => analyserRef.current, []);

  // Memoize the returned object so `engine` keeps a STABLE identity across
  // renders. Without this, every render produced a new object, which made any
  // `useEffect(..., [engine])` in consumers re-fire on every render — causing
  // "Maximum update depth exceeded" infinite loops. All members below are either
  // useCallback-stable or primitive state, so we only rebuild when isLoaded /
  // loadError actually change.
  return useMemo(() => ({
    play, pause, stop, seekTo, setBpm, setLoop, setMetronome,
    startRecording, stopRecording,
    setTrackVolume, setTrackPan, setTrackMute, setTrackSolo, setMasterVolume,
    loadTracks, scheduleFades, scheduleAutomation, rebuildEffects, applyEffectParams, applyClipOps,
    getPosition, getLevels, getAnalyser,
    isLoaded, loadError,
  }), [
    play, pause, stop, seekTo, setBpm, setLoop, setMetronome,
    startRecording, stopRecording,
    setTrackVolume, setTrackPan, setTrackMute, setTrackSolo, setMasterVolume,
    loadTracks, scheduleFades, scheduleAutomation, rebuildEffects, applyEffectParams, applyClipOps,
    getPosition, getLevels, getAnalyser,
    isLoaded, loadError,
  ]);
}

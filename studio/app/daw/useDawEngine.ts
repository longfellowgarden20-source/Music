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
  player: any;     // Tone.Player, synced to transport
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
  scrubTo(sec: number): void;
  setBpm(bpm: number): void;
  setLoop(on: boolean, start: number, end: number): void;
  setMetronome(on: boolean): void;
  // ── Recording / mic ──
  listInputDevices(): Promise<{ id: string; label: string }[]>;
  openMic(deviceId?: string): Promise<boolean>;      // open mic for monitoring/metering (no capture yet)
  openMicDetailed(deviceId?: string): Promise<{ ok: boolean; reason?: string }>;
  closeMic(): void;
  setMonitoring(on: boolean): void;                  // hear yourself through the speakers
  getInputLevel(): number;                           // 0..1 live input meter
  startRecording(opts?: { deviceId?: string; alongTransport?: boolean }): Promise<boolean>;
  stopRecording(): Promise<{ url: string; duration: number } | null>;
  setTrackVolume(id: string, vol: number): void;
  setTrackPan(id: string, pan: number): void;
  setTrackMute(id: string, muted: boolean): void;
  setTrackSolo(id: string, soloed: boolean): void;
  applySolo(soloedIds: string[], mutedIds: string[]): void;
  loadTracks(tracks: DawTrack[]): Promise<DawTrack[]>;
  scheduleFades(tracks: DawTrack[]): void;
  rescheduleClips(tracks: DawTrack[]): void;
  scheduleAutomation(tracks: DawTrack[]): void;
  rebuildEffects(track: DawTrack): void;
  rebuildClips(track: DawTrack): Promise<void>;
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
  // Bumped on each loadTracks call. An in-flight (async) load checks this after
  // every await; if a newer load started, the stale one aborts and cleans up its
  // players. Without this, React StrictMode's double-invoke (or a fast re-load)
  // creates a second set of synced players that aren't tracked in nodesRef —
  // they keep playing and the faders can't touch them (the cross-talk bug).
  const loadGenRef = useRef(0);
  const metroRef = useRef<any>(null);   // { synth, loop }
  const recRef = useRef<any>(null);     // { recorder, startedAt }
  // Persistent mic chain: mic -> meter (always) and mic -> monitorGain -> dest (when monitoring)
  const micRef = useRef<any>(null);     // { mic, meter, monitorGain, deviceId }
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
        // Composite effects (EQ/Echo = multiple internal nodes) expose _head as
        // the input. Connect the running tail INTO the composite's head; then the
        // composite itself becomes the new tail (its .connect chains out of _tail).
        const input = node._isComposite ? node._head : node;
        tail.connect(input);
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
      // tear down mic/monitor chain if still open
      if (micRef.current) {
        try { micRef.current.mic.close(); micRef.current.meter.dispose(); micRef.current.monitorGain.dispose(); } catch {}
        micRef.current = null;
      }
      if (toneRef.current) {
        try {
          const t = toneRef.current.getTransport();
          t.stop(); t.cancel();
        } catch {}
      }
    };
  }, [disposeAll]);

  const loadTracks = useCallback(async (tracks: DawTrack[]): Promise<DawTrack[]> => {
    const myGen = ++loadGenRef.current;   // newest load wins
    setIsLoaded(false);
    setLoadError(null);
    const Tone = await getTone();
    if (myGen !== loadGenRef.current) return [];   // superseded during await

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
        const audioBuf = await renderClipBufferAsync(ctx.rawContext ?? ctx, original, track.clips[0]?.ops);

        // A newer load started while we were fetching/decoding — abort so we don't
        // create orphan synced players that play untracked (the cross-talk bug).
        if (myGen !== loadGenRef.current) return [];

        const channel = new Tone.Channel(toDb(track.volume), track.pan * 100);
        channel.mute = track.muted;
        const meter = new Tone.Meter({ smoothing: 0.7 });
        const fadeGain = new Tone.Gain(1);
        const player = new Tone.Player(new Tone.ToneAudioBuffer(audioBuf));
        player.loop = false;

        // player -> fadeGain -> [fx chain] -> channel -> meter -> destination
        player.connect(fadeGain);
        channel.connect(meter);
        channel.toDestination();

        const nodes: TrackNodes = { player, fadeGain, channel, meter, fxNodes: new Map(), original };
        wireChain(Tone, nodes, track.effects ?? []);

        // sync() makes the player follow Tone.Transport; schedule it at the clip's
        // arrangement position so a moved clip actually plays at its new spot.
        player.sync().start(Math.max(0, track.clips[0]?.startSec ?? 0));

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
    if (myGen !== loadGenRef.current) return [];   // superseded — newer load owns the graph

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

  // Re-sync each track's player to its clip's current startSec. Call after a clip
  // is moved (or trimmed) so the AUDIO follows the block — without this, players
  // stay scheduled at their original position and a dragged clip plays at the old
  // spot. Preserves play/position: re-syncing while playing restarts the player at
  // the right transport offset.
  const rescheduleClips = useCallback((tracks: DawTrack[]) => {
    const Tone = toneRef.current;
    if (!Tone) return;
    const wasPlaying = Tone.getTransport().state === "started";
    for (const track of tracks) {
      const n = nodesRef.current.get(track.id);
      if (!n?.player) continue;
      const startSec = Math.max(0, track.clips[0]?.startSec ?? 0);
      try {
        n.player.unsync();
        n.player.stop();
        n.player.sync().start(startSec);
      } catch { /* mid-load */ }
    }
    // Nudge the transport so synced players re-evaluate their start offset.
    if (wasPlaying) {
      const t = Tone.getTransport();
      const pos = t.seconds;
      t.pause(); t.seconds = pos; t.start();
    }
  }, []);

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
      const clip = track.clips[0];
      if (!clip) { g.value = 1; continue; }
      const base = clip.gain ?? 1;
      const start = clip.startSec;
      const end = clip.startSec + clip.durationSec;
      const fi = clip.fadeInSec ?? 0;
      const fo = clip.fadeOutSec ?? 0;
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
        if (volPts && volPts.length) {
          // has automation — schedule ramps through Tone
          vp.cancelScheduledValues(0);
          const sorted = [...volPts].sort((a, b) => a.sec - b.sec);
          vp.setValueAtTime(toDb(sorted[0].value), Math.max(0, sorted[0].sec));
          for (const pt of sorted) vp.linearRampToValueAtTime(toDb(Math.max(0.0001, pt.value)), pt.sec);
        } else {
          // no automation — hold the track's static volume via the dB API
          vp.cancelScheduledValues(0);
          vp.value = track.volume <= 0 ? -Infinity : toDb(track.volume);
        }
      } catch {}
      // pan lane → channel.pan (-1..1)
      const panPts = auto?.pan;
      try {
        const pp = n.channel.pan;
        if (panPts && panPts.length) {
          pp.cancelScheduledValues(0);
          const sorted = [...panPts].sort((a, b) => a.sec - b.sec);
          pp.setValueAtTime(sorted[0].value, Math.max(0, sorted[0].sec));
          for (const pt of sorted) pp.linearRampToValueAtTime(pt.value, pt.sec);
        } else {
          pp.cancelScheduledValues(0);
          pp.value = track.pan;
        }
      } catch {}
    }
  }, []);

  // No-op in the single-player-per-track model (kept so callers don't break).
  // Splitting clips is a visual edit only; the engine plays the whole stem buffer.
  const rebuildClips = useCallback(async (_track: DawTrack) => { /* single-clip model */ }, []);

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
    const target = Math.max(0, sec);
    const wasPlaying = t.state === "started";

    // Stop the transport before moving its clock. A synced Tone.Player scheduled
    // with `.start(0)` does NOT re-seek its buffer when the transport position
    // jumps mid-playback — the clock moves (so the playhead appears to jump) but
    // each player keeps streaming from where it already was, which is why a
    // ruler-drag looked cosmetic. We re-arm the players so their buffer offset
    // matches the new position.
    t.stop();
    t.seconds = target;

    // Re-arm each synced player so its buffer offset matches the new position.
    nodesRef.current.forEach(n => {
      const p = n.player;
      if (!p) return;
      try {
        p.unsync();
        p.stop();
        p.sync().start(0);
      } catch { /* player may be mid-load */ }
    });

    if (wasPlaying) t.start();
  }, [getTone]);

  // Lightweight position move for an in-progress ruler drag. Moves the transport
  // clock (and silences the synced players if currently playing) WITHOUT the full
  // stop/re-arm/start cycle — calling that on every mousemove thrashes the
  // transport so playback never settles. The real re-arm happens once on release
  // via seekTo(). We pause during the drag so the old audio doesn't keep playing
  // from the pre-drag spot while you scrub.
  // Synchronous on purpose: a ruler drag fires this many times per second, and
  // awaiting getTone() each call let the updates resolve out of order, leaving the
  // clock at a stale time. Tone is always loaded by the time the UI is interactive,
  // so read toneRef directly and bail if (somehow) not ready yet.
  const scrubTo = useCallback((sec: number) => {
    const Tone = toneRef.current;
    if (!Tone) return;
    const t = Tone.getTransport();
    if (t.state === "started") t.pause();
    t.seconds = Math.max(0, sec);
  }, []);

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

  // Enumerate available audio input devices (microphones). Requires that the
  // user has granted mic permission at least once for labels to be populated.
  const listInputDevices = useCallback(async (): Promise<{ id: string; label: string }[]> => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return [];
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter(d => d.kind === "audioinput")
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    } catch (e) {
      console.warn("[daw] enumerateDevices failed:", e);
      return [];
    }
  }, []);

  // Open the mic and build the persistent chain: mic -> meter (for input level),
  // and mic -> monitorGain (muted by default) -> destination for live monitoring.
  // Returns a detailed result so the UI can give the right fix instructions.
  //   reason: "system"  = OS (macOS Privacy) blocked it
  //           "denied"  = browser permission blocked/dismissed
  //           "nodevice"= no mic present
  //           "other"   = anything else
  const openMicDetailed = useCallback(async (deviceId?: string): Promise<{ ok: boolean; reason?: string }> => {
    const Tone = await getTone();
    try {
      const ctx = Tone.getContext();
      if (ctx.state === "suspended") await ctx.resume();
      // Already open on the same device — reuse.
      if (micRef.current && micRef.current.deviceId === (deviceId ?? "")) return { ok: true };
      // Different device — tear down the old one.
      if (micRef.current) {
        try { micRef.current.mic.close(); micRef.current.meter.dispose(); micRef.current.monitorGain.dispose(); } catch {}
        micRef.current = null;
      }
      const mic = new Tone.UserMedia();
      await mic.open(deviceId || undefined);   // prompts for permission first time
      const meter = new Tone.Meter({ smoothing: 0.6 });
      const monitorGain = new Tone.Gain(0);    // 0 = muted monitoring by default
      mic.connect(meter);
      mic.connect(monitorGain);
      monitorGain.toDestination();
      micRef.current = { mic, meter, monitorGain, deviceId: deviceId ?? "" };
      return { ok: true };
    } catch (e: any) {
      console.warn("[daw] openMic failed:", e);
      if (micRef.current) { try { micRef.current.mic.close(); } catch {} micRef.current = null; }
      const name = e?.name || "";
      const msg = String(e?.message || e || "");
      let reason = "other";
      if (name === "NotAllowedError") {
        // macOS surfaces OS-level block as "Permission denied by system".
        reason = /system/i.test(msg) ? "system" : "denied";
      } else if (name === "NotFoundError" || name === "OverconstrainedError" || /not found/i.test(msg)) {
        reason = "nodevice";
      }
      return { ok: false, reason };
    }
  }, [getTone]);

  // Back-compat boolean wrapper.
  const openMic = useCallback(async (deviceId?: string): Promise<boolean> => {
    return (await openMicDetailed(deviceId)).ok;
  }, [openMicDetailed]);

  const closeMic = useCallback(() => {
    if (!micRef.current) return;
    try {
      micRef.current.mic.close();
      micRef.current.meter.dispose();
      micRef.current.monitorGain.dispose();
    } catch {}
    micRef.current = null;
  }, []);

  // Toggle live monitoring — route the mic to the speakers so the singer hears
  // themselves. Off by default to avoid feedback howl on laptop speakers.
  const setMonitoring = useCallback((on: boolean) => {
    const m = micRef.current;
    if (!m) return;
    try { m.monitorGain.gain.rampTo(on ? 1 : 0, 0.05); } catch {}
  }, []);

  const getInputLevel = useCallback((): number => {
    const m = micRef.current;
    if (!m) return 0;
    try {
      const db = m.meter.getValue();
      const v = typeof db === "number" ? db : -Infinity;
      return v <= -60 ? 0 : Math.min(1, (v + 60) / 60);
    } catch { return 0; }
  }, []);

  // Start capturing from the (already-open) mic. If alongTransport is true the
  // transport keeps playing so vocals are recorded over the beat. We tap the
  // mic into a fresh Recorder; the persistent meter/monitor chain stays intact.
  const startRecording = useCallback(async (opts?: { deviceId?: string; alongTransport?: boolean }): Promise<boolean> => {
    const Tone = await getTone();
    try {
      const ctx = Tone.getContext();
      if (ctx.state === "suspended") await ctx.resume();
      // Make sure the mic is open (opens default if not already).
      if (!micRef.current || (opts?.deviceId !== undefined && micRef.current.deviceId !== opts.deviceId)) {
        const ok = await openMic(opts?.deviceId);
        if (!ok) return false;
      }
      const recorder = new Tone.Recorder();
      micRef.current.mic.connect(recorder);
      recorder.start();
      // record over the beat: start transport if asked and not already running
      if (opts?.alongTransport) {
        const t = Tone.getTransport();
        if (t.state !== "started") t.start();
      }
      recRef.current = { recorder, startedAt: Date.now() };
      return true;
    } catch (e) {
      console.warn("[daw] startRecording failed:", e);
      return false;
    }
  }, [getTone, openMic]);

  const stopRecording = useCallback(async (): Promise<{ url: string; duration: number } | null> => {
    const r = recRef.current;
    if (!r) return null;
    recRef.current = null;
    try {
      const blob = await r.recorder.stop();
      // disconnect this recorder from the mic but keep the mic chain alive
      try { if (micRef.current) micRef.current.mic.disconnect(r.recorder); } catch {}
      try { r.recorder.dispose(); } catch {}
      const url = URL.createObjectURL(blob);
      const duration = (Date.now() - r.startedAt) / 1000;
      return { url, duration };
    } catch (e) {
      console.warn("[daw] stopRecording failed:", e);
      return null;
    }
  }, []);

  const setMasterVolume = useCallback((vol: number) => {
    if (!toneRef.current) return;
    try {
      const vp = toneRef.current.getDestination().volume;
      vp.cancelScheduledValues(0);
      vp.value = vol <= 0 ? -Infinity : toDb(vol);
    } catch {}
  }, []);

  const setTrackVolume = useCallback((id: string, vol: number) => {
    const n = nodesRef.current.get(id);
    if (!n) return;
    try {
      n.channel.volume.cancelScheduledValues(0);
      n.channel.volume.value = vol <= 0 ? -Infinity : toDb(vol);
    } catch {}
  }, []);

  const setTrackPan = useCallback((id: string, pan: number) => {
    const n = nodesRef.current.get(id);
    if (!n) return;
    try {
      n.channel.pan.cancelScheduledValues(0);
      n.channel.pan.value = pan;
    } catch {}
  }, []);

  const setTrackMute = useCallback((id: string, muted: boolean) => {
    const n = nodesRef.current.get(id);
    if (n) n.channel.mute = muted;
  }, []);

  // Legacy single-track entry point. Superseded by applySolo (DAWStudio now passes
  // the full soloed/muted set). Kept so any stray caller doesn't crash.
  const setTrackSolo = useCallback((_id: string, _soloed: boolean) => {
    // no-op: solo is applied coherently via applySolo
  }, []);

  // Apply solo across ALL tracks explicitly, instead of relying on Tone's
  // Channel.solo bus (which didn't actually silence other channels in our routing —
  // every channel connects straight to Destination, so a single .solo had no effect).
  //
  // Rule: if ANY track is soloed, every non-soloed track is silenced; tracks the
  // user explicitly muted stay muted regardless. We drive channel.mute directly so
  // the result is deterministic.
  const applySolo = useCallback((soloedIds: string[], mutedIds: string[]) => {
    const soloSet = new Set(soloedIds);
    const muteSet = new Set(mutedIds);
    const anySolo = soloSet.size > 0;
    nodesRef.current.forEach((n, tid) => {
      const userMuted = muteSet.has(tid);
      const soloSilenced = anySolo && !soloSet.has(tid);
      try { n.channel.mute = userMuted || soloSilenced; } catch {}
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
    play, pause, stop, seekTo, scrubTo, setBpm, setLoop, setMetronome,
    listInputDevices, openMic, openMicDetailed, closeMic, setMonitoring, getInputLevel,
    startRecording, stopRecording,
    setTrackVolume, setTrackPan, setTrackMute, setTrackSolo, applySolo, setMasterVolume,
    loadTracks, scheduleFades, rescheduleClips, scheduleAutomation, rebuildEffects, rebuildClips, applyEffectParams, applyClipOps,
    getPosition, getLevels, getAnalyser,
    isLoaded, loadError,
  }), [
    play, pause, stop, seekTo, scrubTo, setBpm, setLoop, setMetronome,
    listInputDevices, openMic, openMicDetailed, closeMic, setMonitoring, getInputLevel,
    startRecording, stopRecording,
    setTrackVolume, setTrackPan, setTrackMute, setTrackSolo, applySolo, setMasterVolume,
    loadTracks, scheduleFades, rescheduleClips, scheduleAutomation, rebuildEffects, rebuildClips, applyEffectParams, applyClipOps,
    getPosition, getLevels, getAnalyser,
    isLoaded, loadError,
  ]);
}

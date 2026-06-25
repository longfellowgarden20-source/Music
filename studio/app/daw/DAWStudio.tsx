"use client";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, API } from "../lib/api";
import { useDawEngine } from "./useDawEngine";
import { useHistory } from "./useHistory";
import { wrapWithLog, logAction } from "./actionLog";
import ActionLogPanel from "./ActionLogPanel";
import TransportBar from "./TransportBar";
import TrackHeaders from "./TrackHeaders";
import ArrangementCanvas from "./ArrangementCanvas";
import MixerPanel from "./MixerPanel";
import EffectsRack from "./EffectsRack";
import PianoRoll from "./PianoRoll";
import ScoreView from "./ScoreView";
import VocalRecorder from "./VocalRecorder";
import EPiano from "./EPiano";
import SelectionToolbar from "./SelectionToolbar";
import RegionContextMenu from "./RegionContextMenu";
import TrackContextMenu from "./TrackContextMenu";
import FileMenu from "./FileMenu";
import { makeEffect, buildPresetChain, type VocalPreset } from "./effects";
import { makeOp, OP_META, peaksFromBuffer } from "./regionOps";
import { renderMixdown, audioBufferToWav, downloadBlob, serializeProject, type ProjectFile } from "./exporter";
import { saveLocalProject, loadLocalProject, clearLocalProject } from "./projectStore";
import { C, STEM_COLORS, MARKER_COLORS, mono, ui, withAlpha } from "./theme";
import type { DawTrack, DawClip, TransportState, ViewState, Gesture, Marker, SnapResolution, EffectType, TimeSelection, RegionOp, RegionOpType } from "./dawTypes";

const STEM_ORDER = ["vocals", "drums", "bass", "guitar", "piano", "other"];

function uid() { return Math.random().toString(36).slice(2, 9); }

function makeDawTrack(id: string, label: string, audioUrl: string, duration: number): DawTrack {
  const clip: DawClip = {
    id: uid(), trackId: id, startSec: 0, durationSec: duration, offsetSec: 0,
    fadeInSec: 0, fadeOutSec: 0, gain: 1,
  };
  return {
    id, label, color: STEM_COLORS[id] ?? "#888",
    clips: [clip], volume: 0.85, pan: 0,
    muted: false, soloed: false, armed: false,
    audioUrl, peakData: null, duration, effects: [], automation: {},
  };
}

export default function DAWStudio() {
  const params = useSearchParams();
  const router = useRouter();
  const rawEngine = useDawEngine();
  // Wrap the engine so every method call is auto-logged to the debug ActionLog —
  // covers all current AND future engine methods with no per-call work. Memoized
  // on rawEngine identity so the wrapped object stays stable (the engine relies on
  // a stable identity to avoid effect-loop re-fires).
  const engine = useMemo(() => wrapWithLog(rawEngine), [rawEngine]);
  const history = useHistory();

  const [tracks, setTracks] = useState<DawTrack[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [transport, setTransport] = useState<TransportState>({
    playing: false, recording: false, positionSec: 0,
    bpm: 120, looping: false, loopStart: 0, loopEnd: 8,
    metronome: false, zoom: 24, snap: "off",
  });
  const [view] = useState<ViewState>({ scrollLeft: 0, scrollTop: 0, trackHeight: 88, headerWidth: 160 });
  const [scrollLeft, setScrollLeft] = useState(0);
  const [scrollTop, setScrollTop]   = useState(0);
  const [positionSec, setPositionSec] = useState(0);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [splitStatus, setSplitStatus] = useState<"idle" | "splitting" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("Loading track…");
  const [trackTitle, setTrackTitle] = useState("DAW");
  const [bottomPanel, setBottomPanel] = useState<"mixer" | "effects" | "record" | "piano-roll" | "score" | "piano" | null>("mixer");
  const [masterVolume, setMasterVolume] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TimeSelection | null>(null);
  const [regionMenu, setRegionMenu] = useState<{ x: number; y: number } | null>(null);
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; trackId: string } | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [addLayerOpen, setAddLayerOpen] = useState(false);
  const layerFileRef = useRef<HTMLInputElement>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [automationLane, setAutomationLane] = useState<"volume" | "pan" | null>(null);
  const [trackKey, setTrackKey] = useState<string | null>(null);
  const [chordProg, setChordProg] = useState<string | null>(null);
  const [chordsLoading, setChordsLoading] = useState(false);


  const positionRef = useRef(0);
  const rafRef = useRef<number>(0);
  const playingRef = useRef(false);
  const scrubbingRef = useRef(false);          // true while dragging the playhead on the ruler
  const wasPlayingBeforeScrubRef = useRef(false);
  const gestureRef = useRef<Gesture | null>(null);
  const tracksRef = useRef<DawTrack[]>([]);
  const markersRef = useRef<Marker[]>([]);
  gestureRef.current = gesture;
  tracksRef.current = tracks;
  markersRef.current = markers;

  const trackId = params.get("id");

  // helper: push current arrangement to history then update
  const commitHistory = useCallback((label: string) => {
    history.push(tracksRef.current, markersRef.current, label);
  }, [history]);


  // ── position + meter ticker ──────────────────────────────────────────────────
  useEffect(() => {
    playingRef.current = transport.playing;
    if (transport.playing) {
      const tick = () => {
        // While the user is dragging the playhead, let the scrub drive the
        // position — don't overwrite it with the (paused) transport clock.
        if (!scrubbingRef.current) {
          const pos = engine.getPosition();
          positionRef.current = pos;
          setPositionSec(pos);
        }
        setLevels(engine.getLevels());
        if (playingRef.current) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafRef.current);
      setLevels({});
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [transport.playing, engine]);

  // (keyboard-shortcut effect is registered below, after the handlers it calls
  //  are declared — see "keyboard shortcuts" further down.)

  // ── load track + stems ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!trackId) return;
    const id = parseInt(trackId);

    // If we have a locally-autosaved session for this song, restore it instead of
    // re-loading the pristine stems — this is what makes edits survive a refresh.
    const saved = loadLocalProject(trackId);
    if (saved) {
      setStatusMsg("Restoring your saved session…");
      restoreFromProject(saved)
        .then(() => { setSplitStatus("idle"); setStatusMsg(""); })
        .catch(() => {
          // saved session failed to restore (e.g. audio url changed) — fall back
          // to a clean load so the user isn't stuck.
          clearLocalProject(trackId);
          setStatusMsg("Saved session couldn't be restored — loading fresh.");
          loadFresh();
        });
      // still fetch metadata (title/bpm/key) for the header
      api.track(id).then(t => {
        setTrackTitle(prev => prev || t.title || t.prompt || "Untitled");
        setTrackKey(t.key ?? null);
      }).catch(() => {});
      return;
    }
    loadFresh();

    function loadFresh() {
    api.track(id).then(async t => {
      setTrackTitle(t.title || t.prompt || "Untitled");
      setTransport(tr => ({ ...tr, bpm: t.bpm || 120 }));
      setTrackKey(t.key ?? null);

      // Track file missing on disk — audio was never generated or was deleted.
      if (!t.has_audio) {
        setSplitStatus("error");
        setStatusMsg("Audio file not found — this track was never generated or was deleted.");
        return;
      }

      // Detect existing stems with a few retries: a transient "Failed to fetch"
      // (dev-server / API startup race) must NOT make us think there are no stems
      // — that wrongly drops us into the master-load + re-split branch even though
      // correct stems already exist on disk.
      let stemInfo: Awaited<ReturnType<typeof api.stems>> | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try { stemInfo = await api.stems(id); break; }
        catch { await new Promise(r => setTimeout(r, 400)); }
      }

      if (stemInfo?.separated && stemInfo.stems) {
        setStatusMsg("Loading stems into DAW…");
        await loadStemTracks(id, t.duration ?? 30, Object.keys(stemInfo.stems));
        setSplitStatus("idle");
        setStatusMsg("");
      } else {
        const masterUrl = `${API}/api/audio/${id}`;
        const masterTrack = makeDawTrack("master", "Master", masterUrl, t.duration ?? 30);
        const loaded = await engine.loadTracks([masterTrack]);
        setTracks(loaded);
        history.push(loaded, [], "Load");
        setSplitStatus("splitting");
        setStatusMsg("Separating into stems — this takes ~30s on CPU…");
        try {
          const splitResult = await api.splitStems(id);
          const stemNames = splitResult?.stems ? Object.keys(splitResult.stems) : undefined;
          await loadStemTracks(id, t.duration ?? 30, stemNames);
          setSplitStatus("idle");
          setStatusMsg("");
        } catch (e: any) {
          setSplitStatus("error");
          setStatusMsg(`Stem separation failed: ${e.message}`);
        }
      }
    }).catch(e => {
      setStatusMsg(`Failed to load track: ${e.message}`);
    });
    } // loadFresh
  }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autosave: debounce-write the whole session to localStorage on any change, so a
  // refresh or crash restores exactly where the user left off. Skips the very first
  // render (nothing loaded yet) and the empty state (don't clobber a saved session
  // with an empty one before tracks finish loading).
  const autosaveReady = useRef(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!trackId) return;
    if (tracks.length === 0) return;            // nothing to save yet
    if (!autosaveReady.current) { autosaveReady.current = true; return; } // skip initial load write
    const handle = setTimeout(() => {
      const proj = serializeProject({
        trackId, title: trackTitle, transport, markers: markersRef.current, tracks: tracksRef.current,
      });
      saveLocalProject(trackId, proj);
      setSavedAt(Date.now());
    }, 600);
    return () => clearTimeout(handle);
  }, [trackId, tracks, markers, transport, trackTitle]);

  async function loadStemTracks(trackId: number, duration: number, availableStems?: string[]) {
    setStatusMsg("Loading stems into DAW…");
    // Use only stems that actually exist on disk, in canonical order
    const stemNames = availableStems
      ? STEM_ORDER.filter(s => availableStems.includes(s))
      : STEM_ORDER;
    const dawTracks = stemNames.map(stem =>
      makeDawTrack(stem, stem.charAt(0).toUpperCase() + stem.slice(1),
        api.stemAudioUrl(trackId, stem), duration)
    );
    const loaded = await engine.loadTracks(dawTracks);
    // Guard against a "fake load": if no stem produced real peaks, the audio
    // didn't actually load — don't pretend it's ready.
    const anyReal = loaded.some(t => t.peakData && t.peakData.length > 0);
    if (!anyReal) {
      throw new Error("stems loaded but no audio decoded — split may have failed");
    }
    setTracks(loaded);
    engine.scheduleFades(loaded);
    setSelectedId(prev => prev ?? loaded[0]?.id ?? null);
    history.push(loaded, [], "Load stems");
    setStatusMsg("");
  }

  // ── transport handlers ───────────────────────────────────────────────────────
  const handlePlayPause = useCallback(() => {
    if (playingRef.current) {
      engine.pause();
      setTransport(t => ({ ...t, playing: false }));
    } else {
      engine.scheduleFades(tracksRef.current);
      engine.scheduleAutomation(tracksRef.current);
      engine.play();
      setTransport(t => ({ ...t, playing: true }));
    }
  }, [engine]);

  const handleStop = useCallback(() => {
    engine.stop();
    setTransport(t => ({ ...t, playing: false }));
    setPositionSec(0);
  }, [engine]);

  // Stop recording + add the captured take as a new track.
  // Tracks we auto-muted because they were armed, so we can restore them on stop.
  const armMutedRef = useRef<string[]>([]);

  const finishRecording = useCallback(async () => {
    const result = await engine.stopRecording();
    setTransport(t => ({ ...t, recording: false }));

    // Restore the monitoring-mute we applied to armed tracks while recording.
    for (const id of armMutedRef.current) {
      const tk = tracksRef.current.find(t => t.id === id);
      engine.setTrackMute(id, tk?.muted ?? false);
    }
    armMutedRef.current = [];

    if (result) {
      const recId = `rec_${uid()}`;
      // Tie the take to the armed track if there is one: inherit its name + colour
      // so a re-record reads as "that part, take N" rather than a generic clip.
      const armed = tracksRef.current.find(t => t.armed);
      const takeNum = tracksRef.current.filter(t => t.id.startsWith("rec")).length + 1;
      const label = armed ? `${armed.label} take ${takeNum}` : `Recording ${takeNum}`;
      const recTrack = makeDawTrack(recId, label, result.url, result.duration);
      recTrack.color = armed?.color ?? "#c47b6e";
      const merged = [...tracksRef.current, recTrack];
      const loaded = await engine.loadTracks(merged);
      setTracks(loaded);
      engine.scheduleFades(loaded);
      history.push(loaded, markersRef.current, "Record");
    }
  }, [engine, history]);

  // Start recording. opts let the Vocal Recorder pass a device + record-over-beat.
  const beginRecording = useCallback(async (opts?: { deviceId?: string; alongTransport?: boolean }): Promise<boolean> => {
    const ok = await engine.startRecording(opts);
    if (ok) {
      setTransport(t => ({ ...t, recording: true }));
      // Punch-in monitoring: silence armed tracks during the take so the old
      // part doesn't bleed into what you're re-recording. Restored on stop.
      const toMute = tracksRef.current.filter(t => t.armed && !t.muted).map(t => t.id);
      armMutedRef.current = toMute;
      for (const id of toMute) engine.setTrackMute(id, true);
    } else {
      setStatusMsg("Microphone unavailable — allow mic access to record.");
    }
    return ok;
  }, [engine]);

  // R-key / transport-button toggle (legacy simple path — no count-in, default mic).
  const handleRecord = useCallback(async () => {
    if (transport.recording) { await finishRecording(); return; }
    if (playingRef.current) return; // simple path: don't start over playback
    await beginRecording();
  }, [transport.recording, finishRecording, beginRecording]);

  // ── Add Layer ─────────────────────────────────────────────────────────────
  // Palette for user-added layers (cycles so each new layer is a distinct colour).
  const LAYER_COLORS = ["#5fa8c4", "#c47b6e", "#8e7fc4", "#c4a96e", "#7fb89a", "#b88fb0", "#6e9fc4", "#d6c14a"];

  // Import an audio file (wav/mp3/m4a/ogg) from disk as a new layer track.
  const handleImportLayer = useCallback(async (file: File) => {
    setStatusMsg(`Importing ${file.name}…`);
    try {
      const url = URL.createObjectURL(file);
      const id = `layer_${uid()}`;
      const n = tracksRef.current.filter(t => t.id.startsWith("layer") || t.id.startsWith("rec")).length;
      const label = file.name.replace(/\.[^.]+$/, "").slice(0, 24) || `Layer ${n + 1}`;
      // duration unknown until decoded — loadTracks decodes and fills it in.
      const layer = makeDawTrack(id, label, url, 0);
      layer.color = LAYER_COLORS[n % LAYER_COLORS.length];
      const merged = [...tracksRef.current, layer];
      const loaded = await engine.loadTracks(merged);
      // loadTracks fills in the real decoded duration — sync the clip to match so
      // the imported layer renders at full width instead of zero.
      const synced = loaded.map(t => {
        if (t.id !== id) return t;
        const clips = t.clips.map(c => ({ ...c, durationSec: t.duration }));
        return { ...t, clips };
      });
      setTracks(synced);
      engine.scheduleFades(synced);
      setSelectedId(id);
      history.push(synced, markersRef.current, "Import layer");
      setStatusMsg(`Added "${label}".`);
    } catch (e) {
      setStatusMsg(`Import failed: ${(e as Error).message}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, history]);

  // Duplicate an existing track into a new layer (great for vocal doubling /
  // stacking harmonies you then pitch-shift or pan).
  const handleDuplicateLayer = useCallback(async (trackId: string) => {
    const src = tracksRef.current.find(t => t.id === trackId);
    if (!src) return;
    setStatusMsg(`Duplicating ${src.label}…`);
    const id = `layer_${uid()}`;
    const n = tracksRef.current.filter(t => t.id.startsWith("layer") || t.id.startsWith("rec")).length;
    const dup = makeDawTrack(id, `${src.label} copy`, src.audioUrl, src.duration);
    dup.color = LAYER_COLORS[n % LAYER_COLORS.length];
    // carry over the source clip's region ops so the copy sounds identical
    if (src.clips[0]?.ops) dup.clips[0].ops = [...src.clips[0].ops];
    const merged = [...tracksRef.current, dup];
    const loaded = await engine.loadTracks(merged);
    // re-apply ops on the dup so its buffer matches
    for (const t of loaded) {
      if (t.id === id && t.clips[0]?.ops?.length) {
        const r = await engine.applyClipOps(t.id, t.clips[0].ops);
        if (r) t.peakData = r.peaks;
      }
    }
    setTracks(loaded);
    engine.scheduleFades(loaded);
    setSelectedId(id);
    history.push(loaded, markersRef.current, "Duplicate layer");
    setStatusMsg(`Duplicated "${src.label}".`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, history]);

  // Record a NEW vocal/audio layer — opens the Record panel (it adds a track on stop).
  const handleRecordLayer = useCallback(() => {
    setBottomPanel("record");
  }, []);

  const handleSeek = useCallback((sec: number) => {
    engine.seekTo(sec);
    setPositionSec(sec);
  }, [engine]);

  // Ruler-drag scrub: while the pointer is down we only move the visual playhead
  // and the (paused) transport clock — cheap, runs every mousemove. On release we
  // commit with seekTo(), which re-arms the players and resumes playback if it was
  // playing when the drag started.
  const handleScrub = useCallback((sec: number) => {
    if (!scrubbingRef.current) {
      scrubbingRef.current = true;
      wasPlayingBeforeScrubRef.current = playingRef.current;
    }
    engine.scrubTo(sec);
    positionRef.current = sec;
    setPositionSec(sec);
  }, [engine]);

  const handleScrubEnd = useCallback((sec: number) => {
    scrubbingRef.current = false;
    setPositionSec(sec);
    positionRef.current = sec;
    if (wasPlayingBeforeScrubRef.current) {
      engine.seekTo(sec);           // re-arm players + resume from the drop point
    } else {
      engine.scrubTo(sec);          // stay paused, just park the clock here
    }
  }, [engine]);

  const handleBpm = useCallback((bpm: number) => {
    engine.setBpm(bpm);
    setTransport(t => ({ ...t, bpm }));
  }, [engine]);

  const handleDetectChords = useCallback(async () => {
    if (!trackId || chordsLoading) return;
    setChordsLoading(true);
    try {
      const r = await api.chords(parseInt(trackId));
      setChordProg(r.progression || "—");
    } catch {
      setChordProg("detection failed");
    }
    setChordsLoading(false);
  }, [trackId, chordsLoading]);

  const handleLoopToggle = useCallback(() => {
    setTransport(t => {
      const on = !t.looping;
      engine.setLoop(on, t.loopStart, t.loopEnd);
      return { ...t, looping: on };
    });
  }, [engine]);

  const handleLoopRange = useCallback((start: number, end: number) => {
    engine.setLoop(true, start, end);
    setTransport(t => ({ ...t, looping: true, loopStart: start, loopEnd: end }));
  }, [engine]);

  const handleMetronome = useCallback(() => {
    setTransport(t => {
      const on = !t.metronome;
      engine.setMetronome(on);
      return { ...t, metronome: on };
    });
  }, [engine]);

  const handleZoom = useCallback((z: number) => {
    setTransport(t => ({ ...t, zoom: z }));
  }, []);

  const handleSnap = useCallback((s: SnapResolution) => {
    setTransport(t => ({ ...t, snap: s }));
  }, []);

  // ── markers ──────────────────────────────────────────────────────────────────
  const handleAddMarker = useCallback(() => {
    const sec = positionRef.current;
    setMarkers(ms => {
      const next = [...ms, {
        id: uid(), sec,
        label: `M${ms.length + 1}`,
        color: MARKER_COLORS[ms.length % MARKER_COLORS.length],
      }].sort((a, b) => a.sec - b.sec);
      history.push(tracksRef.current, next, "Add marker");
      return next;
    });
  }, [history]);

  const handleMarkerClick = useCallback((m: Marker) => {
    // shift-click deletes; plain click jumps
    handleSeek(m.sec);
  }, [handleSeek]);

  // ── track controls ───────────────────────────────────────────────────────────
  const handleMute = useCallback((id: string) => {
    setTracks(ts => {
      const next = ts.map(t => t.id === id ? { ...t, muted: !t.muted } : t);
      // Mute interacts with solo (an explicit mute must win), so recompute the whole
      // mix through applySolo rather than toggling one channel in isolation.
      engine.applySolo(
        next.filter(t => t.soloed).map(t => t.id),
        next.filter(t => t.muted).map(t => t.id),
      );
      return next;
    });
  }, [engine]);

  const handleSolo = useCallback((id: string) => {
    setTracks(ts => {
      const next = ts.map(t => t.id === id ? { ...t, soloed: !t.soloed } : t);
      engine.applySolo(
        next.filter(t => t.soloed).map(t => t.id),
        next.filter(t => t.muted).map(t => t.id),
      );
      return next;
    });
  }, [engine]);

  const handleVolume = useCallback((id: string, vol: number) => {
    engine.setTrackVolume(id, vol);
    setTracks(ts => ts.map(t => t.id === id ? { ...t, volume: vol } : t));
  }, [engine]);

  const handlePan = useCallback((id: string, pan: number) => {
    engine.setTrackPan(id, pan);
    setTracks(ts => ts.map(t => t.id === id ? { ...t, pan } : t));
  }, [engine]);

  const handleMasterVolume = useCallback((vol: number) => {
    engine.setMasterVolume(vol);
    setMasterVolume(vol);
  }, [engine]);

  const handleArm = useCallback((id: string) => {
    setTracks(ts => ts.map(t => t.id === id ? { ...t, armed: !t.armed } : t));
  }, []);

  const handleReorder = useCallback((from: number, to: number) => {
    setTracks(ts => {
      if (to < 0 || to >= ts.length) return ts;
      const next = [...ts];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      history.push(next, markersRef.current, "Reorder tracks");
      return next;
    });
  }, [history]);

  const handleColor = useCallback((id: string, color: string) => {
    setTracks(ts => {
      const next = ts.map(t => t.id === id ? { ...t, color } : t);
      history.push(next, markersRef.current, "Recolor track");
      return next;
    });
  }, [history]);

  const handleRenameTrack = useCallback((id: string, label: string) => {
    const name = label.trim();
    if (!name) return;
    setTracks(ts => {
      const next = ts.map(t => t.id === id ? { ...t, label: name } : t);
      history.push(next, markersRef.current, "Rename track");
      return next;
    });
  }, [history]);

  // Remove a track entirely. Rebuilds the engine graph from the remaining tracks
  // so the deleted stem's audio actually stops (its player is disposed by reload).
  const handleDeleteTrack = useCallback(async (id: string) => {
    const remaining = tracksRef.current.filter(t => t.id !== id);
    const loaded = await engine.loadTracks(remaining);
    for (const t of loaded) {
      engine.rebuildEffects(t);
      const res = await engine.applyClipOps(t.id, t.clips[0]?.ops ?? []);
      if (res) t.peakData = res.peaks;
    }
    setTracks(loaded);
    engine.rescheduleClips(loaded);
    engine.scheduleFades(loaded);
    if (selectedId === id) setSelectedId(loaded[0]?.id ?? null);
    history.push(loaded, markersRef.current, "Delete track");
  }, [engine, history, selectedId]);

  // ── effects rack ─────────────────────────────────────────────────────────────
  const handleAddEffect = useCallback((trackId: string, type: EffectType) => {
    setTracks(ts => {
      const next = ts.map(t => t.id === trackId ? { ...t, effects: [...t.effects, makeEffect(type)] } : t);
      const tk = next.find(t => t.id === trackId);
      if (tk) engine.rebuildEffects(tk);
      history.push(next, markersRef.current, "Add effect");
      return next;
    });
  }, [engine, history]);

  const handleRemoveEffect = useCallback((trackId: string, effectId: string) => {
    setTracks(ts => {
      const next = ts.map(t => t.id === trackId ? { ...t, effects: t.effects.filter(e => e.id !== effectId) } : t);
      const tk = next.find(t => t.id === trackId);
      if (tk) engine.rebuildEffects(tk);
      history.push(next, markersRef.current, "Remove effect");
      return next;
    });
  }, [engine, history]);

  const handleToggleEffect = useCallback((trackId: string, effectId: string) => {
    const next = tracksRef.current.map(t => t.id === trackId
      ? { ...t, effects: t.effects.map(e => e.id === effectId ? { ...e, enabled: !e.enabled } : e) }
      : t);
    const tk = next.find(t => t.id === trackId);
    if (tk) engine.rebuildEffects(tk);
    setTracks(next);
    history.push(next, markersRef.current, "Toggle effect");
  }, [engine, history]);

  const handleEffectParam = useCallback((trackId: string, effectId: string, key: string, value: number) => {
    setTracks(ts => ts.map(t => {
      if (t.id !== trackId) return t;
      const effects = t.effects.map(e => e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e);
      const eff = effects.find(e => e.id === effectId);
      if (eff) engine.applyEffectParams(trackId, eff);
      return { ...t, effects };
    }));
  }, [engine]);

  // Apply a vocal preset chain — REPLACES the track's whole effect rack.
  const handleApplyPreset = useCallback((trackId: string, preset: VocalPreset) => {
    setTracks(ts => {
      const next = ts.map(t => t.id === trackId ? { ...t, effects: buildPresetChain(preset) } : t);
      const tk = next.find(t => t.id === trackId);
      if (tk) engine.rebuildEffects(tk);
      history.push(next, markersRef.current, `Preset: ${preset.name}`);
      return next;
    });
  }, [engine, history]);

  const selectedTrack = tracks.find(t => t.id === selectedId) ?? null;
  const selectionTrack = selection ? (tracks.find(t => t.id === selection.trackId) ?? null) : null;

  // ── region editing (the core "grab a part, change it" feature) ────────────────
  // Convert the arrangement-time selection into clip-SOURCE time, append a
  // RegionOp, render instantly via the engine, and refresh the waveform peaks.
  const applyRegionOp = useCallback(async (type: RegionOpType, amount: number) => {
    if (!selection) return;
    const track = tracksRef.current.find(t => t.id === selection.trackId);
    const clip = track?.clips.find(c => c.id === selection.clipId);
    if (!track || !clip) return;
    // arrangement time -> source time: subtract clip start, add its offset
    const srcStart = selection.startSec - clip.startSec + clip.offsetSec;
    const srcEnd = selection.endSec - clip.startSec + clip.offsetSec;
    const op = makeOp(type, srcStart, srcEnd, amount, OP_META[type].name);

    commitHistory(`${OP_META[type].name} region`);
    const nextOps = [...(clip.ops ?? []), op];
    const res = await engine.applyClipOps(track.id, nextOps);
    const lengthChanging = OP_META[type].lengthChanging;
    const next = tracksRef.current.map(t => {
      if (t.id !== track.id) return t;
      const clips = t.clips.map(c => {
        if (c.id !== clip.id) return c;
        // length-changing ops resize the clip to match the new buffer duration
        const durationSec = lengthChanging && res ? res.duration - c.offsetSec : c.durationSec;
        return { ...c, ops: nextOps, durationSec };
      });
      return { ...t, clips, peakData: res?.peaks ?? t.peakData, duration: res?.duration ?? t.duration };
    });
    setTracks(next);
    // structural edits change clip windows — re-arm the track's clip players so
    // playback matches, then re-schedule fades. Clear the (now-stale) selection.
    const updatedTrack = next.find(t => t.id === track.id);
    if (lengthChanging && updatedTrack) {
      setSelection(null);
      await engine.rebuildClips(updatedTrack);
    }
    engine.scheduleFades(next);
  }, [selection, commitHistory, engine]);

  // Apply Auto-Tune to the WHOLE selected track (no drag-selection needed).
  // Replaces any prior autotune op so re-tuning with new settings is clean.
  const handleAutotune = useCallback(async (
    trackId: string, key: number, scale: number, strength: number, speed: number,
  ) => {
    const track = tracksRef.current.find(t => t.id === trackId);
    const clip = track?.clips[0];
    if (!track || !clip) return;
    const srcStart = clip.offsetSec;
    const srcEnd = clip.offsetSec + clip.durationSec;
    const op = makeOp("autotune", srcStart, srcEnd, 0, "Auto-Tune");
    op.params = { key, scale, strength, speed };
    commitHistory("Auto-Tune");
    // drop any existing autotune op, then add the new one (idempotent retune)
    const baseOps = (clip.ops ?? []).filter(o => o.type !== "autotune");
    const nextOps = [...baseOps, op];
    setStatusMsg("Applying Auto-Tune…");
    const res = await engine.applyClipOps(track.id, nextOps);
    setTracks(ts => ts.map(t => {
      if (t.id !== track.id) return t;
      const clips = t.clips.map(c => c.id === clip.id ? { ...c, ops: nextOps } : c);
      return { ...t, clips, peakData: res?.peaks ?? t.peakData };
    }));
    engine.scheduleFades(tracksRef.current);
    setStatusMsg("Auto-Tune applied.");
  }, [commitHistory, engine]);

  // Remove Auto-Tune from a track.
  const handleClearAutotune = useCallback(async (trackId: string) => {
    const track = tracksRef.current.find(t => t.id === trackId);
    const clip = track?.clips[0];
    if (!track || !clip || !(clip.ops ?? []).some(o => o.type === "autotune")) return;
    commitHistory("Remove Auto-Tune");
    const nextOps = (clip.ops ?? []).filter(o => o.type !== "autotune");
    const res = await engine.applyClipOps(track.id, nextOps);
    setTracks(ts => ts.map(t => {
      if (t.id !== track.id) return t;
      const clips = t.clips.map(c => c.id === clip.id ? { ...c, ops: nextOps } : c);
      return { ...t, clips, peakData: res?.peaks ?? t.peakData };
    }));
    engine.scheduleFades(tracksRef.current);
  }, [commitHistory, engine]);

  // AI regenerate the selected region via the Python backend, then reload that
  // track's audio (the backend saves a new version of the whole track's source).
  const handleAiRegen = useCallback(async (prompt: string) => {
    if (!selection || !trackId) return;
    const numId = parseInt(trackId);
    setAiBusy(true);
    setStatusMsg("AI regenerating region with Stable Audio 3 inpainting…");
    try {
      await api.region(numId, {
        start: selection.startSec, end: selection.endSec, prompt,
        model_size: "small", guidance: 3.0, xfade: 0.25,
      });
      // reload stems/master so the regenerated audio is heard
      setStatusMsg("Reloading regenerated audio…");
      // re-fetch the track audio (backend saved a new version of the source)
      const reloaded = await engine.loadTracks(tracksRef.current);
      setTracks(reloaded);
      engine.scheduleFades(reloaded);
      setStatusMsg("");
    } catch (e: any) {
      setStatusMsg(`AI regen failed: ${e.message}`);
    } finally {
      setAiBusy(false);
    }
  }, [selection, trackId, engine]);

  // ── AI stem ops (regenerate / extend / swap on the selected stem track) ────────
  const runStemOp = useCallback(async (kind: "regenerate" | "extend" | "swap", prompt: string) => {
    if (!trackId || !selectedTrack) return;
    const numId = parseInt(trackId);
    const stem = selectedTrack.id;   // track id == stem name (vocals/drums/bass/other)
    setAiBusy(true);
    setStatusMsg(`AI ${kind} on ${selectedTrack.label} — running MusicGen…`);
    try {
      const body: Record<string, unknown> = { prompt, model_size: "small", guidance: 3.0 };
      if (kind === "regenerate") { body.start = selection?.startSec ?? 0; body.end = selection?.endSec ?? 0; }
      if (kind === "extend") body.add_duration = 6;
      if (kind === "regenerate") await api.stemRegenerate(numId, stem, body);
      else if (kind === "extend") await api.stemExtend(numId, stem, body);
      else await api.stemSwap(numId, stem, body);
      setStatusMsg("Reloading regenerated stem…");
      const reloaded = await engine.loadTracks(tracksRef.current);
      for (const t of reloaded) { const r = await engine.applyClipOps(t.id, t.clips[0]?.ops ?? []); if (r) t.peakData = r.peaks; }
      setTracks(reloaded);
      engine.scheduleFades(reloaded);
      setStatusMsg("");
    } catch (e: any) {
      setStatusMsg(`AI ${kind} failed: ${e.message}`);
    } finally { setAiBusy(false); }
  }, [trackId, selectedTrack, selection, engine]);

  // ── automation ─────────────────────────────────────────────────────────────────
  // Add (or replace a near) point on the active lane for a track. Points within
  // ~1 grid of the click time are replaced so re-clicking edits in place.
  const handleAutomationEdit = useCallback((tid: string, sec: number, value: number) => {
    if (!automationLane) return;
    logAction("ui", "automation", `${automationLane} ${tid} ${value.toFixed(2)}`);
    commitHistory("Automation");
    const lane = automationLane;
    const nextTracks = tracksRef.current.map(t => {
      if (t.id !== tid) return t;
      const existing = t.automation?.[lane] ?? [];
      const tol = 0.15;
      const filtered = existing.filter(p => Math.abs(p.sec - sec) > tol);
      const next = [...filtered, { sec, value }].sort((a, b) => a.sec - b.sec);
      return { ...t, automation: { ...t.automation, [lane]: next } };
    });
    setTracks(nextTracks);
    // Push the new curves to the audio graph immediately so edits are audible
    // while playing — without this, automation only took effect on the next play.
    engine.scheduleAutomation(nextTracks);
  }, [automationLane, commitHistory, engine]);

  // ── export / project save-load / bounce ───────────────────────────────────────
  const safeName = (trackTitle || "stemai").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "stemai";

  const handleExportMix = useCallback(async () => {
    setStatusMsg("Rendering mixdown…");
    try {
      const mix = await renderMixdown(tracksRef.current, masterVolume);
      downloadBlob(audioBufferToWav(mix), `${safeName}_mix.wav`);
      setStatusMsg("");
    } catch (e: any) { setStatusMsg(`Export failed: ${e.message}`); }
  }, [safeName, masterVolume]);

  const handleExportStems = useCallback(async () => {
    setStatusMsg("Exporting stems…");
    try {
      // export each track individually (its edits baked in) as a solo mixdown
      for (const t of tracksRef.current) {
        const solo = tracksRef.current.map(x => ({ ...x, muted: x.id !== t.id, soloed: false }));
        const buf = await renderMixdown(solo);
        downloadBlob(audioBufferToWav(buf), `${safeName}_${t.label}.wav`);
      }
      setStatusMsg("");
    } catch (e: any) { setStatusMsg(`Stem export failed: ${e.message}`); }
  }, [safeName]);

  // Discard the autosaved session and reload the pristine stems from the server.
  const handleRevertToOriginal = useCallback(() => {
    if (!trackId) return;
    if (!window.confirm("Discard your saved edits for this song and reload the original stems? This can't be undone.")) return;
    clearLocalProject(trackId);
    autosaveReady.current = false;
    window.location.reload();
  }, [trackId]);

  const handleSaveProject = useCallback(() => {
    const proj = serializeProject({
      trackId, title: trackTitle, transport, markers: markersRef.current, tracks: tracksRef.current,
    });
    downloadBlob(new Blob([JSON.stringify(proj, null, 2)], { type: "application/json" }), `${safeName}.stemai.json`);
  }, [trackId, trackTitle, transport, safeName]);

  // Rebuild the full DAW session from a serialized project: re-fetch audio,
  // restore tracks/clips/effects/automation, replay region ops, schedule fades +
  // clip positions. Shared by File→Open and the localStorage autosave-restore.
  const restoreFromProject = useCallback(async (proj: ProjectFile) => {
    if (proj.version !== 1) throw new Error("unsupported project version");
    setTrackTitle(proj.title || "Project");
    setTransport(tr => ({ ...tr, bpm: proj.transport.bpm, looping: proj.transport.looping,
      loopStart: proj.transport.loopStart, loopEnd: proj.transport.loopEnd, snap: proj.transport.snap }));
    setMarkers(proj.markers || []);
    const rebuilt: DawTrack[] = proj.tracks.map(pt => ({
      id: pt.id, label: pt.label, color: pt.color, volume: pt.volume, pan: pt.pan,
      muted: pt.muted, soloed: pt.soloed, armed: false, audioUrl: pt.audioUrl,
      peakData: null, duration: pt.clips[0]?.durationSec ?? 30,
      clips: pt.clips.map(c => ({ ...c, trackId: pt.id })),
      effects: pt.effects.map(e => ({ id: e.id, type: e.type as EffectType, enabled: e.enabled, params: e.params })),
      automation: pt.automation ?? {},
    }));
    const loaded = await engine.loadTracks(rebuilt);
    for (const t of loaded) {
      engine.rebuildEffects(t);
      const res = await engine.applyClipOps(t.id, t.clips[0]?.ops ?? []);
      if (res) t.peakData = res.peaks;
      // Self-heal poisoned sessions: an UNEDITED clip 0 (no ops, no offset, not
      // trimmed) should span the whole stem. If a stale autosave stored a short
      // durationSec, snap it back to the real decoded audio length so the clip
      // doesn't render truncated. Edited/trimmed clips (ops or offset) are left
      // alone — their durationSec is intentional.
      const c0 = t.clips[0];
      if (c0 && (!c0.ops || c0.ops.length === 0) && (c0.offsetSec ?? 0) === 0
          && t.duration && c0.durationSec < t.duration - 0.05) {
        t.clips = t.clips.map((c, i) => i === 0 ? { ...c, durationSec: t.duration } : c);
      }
    }
    setTracks(loaded);
    engine.rescheduleClips(loaded);   // place each clip's audio at its saved position
    engine.scheduleFades(loaded);
    engine.scheduleAutomation(loaded);
    setSelectedId(loaded[0]?.id ?? null);
    history.push(loaded, proj.markers || [], "Load project");
  }, [engine, history]);

  const handleLoadProject = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setStatusMsg("Loading project…");
      try {
        const proj: ProjectFile = JSON.parse(await file.text());
        await restoreFromProject(proj);
        setStatusMsg("");
      } catch (e: any) { setStatusMsg(`Load failed: ${e.message}`); }
    };
    input.click();
  }, [restoreFromProject]);

  // Bounce the selected region into a brand-new independent track (a "clip").
  const handleBounceSelection = useCallback(async () => {
    if (!selection) return;
    const src = tracksRef.current.find(t => t.id === selection.trackId);
    if (!src) return;
    setStatusMsg("Bouncing selection…");
    try {
      // crop a copy of the source down to just the selection, as a new track
      const clip = src.clips[0];
      const srcStart = selection.startSec - clip.startSec + clip.offsetSec;
      const srcEnd = selection.endSec - clip.startSec + clip.offsetSec;
      const cropOp = makeOp("crop", srcStart, srcEnd, 1, "Bounce");
      const newId = `bounce_${uid()}`;
      const newTrack = makeDawTrack(newId, `${src.label} bounce`, src.audioUrl, selection.endSec - selection.startSec);
      newTrack.color = src.color;
      newTrack.clips[0].ops = [...(clip.ops ?? []), cropOp];
      const merged = [...tracksRef.current, newTrack];
      const loaded = await engine.loadTracks(merged);
      for (const t of loaded) { const r = await engine.applyClipOps(t.id, t.clips[0]?.ops ?? []); if (r) t.peakData = r.peaks; }
      setTracks(loaded);
      engine.scheduleFades(loaded);
      history.push(loaded, markersRef.current, "Bounce selection");
      setStatusMsg("");
    } catch (e: any) { setStatusMsg(`Bounce failed: ${e.message}`); }
  }, [selection, engine, history]);

  // ── clip gestures ────────────────────────────────────────────────────────────
  const handleGestureStart = useCallback((g: Gesture) => {
    logAction("ui", "gesture", `${g.type} ${g.trackId}`);
    setGesture(g);
    if (g.type !== "loop-range" && g.type !== "seeking" && g.type !== "marquee") {
      // snapshot before edit begins so undo lands on the pre-edit state
      commitHistory(
        g.type === "dragging" ? "Move clip" :
        g.type.startsWith("trim") ? "Trim clip" :
        g.type.startsWith("fade") ? "Fade clip" : "Edit clip"
      );
    }
  }, [commitHistory]);

  const handleGestureMove = useCallback((clientX: number, _clientY?: number) => {
    const g = gestureRef.current;
    if (!g || g.type === "idle" || g.type === "seeking" || g.type === "loop-range") return;
    const deltaSec = (clientX - g.startClientX) / transport.zoom;

    setTracks(ts => ts.map(track => {
      if (track.id !== g.trackId) return track;
      return {
        ...track,
        clips: track.clips.map(clip => {
          if (clip.id !== g.clipId) return clip;
          if (g.type === "dragging") {
            return { ...clip, startSec: Math.max(0, g.origStartSec + deltaSec) };
          } else if (g.type === "trim-left") {
            const newStart = Math.max(0, g.origStartSec + deltaSec);
            const newDur = g.origDurSec - deltaSec;
            if (newDur < 0.1) return clip;
            return { ...clip, startSec: newStart, durationSec: newDur, offsetSec: g.origOffsetSec + deltaSec };
          } else if (g.type === "trim-right") {
            return { ...clip, durationSec: Math.max(0.1, g.origDurSec + deltaSec) };
          } else if (g.type === "fade-in") {
            const fi = Math.max(0, Math.min(clip.durationSec * 0.9, g.origFadeInSec + deltaSec));
            return { ...clip, fadeInSec: fi };
          } else if (g.type === "fade-out") {
            const fo = Math.max(0, Math.min(clip.durationSec * 0.9, g.origFadeOutSec - deltaSec));
            return { ...clip, fadeOutSec: fo };
          }
          return clip;
        }),
      };
    }));
  }, [transport.zoom]);

  const handleGestureEnd = useCallback(() => {
    const g = gestureRef.current;
    if (g && (g.type.startsWith("fade") || g.type.startsWith("trim") || g.type === "dragging")) {
      // A moved/trimmed clip changed its startSec — re-sync the players so the
      // AUDIO follows the block, then re-apply fades at the new position.
      if (g.type === "dragging" || g.type.startsWith("trim")) {
        engine.rescheduleClips(tracksRef.current);
      }
      engine.scheduleFades(tracksRef.current);
    }
    setGesture(null);
  }, [engine]);

  const handleClipGain = useCallback((trackId: string, clipId: string, delta: number) => {
    const next = tracksRef.current.map(track => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map(clip => {
          if (clip.id !== clipId) return clip;
          const gain = Math.max(0, Math.min(2, (clip.gain ?? 1) + delta));
          return { ...clip, gain };
        }),
      };
    });
    setTracks(next);
    engine.scheduleFades(next);   // schedule from the updated tracks, not the stale ref
  }, [engine]);

  const handleClipSplit = useCallback((trackId: string, clipId: string) => {
    const pos = positionRef.current;
    commitHistory("Split clip");
    const next = tracksRef.current.map(track => {
      if (track.id !== trackId) return track;
      const clip = track.clips.find(c => c.id === clipId);
      if (!clip || pos <= clip.startSec || pos >= clip.startSec + clip.durationSec) return track;
      const leftDur = pos - clip.startSec;
      const rightDur = clip.durationSec - leftDur;
      return {
        ...track,
        clips: [
          ...track.clips.filter(c => c.id !== clipId),
          { ...clip, id: uid(), durationSec: leftDur, fadeOutSec: 0 },
          { ...clip, id: uid(), startSec: pos, durationSec: rightDur, offsetSec: clip.offsetSec + leftDur, fadeInSec: 0 },
        ],
      };
    });
    setTracks(next);
    // Rebuild the split track's clip players so the two halves actually play as
    // separate regions (and re-apply fades), then refresh automation.
    const splitTrack = next.find(t => t.id === trackId);
    if (splitTrack) {
      void engine.rebuildClips(splitTrack).then(() => {
        engine.scheduleFades(next);
        engine.scheduleAutomation(next);
      });
    }
  }, [commitHistory, engine]);

  // ── undo / redo ──────────────────────────────────────────────────────────────
  const restoreSnapshot = useCallback(async (snap: { tracks: DawTrack[]; markers: Marker[] } | null) => {
    if (!snap) return;
    setMarkers(snap.markers);
    setTracks(snap.tracks);
    setSelection(null);
    // re-apply mixer + fades + region ops to engine, refreshing peaks per track
    for (const t of snap.tracks) {
      engine.setTrackVolume(t.id, t.volume);
      engine.setTrackPan(t.id, t.pan);
      engine.rebuildEffects(t);
      // Rebuild clip players so undo/redo of a split (or clip move) re-arms the
      // engine to match the restored arrangement, then bake in the region ops.
      await engine.rebuildClips(t);
      const res = await engine.applyClipOps(t.id, t.clips[0]?.ops ?? []);
      if (res) setTracks(cur => cur.map(ct => ct.id === t.id ? { ...ct, peakData: res.peaks } : ct));
    }
    // Apply mute + solo as one coherent pass (solo must override non-soloed tracks).
    engine.applySolo(
      snap.tracks.filter(t => t.soloed).map(t => t.id),
      snap.tracks.filter(t => t.muted).map(t => t.id),
    );
    engine.scheduleFades(snap.tracks);
  }, [engine]);

  const handleUndo = useCallback(() => restoreSnapshot(history.undo()), [history, restoreSnapshot]);
  const handleRedo = useCallback(() => restoreSnapshot(history.redo()), [history, restoreSnapshot]);

  // ── keyboard shortcuts ───────────────────────────────────────────────────────
  // Registered here (after the handlers it calls are declared) and re-bound only
  // when a handler identity changes — not on every render.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT") return;
      const sel = selectedId;   // track-level shortcuts act on the selected track
      if (e.code === "Space") { e.preventDefault(); handlePlayPause(); }
      else if ((e.metaKey || e.ctrlKey) && e.code === "KeyD") { e.preventDefault(); if (sel) handleDuplicateLayer(sel); }   // duplicate track
      else if (e.code === "KeyR" && !e.metaKey) { e.preventDefault(); handleRecord(); }
      else if (e.code === "KeyM" && !e.metaKey && !e.shiftKey) { e.preventDefault(); if (sel) handleMute(sel); }   // mute selected track
      else if (e.code === "KeyM" && e.shiftKey) { e.preventDefault(); handleAddMarker(); }                        // shift+M = add marker
      else if (e.code === "KeyS" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); if (sel) handleSolo(sel); }   // solo selected track
      else if ((e.code === "Backspace" || e.code === "Delete") && sel) { e.preventDefault(); void handleDeleteTrack(sel); }
      else if (e.code === "Escape") handleStop();
      else if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handlePlayPause, handleRecord, handleAddMarker, handleStop, handleUndo, handleRedo,
      selectedId, handleDuplicateLayer, handleMute, handleSolo, handleDeleteTrack]);

  const viewWithScroll = { ...view, scrollLeft, scrollTop };

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100vh",
      overflow: "hidden", background: C.bg0, color: C.text,
    }}>
      <TransportBar
        transport={{ ...transport, positionSec }}
        trackTitle={trackTitle}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onPlay={handlePlayPause}
        onPause={handlePlayPause}
        onStop={handleStop}
        onRecord={handleRecord}
        onBpmChange={handleBpm}
        onLoopToggle={handleLoopToggle}
        onMetronomeToggle={handleMetronome}
        onZoomIn={() => handleZoom(Math.min(600, transport.zoom * 1.25))}
        onZoomOut={() => handleZoom(Math.max(30, transport.zoom / 1.25))}
        onSnapChange={handleSnap}
        onAddMarker={handleAddMarker}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onBack={() => { try { router.push("/"); } catch { window.location.href = "/"; } }}
      />

      {(statusMsg || (engine.loadError && tracks.length > 0)) && (
        <div style={{
          padding: "6px 16px", background: C.bg2, fontSize: 12,
          color: (splitStatus === "error") ? C.rec : engine.loadError ? C.warn : C.accent,
          borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8,
        }}>
          {splitStatus === "splitting" && <span className="spinner" />}
          {statusMsg || (engine.loadError ? `One or more stems had load issues: ${engine.loadError}` : "")}
        </div>
      )}

      {/* chord progression strip */}
      <div style={{
        padding: "4px 16px", background: C.bg1, fontSize: 11,
        borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 10,
        fontFamily: mono, color: C.text3, minHeight: 26,
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.text4 }}>CHORDS</span>
        {chordProg ? (
          <span style={{ color: C.accent, letterSpacing: 0.5 }}>{chordProg}</span>
        ) : (
          <button onClick={handleDetectChords} disabled={chordsLoading} style={{
            fontSize: 10, fontFamily: ui, background: "none", border: `1px solid ${C.line}`,
            color: C.text3, padding: "2px 8px", borderRadius: 4, cursor: chordsLoading ? "default" : "pointer",
          }}>{chordsLoading ? "Detecting…" : "Detect chord progression"}</button>
        )}
      </div>

      {/* Region edit bar: file menu + select-mode toggle + op toolbar */}
      <div style={{
        height: 38, flexShrink: 0, display: "flex", alignItems: "stretch",
        borderBottom: `1px solid ${C.line}`, background: C.bg1,
        overflow: "visible", position: "relative", zIndex: 20,
      }}>
        <FileMenu
          onSave={handleSaveProject} onLoad={handleLoadProject}
          onExportMix={handleExportMix} onExportStems={handleExportStems}
          onBounce={selection ? handleBounceSelection : null}
          onRevert={handleRevertToOriginal}
        />
        {savedAt && (
          <div style={{ display: "flex", alignItems: "center", paddingLeft: 8 }}
            title={`Auto-saved ${new Date(savedAt).toLocaleTimeString()}`}>
            <span style={{ fontSize: 9, color: C.text4, whiteSpace: "nowrap" }}>✓ saved</span>
          </div>
        )}

        {/* Add Layer */}
        <div style={{ position: "relative", display: "flex" }}>
          <button onClick={() => setAddLayerOpen(o => !o)} title="Add a new layer / track"
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "0 14px", border: "none",
              borderRight: `1px solid ${C.line}`, cursor: "pointer", fontSize: 11, fontWeight: 800,
              letterSpacing: 0.5, whiteSpace: "nowrap",
              background: addLayerOpen ? `linear-gradient(180deg, ${C.accent}, ${C.accentDim})` : "transparent",
              color: addLayerOpen ? "#0c1714" : C.text2,
            }}>
            ＋ ADD LAYER <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
          </button>
          {addLayerOpen && (
            <>
              {/* click-away */}
              <div onClick={() => setAddLayerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 59 }} />
              <div style={{
                position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 60,
                background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 8,
                boxShadow: "0 10px 28px rgba(0,0,0,0.55)", padding: 4, minWidth: 240,
              }}>
                {[
                  { label: "Record New Layer", hint: "vocals / mic", icon: "●", on: () => { handleRecordLayer(); setAddLayerOpen(false); } },
                  { label: "Import Audio File", hint: "wav · mp3 · m4a", icon: "↥", on: () => { layerFileRef.current?.click(); setAddLayerOpen(false); } },
                  { label: selectedId ? "Duplicate Selected Track" : "Duplicate (select a track)", hint: "stack / double", icon: "⧉", disabled: !selectedId, on: () => { if (selectedId) handleDuplicateLayer(selectedId); setAddLayerOpen(false); } },
                ].map(it => (
                  <button key={it.label} disabled={it.disabled} onClick={it.on} style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%",
                    padding: "9px 12px", borderRadius: 5, border: "none",
                    cursor: it.disabled ? "default" : "pointer", textAlign: "left",
                    background: "transparent", color: it.disabled ? C.text4 : C.text, fontSize: 12, fontFamily: ui,
                    opacity: it.disabled ? 0.5 : 1,
                  }}
                    onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = withAlpha(C.accent, 0.15); }}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ width: 16, textAlign: "center", color: C.accent, fontSize: 13 }}>{it.icon}</span>
                    <span style={{ flex: 1 }}>{it.label}</span>
                    <span style={{ fontSize: 10, color: C.text4 }}>{it.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <input ref={layerFileRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImportLayer(f); e.target.value = ""; }} />
        </div>

        <button onClick={() => setSelectMode(m => !m)} title="Toggle region-select mode (or hold Alt and drag)"
          style={{
            display: "flex", alignItems: "center", gap: 6, padding: "0 14px", border: "none",
            borderRight: `1px solid ${C.line}`, cursor: "pointer", fontSize: 11, fontWeight: 800,
            letterSpacing: 0.5, fontFamily: "var(--ui, sans-serif)",
            background: selectMode ? `linear-gradient(180deg, ${C.accent}, ${C.accentDim})` : "transparent",
            color: selectMode ? "#0c1714" : C.text2, whiteSpace: "nowrap",
          }}>
          ⌖ SELECT {selectMode ? "ON" : "OFF"}
        </button>
        {/* automation lane toggles */}
        {(["volume", "pan"] as const).map(lane => (
          <button key={lane} onClick={() => setAutomationLane(l => l === lane ? null : lane)}
            title={`Draw ${lane} automation — click on a track to add points`}
            style={{
              display: "flex", alignItems: "center", gap: 4, padding: "0 11px", border: "none",
              borderRight: `1px solid ${C.line}`, cursor: "pointer", fontSize: 10, fontWeight: 800,
              letterSpacing: 0.5, whiteSpace: "nowrap",
              background: automationLane === lane ? `linear-gradient(180deg, ${lane === "volume" ? C.accent : "#c4a96e"}, ${C.accentDim})` : "transparent",
              color: automationLane === lane ? "#0c1714" : C.text3,
            }}>
            ∿ {lane.toUpperCase()}
          </button>
        ))}
        {selection ? (
          <SelectionToolbar
            selection={selection}
            track={selectionTrack}
            aiBusy={aiBusy}
            onApplyOp={applyRegionOp}
            onAiRegen={handleAiRegen}
            onClear={() => setSelection(null)}
          />
        ) : (
          <div style={{ display: "flex", alignItems: "center", padding: "0 14px", fontSize: 11, color: C.text4 }}>
            {selectMode ? "Drag across any clip to select a region to edit" : "Turn on SELECT (or hold Alt) then drag to grab a part of the song"}
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <TrackHeaders
          tracks={tracks} view={view} levels={levels} selectedId={selectedId}
          scrollTop={scrollTop}
          onMute={handleMute} onSolo={handleSolo}
          onVolume={handleVolume} onPan={handlePan} onArm={handleArm}
          onReorder={handleReorder} onSelect={setSelectedId}
          onColor={handleColor}
        />
        <ArrangementCanvas
          tracks={tracks}
          transport={transport}
          view={viewWithScroll}
          positionSec={positionSec}
          gesture={gesture}
          markers={markers}
          selection={selection}
          selectMode={selectMode}
          automationLane={automationLane}
          onAutomationEdit={handleAutomationEdit}
          onSeek={handleSeek}
          onScrub={handleScrub}
          onScrubEnd={handleScrubEnd}
          onScrollLeft={setScrollLeft}
          onScrollTop={setScrollTop}
          onZoom={handleZoom}
          onGestureStart={handleGestureStart}
          onGestureMove={handleGestureMove}
          onGestureEnd={handleGestureEnd}
          onClipSplit={handleClipSplit}
          onClipGain={handleClipGain}
          onLoopRange={handleLoopRange}
          onMarkerClick={handleMarkerClick}
          onSelectRegion={setSelection}
          onRegionContextMenu={(x, y) => { setTrackMenu(null); setRegionMenu({ x, y }); }}
          onTrackContextMenu={(x, y, trackId) => { setRegionMenu(null); setTrackMenu({ x, y, trackId }); }}
        />
        {trackMenu && tracks.find(t => t.id === trackMenu.trackId) && (
          <TrackContextMenu
            x={trackMenu.x}
            y={trackMenu.y}
            track={tracks.find(t => t.id === trackMenu.trackId)!}
            onDuplicate={handleDuplicateLayer}
            onMute={handleMute}
            onSolo={handleSolo}
            onRename={handleRenameTrack}
            onColor={handleColor}
            onDelete={handleDeleteTrack}
            onClose={() => setTrackMenu(null)}
          />
        )}
        {regionMenu && selection && (
          <RegionContextMenu
            x={regionMenu.x}
            y={regionMenu.y}
            trackLabel={selectionTrack?.label ?? ""}
            durSec={selection.endSec - selection.startSec}
            aiBusy={aiBusy}
            canBounce={!!selection}
            onApplyOp={applyRegionOp}
            onBounce={handleBounceSelection}
            onAiRegen={handleAiRegen}
            onClose={() => setRegionMenu(null)}
          />
        )}
      </div>

      <div style={{ flexShrink: 0, position: "relative", zIndex: 10 }}>
        <div style={{
          height: 30, background: `linear-gradient(180deg, ${C.bg2}, ${C.bg1})`,
          borderTop: `1px solid ${C.line}`,
          display: "flex", alignItems: "center", gap: 4, padding: "0 12px",
        }}>
          {(["mixer", "effects", "record", "piano-roll", "score", "piano"] as const).map(tab => {
            const active = bottomPanel === tab;
            const isRec = tab === "record";
            return (
              <button key={tab}
                onClick={() => setBottomPanel(p => p === tab ? null : tab)}
                style={{
                  padding: "4px 12px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 800,
                  background: active
                    ? `linear-gradient(180deg, ${isRec ? C.rec : C.accent}, ${isRec ? C.recDim : C.accentDim})`
                    : "transparent",
                  color: active ? (isRec ? "#fff" : "#0c1714") : (isRec && transport.recording ? C.rec : C.text3),
                  letterSpacing: 0.8, textTransform: "uppercase",
                  display: "flex", alignItems: "center", gap: 5,
                }}>
                {isRec && transport.recording && (
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.rec, boxShadow: `0 0 6px ${C.rec}` }} />
                )}
                {tab === "record" ? "Record" : tab === "piano" ? "E-Piano" : tab}
              </button>
            );
          })}
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: C.text4, fontFamily: "var(--mono, monospace)" }}>
            {tracks.length} stems · {selectedTrack ? `${selectedTrack.effects.length} fx` : ""} · {engine.isLoaded ? "ready" : "loading…"}
          </span>
        </div>
        {bottomPanel === "mixer" && (
          <MixerPanel
            tracks={tracks} levels={levels} selectedId={selectedId}
            masterVolume={masterVolume}
            playing={transport.playing}
            bpm={transport.bpm}
            trackKey={trackKey}
            getAnalyser={engine.getAnalyser}
            onVolume={handleVolume} onPan={handlePan}
            onMute={handleMute} onSolo={handleSolo} onSelect={setSelectedId}
            onMasterVolume={handleMasterVolume}
          />
        )}
        {bottomPanel === "effects" && (
          <div style={{ height: 210, borderTop: `1px solid ${C.line}`, display: "flex", overflow: "visible", position: "relative", zIndex: 30 }}>
            <EffectsRack
              track={selectedTrack}
              aiBusy={aiBusy}
              onAddEffect={handleAddEffect}
              onRemoveEffect={handleRemoveEffect}
              onToggleEffect={handleToggleEffect}
              onParamChange={handleEffectParam}
              onApplyPreset={handleApplyPreset}
              onAutotune={handleAutotune}
              onClearAutotune={handleClearAutotune}
              onStemOp={runStemOp}
            />
          </div>
        )}
        {bottomPanel === "record" && (
          <VocalRecorder
            engine={engine}
            recording={transport.recording}
            bpm={transport.bpm}
            onStart={async (opts) => beginRecording(opts)}
            onStop={() => { void finishRecording(); }}
          />
        )}
        {bottomPanel === "piano-roll" && (
          <div style={{ height: 260, borderTop: `1px solid ${C.line}`, display: "flex" }}>
            <PianoRoll
              track={selectedTrack}
              trackId={trackId ? parseInt(trackId) : null}
              positionSec={positionSec}
              playing={transport.playing}
            />
          </div>
        )}
        {bottomPanel === "piano" && <EPiano />}
        {bottomPanel === "score" && (
          <div style={{ height: 260, borderTop: `1px solid ${C.line}`, display: "flex" }}>
            <ScoreView
              track={selectedTrack}
              trackId={trackId ? parseInt(trackId) : null}
              bpm={transport.bpm}
            />
          </div>
        )}
      </div>
      <ActionLogPanel />
    </div>
  );
}

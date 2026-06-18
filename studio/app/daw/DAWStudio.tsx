"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, API } from "../lib/api";
import { useDawEngine } from "./useDawEngine";
import { useHistory } from "./useHistory";
import TransportBar from "./TransportBar";
import TrackHeaders from "./TrackHeaders";
import ArrangementCanvas from "./ArrangementCanvas";
import MixerPanel from "./MixerPanel";
import EffectsRack from "./EffectsRack";
import SelectionToolbar from "./SelectionToolbar";
import FileMenu from "./FileMenu";
import { makeEffect } from "./effects";
import { makeOp, OP_META, peaksFromBuffer } from "./regionOps";
import { renderMixdown, audioBufferToWav, downloadBlob, serializeProject, type ProjectFile } from "./exporter";
import { C, STEM_COLORS, MARKER_COLORS } from "./theme";
import type { DawTrack, DawClip, TransportState, ViewState, Gesture, Marker, SnapResolution, EffectType, TimeSelection, RegionOp, RegionOpType } from "./dawTypes";

const STEM_ORDER = ["vocals", "drums", "bass", "other"];

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
  const engine = useDawEngine();
  const history = useHistory();

  const [tracks, setTracks] = useState<DawTrack[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [transport, setTransport] = useState<TransportState>({
    playing: false, recording: false, positionSec: 0,
    bpm: 120, looping: false, loopStart: 0, loopEnd: 8,
    metronome: false, zoom: 120, snap: "off",
  });
  const [view] = useState<ViewState>({ scrollLeft: 0, trackHeight: 88, headerWidth: 160 });
  const [scrollLeft, setScrollLeft] = useState(0);
  const [positionSec, setPositionSec] = useState(0);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [splitStatus, setSplitStatus] = useState<"idle" | "splitting" | "done" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState("Loading track…");
  const [trackTitle, setTrackTitle] = useState("DAW");
  const [bottomPanel, setBottomPanel] = useState<"mixer" | "effects" | null>("mixer");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TimeSelection | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [automationLane, setAutomationLane] = useState<"volume" | "pan" | null>(null);

  const positionRef = useRef(0);
  const rafRef = useRef<number>(0);
  const playingRef = useRef(false);
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
        const pos = engine.getPosition();
        positionRef.current = pos;
        setPositionSec(pos);
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

  // ── keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.tagName === "SELECT") return;
      if (e.code === "Space") { e.preventDefault(); handlePlayPause(); }
      else if (e.code === "KeyR" && !e.metaKey) { e.preventDefault(); handleRecord(); }
      else if (e.code === "KeyM" && !e.metaKey) { e.preventDefault(); handleAddMarker(); }
      else if (e.code === "Escape") handleStop();
      else if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ" && !e.shiftKey) { e.preventDefault(); handleUndo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) { e.preventDefault(); handleRedo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // no deps — always current handlers

  // ── load track + stems ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!trackId) return;
    const id = parseInt(trackId);

    api.track(id).then(async t => {
      setTrackTitle(t.title || t.prompt || "Untitled");
      setTransport(tr => ({ ...tr, bpm: t.bpm || 120 }));

      const stemInfo = await api.stems(id).catch(() => null);

      if (stemInfo?.separated && stemInfo.stems) {
        await loadStemTracks(id, t.duration ?? 30);
      } else {
        const masterUrl = `${API}/api/audio/${id}`;
        const masterTrack = makeDawTrack("master", "Master", masterUrl, t.duration ?? 30);
        const loaded = await engine.loadTracks([masterTrack]);
        setTracks(loaded);
        history.push(loaded, [], "Load");
        setSplitStatus("splitting");
        setStatusMsg("Separating into stems — this takes ~30s on CPU…");
        try {
          await api.splitStems(id);
          await loadStemTracks(id, t.duration ?? 30);
          setSplitStatus("done");
          setStatusMsg("");
        } catch (e: any) {
          setSplitStatus("error");
          setStatusMsg(`Stem separation failed: ${e.message}`);
        }
      }
    }).catch(e => {
      setStatusMsg(`Failed to load track: ${e.message}`);
    });
  }, [trackId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadStemTracks(trackId: number, duration: number) {
    setStatusMsg("Loading stems into DAW…");
    const dawTracks = STEM_ORDER.map(stem =>
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

  const handleRecord = useCallback(async () => {
    if (playingRef.current) return; // don't start a record while playing back
    if (transport.recording) {
      // stop + capture
      const result = await engine.stopRecording();
      setTransport(t => ({ ...t, recording: false }));
      if (result) {
        const recId = `rec_${uid()}`;
        const recTrack = makeDawTrack(recId, `Recording ${tracksRef.current.filter(t => t.id.startsWith("rec")).length + 1}`, result.url, result.duration);
        recTrack.color = "#c47b6e";
        const merged = [...tracksRef.current, recTrack];
        const loaded = await engine.loadTracks(merged);
        setTracks(loaded);
        engine.scheduleFades(loaded);
        history.push(loaded, markersRef.current, "Record");
      }
    } else {
      const ok = await engine.startRecording();
      if (ok) setTransport(t => ({ ...t, recording: true }));
      else setStatusMsg("Microphone unavailable — allow mic access to record.");
    }
  }, [engine, transport.recording, history]);

  const handleSeek = useCallback((sec: number) => {
    engine.seekTo(sec);
    setPositionSec(sec);
  }, [engine]);

  const handleBpm = useCallback((bpm: number) => {
    engine.setBpm(bpm);
    setTransport(t => ({ ...t, bpm }));
  }, [engine]);

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
    setTracks(ts => ts.map(t => {
      if (t.id !== id) return t;
      const muted = !t.muted;
      engine.setTrackMute(id, muted);
      return { ...t, muted };
    }));
  }, [engine]);

  const handleSolo = useCallback((id: string) => {
    setTracks(ts => ts.map(t => {
      if (t.id !== id) return t;
      const soloed = !t.soloed;
      engine.setTrackSolo(id, soloed);
      return { ...t, soloed };
    }));
  }, [engine]);

  const handleVolume = useCallback((id: string, vol: number) => {
    engine.setTrackVolume(id, vol);
    setTracks(ts => ts.map(t => t.id === id ? { ...t, volume: vol } : t));
  }, [engine]);

  const handlePan = useCallback((id: string, pan: number) => {
    engine.setTrackPan(id, pan);
    setTracks(ts => ts.map(t => t.id === id ? { ...t, pan } : t));
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
    setTracks(ts => {
      const next = ts.map(t => t.id === trackId
        ? { ...t, effects: t.effects.map(e => e.id === effectId ? { ...e, enabled: !e.enabled } : e) }
        : t);
      const tk = next.find(t => t.id === trackId);
      if (tk) engine.rebuildEffects(tk);
      return next;
    });
  }, [engine]);

  const handleEffectParam = useCallback((trackId: string, effectId: string, key: string, value: number) => {
    setTracks(ts => ts.map(t => {
      if (t.id !== trackId) return t;
      const effects = t.effects.map(e => e.id === effectId ? { ...e, params: { ...e.params, [key]: value } } : e);
      const eff = effects.find(e => e.id === effectId);
      if (eff) engine.applyEffectParams(trackId, eff);
      return { ...t, effects };
    }));
  }, [engine]);

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
    setTracks(ts => ts.map(t => {
      if (t.id !== track.id) return t;
      const clips = t.clips.map(c => {
        if (c.id !== clip.id) return c;
        // length-changing ops resize the clip to match the new buffer duration
        const durationSec = OP_META[type].lengthChanging && res ? res.duration - c.offsetSec : c.durationSec;
        return { ...c, ops: nextOps, durationSec };
      });
      return { ...t, clips, peakData: res?.peaks ?? t.peakData, duration: res?.duration ?? t.duration };
    }));
    // structural edits move things around — clear the selection so it's not stale
    if (OP_META[type].lengthChanging) setSelection(null);
    engine.scheduleFades(tracksRef.current);
  }, [selection, commitHistory, engine]);

  // AI regenerate the selected region via the Python backend, then reload that
  // track's audio (the backend saves a new version of the whole track's source).
  const handleAiRegen = useCallback(async (prompt: string) => {
    if (!selection || !trackId) return;
    const numId = parseInt(trackId);
    setAiBusy(true);
    setStatusMsg("AI regenerating region — this runs MusicGen on the backend…");
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
    commitHistory("Automation");
    setTracks(ts => ts.map(t => {
      if (t.id !== tid) return t;
      const lane = automationLane;
      const existing = t.automation?.[lane] ?? [];
      const tol = 0.15;
      const filtered = existing.filter(p => Math.abs(p.sec - sec) > tol);
      const next = [...filtered, { sec, value }].sort((a, b) => a.sec - b.sec);
      return { ...t, automation: { ...t.automation, [lane]: next } };
    }));
  }, [automationLane, commitHistory]);

  // ── export / project save-load / bounce ───────────────────────────────────────
  const safeName = (trackTitle || "stemai").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_") || "stemai";

  const handleExportMix = useCallback(async () => {
    setStatusMsg("Rendering mixdown…");
    try {
      const mix = await renderMixdown(tracksRef.current);
      downloadBlob(audioBufferToWav(mix), `${safeName}_mix.wav`);
      setStatusMsg("");
    } catch (e: any) { setStatusMsg(`Export failed: ${e.message}`); }
  }, [safeName]);

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

  const handleSaveProject = useCallback(() => {
    const proj = serializeProject({
      trackId, title: trackTitle, transport, markers: markersRef.current, tracks: tracksRef.current,
    });
    downloadBlob(new Blob([JSON.stringify(proj, null, 2)], { type: "application/json" }), `${safeName}.stemai.json`);
  }, [trackId, trackTitle, transport, safeName]);

  const handleLoadProject = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".json,application/json";
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      setStatusMsg("Loading project…");
      try {
        const proj: ProjectFile = JSON.parse(await file.text());
        if (proj.version !== 1) throw new Error("unsupported project version");
        setTrackTitle(proj.title || "Project");
        setTransport(tr => ({ ...tr, bpm: proj.transport.bpm, looping: proj.transport.looping,
          loopStart: proj.transport.loopStart, loopEnd: proj.transport.loopEnd, snap: proj.transport.snap }));
        setMarkers(proj.markers || []);
        // rebuild DawTracks from the project, then load audio + replay ops
        const rebuilt: DawTrack[] = proj.tracks.map(pt => ({
          id: pt.id, label: pt.label, color: pt.color, volume: pt.volume, pan: pt.pan,
          muted: pt.muted, soloed: pt.soloed, armed: false, audioUrl: pt.audioUrl,
          peakData: null, duration: pt.clips[0]?.durationSec ?? 30,
          clips: pt.clips.map(c => ({ ...c, trackId: pt.id })),
          effects: pt.effects.map(e => ({ id: e.id, type: e.type as EffectType, enabled: e.enabled, params: e.params })),
          automation: pt.automation ?? {},
        }));
        const loaded = await engine.loadTracks(rebuilt);
        // replay ops + effects so audio matches the saved edits
        for (const t of loaded) {
          engine.rebuildEffects(t);
          const res = await engine.applyClipOps(t.id, t.clips[0]?.ops ?? []);
          if (res) t.peakData = res.peaks;
        }
        setTracks(loaded);
        engine.scheduleFades(loaded);
        setSelectedId(loaded[0]?.id ?? null);
        history.push(loaded, proj.markers || [], "Load project");
        setStatusMsg("");
      } catch (e: any) { setStatusMsg(`Load failed: ${e.message}`); }
    };
    input.click();
  }, [engine, history]);

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

  const handleGestureMove = useCallback((clientX: number) => {
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
      engine.scheduleFades(tracksRef.current);
    }
    setGesture(null);
  }, [engine]);

  const handleClipGain = useCallback((trackId: string, clipId: string, delta: number) => {
    setTracks(ts => ts.map(track => {
      if (track.id !== trackId) return track;
      return {
        ...track,
        clips: track.clips.map(clip => {
          if (clip.id !== clipId) return clip;
          const gain = Math.max(0, Math.min(2, (clip.gain ?? 1) + delta));
          return { ...clip, gain };
        }),
      };
    }));
    engine.scheduleFades(tracksRef.current);
  }, [engine]);

  const handleClipSplit = useCallback((trackId: string, clipId: string) => {
    const pos = positionRef.current;
    commitHistory("Split clip");
    setTracks(ts => ts.map(track => {
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
    }));
  }, [commitHistory]);

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
      engine.setTrackMute(t.id, t.muted);
      engine.setTrackSolo(t.id, t.soloed);
      engine.rebuildEffects(t);
      const res = await engine.applyClipOps(t.id, t.clips[0]?.ops ?? []);
      if (res) setTracks(cur => cur.map(ct => ct.id === t.id ? { ...ct, peakData: res.peaks } : ct));
    }
    engine.scheduleFades(snap.tracks);
  }, [engine]);

  const handleUndo = useCallback(() => restoreSnapshot(history.undo()), [history, restoreSnapshot]);
  const handleRedo = useCallback(() => restoreSnapshot(history.redo()), [history, restoreSnapshot]);

  const viewWithScroll = { ...view, scrollLeft };

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
        onBack={() => router.push("/")}
      />

      {(statusMsg || engine.loadError) && (
        <div style={{
          padding: "6px 16px", background: C.bg2, fontSize: 12,
          color: (splitStatus === "error" || engine.loadError) ? C.rec : C.accent,
          borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 8,
        }}>
          {splitStatus === "splitting" && <span className="spinner" />}
          {engine.loadError ? `Audio load issue — ${engine.loadError}` : statusMsg}
        </div>
      )}

      {/* Region edit bar: file menu + select-mode toggle + op toolbar */}
      <div style={{
        height: 38, flexShrink: 0, display: "flex", alignItems: "stretch",
        borderBottom: `1px solid ${C.line}`, background: C.bg1,
      }}>
        <FileMenu
          onSave={handleSaveProject} onLoad={handleLoadProject}
          onExportMix={handleExportMix} onExportStems={handleExportStems}
          onBounce={selection ? handleBounceSelection : null}
        />
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
          onMute={handleMute} onSolo={handleSolo}
          onVolume={handleVolume} onPan={handlePan} onArm={handleArm}
          onReorder={handleReorder} onSelect={setSelectedId}
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
          onScrollLeft={setScrollLeft}
          onZoom={handleZoom}
          onGestureStart={handleGestureStart}
          onGestureMove={handleGestureMove}
          onGestureEnd={handleGestureEnd}
          onClipSplit={handleClipSplit}
          onClipGain={handleClipGain}
          onLoopRange={handleLoopRange}
          onMarkerClick={handleMarkerClick}
          onSelectRegion={setSelection}
        />
      </div>

      <div style={{ flexShrink: 0 }}>
        <div style={{
          height: 30, background: `linear-gradient(180deg, ${C.bg2}, ${C.bg1})`,
          borderTop: `1px solid ${C.line}`,
          display: "flex", alignItems: "center", gap: 4, padding: "0 12px",
        }}>
          {(["mixer", "effects"] as const).map(tab => {
            const active = bottomPanel === tab;
            return (
              <button key={tab}
                onClick={() => setBottomPanel(p => p === tab ? null : tab)}
                style={{
                  padding: "4px 12px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 10, fontWeight: 800,
                  background: active ? `linear-gradient(180deg, ${C.accent}, ${C.accentDim})` : "transparent",
                  color: active ? "#0c1714" : C.text3, letterSpacing: 0.8, textTransform: "uppercase",
                }}>{tab}</button>
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
            onVolume={handleVolume} onPan={handlePan}
            onMute={handleMute} onSolo={handleSolo} onSelect={setSelectedId}
          />
        )}
        {bottomPanel === "effects" && (
          <div style={{ height: 210, borderTop: `1px solid ${C.line}` }}>
            <EffectsRack
              track={selectedTrack}
              aiBusy={aiBusy}
              onAddEffect={handleAddEffect}
              onRemoveEffect={handleRemoveEffect}
              onToggleEffect={handleToggleEffect}
              onParamChange={handleEffectParam}
              onStemOp={runStemOp}
            />
          </div>
        )}
      </div>
    </div>
  );
}

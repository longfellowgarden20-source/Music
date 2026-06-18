"use client";
import { useEffect, useRef, useState } from "react";
import type { TransportState, SnapResolution } from "./dawTypes";
import { SNAP_OPTIONS, SNAP_LABELS } from "./snap";
import { C, mono, ui, raised, inset } from "./theme";

interface Props {
  transport: TransportState;
  trackTitle: string;
  canUndo: boolean;
  canRedo: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onRecord: () => void;
  onBpmChange: (bpm: number) => void;
  onLoopToggle: () => void;
  onMetronomeToggle: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onSnapChange: (s: SnapResolution) => void;
  onAddMarker: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onBack: () => void;
}

function fmtTime(sec: number) {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const ss = String(s % 60).padStart(2, "0");
  const ms = String(Math.floor((sec % 1) * 100)).padStart(2, "0");
  return { m: String(m).padStart(2, "0"), ss, ms };
}

function fmtBars(sec: number, bpm: number) {
  const secPerBeat = 60 / bpm;
  const totalBeats = sec / secPerBeat;
  const bar = Math.floor(totalBeats / 4) + 1;
  const beat = Math.floor(totalBeats % 4) + 1;
  const tick = Math.floor((totalBeats % 1) * 4) + 1;
  return { bar, beat, tick };
}

export default function TransportBar({
  transport, trackTitle, canUndo, canRedo, onPlay, onPause, onStop, onRecord,
  onBpmChange, onLoopToggle, onMetronomeToggle, onZoomIn, onZoomOut,
  onSnapChange, onAddMarker, onUndo, onRedo, onBack,
}: Props) {
  const { playing, recording, positionSec, bpm, looping, metronome, snap } = transport;
  const [editBpm, setEditBpm] = useState(false);
  const [bpmInput, setBpmInput] = useState(String(Math.round(bpm)));
  const bpmRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editBpm) bpmRef.current?.select(); }, [editBpm]);
  useEffect(() => { setBpmInput(String(Math.round(bpm))); }, [bpm]);

  const t = fmtTime(positionSec);
  const b = fmtBars(positionSec, bpm);

  return (
    <div style={{
      height: 54, background: `linear-gradient(180deg, ${C.bg2}, ${C.bg1})`,
      borderBottom: `1px solid ${C.line}`,
      boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
      display: "flex", alignItems: "center", gap: 10, padding: "0 12px",
      flexShrink: 0, userSelect: "none", fontFamily: ui,
    }}>
      {/* back */}
      <button onClick={onBack} title="Back to library" style={{
        ...ctrlBtn, width: 32, fontSize: 16, color: C.text2,
      }}>‹</button>

      <Divider />

      {/* transport cluster */}
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        <button onClick={onStop} title="Stop (Esc)" style={ctrlBtn}>
          <span style={{ fontSize: 11 }}>■</span>
        </button>
        <button onClick={playing ? onPause : onPlay} title={playing ? "Pause" : "Play (Space)"} style={{
          ...ctrlBtn, width: 40, height: 36,
          background: playing
            ? `linear-gradient(180deg, ${C.accent}, ${C.accentDim})`
            : `linear-gradient(180deg, ${C.bg4}, ${C.bg3})`,
          color: playing ? "#0c1714" : C.text,
          boxShadow: playing
            ? `0 0 0 1px ${C.accentDim}, 0 0 12px ${C.accent}66, inset 0 1px 0 rgba(255,255,255,0.2)`
            : raised.boxShadow,
          fontSize: 13,
        }}>{playing ? "❚❚" : "▶"}</button>
        <button onClick={onRecord} title="Record (R)" style={{
          ...ctrlBtn,
          background: recording
            ? `linear-gradient(180deg, ${C.rec}, ${C.recDim})`
            : `linear-gradient(180deg, ${C.bg4}, ${C.bg3})`,
          color: recording ? "#fff" : C.rec,
          boxShadow: recording ? `0 0 10px ${C.rec}99, inset 0 1px 0 rgba(255,255,255,0.2)` : raised.boxShadow,
          animation: recording ? "recPulse 1.2s ease-in-out infinite" : "none",
        }}>●</button>
      </div>

      <Divider />

      {/* LCD time + bars display */}
      <div style={{
        ...inset, borderRadius: 6, padding: "5px 12px",
        display: "flex", flexDirection: "column", gap: 1, minWidth: 116,
        background: "#0e1512",
      }}>
        <div style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, color: C.accent, letterSpacing: 1, lineHeight: 1, textShadow: `0 0 8px ${C.accent}55` }}>
          {t.m}:{t.ss}<span style={{ color: C.accentDim, fontSize: 12 }}>.{t.ms}</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: C.text3, letterSpacing: 1, lineHeight: 1, marginTop: 2 }}>
          {b.bar}.{b.beat}.{b.tick} <span style={{ color: C.text4 }}>BAR</span>
        </div>
      </div>

      {/* BPM */}
      <div style={{ ...inset, borderRadius: 6, padding: "5px 10px", display: "flex", flexDirection: "column", gap: 1, minWidth: 58, background: "#0e1512" }}>
        {editBpm ? (
          <input ref={bpmRef} value={bpmInput} onChange={e => setBpmInput(e.target.value)}
            onBlur={() => {
              const v = parseInt(bpmInput);
              if (v >= 40 && v <= 240) onBpmChange(v); else setBpmInput(String(Math.round(bpm)));
              setEditBpm(false);
            }}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{ width: 42, background: "transparent", border: "none", color: C.accent, fontFamily: mono, fontSize: 17, fontWeight: 600, padding: 0, outline: "none" }} />
        ) : (
          <div onClick={() => setEditBpm(true)} style={{ fontFamily: mono, fontSize: 17, fontWeight: 600, color: C.text, letterSpacing: 0.5, lineHeight: 1, cursor: "text", textShadow: "0 0 6px rgba(232,232,236,0.2)" }}>
            {Math.round(bpm)}
          </div>
        )}
        <div style={{ fontFamily: mono, fontSize: 9, color: C.text4, letterSpacing: 1.5, lineHeight: 1, marginTop: 3 }}>BPM</div>
      </div>

      <Divider />

      {/* loop / metro toggles */}
      <Toggle label="Loop" active={looping} onClick={onLoopToggle} activeColor={C.accent} />
      <Toggle label="Metro" active={metronome} onClick={onMetronomeToggle} activeColor={C.warn} />

      <Divider />

      {/* snap */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={labelTag}>SNAP</span>
        <select value={snap} onChange={e => onSnapChange(e.target.value as SnapResolution)}
          style={{
            ...inset, color: C.text, fontFamily: mono, fontSize: 11, fontWeight: 600,
            padding: "5px 6px", borderRadius: 5, cursor: "pointer", outline: "none",
          }}>
          {SNAP_OPTIONS.map(o => <option key={o} value={o} style={{ background: C.bg2 }}>{SNAP_LABELS[o]}</option>)}
        </select>
      </div>

      <Divider />

      {/* marker + undo/redo */}
      <button onClick={onAddMarker} style={ctrlBtn} title="Add marker (M)">⚑</button>
      <button onClick={onUndo} disabled={!canUndo} style={{ ...ctrlBtn, opacity: canUndo ? 1 : 0.35 }} title="Undo (⌘Z)">↶</button>
      <button onClick={onRedo} disabled={!canRedo} style={{ ...ctrlBtn, opacity: canRedo ? 1 : 0.35 }} title="Redo (⌘⇧Z)">↷</button>

      <Divider />

      <button onClick={onZoomOut} style={ctrlBtn} title="Zoom out">−</button>
      <button onClick={onZoomIn} style={ctrlBtn} title="Zoom in">+</button>

      {/* title */}
      <div style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 600,
        color: C.text3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "0 12px" }}>
        {trackTitle}
      </div>

      <div style={{ fontSize: 10, color: C.text4, whiteSpace: "nowrap", fontFamily: mono }}>
        SPACE ▸ play · ⇧drag ruler ▸ loop · ⇧wheel ▸ gain
      </div>

      <style>{`@keyframes recPulse { 0%,100%{box-shadow:0 0 6px ${C.rec}66, inset 0 1px 0 rgba(255,255,255,0.2)} 50%{box-shadow:0 0 16px ${C.rec}, inset 0 1px 0 rgba(255,255,255,0.2)} }`}</style>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 28, background: C.line, boxShadow: `1px 0 0 ${C.bg1}`, flexShrink: 0 }} />;
}

function Toggle({ label, active, onClick, activeColor }: { label: string; active: boolean; onClick: () => void; activeColor: string }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 11px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 700,
      letterSpacing: 0.3, fontFamily: ui, border: `1px solid ${active ? activeColor : C.line}`,
      background: active ? `linear-gradient(180deg, ${activeColor}cc, ${activeColor}88)` : `linear-gradient(180deg, ${C.bg3}, ${C.bg2})`,
      color: active ? "#0c1714" : C.text2,
      boxShadow: active ? `0 0 8px ${activeColor}55, inset 0 1px 0 rgba(255,255,255,0.15)` : "inset 0 1px 0 rgba(255,255,255,0.04)",
      transition: "all .12s",
    }}>{label}</button>
  );
}

const ctrlBtn: React.CSSProperties = {
  background: `linear-gradient(180deg, ${C.bg4}, ${C.bg3})`,
  border: `1px solid ${C.line}`, color: C.text,
  width: 32, height: 32, borderRadius: 6, cursor: "pointer",
  fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06), 0 1px 2px rgba(0,0,0,0.3)",
  flexShrink: 0, transition: "all .1s",
};

const labelTag: React.CSSProperties = {
  fontSize: 9, color: C.text3, fontWeight: 800, letterSpacing: 1.5, fontFamily: ui,
};

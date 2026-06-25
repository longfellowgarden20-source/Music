"use client";
import { useRef, useCallback } from "react";
import type { DawTrack } from "./dawTypes";
import { C, ui, mono, withAlpha } from "./theme";
import SpectrumAnalyzer from "./SpectrumAnalyzer";
import TrackInfoPanel from "./TrackInfoPanel";
import LufsMeter from "./LufsMeter";

interface Props {
  tracks: DawTrack[];
  levels: Record<string, number>;
  selectedId: string | null;
  masterVolume: number;
  playing: boolean;
  bpm: number;
  trackKey: string | null;
  getAnalyser: () => AnalyserNode | null;
  onVolume: (id: string, v: number) => void;
  onPan: (id: string, v: number) => void;
  onMute: (id: string) => void;
  onSolo: (id: string) => void;
  onSelect: (id: string) => void;
  onMasterVolume: (v: number) => void;
}

export default function MixerPanel({ tracks, levels, selectedId, masterVolume, playing, bpm, trackKey, getAnalyser, onVolume, onPan, onMute, onSolo, onSelect, onMasterVolume }: Props) {
  const masterLevel = Math.min(1, Object.values(levels).reduce((s, v) => s + v, 0));
  const selectedTrack = tracks.find(t => t.id === selectedId) ?? null;
  const totalDuration = Math.max(...tracks.map(t => t.duration ?? 0), 30);

  return (
    <div style={{
      height: 210, background: `linear-gradient(180deg, ${C.bg1}, ${C.bg0})`,
      borderTop: `1px solid ${C.line}`, display: "flex", alignItems: "stretch",
      flexShrink: 0, fontFamily: ui, overflow: "hidden",
    }}>
      {/* ── Mixer channels (scrollable) ── */}
      <div style={{ display: "flex", alignItems: "stretch", overflowX: "auto", flexShrink: 0 }}>
        {tracks.map(track => (
          <Channel key={track.id} track={track} level={levels[track.id] ?? 0} selected={track.id === selectedId}
            onVolume={v => onVolume(track.id, v)} onPan={v => onPan(track.id, v)}
            onMute={() => onMute(track.id)} onSolo={() => onSolo(track.id)} onSelect={() => onSelect(track.id)} />
        ))}
        {/* Master */}
        <div style={{ width: 1, background: C.line, margin: "10px 0", flexShrink: 0 }} />
        <Channel master track={{ id: "__master", label: "Master", color: C.accent, volume: masterVolume, pan: 0, muted: false, soloed: false } as any}
          level={masterLevel} selected={false}
          onVolume={onMasterVolume} onPan={() => {}} onMute={() => {}} onSolo={() => {}} onSelect={() => {}} />
        <LufsMeter playing={playing} getAnalyser={getAnalyser} />
        <div style={{ width: 1, background: C.line, margin: "10px 0", flexShrink: 0 }} />
      </div>

      {/* ── Spectrum analyzer (fills remaining space) ── */}
      <SpectrumAnalyzer playing={playing} getAnalyser={getAnalyser} />

      {/* ── Track info panel (fixed right column) ── */}
      <TrackInfoPanel
        track={selectedTrack}
        bpm={bpm}
        trackKey={trackKey}
        duration={totalDuration}
      />
    </div>
  );
}

function Channel({ track, level, selected, master, onVolume, onPan, onMute, onSolo, onSelect }: {
  track: DawTrack; level: number; selected: boolean; master?: boolean;
  onVolume: (v: number) => void; onPan: (v: number) => void;
  onMute: () => void; onSolo: () => void; onSelect: () => void;
}) {
  const dbLabel = track.volume <= 0 ? "-∞" : `${(20 * Math.log10(track.volume)).toFixed(1)}`;
  return (
    <div onMouseDown={onSelect} style={{
      width: 78, display: "flex", flexDirection: "column", alignItems: "center",
      padding: "8px 6px", gap: 6, borderRight: `1px solid ${C.lineSoft}`,
      background: selected ? withAlpha(track.color, 0.07) : (track.soloed ? withAlpha(C.solo, 0.08) : "transparent"),
      opacity: track.muted ? 0.5 : 1, transition: "opacity .15s, background .15s", cursor: "pointer", flexShrink: 0,
    }}>
      {/* color cap */}
      <div style={{ width: "100%", height: 3, borderRadius: 2, background: track.color, boxShadow: selected ? `0 0 6px ${track.color}` : "none" }} />
      <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: master ? C.accent : C.text,
        textTransform: "uppercase", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%", textAlign: "center" }}>
        {track.label}
      </span>

      {/* pan */}
      {!master && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 1, width: "100%" }}>
          <input type="range" min={-1} max={1} step={0.01} value={track.pan}
            onMouseDown={e => e.stopPropagation()}
            onChange={e => onPan(parseFloat(e.target.value))}
            style={{ width: "90%", accentColor: track.color, height: 3, cursor: "pointer" }} />
          <span style={{ fontSize: 8, color: C.text3, fontFamily: mono }}>
            {track.pan === 0 ? "C" : track.pan > 0 ? `R${Math.round(track.pan * 100)}` : `L${Math.round(-track.pan * 100)}`}
          </span>
        </div>
      )}

      {/* fader + meter */}
      <div style={{ flex: 1, display: "flex", alignItems: "stretch", justifyContent: "center", width: "100%", gap: 5 }}>
        <Fader value={track.volume} color={track.color} onChange={onVolume} />
        <StereoMeter level={track.muted ? 0 : level} />
      </div>

      <span style={{ fontSize: 9, color: master ? C.accent : C.text2, fontFamily: mono }}>{dbLabel} dB</span>

      {/* M S */}
      {!master ? (
        <div style={{ display: "flex", gap: 4 }}>
          <MS label="M" active={track.muted} color={C.rec} onClick={e => { e.stopPropagation(); onMute(); }} />
          <MS label="S" active={track.soloed} color={C.solo} onClick={e => { e.stopPropagation(); onSolo(); }} />
        </div>
      ) : <div style={{ height: 18 }} />}
    </div>
  );
}

// Custom vertical fader: an inset track with a draggable cap. Drag to set.
function Fader({ value, color, onChange }: { value: number; color: string; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);

  const setFromY = useCallback((clientY: number) => {
    const el = ref.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const frac = 1 - (clientY - rect.top) / rect.height;
    onChange(Math.max(0, Math.min(1, frac)));
  }, [onChange]);

  const onDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    // Capture on the CONTAINER (which owns onPointerMove), not e.target — clicking
    // the cap/fill child captured the pointer there, so move events never reached
    // the handler and the fader did nothing. Capturing on ref.current fixes that.
    try { ref.current?.setPointerCapture(e.pointerId); } catch {}
    dragRef.current = true;
    setFromY(e.clientY);
  }, [setFromY]);

  const onMove = useCallback((e: React.PointerEvent) => { if (dragRef.current) setFromY(e.clientY); }, [setFromY]);
  const onUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = false;
    try { ref.current?.releasePointerCapture(e.pointerId); } catch {}
  }, []);

  return (
    <div ref={ref} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      style={{
        width: 20, position: "relative", cursor: "ns-resize",
        background: C.bg0, borderRadius: 4, boxShadow: "inset 0 1px 3px rgba(0,0,0,0.6)",
        border: `1px solid ${C.lineSoft}`, touchAction: "none",
      }}>
      {/* unity line at ~0.85 */}
      <div style={{ position: "absolute", left: 0, right: 0, bottom: "85%", height: 1, background: withAlpha(C.text3, 0.4) }} />
      {/* fill */}
      <div style={{ position: "absolute", left: 1, right: 1, bottom: 1, height: `calc(${value * 100}% - 2px)`,
        background: `linear-gradient(180deg, ${withAlpha(color, 0.5)}, ${withAlpha(color, 0.15)})`, borderRadius: 3 }} />
      {/* cap */}
      <div style={{
        position: "absolute", left: -3, right: -3, bottom: `calc(${value * 100}% - 6px)`, height: 12,
        background: `linear-gradient(180deg, ${C.bg4}, ${C.bg2})`, borderRadius: 3,
        border: `1px solid ${C.lineBright}`, boxShadow: "0 1px 3px rgba(0,0,0,0.5)",
      }}>
        <div style={{ position: "absolute", top: "50%", left: 2, right: 2, height: 1, background: color, opacity: 0.8 }} />
      </div>
    </div>
  );
}

function StereoMeter({ level }: { level: number }) {
  const pct = Math.max(0, Math.min(1, level)) * 100;
  const bar = (
    <div style={{ width: 4, position: "relative", background: C.bg0, borderRadius: 2, overflow: "hidden", border: `1px solid ${C.lineSoft}` }}>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: `${pct}%`,
        background: `linear-gradient(180deg, ${C.meterHigh}, ${C.meterMid} 30%, ${C.meterLow} 60%)`,
        transition: "height .05s linear" }} />
    </div>
  );
  return <div style={{ display: "flex", gap: 1.5 }}>{bar}{bar}</div>;
}

function MS({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button onClick={onClick} style={{
      width: 24, height: 18, borderRadius: 3, cursor: "pointer", padding: 0,
      fontSize: 9, fontWeight: 800, fontFamily: ui,
      border: `1px solid ${active ? color : C.line}`,
      background: active ? `linear-gradient(180deg, ${color}, ${color}aa)` : `linear-gradient(180deg, ${C.bg3}, ${C.bg2})`,
      color: active ? "#1a1a1d" : C.text3,
      boxShadow: active ? `0 0 6px ${color}66` : "none",
    }}>{label}</button>
  );
}

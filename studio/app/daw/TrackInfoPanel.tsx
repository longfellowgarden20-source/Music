"use client";
import type { DawTrack } from "./dawTypes";
import { C, ui, mono, withAlpha } from "./theme";

interface Props {
  track: DawTrack | null;
  bpm: number;
  trackKey: string | null;
  duration: number;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Simple chord name lookup from root + intervals (very light, no lib needed)
const CHORD_TYPES: [number[], string][] = [
  [[0, 4, 7], "maj"],
  [[0, 3, 7], "min"],
  [[0, 4, 7, 11], "maj7"],
  [[0, 3, 7, 10], "min7"],
  [[0, 4, 7, 10], "7"],
  [[0, 3, 6], "dim"],
  [[0, 4, 8], "aug"],
  [[0, 5, 7], "sus4"],
  [[0, 2, 7], "sus2"],
];

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function Stat({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.8, color: C.text4, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: big ? 20 : 13, fontWeight: 800, fontFamily: mono, color: color ?? C.text, lineHeight: 1 }}>{value}</span>
    </div>
  );
}

export default function TrackInfoPanel({ track, bpm, trackKey, duration }: Props) {
  const color = track?.color ?? C.accent;

  // Build effect count summary
  const fxCount = track?.effects?.filter(e => e.enabled).length ?? 0;
  const fxList = track?.effects?.filter(e => e.enabled).map(e => e.type.toUpperCase()).join(" · ") || "—";

  // Clip stats
  const clip = track?.clips?.[0];
  const clipDur = clip ? clip.durationSec : duration;
  const fadeIn = clip?.fadeInSec ?? 0;
  const fadeOut = clip?.fadeOutSec ?? 0;
  const gainDb = clip?.gain ? (20 * Math.log10(clip.gain)).toFixed(1) : "0.0";

  // Auto-determine scale from key
  const keyDisplay = trackKey ?? "—";
  const relativeMinor = trackKey ? (() => {
    const idx = NOTE_NAMES.indexOf(trackKey);
    if (idx < 0) return null;
    return NOTE_NAMES[(idx + 9) % 12];
  })() : null;

  return (
    <div style={{
      width: 220, flexShrink: 0, display: "flex", flexDirection: "column",
      borderLeft: `1px solid ${C.line}`, background: `linear-gradient(180deg, ${C.bg1}, ${C.bg0})`,
    }}>
      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "4px 10px",
        borderBottom: `1px solid ${C.line}`,
      }}>
        {track && <div style={{ width: 8, height: 8, borderRadius: 2, background: color, boxShadow: `0 0 6px ${color}` }} />}
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.text3 }}>
          {track ? track.label.toUpperCase() : "TRACK INFO"}
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "10px 12px", gap: 12, overflowY: "auto" }}>

        {/* top stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <Stat label="BPM" value={bpm ? `${bpm}` : "—"} color={C.accent} big />
          <Stat label="Key" value={keyDisplay} color={color} big />
          <Stat label="Length" value={formatTime(clipDur)} />
        </div>

        {/* divider */}
        <div style={{ height: 1, background: C.lineSoft }} />

        {/* relative minor / scale info */}
        {relativeMinor && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Tag label={`${keyDisplay} major`} color={color} />
            <Tag label={`${relativeMinor} minor`} color={withAlpha(color, 0.6)} />
          </div>
        )}

        {/* clip details */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <Stat label="Clip gain" value={`${Number(gainDb) > 0 ? "+" : ""}${gainDb} dB`} />
          <Stat label="Effects" value={`${fxCount}`} color={fxCount > 0 ? color : C.text3} />
          {fadeIn > 0 && <Stat label="Fade in" value={`${fadeIn.toFixed(2)}s`} />}
          {fadeOut > 0 && <Stat label="Fade out" value={`${fadeOut.toFixed(2)}s`} />}
        </div>

        {/* active effects list */}
        {fxCount > 0 && (
          <div style={{ background: withAlpha(color, 0.06), borderRadius: 6, padding: "6px 8px",
            border: `1px solid ${withAlpha(color, 0.15)}` }}>
            <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: 0.8, color: C.text4, marginBottom: 4 }}>ACTIVE FX</div>
            <div style={{ fontSize: 9, fontFamily: mono, color: color, lineHeight: 1.6 }}>{fxList}</div>
          </div>
        )}

        {/* muted / soloed state */}
        {(track?.muted || track?.soloed) && (
          <div style={{ display: "flex", gap: 6 }}>
            {track.muted && <Tag label="MUTED" color="#c47b6e" />}
            {track.soloed && <Tag label="SOLOED" color={C.solo} />}
          </div>
        )}

        {!track && (
          <div style={{ color: C.text4, fontSize: 10, textAlign: "center", marginTop: 16 }}>
            Select a track to see its details
          </div>
        )}
      </div>
    </div>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 8, fontWeight: 800, fontFamily: ui, letterSpacing: 0.5,
      padding: "2px 6px", borderRadius: 3,
      background: withAlpha(color, 0.15), color, border: `1px solid ${withAlpha(color, 0.3)}`,
    }}>{label}</span>
  );
}

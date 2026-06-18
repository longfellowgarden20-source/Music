"use client";
import type { DawTrack, ViewState } from "./dawTypes";
import { C, ui, mono, withAlpha } from "./theme";

const RULER_H = 30;

interface Props {
  tracks: DawTrack[];
  view: ViewState;
  levels: Record<string, number>;
  selectedId: string | null;
  onMute: (id: string) => void;
  onSolo: (id: string) => void;
  onVolume: (id: string, v: number) => void;
  onPan: (id: string, v: number) => void;
  onArm: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onSelect: (id: string) => void;
}

export default function TrackHeaders({
  tracks, view, levels, selectedId,
  onMute, onSolo, onVolume, onPan, onArm, onReorder, onSelect,
}: Props) {
  const { headerWidth, trackHeight } = view;

  return (
    <div style={{
      width: headerWidth, flexShrink: 0,
      background: C.bg1, borderRight: `1px solid ${C.line}`,
      display: "flex", flexDirection: "column", overflow: "hidden",
      boxShadow: "2px 0 6px rgba(0,0,0,0.25)", zIndex: 2, fontFamily: ui,
    }}>
      {/* ruler spacer */}
      <div style={{
        height: RULER_H, borderBottom: `1px solid ${C.line}`,
        display: "flex", alignItems: "center", padding: "0 12px",
        fontSize: 9, fontWeight: 800, letterSpacing: 1.5,
        color: C.text3, textTransform: "uppercase",
        background: `linear-gradient(180deg, ${C.bg2}, ${C.bg1})`,
      }}>
        Tracks
      </div>

      {tracks.map((track, i) => {
        const selected = track.id === selectedId;
        const lvl = levels[track.id] ?? 0;
        return (
          <div key={track.id}
            onMouseDown={() => onSelect(track.id)}
            style={{
              height: trackHeight, borderBottom: `1px solid ${C.lineSoft}`,
              display: "flex", position: "relative",
              background: selected ? withAlpha(track.color, 0.09) : (i % 2 === 0 ? C.rowA : C.rowB),
              cursor: "pointer",
            }}>
            {/* color strip on left edge */}
            <div style={{
              width: 4, flexShrink: 0,
              background: track.muted ? C.text4 : track.color,
              boxShadow: selected ? `0 0 8px ${track.color}` : "none",
            }} />

            <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "6px 8px 6px 9px", gap: 5, minWidth: 0 }}>
              {/* top row: name + reorder */}
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{
                  flex: 1, fontSize: 11, fontWeight: 700,
                  color: track.muted ? C.text3 : C.text,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{track.label}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <button onClick={e => { e.stopPropagation(); onReorder(i, i - 1); }} disabled={i === 0} title="Move up" style={reorderBtn(i === 0)}>▲</button>
                  <button onClick={e => { e.stopPropagation(); onReorder(i, i + 1); }} disabled={i === tracks.length - 1} title="Move down" style={reorderBtn(i === tracks.length - 1)}>▼</button>
                </div>
              </div>

              {/* M S R buttons */}
              <div style={{ display: "flex", gap: 4 }}>
                <Pill label="M" active={track.muted} color={C.rec} onClick={e => { e.stopPropagation(); onMute(track.id); }} />
                <Pill label="S" active={track.soloed} color={C.solo} onClick={e => { e.stopPropagation(); onSolo(track.id); }} />
                <Pill label="R" active={track.armed} color={C.rec} onClick={e => { e.stopPropagation(); onArm(track.id); }} />
                {/* inline meter */}
                <div style={{ flex: 1, alignSelf: "center", height: 5, borderRadius: 3, background: C.bg0, boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)", overflow: "hidden", marginLeft: 2 }}>
                  <div style={{
                    height: "100%", width: `${Math.min(100, (track.muted ? 0 : lvl) * 100)}%`,
                    background: lvl > 0.88 ? C.meterHigh : lvl > 0.7 ? C.meterMid : C.meterLow,
                    transition: "width .05s linear",
                  }} />
                </div>
              </div>

              {/* vol + pan */}
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={tag}>VOL</span>
                <input type="range" min={0} max={1} step={0.01} value={track.volume}
                  onMouseDown={e => e.stopPropagation()}
                  onChange={e => onVolume(track.id, parseFloat(e.target.value))}
                  style={slider(track.color)} />
                <span style={tag}>PAN</span>
                <input type="range" min={-1} max={1} step={0.01} value={track.pan}
                  onMouseDown={e => e.stopPropagation()}
                  onChange={e => onPan(track.id, parseFloat(e.target.value))}
                  style={{ ...slider(track.color), width: 36, flex: "none" }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function reorderBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 13, height: 9, padding: 0, border: "none", borderRadius: 2,
    background: "transparent", color: disabled ? C.text4 : C.text3,
    fontSize: 6, cursor: disabled ? "default" : "pointer", lineHeight: 1,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
}

function Pill({ label, active, color, onClick }: {
  label: string; active: boolean; color: string; onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button onClick={onClick} style={{
      width: 19, height: 17, borderRadius: 3, cursor: "pointer", padding: 0, flexShrink: 0,
      fontSize: 9, fontWeight: 800, fontFamily: ui,
      border: `1px solid ${active ? color : C.line}`,
      background: active ? `linear-gradient(180deg, ${color}, ${color}aa)` : `linear-gradient(180deg, ${C.bg3}, ${C.bg2})`,
      color: active ? "#1a1a1d" : C.text3,
      boxShadow: active ? `0 0 6px ${color}66` : "inset 0 1px 0 rgba(255,255,255,0.04)",
    }}>{label}</button>
  );
}

const tag: React.CSSProperties = { fontSize: 8, color: C.text3, fontWeight: 700, letterSpacing: 0.5, fontFamily: mono };
function slider(color: string): React.CSSProperties {
  return { flex: 1, accentColor: color, height: 3, cursor: "pointer", minWidth: 0 };
}

"use client";
import { useState, useRef, useEffect } from "react";
import type { TimeSelection, DawTrack, RegionOpType } from "./dawTypes";
import { OP_META } from "./regionOps";
import { C, ui, mono, withAlpha } from "./theme";

interface Props {
  selection: TimeSelection;
  track: DawTrack | null;
  aiBusy: boolean;
  onApplyOp: (type: RegionOpType, amount: number) => void;
  onAiRegen: (prompt: string) => void;
  onClear: () => void;
}

// Ops grouped into menus. Order within each group = display order.
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const GROUPS: { name: string; color: string; ops: RegionOpType[] }[] = [
  { name: "Edit", color: "#6fae8e", ops: ["gain", "fade-in", "fade-out", "silence", "reverse", "normalize", "invert", "duplicate", "delete", "crop", "insert-silence"] },
  { name: "Time", color: "#c4a96e", ops: ["pitch", "stretch", "half-time", "double-time", "stutter", "tape-stop", "pitch-scale"] },
  { name: "EQ",   color: "#5fa8c4", ops: ["lowpass", "highpass", "bandpass", "eq-low", "eq-mid", "eq-high", "deess", "mudcut", "telephone"] },
  { name: "Mix",  color: "#b88fb0", ops: ["compress", "limit", "gate", "tremolo", "autogain"] },
];

export default function SelectionToolbar({ selection, track, aiBusy, onApplyOp, onAiRegen, onClear }: Props) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [pending, setPending] = useState<{ type: RegionOpType; amount: number } | null>(null);
  const [showAi, setShowAi] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // close menus on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenMenu(null); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);

  const dur = selection.endSec - selection.startSec;

  function choose(type: RegionOpType) {
    setOpenMenu(null);
    const meta = OP_META[type];
    if (meta.amount) setPending({ type, amount: meta.amount.default });
    else onApplyOp(type, 1);
  }

  return (
    <div ref={rootRef} style={{
      display: "flex", alignItems: "center", gap: 8, padding: "0 12px", height: "100%",
      fontFamily: ui, overflowX: "auto", overflowY: "visible", position: "relative",
    }}>
      <span style={{ fontSize: 9, fontWeight: 800, color: C.accent, letterSpacing: 1, whiteSpace: "nowrap" }}>SELECTION</span>
      <span style={{ fontSize: 10, fontFamily: mono, color: C.text3, whiteSpace: "nowrap" }}>
        {track?.label} · {dur.toFixed(2)}s
      </span>
      <Divider />

      {/* category menus */}
      {GROUPS.map(group => (
        <div key={group.name} style={{ position: "relative" }}>
          <button onClick={() => setOpenMenu(m => m === group.name ? null : group.name)} style={{
            display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 6,
            cursor: "pointer", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
            border: `1px solid ${openMenu === group.name ? group.color : C.line}`,
            background: openMenu === group.name ? withAlpha(group.color, 0.2) : `linear-gradient(180deg, ${C.bg3}, ${C.bg2})`,
            color: openMenu === group.name ? group.color : C.text,
          }}>
            {group.name} <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
          </button>
          {openMenu === group.name && (
            <div style={{
              position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 50,
              background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 8,
              boxShadow: "0 10px 28px rgba(0,0,0,0.55)", padding: 4, minWidth: 168,
            }}>
              {group.ops.map(type => {
                const meta = OP_META[type];
                return (
                  <button key={type} onClick={() => choose(type)} style={{
                    display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
                    padding: "7px 10px", borderRadius: 5, border: "none", cursor: "pointer",
                    background: "transparent", color: C.text, fontSize: 12, fontFamily: ui,
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = withAlpha(group.color, 0.16))}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ width: 16, textAlign: "center", color: group.color, fontSize: 13 }}>{meta.icon}</span>
                    <span style={{ flex: 1 }}>{meta.name}</span>
                    {meta.amount && <span style={{ fontSize: 9, color: C.text4 }}>▸</span>}
                    {meta.lengthChanging && <span style={{ fontSize: 8, color: C.warn }}>±len</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <Divider />

      {/* pending op with amount slider */}
      {pending && OP_META[pending.type].amount && (
        <div style={{
          display: "flex", alignItems: "center", gap: 7, padding: "4px 10px",
          background: C.bg0, borderRadius: 6, border: `1px solid ${C.accent}`, whiteSpace: "nowrap",
        }}>
          <span style={{ fontSize: 10, color: C.text2 }}>{OP_META[pending.type].name}</span>
          {pending.type === "pitch-scale" ? (
            <select value={pending.amount} onChange={e => setPending({ type: pending.type, amount: parseFloat(e.target.value) })}
              style={{ background: C.bg2, border: `1px solid ${C.line}`, color: C.text, fontSize: 11, fontWeight: 700, padding: "4px 6px", borderRadius: 5, fontFamily: mono }}>
              {NOTE_NAMES.map((nm, i) => <option key={i} value={i}>{nm} major</option>)}
            </select>
          ) : (
            <>
              <input type="range"
                min={OP_META[pending.type].amount!.min} max={OP_META[pending.type].amount!.max} step={OP_META[pending.type].amount!.step}
                value={pending.amount} onChange={e => setPending({ type: pending.type, amount: parseFloat(e.target.value) })}
                style={{ width: 110, accentColor: C.accent }} />
              <span style={{ fontSize: 11, fontFamily: mono, color: C.accent, minWidth: 42, textAlign: "right" }}>
                {pending.type === "pitch" && pending.amount > 0 ? "+" : ""}{pending.amount}{OP_META[pending.type].amount!.unit ?? ""}
              </span>
            </>
          )}
          <button onClick={() => { onApplyOp(pending.type, pending.amount); setPending(null); }} style={applyBtn}>Apply</button>
          <button onClick={() => setPending(null)} style={{ ...applyBtn, background: "transparent", color: C.text3, border: `1px solid ${C.line}` }}>✕</button>
        </div>
      )}

      {/* AI regen */}
      {!showAi ? (
        <button onClick={() => setShowAi(true)} style={{
          display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", borderRadius: 6, cursor: "pointer",
          fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", border: `1px solid ${withAlpha("#b88fb0", 0.6)}`,
          background: `linear-gradient(180deg, ${withAlpha("#b88fb0", 0.9)}, ${withAlpha("#8e7fc4", 0.7)})`, color: "#fff",
        }}>✦ AI Regen</button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
          <input autoFocus value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
            placeholder="describe new sound for this region…"
            onKeyDown={e => { if (e.key === "Enter" && aiPrompt.trim()) onAiRegen(aiPrompt.trim()); }}
            style={{ width: 220, background: C.bg0, border: `1px solid ${C.line}`, color: C.text, fontSize: 11, padding: "6px 9px", borderRadius: 6, outline: "none" }} />
          <button disabled={aiBusy || !aiPrompt.trim()} onClick={() => onAiRegen(aiPrompt.trim())} style={{
            ...applyBtn, background: aiBusy ? C.bg3 : "#8e7fc4", opacity: aiBusy || !aiPrompt.trim() ? 0.5 : 1,
          }}>{aiBusy ? "Working…" : "Go"}</button>
        </div>
      )}

      <div style={{ flex: 1 }} />
      <button onClick={onClear} title="Clear selection" style={{ ...applyBtn, background: "transparent", color: C.text3, border: `1px solid ${C.line}` }}>✕</button>
    </div>
  );
}

function Divider() { return <div style={{ width: 1, height: 22, background: C.line, flexShrink: 0 }} />; }

const applyBtn: React.CSSProperties = {
  padding: "5px 10px", borderRadius: 5, border: "none", cursor: "pointer",
  fontSize: 11, fontWeight: 800, fontFamily: ui, background: C.accent, color: "#0c1714", whiteSpace: "nowrap",
};

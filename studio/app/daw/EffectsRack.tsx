"use client";
import { useState } from "react";
import type { DawTrack, TrackEffect, EffectType } from "./dawTypes";
import { EFFECT_DEFS, EFFECT_ORDER, makeEffect } from "./effects";
import Knob from "./Knob";
import { C, ui, mono, withAlpha } from "./theme";

interface Props {
  track: DawTrack | null;
  aiBusy: boolean;
  onAddEffect: (trackId: string, type: EffectType) => void;
  onRemoveEffect: (trackId: string, effectId: string) => void;
  onToggleEffect: (trackId: string, effectId: string) => void;
  onParamChange: (trackId: string, effectId: string, key: string, value: number) => void;
  onStemOp: (kind: "regenerate" | "extend" | "swap", prompt: string) => void;
}

export default function EffectsRack({ track, aiBusy, onAddEffect, onRemoveEffect, onToggleEffect, onParamChange, onStemOp }: Props) {
  const [adding, setAdding] = useState(false);
  const [aiKind, setAiKind] = useState<"regenerate" | "extend" | "swap" | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");

  if (!track) {
    return (
      <div style={{ ...wrap, alignItems: "center", justifyContent: "center", color: C.text4, fontSize: 11, letterSpacing: 0.5 }}>
        Select a track then add effects with the + button
      </div>
    );
  }

  const used = new Set(track.effects.map(e => e.type));
  const available = EFFECT_ORDER.filter(t => !used.has(t));

  return (
    <div style={wrap}>
      {/* selected track badge */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
        padding: "0 14px", borderRight: `1px solid ${C.line}`, flexShrink: 0, justifyContent: "center",
      }}>
        <div style={{ width: 4, height: 30, borderRadius: 2, background: track.color, boxShadow: `0 0 8px ${track.color}` }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: C.text, letterSpacing: 0.5, writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
          {track.label.toUpperCase()}
        </span>
      </div>

      {/* effect units */}
      {track.effects.map(eff => (
        <EffectUnit key={eff.id} eff={eff} color={track.color}
          onToggle={() => onToggleEffect(track.id, eff.id)}
          onRemove={() => onRemoveEffect(track.id, eff.id)}
          onParam={(k, v) => onParamChange(track.id, eff.id, k, v)} />
      ))}

      {/* add effect */}
      <div style={{ position: "relative", display: "flex", alignItems: "center", padding: "0 12px", flexShrink: 0 }}>
        {available.length > 0 && (
          <button onClick={() => setAdding(a => !a)} style={{
            width: 44, height: 44, borderRadius: 8, cursor: "pointer",
            border: `1px dashed ${C.lineBright}`, background: C.bg2, color: C.text3,
            fontSize: 22, fontWeight: 300, display: "flex", alignItems: "center", justifyContent: "center",
          }} title="Add effect">+</button>
        )}
        {adding && (
          <div style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 12, zIndex: 60,
            background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)", padding: 4, minWidth: 150,
          }}>
            {available.map(t => (
              <button key={t} onClick={() => { onAddEffect(track.id, t); setAdding(false); }}
                style={{
                  display: "flex", alignItems: "center", gap: 8, width: "100%",
                  padding: "7px 9px", borderRadius: 5, border: "none", cursor: "pointer",
                  background: "transparent", color: C.text, fontSize: 12, fontFamily: ui, textAlign: "left",
                }}
                onMouseEnter={e => (e.currentTarget.style.background = C.bg3)}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <span style={{ fontFamily: mono, fontSize: 9, fontWeight: 800, color: C.accent, width: 26 }}>{EFFECT_DEFS[t].short}</span>
                {EFFECT_DEFS[t].name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* AI stem ops — act on the whole selected stem via the backend */}
      <div style={{
        display: "flex", flexDirection: "column", justifyContent: "center", gap: 6,
        padding: "0 14px", borderLeft: `1px solid ${C.line}`, flexShrink: 0, minWidth: 230,
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: "#b88fb0", letterSpacing: 1 }}>✦ AI STEM</span>
        {!aiKind ? (
          <div style={{ display: "flex", gap: 5 }}>
            {(["regenerate", "extend", "swap"] as const).map(k => (
              <button key={k} disabled={aiBusy} onClick={() => { setAiKind(k); setAiPrompt(""); }} style={{
                padding: "5px 9px", borderRadius: 5, border: `1px solid ${withAlpha("#b88fb0", 0.5)}`,
                background: withAlpha("#b88fb0", 0.12), color: "#d8b8d0", fontSize: 10, fontWeight: 700,
                cursor: aiBusy ? "default" : "pointer", opacity: aiBusy ? 0.5 : 1, fontFamily: ui, textTransform: "capitalize",
              }}>{k}</button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <input autoFocus value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
              placeholder={aiKind === "extend" ? "(optional) how to continue…" : `${aiKind}: describe the sound…`}
              onKeyDown={e => { if (e.key === "Enter") { onStemOp(aiKind, aiPrompt.trim()); setAiKind(null); } }}
              style={{ width: 150, background: C.bg0, border: `1px solid ${C.line}`, color: C.text, fontSize: 11, padding: "5px 8px", borderRadius: 5, outline: "none" }} />
            <button disabled={aiBusy} onClick={() => { onStemOp(aiKind, aiPrompt.trim()); setAiKind(null); }} style={{
              padding: "5px 9px", borderRadius: 5, border: "none", background: "#8e7fc4", color: "#fff", fontSize: 10, fontWeight: 800, cursor: "pointer",
            }}>{aiBusy ? "…" : "Go"}</button>
            <button onClick={() => setAiKind(null)} style={{ background: "none", border: "none", color: C.text3, cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
        )}
      </div>
    </div>
  );
}

function EffectUnit({ eff, color, onToggle, onRemove, onParam }: {
  eff: TrackEffect; color: string;
  onToggle: () => void; onRemove: () => void; onParam: (k: string, v: number) => void;
}) {
  const def = EFFECT_DEFS[eff.type];
  return (
    <div style={{
      display: "flex", flexDirection: "column", flexShrink: 0,
      borderRight: `1px solid ${C.line}`,
      opacity: eff.enabled ? 1 : 0.45, transition: "opacity .15s",
      background: eff.enabled ? withAlpha(color, 0.03) : "transparent",
    }}>
      {/* unit header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 6, padding: "5px 10px",
        borderBottom: `1px solid ${C.lineSoft}`, background: C.bg2,
      }}>
        <button onClick={onToggle} title={eff.enabled ? "Bypass" : "Enable"} style={{
          width: 9, height: 9, borderRadius: "50%", border: "none", cursor: "pointer", padding: 0,
          background: eff.enabled ? C.accent : C.text4,
          boxShadow: eff.enabled ? `0 0 6px ${C.accent}` : "none",
        }} />
        <span style={{ fontSize: 10, fontWeight: 800, color: C.text, letterSpacing: 0.5, flex: 1, fontFamily: ui }}>
          {def.name}
        </span>
        <button onClick={onRemove} title="Remove" style={{
          background: "none", border: "none", color: C.text4, cursor: "pointer", fontSize: 13, padding: 0, lineHeight: 1,
        }}>×</button>
      </div>
      {/* knobs */}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px", alignItems: "flex-start" }}>
        {def.params.map(p => (
          <Knob key={p.key} label={p.label} unit={p.unit}
            value={eff.params[p.key] ?? p.default}
            min={p.min} max={p.max} step={p.step} color={color}
            onChange={v => onParam(p.key, v)} />
        ))}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "stretch",
  background: C.bg1, overflowX: "auto", overflowY: "visible", fontFamily: ui,
};

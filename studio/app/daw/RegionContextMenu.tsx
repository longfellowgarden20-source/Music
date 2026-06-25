"use client";
import { useEffect, useRef, useLayoutEffect, useState } from "react";
import type { RegionOpType } from "./dawTypes";
import { OP_META } from "./regionOps";
import { C, ui, mono, withAlpha } from "./theme";

// Right-click menu shown over a highlighted region. It lists the same region
// operations as the SelectionToolbar, grouped by category, plus Bounce / AI
// Regen. Ops that take an amount apply their default here (use the toolbar
// slider to fine-tune); structural ops apply immediately.

interface Props {
  x: number;            // viewport coords of the click
  y: number;
  trackLabel: string;
  durSec: number;
  aiBusy: boolean;
  canBounce: boolean;
  onApplyOp: (type: RegionOpType, amount: number) => void;
  onBounce: () => void;
  onAiRegen: (prompt: string) => void;
  onClose: () => void;
}

const GROUPS: { name: string; icon: string; color: string; ops: RegionOpType[] }[] = [
  { name: "Edit", icon: "✎", color: "#6fae8e", ops: ["gain", "fade-in", "fade-out", "silence", "reverse", "normalize", "invert", "duplicate", "delete", "crop", "insert-silence"] },
  { name: "Time", icon: "⏱", color: "#c4a96e", ops: ["pitch", "stretch", "half-time", "double-time", "stutter", "tape-stop", "pitch-scale"] },
  { name: "EQ",   icon: "≋", color: "#5fa8c4", ops: ["lowpass", "highpass", "bandpass", "eq-low", "eq-mid", "eq-high", "deess", "mudcut", "telephone"] },
  { name: "Mix",  icon: "🎚", color: "#b88fb0", ops: ["compress", "limit", "gate", "tremolo", "autogain"] },
];

export default function RegionContextMenu(props: Props) {
  const { x, y, trackLabel, durSec, aiBusy, canBounce, onApplyOp, onBounce, onAiRegen, onClose } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [openGroup, setOpenGroup] = useState<string | null>(null); // category whose flyout is shown
  // When an op needs an amount, we show a slider instead of applying the neutral
  // default (which for EQ is 0 dB = no audible change — the "EQ does nothing" bug).
  const [pending, setPending] = useState<{ type: RegionOpType; amount: number } | null>(null);

  // Close on any outside click, Escape, scroll, or resize.
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  // Keep the menu fully on-screen (flip near right/bottom edges).
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = x, top = y;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  // Open flyouts to the left when the menu sits in the right half of the screen,
  // so the submenu doesn't run off the edge.
  const flyoutSide: React.CSSProperties =
    pos.left > window.innerWidth / 2
      ? { right: "100%", marginRight: 4 }
      : { left: "100%", marginLeft: 4 };

  function apply(type: RegionOpType) {
    const meta = OP_META[type];
    if (meta.amount) {
      // open the slider so the user picks a real value (default is often neutral)
      setPending({ type, amount: meta.amount.default });
      setOpenGroup(null);
    } else {
      onApplyOp(type, 1);
      onClose();
    }
  }

  return (
    <div
      ref={rootRef}
      onContextMenu={e => e.preventDefault()}
      style={{
        position: "fixed", left: pos.left, top: pos.top, zIndex: 1000,
        background: C.bg2, border: `1px solid ${C.lineBright}`, borderRadius: 10,
        boxShadow: "0 16px 40px rgba(0,0,0,0.6)", padding: 6, minWidth: 210, maxHeight: "80vh",
        overflowY: "auto", fontFamily: ui, userSelect: "none",
      }}>
      {/* header */}
      <div style={{ padding: "4px 8px 6px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: C.accent, letterSpacing: 1 }}>SELECTION</span>
        <span style={{ fontSize: 10, fontFamily: mono, color: C.text3, marginLeft: "auto" }}>
          {trackLabel} · {durSec.toFixed(2)}s
        </span>
      </div>

      {/* amount slider for the pending op — pick a real value, then Apply */}
      {pending && OP_META[pending.type].amount && (() => {
        const a = OP_META[pending.type].amount!;
        return (
          <div style={{ padding: "8px 10px", margin: "2px 0 6px", background: C.bg0, borderRadius: 8, border: `1px solid ${C.accent}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.text2, marginBottom: 6 }}>{OP_META[pending.type].name}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="range" min={a.min} max={a.max} step={a.step} value={pending.amount}
                onChange={e => setPending({ type: pending.type, amount: parseFloat(e.target.value) })}
                style={{ flex: 1, accentColor: C.accent }} />
              <span style={{ fontSize: 11, fontFamily: mono, color: C.accent, minWidth: 48, textAlign: "right" }}>
                {pending.amount > 0 && (pending.type === "pitch" || pending.type.startsWith("eq-")) ? "+" : ""}{pending.amount}{a.unit ?? ""}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={() => { onApplyOp(pending.type, pending.amount); onClose(); }} style={{
                flex: 1, padding: "6px 0", borderRadius: 5, border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 800, background: C.accent, color: "#0c1714", fontFamily: ui,
              }}>Apply</button>
              <button onClick={() => setPending(null)} style={{
                padding: "6px 12px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontWeight: 700,
                background: "transparent", color: C.text3, border: `1px solid ${C.line}`, fontFamily: ui,
              }}>✕</button>
            </div>
          </div>
        );
      })()}

      {/* One row per category. Hovering (or clicking) a row opens its ops in a
          flyout panel beside the menu, so the top level stays compact. */}
      {GROUPS.map(group => {
        const open = openGroup === group.name;
        return (
          <div key={group.name} style={{ position: "relative" }}
            onMouseEnter={() => setOpenGroup(group.name)}>
            <button onClick={() => setOpenGroup(g => g === group.name ? null : group.name)} style={{
              ...item,
              background: open ? withAlpha(group.color, 0.18) : "transparent",
            }}>
              <span style={{ width: 16, textAlign: "center", color: group.color, fontSize: 13 }}>{group.icon}</span>
              <span style={{ flex: 1, fontWeight: 700 }}>{group.name}</span>
              <span style={{ fontSize: 9, color: C.text4 }}>{group.ops.length}</span>
              <span style={{ fontSize: 9, color: open ? group.color : C.text4 }}>▸</span>
            </button>

            {open && (
              <div style={{
                position: "absolute", top: -6, zIndex: 1, ...flyoutSide,
                background: C.bg2, border: `1px solid ${C.lineBright}`, borderRadius: 10,
                boxShadow: "0 16px 40px rgba(0,0,0,0.6)", padding: 6, minWidth: 184,
                maxHeight: "70vh", overflowY: "auto",
              }}>
                <div style={{ padding: "2px 8px 5px", fontSize: 8, fontWeight: 800, letterSpacing: 1, color: group.color }}>
                  {group.name.toUpperCase()}
                </div>
                {group.ops.map(type => {
                  const meta = OP_META[type];
                  return (
                    <button key={type} onClick={() => apply(type)} style={item}
                      onMouseEnter={e => (e.currentTarget.style.background = withAlpha(group.color, 0.18))}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                      <span style={{ width: 16, textAlign: "center", color: group.color, fontSize: 13 }}>{meta.icon}</span>
                      <span style={{ flex: 1 }}>{meta.name}</span>
                      {meta.amount && <span style={{ fontSize: 8, color: C.text4 }}>dflt</span>}
                      {meta.lengthChanging && <span style={{ fontSize: 8, color: C.warn }}>±len</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* hovering the bottom section dismisses any open category flyout */}
      <div onMouseEnter={() => setOpenGroup(null)}>
      <div style={{ height: 1, background: C.line, margin: "5px 4px" }} />

      {canBounce && (
        <button onClick={() => { onBounce(); onClose(); }} style={item}
          onMouseEnter={e => (e.currentTarget.style.background = withAlpha(C.accent, 0.18))}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <span style={{ width: 16, textAlign: "center", color: C.accent, fontSize: 13 }}>⤓</span>
          <span style={{ flex: 1 }}>Bounce to New Track</span>
        </button>
      )}

      {!aiOpen ? (
        <button onClick={() => setAiOpen(true)} style={item}
          onMouseEnter={e => (e.currentTarget.style.background = withAlpha("#b88fb0", 0.18))}
          onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
          <span style={{ width: 16, textAlign: "center", color: "#b88fb0", fontSize: 13 }}>✦</span>
          <span style={{ flex: 1 }}>Regenerate This Part…</span>
        </button>
      ) : (
        <div style={{ display: "flex", gap: 5, padding: "4px 6px" }}>
          <input autoFocus value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
            placeholder="what should fill this section? (e.g. bigger drop, build up)"
            onKeyDown={e => { if (e.key === "Enter" && aiPrompt.trim()) { onAiRegen(aiPrompt.trim()); onClose(); } }}
            style={{ flex: 1, minWidth: 0, background: C.bg0, border: `1px solid ${C.line}`, color: C.text, fontSize: 11, padding: "6px 8px", borderRadius: 6, outline: "none" }} />
          <button disabled={aiBusy || !aiPrompt.trim()} onClick={() => { if (aiPrompt.trim()) { onAiRegen(aiPrompt.trim()); onClose(); } }}
            style={{ padding: "5px 10px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 800, background: "#8e7fc4", color: "#fff", opacity: aiBusy || !aiPrompt.trim() ? 0.5 : 1 }}>
            {aiBusy ? "…" : "Go"}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

const item: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
  padding: "7px 10px", borderRadius: 5, border: "none", cursor: "pointer",
  background: "transparent", color: C.text, fontSize: 12, fontFamily: ui,
};

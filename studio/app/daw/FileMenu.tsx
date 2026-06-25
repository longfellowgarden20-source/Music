"use client";
import { useState, useRef, useEffect } from "react";
import { C, ui, withAlpha } from "./theme";

interface Props {
  onSave: () => void;
  onLoad: () => void;
  onExportMix: () => void;
  onExportStems: () => void;
  onBounce: (() => void) | null;   // null when no selection
  onRevert?: () => void;           // discard autosaved session, reload originals
}

export default function FileMenu({ onSave, onLoad, onExportMix, onExportStems, onBounce, onRevert }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", h);
    return () => window.removeEventListener("mousedown", h);
  }, []);

  const item = (label: string, hint: string, onClick: () => void, disabled = false) => (
    <button disabled={disabled} onClick={() => { onClick(); setOpen(false); }} style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, width: "100%",
      padding: "8px 12px", borderRadius: 5, border: "none", cursor: disabled ? "default" : "pointer",
      background: "transparent", color: disabled ? C.text4 : C.text, fontSize: 12, fontFamily: ui, textAlign: "left",
      opacity: disabled ? 0.5 : 1,
    }}
      onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = withAlpha(C.accent, 0.15); }}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
      <span>{label}</span><span style={{ fontSize: 10, color: C.text4 }}>{hint}</span>
    </button>
  );

  return (
    <div ref={ref} style={{ position: "relative", display: "flex" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 6, padding: "0 14px", border: "none",
        borderRight: `1px solid ${C.line}`, cursor: "pointer", fontSize: 11, fontWeight: 800,
        letterSpacing: 0.5, fontFamily: ui, whiteSpace: "nowrap",
        background: open ? withAlpha(C.accent, 0.18) : "transparent", color: open ? C.accent : C.text2,
      }}>
        ☰ FILE <span style={{ fontSize: 8, opacity: 0.6 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 5px)", left: 0, zIndex: 60,
          background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 8,
          boxShadow: "0 10px 28px rgba(0,0,0,0.55)", padding: 4, minWidth: 220,
        }}>
          {item("Save Project", ".stemai.json", onSave)}
          {item("Open Project", "load .json", onLoad)}
          <div style={{ height: 1, background: C.line, margin: "4px 8px" }} />
          {item("Export Mixdown", "WAV", onExportMix)}
          {item("Export Stems", "WAV ×N", onExportStems)}
          <div style={{ height: 1, background: C.line, margin: "4px 8px" }} />
          {item("Bounce Selection", onBounce ? "→ new track" : "select first", onBounce ?? (() => {}), !onBounce)}
          {onRevert && <div style={{ height: 1, background: C.line, margin: "4px 8px" }} />}
          {onRevert && item("Revert to Original", "discard edits", onRevert)}
        </div>
      )}
    </div>
  );
}

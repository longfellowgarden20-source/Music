"use client";
import { useEffect, useRef, useLayoutEffect, useState } from "react";
import type { DawTrack } from "./dawTypes";
import { C, ui, mono, withAlpha } from "./theme";

// Right-click menu for a whole track (no selection needed). Opens on a track lane
// and offers track-level actions: duplicate/copy, mute, solo, rename, recolor,
// delete. Keyboard shortcuts are shown inline so they're discoverable.

const PALETTE = ["#5fa8c4", "#c47b6e", "#8e7fc4", "#c4a96e", "#7fb89a", "#b88fb0", "#6e9fc4", "#d6c14a"];

interface Props {
  x: number;
  y: number;
  track: DawTrack;
  onDuplicate: (id: string) => void;
  onMute: (id: string) => void;
  onSolo: (id: string) => void;
  onRename: (id: string, label: string) => void;
  onColor: (id: string, color: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export default function TrackContextMenu(props: Props) {
  const { x, y, track, onDuplicate, onMute, onSolo, onRename, onColor, onDelete, onClose } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(track.label);

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

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = x, top = y;
    if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
    if (top + height > window.innerHeight - 8) top = window.innerHeight - height - 8;
    setPos({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [x, y]);

  const item = (icon: string, label: string, onClick: () => void, opts?: { shortcut?: string; danger?: boolean; keepOpen?: boolean }) => (
    <button onClick={() => { onClick(); if (!opts?.keepOpen) onClose(); }} style={{
      display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
      padding: "7px 10px", borderRadius: 5, border: "none", cursor: "pointer",
      background: "transparent", color: opts?.danger ? "#e0564e" : C.text, fontSize: 12, fontFamily: ui,
    }}
      onMouseEnter={e => (e.currentTarget.style.background = withAlpha(opts?.danger ? "#e0564e" : C.accent, 0.16))}
      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
      <span style={{ width: 16, textAlign: "center", color: opts?.danger ? "#e0564e" : C.accent, fontSize: 13 }}>{icon}</span>
      <span style={{ flex: 1 }}>{label}</span>
      {opts?.shortcut && <span style={{ fontSize: 9, color: C.text4, fontFamily: mono }}>{opts.shortcut}</span>}
    </button>
  );

  return (
    <div ref={rootRef} onContextMenu={e => e.preventDefault()} style={{
      position: "fixed", left: pos.left, top: pos.top, zIndex: 1000,
      background: C.bg2, border: `1px solid ${C.lineBright}`, borderRadius: 10,
      boxShadow: "0 16px 40px rgba(0,0,0,0.6)", padding: 6, minWidth: 210, fontFamily: ui, userSelect: "none",
    }}>
      {/* header / rename */}
      <div style={{ padding: "4px 8px 6px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: track.color, flexShrink: 0 }} />
        {renaming ? (
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { onRename(track.id, name); onClose(); } }}
            style={{ flex: 1, minWidth: 0, background: C.bg0, border: `1px solid ${C.line}`, color: C.text, fontSize: 11, padding: "3px 6px", borderRadius: 4, outline: "none" }} />
        ) : (
          <span style={{ fontSize: 10, fontWeight: 800, color: C.text2, letterSpacing: 0.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {track.label.toUpperCase()}
          </span>
        )}
      </div>

      {item("⧉", "Duplicate Track", () => onDuplicate(track.id), { shortcut: "⌘D" })}
      {item(track.muted ? "🔈" : "🔇", track.muted ? "Unmute" : "Mute", () => onMute(track.id), { shortcut: "M" })}
      {item("◎", track.soloed ? "Unsolo" : "Solo", () => onSolo(track.id), { shortcut: "S" })}
      {item("✎", "Rename", () => setRenaming(true), { keepOpen: true })}

      {/* color row */}
      <div style={{ padding: "6px 10px 4px", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ fontSize: 9, color: C.text4, width: "100%", fontWeight: 700, letterSpacing: 0.5 }}>COLOR</span>
        {PALETTE.map(c => (
          <button key={c} onClick={() => { onColor(track.id, c); onClose(); }} style={{
            width: 16, height: 16, borderRadius: 4, cursor: "pointer", padding: 0,
            background: c, border: c === track.color ? "2px solid #fff" : "1px solid rgba(0,0,0,0.4)",
          }} />
        ))}
      </div>

      <div style={{ height: 1, background: C.line, margin: "5px 4px" }} />
      {item("⌫", "Delete Track", () => { if (window.confirm(`Delete "${track.label}"? This removes the track from the session.`)) { onDelete(track.id); onClose(); } }, { danger: true, keepOpen: true, shortcut: "Del" })}
    </div>
  );
}

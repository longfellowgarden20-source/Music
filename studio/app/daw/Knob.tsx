"use client";
import { useRef, useCallback } from "react";
import { C, mono, withAlpha } from "./theme";

interface Props {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  unit?: string;
  color?: string;
  size?: number;
  onChange: (v: number) => void;
}

// Hardware-style rotary knob. Drag up/down to change. Renders as an SVG
// arc with an indicator line — the thing that makes a rack look like gear.
export default function Knob({ value, min, max, step = 0.01, label, unit, color = C.accent, size = 38, onChange }: Props) {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);

  const frac = (value - min) / (max - min);
  const ANGLE = 270;              // total sweep
  const startA = -135;           // start at lower-left
  const angle = startA + frac * ANGLE;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startVal: value };
  }, [value]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dy = dragRef.current.startY - e.clientY;
    const range = max - min;
    // fine control with shift
    const sens = e.shiftKey ? 0.25 : 1;
    let next = dragRef.current.startVal + (dy / 150) * range * sens;
    next = Math.max(min, Math.min(max, next));
    if (step) next = Math.round(next / step) * step;
    onChange(next);
  }, [min, max, step, onChange]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch {}
  }, []);

  const onDouble = useCallback(() => {
    // reset toward center of range (or 0 if 0 is in range)
    const reset = min <= 0 && max >= 0 ? 0 : (min + max) / 2;
    onChange(reset);
  }, [min, max, onChange]);

  const r = size / 2;
  const cx = r, cy = r;
  const ir = r - 4;
  const a0 = (startA * Math.PI) / 180;
  const a1 = ((startA + ANGLE) * Math.PI) / 180;
  const av = (angle * Math.PI) / 180;

  const arcPath = (from: number, to: number) => {
    const x0 = cx + ir * Math.cos(from), y0 = cy + ir * Math.sin(from);
    const x1 = cx + ir * Math.cos(to), y1 = cy + ir * Math.sin(to);
    const large = to - from > Math.PI ? 1 : 0;
    return `M ${x0} ${y0} A ${ir} ${ir} 0 ${large} 1 ${x1} ${y1}`;
  };

  const disp = unit === "Hz" && value >= 1000 ? `${(value / 1000).toFixed(1)}k`
    : Number.isInteger(value) ? `${value}` : value.toFixed(unit === "s" ? 2 : 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, userSelect: "none", width: size + 6 }}>
      <svg width={size} height={size}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onDoubleClick={onDouble}
        style={{ cursor: "ns-resize", touchAction: "none" }}>
        {/* track arc */}
        <path d={arcPath(a0, a1)} fill="none" stroke={C.bg0} strokeWidth={3} strokeLinecap="round" />
        {/* value arc */}
        <path d={arcPath(a0, av)} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 3px ${withAlpha(color, 0.6)})` }} />
        {/* knob body */}
        <circle cx={cx} cy={cy} r={ir - 4} fill={`url(#kg${size})`} stroke={C.line} strokeWidth={1} />
        {/* indicator */}
        <line x1={cx} y1={cy} x2={cx + (ir - 6) * Math.cos(av)} y2={cy + (ir - 6) * Math.sin(av)}
          stroke={color} strokeWidth={2} strokeLinecap="round" />
        <defs>
          <radialGradient id={`kg${size}`} cx="50%" cy="35%">
            <stop offset="0%" stopColor={C.bg4} />
            <stop offset="100%" stopColor={C.bg2} />
          </radialGradient>
        </defs>
      </svg>
      <span style={{ fontSize: 8, fontWeight: 700, color: C.text3, letterSpacing: 0.3 }}>{label}</span>
      <span style={{ fontSize: 8, fontFamily: mono, color: C.text2 }}>{disp}{unit && unit !== ":1" ? "" : unit}</span>
    </div>
  );
}

// Ableton/Logic-inspired design tokens.
// Key principles that separate a real DAW look from generic web UI:
//  - background is warm dark grey, NOT pure black
//  - surfaces are layered with subtle top-highlight + bottom-shadow (depth)
//  - clip colors are MUTED/desaturated, never neon
//  - everything uses tight type, lots of monospace for numbers
//  - 1px inset borders + soft outer shadows create the "panel" feel

export const C = {
  // base surfaces (warm greys, layered light→dark)
  bg0: "#1a1a1d",      // app background (behind everything)
  bg1: "#212126",      // main panel
  bg2: "#27272e",      // raised panel (transport, headers)
  bg3: "#2e2e36",      // controls / inputs
  bg4: "#3a3a44",      // hover / active control
  arrange: "#1c1c20",  // arrangement canvas bed
  rowA: "#202024",     // alternating track row
  rowB: "#1d1d21",

  // lines / borders
  line: "#34343d",
  lineSoft: "#2a2a32",
  lineBright: "#43434f",

  // text
  text: "#e8e8ec",
  text2: "#a0a0aa",
  text3: "#6c6c78",
  text4: "#4a4a54",

  // brand accent (kept but softened — sea green, not neon)
  accent: "#4fd1a5",
  accentDim: "#2f7d65",
  rec: "#e0564e",      // record red (muted)
  recDim: "#7a322e",
  solo: "#e0b341",     // solo amber
  warn: "#e0a23e",

  // meter gradient stops
  meterLow: "#3fae7d",
  meterMid: "#d6c14a",
  meterHigh: "#e0564e",
} as const;

// Muted, desaturated stem colors — Ableton-style. These read as "pro"
// because they're never fully saturated.
export const STEM_COLORS: Record<string, string> = {
  master: "#6fae8e",
  vocals: "#5fa8c4",
  drums:  "#c47b6e",
  bass:   "#8e7fc4",
  other:  "#c4a96e",
  guitar: "#7fb89a",
  piano:  "#b88fb0",
  synth:  "#6e9fc4",
};

export const MARKER_COLORS = ["#5fa8c4", "#d6c14a", "#c47b6e", "#8e7fc4", "#6fae8e", "#c48fb0"];

// reusable raised-surface shadow (the thing that makes panels feel physical)
export const raised: React.CSSProperties = {
  background: `linear-gradient(180deg, ${C.bg3}, ${C.bg2})`,
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.4)",
  border: `1px solid ${C.line}`,
};

export const inset: React.CSSProperties = {
  background: C.bg0,
  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.6)",
  border: `1px solid ${C.lineSoft}`,
};

// monospace numeric readout
export const mono = "'SF Mono', 'JetBrains Mono', 'Roboto Mono', ui-monospace, monospace";
export const ui = "'Inter', -apple-system, system-ui, sans-serif";

// turn a hex like #5fa8c4 into rgba with given alpha
export function withAlpha(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

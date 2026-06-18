import type { SnapResolution } from "./dawTypes";

// Snap a time (seconds) to the nearest grid line given the snap resolution + tempo.
export function snapSec(sec: number, snap: SnapResolution, bpm: number): number {
  if (snap === "off") return sec;
  const secPerBeat = 60 / bpm;
  let grid: number;
  switch (snap) {
    case "bar":  grid = secPerBeat * 4; break;
    case "beat": grid = secPerBeat;     break;
    case "1/8":  grid = secPerBeat / 2; break;
    case "1/16": grid = secPerBeat / 4; break;
    default:     return sec;
  }
  return Math.round(sec / grid) * grid;
}

export const SNAP_OPTIONS: SnapResolution[] = ["off", "bar", "beat", "1/8", "1/16"];

export const SNAP_LABELS: Record<SnapResolution, string> = {
  "off": "Off",
  "bar": "Bar",
  "beat": "Beat",
  "1/8": "1/8",
  "1/16": "1/16",
};

"use client";
import { useRef, useState, useCallback } from "react";
import type { DawTrack, Marker, HistorySnapshot } from "./dawTypes";

// Strip the non-serialisable peakData before snapshotting, then restore it on undo
// by matching track ids (peakData never changes once decoded).
function cloneTracks(tracks: DawTrack[]): DawTrack[] {
  return tracks.map(t => ({
    ...t,
    clips: t.clips.map(c => ({ ...c, ops: (c.ops ?? []).map(o => ({ ...o })) })),
    effects: (t.effects ?? []).map(e => ({ ...e, params: { ...e.params } })),
    automation: t.automation
      ? Object.fromEntries(Object.entries(t.automation).map(([k, v]) => [k, (v ?? []).map(p => ({ ...p }))]))
      : {},
    // keep the peakData reference — it's immutable
  }));
}

export interface HistoryApi {
  push: (tracks: DawTrack[], markers: Marker[], label: string) => void;
  undo: () => HistorySnapshot | null;
  redo: () => HistorySnapshot | null;
  canUndo: boolean;
  canRedo: boolean;
  entries: { label: string; current: boolean }[];
}

const MAX = 60;

export function useHistory(): HistoryApi {
  const past = useRef<HistorySnapshot[]>([]);
  const future = useRef<HistorySnapshot[]>([]);
  const [, force] = useState(0);
  const rerender = useCallback(() => force(n => n + 1), []);

  const push = useCallback((tracks: DawTrack[], markers: Marker[], label: string) => {
    past.current.push({ tracks: cloneTracks(tracks), markers: markers.map(m => ({ ...m })), label });
    if (past.current.length > MAX) past.current.shift();
    future.current = [];
    rerender();
  }, [rerender]);

  const undo = useCallback((): HistorySnapshot | null => {
    if (past.current.length < 2) return null;
    const current = past.current.pop()!;
    future.current.push(current);
    const prev = past.current[past.current.length - 1];
    rerender();
    return { tracks: cloneTracks(prev.tracks), markers: prev.markers.map(m => ({ ...m })), label: prev.label };
  }, [rerender]);

  const redo = useCallback((): HistorySnapshot | null => {
    if (future.current.length === 0) return null;
    const next = future.current.pop()!;
    past.current.push(next);
    rerender();
    return { tracks: cloneTracks(next.tracks), markers: next.markers.map(m => ({ ...m })), label: next.label };
  }, [rerender]);

  const entries = past.current.map((s, i) => ({
    label: s.label,
    current: i === past.current.length - 1,
  }));

  return {
    push, undo, redo,
    canUndo: past.current.length >= 2,
    canRedo: future.current.length > 0,
    entries,
  };
}

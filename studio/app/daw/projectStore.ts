"use client";
import type { ProjectFile } from "./exporter";

// Local autosave for DAW projects. Edits (clip moves, volume, effects, markers…)
// are serialized to localStorage so a refresh/crash doesn't lose work. Keyed by
// the source library track id, so each song restores its own edit session.
//
// This is the immediate safety net. Durable cross-device persistence is the
// backend save (see api.saveProject); localStorage is the fast local cache.

const KEY_PREFIX = "stemai-daw-project:";
// SCHEMA bump invalidates every previously-saved session. v1 sessions could be
// "poisoned" with a truncated clip.durationSec (a load-time bug baked the
// decoded buffer length into the clip, and a short read got autosaved + replayed
// forever). Bumping to 2 makes loadLocalProject reject all v1 blobs, so the DAW
// loads pristine stems from disk instead of a stale, short session.
const SCHEMA = 2;

function key(trackId: string | number): string {
  return `${KEY_PREFIX}${trackId}`;
}

export function saveLocalProject(trackId: string | number | null, proj: ProjectFile): void {
  if (trackId == null) return;
  try {
    localStorage.setItem(key(trackId), JSON.stringify({ schema: SCHEMA, proj }));
  } catch {
    // quota exceeded or storage disabled — fail silently; backend save is the
    // durable path, this is only the local convenience cache.
  }
}

export function loadLocalProject(trackId: string | number | null): ProjectFile | null {
  if (trackId == null) return null;
  try {
    const raw = localStorage.getItem(key(trackId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.schema !== SCHEMA || !parsed.proj) return null;
    return parsed.proj as ProjectFile;
  } catch {
    return null;
  }
}

export function clearLocalProject(trackId: string | number | null): void {
  if (trackId == null) return;
  try { localStorage.removeItem(key(trackId)); } catch { /* noop */ }
}

export function hasLocalProject(trackId: string | number | null): boolean {
  if (trackId == null) return false;
  try { return localStorage.getItem(key(trackId)) != null; } catch { return false; }
}

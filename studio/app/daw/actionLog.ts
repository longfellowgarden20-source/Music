"use client";
import { useSyncExternalStore } from "react";

// Lightweight global action log for debugging "is this feature actually wired?".
// Engine calls are auto-captured by wrapping the engine object (see wrapWithLog),
// so EVERY method — current or added later — logs itself with zero per-call work.
// UI events can also push entries directly via logAction().
//
// TEMP debugging aid. Toggle the on-screen panel with the "LOG" button; clearing
// the whole feature is a matter of removing wrapWithLog() + <ActionLog/>.

export interface LogEntry {
  id: number;
  t: number;          // epoch ms
  source: "engine" | "ui";
  name: string;       // method / event name
  detail: string;     // short arg/result summary
}

const MAX = 60;
let entries: LogEntry[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  // new array identity so useSyncExternalStore re-renders
  entries = entries.slice(0, MAX);
  listeners.forEach(l => l());
}

export function logAction(source: LogEntry["source"], name: string, detail = ""): void {
  entries = [{ id: ++seq, t: Date.now(), source, name, detail }, ...entries];
  emit();
}

export function clearLog(): void { entries = []; emit(); }

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function snapshot(): LogEntry[] { return entries; }

export function useActionLog(): LogEntry[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

// Summarize a call's args into a short readable string (ids, numbers, small objects).
function summarizeArgs(args: unknown[]): string {
  return args.map(a => {
    if (a == null) return String(a);
    if (typeof a === "number") return Number.isInteger(a) ? String(a) : a.toFixed(3);
    if (typeof a === "string") return a.length > 24 ? a.slice(0, 24) + "…" : a;
    if (typeof a === "boolean") return String(a);
    if (Array.isArray(a)) return `[${a.length}]`;
    if (typeof a === "object") {
      const o = a as Record<string, unknown>;
      // common DAW shapes: tracks, effects, ops
      if ("id" in o && "label" in o) return `track:${o.id}`;
      if ("type" in o) return `${o.type}`;
      const keys = Object.keys(o);
      return `{${keys.slice(0, 3).join(",")}${keys.length > 3 ? "…" : ""}}`;
    }
    return typeof a;
  }).join(", ");
}

// Methods that fire on every animation frame — never log these (would flood).
const SILENT = new Set(["getPosition", "getLevels", "getAnalyser", "getInputLevel"]);

/**
 * Wrap an object so every function-valued property logs when called. Returns a new
 * object with the same shape. Non-function props pass through untouched. This is
 * what makes the log cover all current AND future engine methods automatically.
 */
export function wrapWithLog<T extends object>(obj: T, source: LogEntry["source"] = "engine"): T {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (typeof val === "function" && !SILENT.has(key)) {
      out[key] = (...args: unknown[]) => {
        logAction(source, key, summarizeArgs(args));
        return (val as (...a: unknown[]) => unknown).apply(obj, args);
      };
    } else {
      out[key] = val;
    }
  }
  return out as T;
}

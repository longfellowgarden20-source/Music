// Use 127.0.0.1 (not "localhost") on purpose: Chromium/Electron resolve
// "localhost" to IPv6 ::1 first, but the engine binds IPv4 only — a "localhost"
// fetch then hangs forever with no error. 127.0.0.1 pins it to IPv4.
export const API = "http://127.0.0.1:8765";

export interface Track {
  id: number;
  title: string;
  prompt: string;
  model: string;
  duration: number;
  bpm: number | null;
  key: string | null;
  rating: number;
  favorite: boolean;
  tags: string;
  notes: string;
  collection: string;
  created_at: string;
  filepath: string;
  cover_path: string;
  version: number;
  project_id: number;
  edit_label: string;
  has_audio: boolean;
  has_cover: boolean;
}

export interface EffectParam {
  key: string; min: number; max: number; default: number; label: string;
}
export interface EffectDef { name: string; params: EffectParam[]; }

export interface Stats {
  total: number; favorites: number; plays: number; total_seconds: number;
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts?.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  // data
  tracks: (q: { search?: string; collection?: string; sort?: string; favorites?: boolean } = {}) => {
    const p = new URLSearchParams();
    if (q.search) p.set("search", q.search);
    if (q.collection) p.set("collection", q.collection);
    if (q.sort) p.set("sort", q.sort);
    if (q.favorites) p.set("favorites", "true");
    return req<Track[]>(`/api/tracks?${p.toString()}`);
  },
  track: (id: number) => req<Track>(`/api/track/${id}`),
  versions: (id: number) => req<Track[]>(`/api/track/${id}/versions`),
  collections: () => req<string[]>(`/api/collections`),
  stats: () => req<Stats>(`/api/stats`),
  waveform: (id: number, points = 1400) =>
    req<{ peaks: number[]; duration: number; sr: number }>(`/api/waveform/${id}?points=${points}`),

  // management
  rename: (id: number, title: string) =>
    req(`/api/track/${id}/rename`, { method: "POST", body: JSON.stringify({ title }) }),
  rate: (id: number, rating: number) =>
    req(`/api/track/${id}/rate`, { method: "POST", body: JSON.stringify({ rating }) }),
  favorite: (id: number) =>
    req<{ favorite: boolean }>(`/api/track/${id}/favorite`, { method: "POST" }),
  notes: (id: number, notes: string) =>
    req(`/api/track/${id}/notes`, { method: "POST", body: JSON.stringify({ notes }) }),
  setCollection: (id: number, collection: string) =>
    req(`/api/track/${id}/collection`, { method: "POST", body: JSON.stringify({ collection }) }),
  duplicate: (id: number) =>
    req<{ id: number }>(`/api/track/${id}/duplicate`, { method: "POST" }),
  remove: (id: number) => req(`/api/track/${id}`, { method: "DELETE" }),

  // generate
  generate: (body: Record<string, unknown>) =>
    req<{ id: number; seed: number; bpm: number | null; key: string | null; track: Track }>(
      `/api/generate`, { method: "POST", body: JSON.stringify(body) }),
  tweak: (id: number, body: Record<string, unknown>) =>
    req<{ id: number; new_prompt: string; track: Track }>(
      `/api/track/${id}/tweak`, { method: "POST", body: JSON.stringify(body) }),
  extend: (id: number, body: Record<string, unknown>) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/extend`, { method: "POST", body: JSON.stringify(body) }),
  complete: (id: number, body: Record<string, unknown>) =>
    req<{ id: number; structure: string; track: Track }>(`/api/track/${id}/complete`, { method: "POST", body: JSON.stringify(body) }),
  cancel: () =>
    req<{ ok: boolean; was_running: boolean }>(`/api/cancel`, { method: "POST" }),
  status: () => req<{ generating: boolean }>(`/api/status`),
  soundsLike: (text: string) =>
    req<{ prompt: string }>(`/api/sounds-like`, { method: "POST", body: JSON.stringify({ text }) }),

  // edit
  effects: () => req<EffectDef[]>(`/api/effects`),
  effect: (id: number, effect: string, params: Record<string, number>) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/effect`, { method: "POST", body: JSON.stringify({ effect, params }) }),
  pitch: (id: number, semitones: number) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/pitch`, { method: "POST", body: JSON.stringify({ semitones }) }),
  speed: (id: number, speed_pct: number) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/speed`, { method: "POST", body: JSON.stringify({ speed_pct }) }),
  fade: (id: number, fade_in: number, fade_out: number) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/fade`, { method: "POST", body: JSON.stringify({ fade_in, fade_out }) }),
  normalize: (id: number) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/normalize`, { method: "POST" }),
  preset: (id: number, preset: string) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/preset`, { method: "POST", body: JSON.stringify({ preset }) }),
  arrange: (id: number, op: string, a = 0, b = 0) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/arrange`, { method: "POST", body: JSON.stringify({ op, a, b }) }),
  region: (id: number, body: Record<string, unknown>) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/region`, { method: "POST", body: JSON.stringify(body) }),

  aiNotes: (id: number) =>
    req<{ vibe?: string; strengths?: string[]; suggestions?: string[]; next?: string; error?: string }>(
      `/api/track/${id}/ai-notes`),

  // stems / multitrack DAW
  stems: (id: number) =>
    req<{ track_id: number; separated: boolean; stems: Record<string, string> }>(`/api/stems/${id}`),
  splitStems: (id: number) =>
    req<{ track_id: number; separated: boolean; stems: Record<string, string> }>(
      `/api/stems/${id}/split`, { method: "POST" }),
  stemWaveform: (id: number, stem: string, points = 1400) =>
    req<{ peaks: number[]; duration: number }>(`/api/waveform-stem/${id}/${stem}?points=${points}`),
  mixdown: (id: number, mixer: Record<string, { volume: number; muted: boolean; pan?: number }>) =>
    req<{ id: number; track: Track }>(`/api/stems/${id}/mixdown`, { method: "POST", body: JSON.stringify({ mixer }) }),
  stemAudioUrl: (id: number, stem: string) => `${API}/api/stem-audio/${id}/${stem}`,

  // AI stem ops (DAW)
  stemRegenerate: (id: number, stem: string, body: Record<string, unknown>) =>
    req<{ ok: boolean; stem: string; duration: number }>(`/api/daw/${id}/stem-regenerate/${stem}`, { method: "POST", body: JSON.stringify(body) }),
  stemExtend: (id: number, stem: string, body: Record<string, unknown>) =>
    req<{ ok: boolean; stem: string; duration: number }>(`/api/daw/${id}/stem-extend/${stem}`, { method: "POST", body: JSON.stringify(body) }),
  stemSwap: (id: number, stem: string, body: Record<string, unknown>) =>
    req<{ ok: boolean; stem: string; duration: number }>(`/api/daw/${id}/stem-swap/${stem}`, { method: "POST", body: JSON.stringify(body) }),
  stemRevert: (id: number, stem: string) =>
    req<{ ok: boolean; stem: string }>(`/api/daw/${id}/stem-revert/${stem}`, { method: "POST" }),

  audioUrl: (id: number) => `${API}/api/audio/${id}`,
  coverUrl: (id: number) => `${API}/api/cover/${id}`,

  // licensing
  licenseStatus: () =>
    req<{ required: boolean; activated: boolean; email: string }>(`/api/license`),
  activate: (key: string) =>
    req<{ activated: boolean; email: string }>(`/api/license/activate`, {
      method: "POST", body: JSON.stringify({ key }),
    }),
};

export function fmtTime(s: number): string {
  if (!s || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return iso?.slice(0, 10) || ""; }
}

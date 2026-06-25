// Use 127.0.0.1 (not "localhost") on purpose: Chromium/Electron resolve
// "localhost" to IPv6 ::1 first, but the engine binds IPv4 only — a "localhost"
// fetch then hangs forever with no error. 127.0.0.1 pins it to IPv4.
export const API = "http://127.0.0.1:8765";

export interface Track {
  id: number;
  title: string;
  prompt: string;
  negative?: string;
  model: string;
  guidance?: number | null;
  temperature?: number | null;
  seed?: number | null;
  sample_rate?: number | null;
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

export interface Playlist {
  id: number;
  name: string;
  created_at: string;
  track_count: number;
  total_seconds: number;
}
export interface PlaylistDetail extends Playlist {
  tracks: Track[];
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
  deleteVersion: (trackId: number, versionId: number) =>
    req<{ ok: boolean; versions: Track[] }>(`/api/track/${trackId}/version/${versionId}`, { method: "DELETE" }),
  collections: () => req<string[]>(`/api/collections`),
  stats: () => req<Stats>(`/api/stats`),

  // playlists
  playlists: () => req<Playlist[]>(`/api/playlists`),
  playlist: (id: number) => req<PlaylistDetail>(`/api/playlists/${id}`),
  createPlaylist: (name: string) =>
    req<{ id: number }>(`/api/playlists`, { method: "POST", body: JSON.stringify({ name }) }),
  renamePlaylist: (id: number, name: string) =>
    req(`/api/playlists/${id}/rename`, { method: "POST", body: JSON.stringify({ name }) }),
  deletePlaylist: (id: number) => req(`/api/playlists/${id}`, { method: "DELETE" }),
  addToPlaylist: (playlistId: number, trackId: number) =>
    req(`/api/playlists/${playlistId}/add/${trackId}`, { method: "POST" }),
  removeFromPlaylist: (playlistId: number, trackId: number) =>
    req(`/api/playlists/${playlistId}/remove/${trackId}`, { method: "POST" }),
  reorderPlaylist: (playlistId: number, trackIds: number[]) =>
    req(`/api/playlists/${playlistId}/reorder`, { method: "POST", body: JSON.stringify({ track_ids: trackIds }) }),
  waveform: (id: number, points = 1400) =>
    req<{ peaks: number[]; duration: number; sr: number }>(`/api/waveform/${id}?points=${points}`),

  downloadUrl: (id: number) => `${API}/api/download/${id}`,
  addToAppleMusic: (id: number) => req<{ ok: boolean; message: string }>(`/api/add-to-apple-music/${id}`, { method: "POST" }),

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
  // Generate N fresh takes from the track's original prompt (new seed each).
  // Original is untouched; each variation is saved as a version of the project.
  variations: (id: number, body: Record<string, unknown>) =>
    req<{ ok: boolean; variations: Track[]; count: number }>(
      `/api/track/${id}/variations`, { method: "POST", body: JSON.stringify(body) }),
  extend: (id: number, body: Record<string, unknown>) =>
    req<{ id: number; track: Track }>(`/api/track/${id}/extend`, { method: "POST", body: JSON.stringify(body) }),
  complete: (id: number, body: Record<string, unknown>) =>
    req<{ id: number; structure: string; track: Track }>(`/api/track/${id}/complete`, { method: "POST", body: JSON.stringify(body) }),

  // "Complete the song" — start a background build, then poll for progress.
  // Polling (not a long SSE connection) is robust: MusicGen's GIL-heavy compute
  // would starve a streaming connection and drop it mid-build.
  completeStream: (
    id: number,
    body: Record<string, unknown>,
    onProgress: (p: { pct: number; section: number; total: number; role: string; msg?: string }) => void,
  ): Promise<{ id: number; structure: string; track: Track }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const start = await fetch(`${API}/api/track/${id}/complete-start`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!start.ok) {
          let msg = `HTTP ${start.status}`;
          try { const j = await start.json(); msg = j.detail || msg; } catch {}
          reject(new Error(msg)); return;
        }
        const { job_id } = await start.json();

        // Poll every 1.5s. Tolerate transient fetch failures (don't abort the
        // whole build just because one poll hiccuped).
        let misses = 0;
        const poll = async () => {
          try {
            const res = await fetch(`${API}/api/complete-status/${job_id}`);
            if (!res.ok) {
              // 404 after a terminal poll is expected (job GC'd) — only fail if we
              // never saw a result.
              if (++misses > 5) { reject(new Error("Lost track of the build")); return; }
              setTimeout(poll, 1500); return;
            }
            misses = 0;
            const s = await res.json();
            if (s.state === "done") {
              resolve({ id: s.id, structure: s.structure, track: s.track }); return;
            }
            if (s.state === "error" || s.state === "cancelled") {
              reject(new Error(s.error || "Complete failed")); return;
            }
            onProgress({ pct: s.pct ?? 5, section: s.section ?? 0, total: s.total ?? 6,
                         role: s.role ?? "working", msg: s.state });
            setTimeout(poll, 1500);
          } catch {
            if (++misses > 8) { reject(new Error("Connection lost during build")); return; }
            setTimeout(poll, 1500);
          }
        };
        poll();
      } catch (e) { reject(e); }
    });
  },

  // Song structure editor — build a song from a custom arrangement of sections.
  structure: (
    id: number,
    sections: { role: string; duration: number }[],
    prompt: string,
    onProgress: (p: { pct: number; section: number; total: number; role: string }) => void,
  ): Promise<{ id: number; structure: string; track: Track }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const start = await fetch(`${API}/api/track/${id}/structure-start`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sections, prompt }),
        });
        if (!start.ok) {
          let msg = `HTTP ${start.status}`;
          try { const j = await start.json(); msg = j.detail || msg; } catch {}
          reject(new Error(msg)); return;
        }
        const { job_id } = await start.json();
        let misses = 0;
        const poll = async () => {
          try {
            const res = await fetch(`${API}/api/complete-status/${job_id}`);
            if (!res.ok) { if (++misses > 5) { reject(new Error("Lost track of the build")); return; } setTimeout(poll, 1500); return; }
            misses = 0;
            const s = await res.json();
            if (s.state === "done") { resolve({ id: s.id, structure: s.structure, track: s.track }); return; }
            if (s.state === "error" || s.state === "cancelled") { reject(new Error(s.error || "Failed")); return; }
            onProgress({ pct: s.pct ?? 5, section: s.section ?? 0, total: s.total ?? 0, role: s.role ?? "working" });
            setTimeout(poll, 1500);
          } catch { if (++misses > 8) { reject(new Error("Connection lost")); return; } setTimeout(poll, 1500); }
        };
        poll();
      } catch (e) { reject(e); }
    });
  },

  // "Add an instrument" (e.g. drums) — same start+poll pattern as completeStream,
  // sharing the backend's single-generation guard + status endpoint.
  addInstrument: (
    id: number,
    body: { prompt: string; volume?: number; blend?: string; model_size?: string; guidance?: number },
    onProgress: (p: { pct: number; state: string }) => void,
  ): Promise<{ id: number; track: Track }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const start = await fetch(`${API}/api/track/${id}/add-instrument-start`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!start.ok) {
          let msg = `HTTP ${start.status}`;
          try { const j = await start.json(); msg = j.detail || msg; } catch {}
          reject(new Error(msg)); return;
        }
        const { job_id } = await start.json();
        let misses = 0;
        const poll = async () => {
          try {
            const res = await fetch(`${API}/api/complete-status/${job_id}`);
            if (!res.ok) {
              if (++misses > 5) { reject(new Error("Lost track of the job")); return; }
              setTimeout(poll, 1500); return;
            }
            misses = 0;
            const s = await res.json();
            if (s.state === "done") { resolve({ id: s.id, track: s.track }); return; }
            if (s.state === "error" || s.state === "cancelled") { reject(new Error(s.error || "Failed")); return; }
            onProgress({ pct: s.pct ?? 10, state: s.state ?? "working" });
            setTimeout(poll, 1500);
          } catch {
            if (++misses > 8) { reject(new Error("Connection lost")); return; }
            setTimeout(poll, 1500);
          }
        };
        poll();
      } catch (e) { reject(e); }
    });
  },

  // Producer-mode chat: one message → parsed action → background edit. Resolves
  // with the assistant reply, the parsed action, and (usually) the new track.
  chat: (
    id: number,
    message: string,
    onProgress?: (p: { pct: number; state: string }) => void,
  ): Promise<{ reply: string; action: any; track?: Track; id?: number; no_change?: boolean }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const start = await fetch(`${API}/api/track/${id}/chat`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }),
        });
        if (!start.ok) {
          let msg = `HTTP ${start.status}`;
          try { const j = await start.json(); msg = j.detail || msg; } catch {}
          reject(new Error(msg)); return;
        }
        const { job_id, action } = await start.json();
        let misses = 0;
        const poll = async () => {
          try {
            const res = await fetch(`${API}/api/complete-status/${job_id}`);
            if (!res.ok) {
              if (++misses > 5) { reject(new Error("Lost track of the job")); return; }
              setTimeout(poll, 1500); return;
            }
            misses = 0;
            const s = await res.json();
            if (s.state === "done") {
              resolve({ reply: s.reply || "Done.", action, track: s.track, id: s.id, no_change: s.no_change });
              return;
            }
            if (s.state === "error" || s.state === "cancelled") { reject(new Error(s.error || "Failed")); return; }
            onProgress?.({ pct: s.pct ?? 10, state: s.state ?? "working" });
            setTimeout(poll, 1500);
          } catch {
            if (++misses > 8) { reject(new Error("Connection lost")); return; }
            setTimeout(poll, 1500);
          }
        };
        poll();
      } catch (e) { reject(e); }
    });
  },
  // Reference track matching — upload a song, generate in its style ("restyle")
  // or continue from it ("continue"). Background job; resolves with the new track.
  referenceMatch: (
    file: File,
    opts: { prompt?: string; mode?: "restyle" | "continue"; duration?: number; model_size?: string },
    onProgress?: (p: { pct: number; state: string }) => void,
  ): Promise<{ id: number; track: Track }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("prompt", opts.prompt || "");
        form.append("mode", opts.mode || "restyle");
        form.append("duration", String(opts.duration ?? 12));
        form.append("model_size", opts.model_size || "small");
        const start = await fetch(`${API}/api/reference-start`, { method: "POST", body: form });
        if (!start.ok) {
          let msg = `HTTP ${start.status}`;
          try { const j = await start.json(); msg = j.detail || msg; } catch {}
          reject(new Error(msg)); return;
        }
        const { job_id } = await start.json();
        let misses = 0;
        const poll = async () => {
          try {
            const res = await fetch(`${API}/api/complete-status/${job_id}`);
            if (!res.ok) { if (++misses > 5) { reject(new Error("Lost track of the job")); return; } setTimeout(poll, 1500); return; }
            misses = 0;
            const s = await res.json();
            if (s.state === "done") { resolve({ id: s.id, track: s.track }); return; }
            if (s.state === "error" || s.state === "cancelled") { reject(new Error(s.error || "Failed")); return; }
            onProgress?.({ pct: s.pct ?? 10, state: s.state ?? "working" });
            setTimeout(poll, 1500);
          } catch { if (++misses > 8) { reject(new Error("Connection lost")); return; } setTimeout(poll, 1500); }
        };
        poll();
      } catch (e) { reject(e); }
    });
  },
  // Mashup: mix stems from different tracks into one. Background job.
  mashup: (
    selections: { track_id: number; stem: string; volume?: number }[],
    title: string,
    onProgress?: (p: { pct: number; state: string }) => void,
  ): Promise<{ id: number; track: Track }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const start = await fetch(`${API}/api/mashup-start`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ selections, title }),
        });
        if (!start.ok) {
          let msg = `HTTP ${start.status}`;
          try { const j = await start.json(); msg = j.detail || msg; } catch {}
          reject(new Error(msg)); return;
        }
        const { job_id } = await start.json();
        let misses = 0;
        const poll = async () => {
          try {
            const res = await fetch(`${API}/api/complete-status/${job_id}`);
            if (!res.ok) { if (++misses > 5) { reject(new Error("Lost track of the job")); return; } setTimeout(poll, 1500); return; }
            misses = 0;
            const s = await res.json();
            if (s.state === "done") { resolve({ id: s.id, track: s.track }); return; }
            if (s.state === "error" || s.state === "cancelled") { reject(new Error(s.error || "Failed")); return; }
            onProgress?.({ pct: s.pct ?? 10, state: s.state ?? "working" });
            setTimeout(poll, 1500);
          } catch { if (++misses > 8) { reject(new Error("Connection lost")); return; } setTimeout(poll, 1500); }
        };
        poll();
      } catch (e) { reject(e); }
    });
  },
  // Lyrics → full sung song (ACE-Step). Background job.
  makeSong: (
    body: { lyrics?: string; theme?: string; style?: string; duration?: number },
    onProgress?: (p: { pct: number; state: string }) => void,
  ): Promise<{ id: number; lyrics: string; track: Track }> => {
    return new Promise(async (resolve, reject) => {
      try {
        const start = await fetch(`${API}/api/song-start`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        if (!start.ok) {
          let msg = `HTTP ${start.status}`;
          try { const j = await start.json(); msg = j.detail || msg; } catch {}
          reject(new Error(msg)); return;
        }
        const { job_id } = await start.json();
        let misses = 0;
        const poll = async () => {
          try {
            const res = await fetch(`${API}/api/complete-status/${job_id}`);
            if (!res.ok) { if (++misses > 5) { reject(new Error("Lost track of the job")); return; } setTimeout(poll, 1500); return; }
            misses = 0;
            const s = await res.json();
            if (s.state === "done") { resolve({ id: s.id, lyrics: s.lyrics, track: s.track }); return; }
            if (s.state === "error" || s.state === "cancelled") { reject(new Error(s.error || "Failed")); return; }
            onProgress?.({ pct: s.pct ?? 10, state: s.state ?? "working" });
            setTimeout(poll, 1500);
          } catch { if (++misses > 8) { reject(new Error("Connection lost")); return; } setTimeout(poll, 1500); }
        };
        poll();
      } catch (e) { reject(e); }
    });
  },
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
  masterPlatforms: () =>
    req<{ key: string; label: string; lufs: number }[]>(`/api/master-platforms`),
  master: (id: number, platform: string) =>
    req<{ id: number; platform: string; track: Track }>(`/api/track/${id}/master`, { method: "POST", body: JSON.stringify({ platform }) }),
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
  stemNotes: (id: number, stem: string) =>
    req<{ track_id: number; stem: string; notes: Array<{ pitch: number; note_name: string; start_sec: number; end_sec: number; velocity: number; confidence: number }> }>(`/api/notes/${id}/${stem}`),

  // AI stem ops (DAW)
  stemRegenerate: (id: number, stem: string, body: Record<string, unknown>) =>
    req<{ ok: boolean; stem: string; duration: number }>(`/api/daw/${id}/stem-regenerate/${stem}`, { method: "POST", body: JSON.stringify(body) }),
  stemExtend: (id: number, stem: string, body: Record<string, unknown>) =>
    req<{ ok: boolean; stem: string; duration: number }>(`/api/daw/${id}/stem-extend/${stem}`, { method: "POST", body: JSON.stringify(body) }),
  stemSwap: (id: number, stem: string, body: Record<string, unknown>) =>
    req<{ ok: boolean; stem: string; duration: number }>(`/api/daw/${id}/stem-swap/${stem}`, { method: "POST", body: JSON.stringify(body) }),
  stemRevert: (id: number, stem: string) =>
    req<{ ok: boolean; stem: string }>(`/api/daw/${id}/stem-revert/${stem}`, { method: "POST" }),

  importAudio: async (file: File): Promise<{ id: number; title: string; bpm: number | null; key: string | null; duration: number; track: Track }> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API}/api/import`, { method: "POST", body: form });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.detail || msg; } catch {}
      throw new Error(msg);
    }
    return res.json();
  },

  audioUrl: (id: number) => `${API}/api/audio/${id}`,
  coverUrl: (id: number) => `${API}/api/cover/${id}`,

  // export formats
  exportUrl: (id: number, fmt: string) => `${API}/api/export/${id}.${fmt}`,
  midiUrl: (id: number, stem: string) => `${API}/api/midi/${id}/${stem}.mid`,

  // chord progression
  chords: (id: number) =>
    req<{ track_id: number; progression: string; chords: Array<{ chord: string; start_sec: number; confidence: number }> }>(`/api/chords/${id}`),

  // tags + bulk ops
  setTags: (id: number, tags: string) =>
    req<{ ok: boolean; tags: string }>(`/api/track/${id}/tags`, { method: "POST", body: JSON.stringify({ tags }) }),
  allTags: () => req<Array<{ tag: string; count: number }>>(`/api/tags`),
  bulk: (ids: number[], op: string, value?: string) =>
    req<{ ok: boolean; affected: number }>(`/api/tracks/bulk`, { method: "POST", body: JSON.stringify({ ids, op, value }) }),

  // licensing
  licenseStatus: () =>
    req<{ required: boolean; activated: boolean; email: string }>(`/api/license`),
  activate: (key: string) =>
    req<{ activated: boolean; email: string }>(`/api/license/activate`, {
      method: "POST", body: JSON.stringify({ key }),
    }),

  // Producer AI keys (user's own Groq key(s) — optional; enable full NL understanding).
  // Multiple keys are supported and rotated through on rate-limit.
  groqKeyStatus: () =>
    req<{ configured: boolean; keys: GroqKeyInfo[] }>(`/api/settings/groq`),
  addGroqKey: (key: string) =>
    req<{ ok: boolean; configured: boolean; keys: GroqKeyInfo[] }>(
      `/api/settings/groq`, { method: "POST", body: JSON.stringify({ key }) }),
  removeGroqKey: (key: string) =>
    req<{ ok: boolean; configured: boolean; keys: GroqKeyInfo[] }>(
      `/api/settings/groq`, { method: "DELETE", body: JSON.stringify({ key }) }),
};

export interface GroqKeyInfo { masked: string; removable: boolean; raw: string | null }

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

"use client";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, fmtTime, type Track, type EffectDef } from "../lib/api";
import { usePlayer } from "../components/PlayerProvider";
import { useProgress } from "../components/ProgressContext";
import Waveform from "../components/Waveform";
import AiNotes from "../components/AiNotes";
import ShareTrack from "../components/ShareTrack";
import VocalRecorder from "../components/VocalRecorder";
import InstrumentStudio from "../components/InstrumentStudio";
import MultitTrackMixer from "../components/MultitTrackMixer";

type Busy = string | null;

export default function EditStudio() {
  const params = useSearchParams();
  const router = useRouter();
  const { play, current, playing, toggle } = usePlayer();
  const progress = useProgress();
  const idParam = params.get("id");

  const [track, setTrack] = useState<Track | null>(null);
  const [versions, setVersions] = useState<Track[]>([]);
  const [effects, setEffects] = useState<EffectDef[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState("");
  // producer-mode chat history (user + assistant turns)
  const [chatLog, setChatLog] = useState<{ role: "you" | "ai"; text: string }[]>([]);

  const loadTrack = useCallback((id: number) => {
    api.track(id).then(t => {
      setTrack(t);
      setNotes(t.notes || "");
      api.versions(id).then(setVersions).catch(() => {});
    }).catch(() => setStatus("❌ Track not found"));
  }, []);

  useEffect(() => {
    api.effects().then(setEffects).catch(() => {});
  }, []);
  useEffect(() => {
    if (idParam) loadTrack(parseInt(idParam));
  }, [idParam, loadTrack]);

  // run an edit op → switch to the new version it produces
  const run = async (key: string, fn: () => Promise<{ id: number; track: Track }>, okMsg: string) => {
    if (!track) return;
    setBusy(key); setStatus(`${okMsg}…`);
    progress.start(`${okMsg}…`);
    try {
      const r = await fn();
      setStatus(`✅ ${okMsg} → #${r.id}`);
      router.replace(`/edit?id=${r.id}`);
      setTrack(r.track);
      setNotes(r.track.notes || "");
      api.versions(r.id).then(setVersions).catch(() => {});
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Stopped" : `❌ ${msg}`);
    } finally {
      setBusy(null);
      progress.finish();
    }
  };

  const onStop = async () => { setStatus("🛑 Stopping…"); try { await api.cancel(); } catch { /* ignore */ } };

  // Streaming "complete the song" — real per-section progress on the top bar.
  const runComplete = async (prompt: string) => {
    if (!track) return;
    setBusy("complete");
    setStatus("Building full song…");
    progress.set(3, "Complete the song · warming up…");
    try {
      const r = await api.completeStream(
        track.id,
        { prompt, model_size: track.model || "small" },
        (p) => {
          const label = p.role === "starting"
            ? "Complete the song · warming up…"
            : `Complete the song · ${p.role} (${p.section}/${p.total})`;
          progress.set(p.pct, label);
        },
      );
      setStatus(`✅ Full song → #${r.id}`);
      router.replace(`/edit?id=${r.id}`);
      setTrack(r.track);
      setNotes(r.track.notes || "");
      api.versions(r.id).then(setVersions).catch(() => {});
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Stopped" : `❌ ${msg}`);
    } finally {
      setBusy(null);
      progress.finish();
    }
  };

  // Build a song from a custom arrangement (structure editor).
  const runStructure = async (sections: { role: string; duration: number }[], prompt: string) => {
    if (!track || !sections.length) return;
    setBusy("structure");
    setStatus("Building your structure…");
    progress.set(3, "Structure…");
    try {
      const r = await api.structure(track.id, sections, prompt, (p) =>
        progress.set(p.pct, p.role === "starting" ? "Structure · warming up…" : `Structure · ${p.role} (${p.section}/${p.total})`));
      setStatus(`✅ Built → #${r.id}`);
      router.replace(`/edit?id=${r.id}`);
      setTrack(r.track);
      setNotes(r.track.notes || "");
      api.versions(r.id).then(setVersions).catch(() => {});
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Stopped" : `❌ ${msg}`);
    } finally {
      setBusy(null);
      progress.finish();
    }
  };

  // Add an AI instrument layer (drums/bass/keys/custom). Same poll pattern.
  const runAddInstrument = async (prompt: string, label: string) => {
    if (!track) return;
    setBusy("add_instrument");
    setStatus(`Adding ${label}…`);
    progress.set(8, `Adding ${label}…`);
    try {
      const r = await api.addInstrument(
        track.id,
        { prompt, model_size: track.model || "small", blend: "smart", volume: 0.7 },
        (p) => progress.set(p.pct, `Adding ${label}… (${p.state})`),
      );
      setStatus(`✅ Added ${label} → #${r.id}`);
      router.replace(`/edit?id=${r.id}`);
      setTrack(r.track);
      setNotes(r.track.notes || "");
      api.versions(r.id).then(setVersions).catch(() => {});
      play(r.track);
    } catch (e) {
      const msg = (e as Error).message || "";
      setStatus(/cancel/i.test(msg) ? "🛑 Stopped" : `❌ ${msg}`);
    } finally {
      setBusy(null);
      progress.finish();
    }
  };

  // Producer-mode chat: send a message, AI edits the track, switch to the result.
  const runChat = async (message: string) => {
    if (!track || !message.trim()) return;
    setChatLog(l => [...l, { role: "you", text: message }]);
    setBusy("chat");
    progress.set(8, "Producer…");
    try {
      const r = await api.chat(track.id, message, (p) => progress.set(p.pct, "Producer…"));
      setChatLog(l => [...l, { role: "ai", text: r.reply }]);
      if (r.track && r.id && !r.no_change) {
        router.replace(`/edit?id=${r.id}`);
        setTrack(r.track);
        setNotes(r.track.notes || "");
        api.versions(r.id).then(setVersions).catch(() => {});
        play(r.track);
        setStatus(`✅ ${r.reply}`);
      } else {
        setStatus("");
      }
    } catch (e) {
      const msg = (e as Error).message || "";
      setChatLog(l => [...l, { role: "ai", text: /cancel/i.test(msg) ? "Stopped." : `Couldn't do that: ${msg}` }]);
    } finally {
      setBusy(null);
      progress.finish();
    }
  };

  // NOTE: there used to be a "kill switch" here that fired /api/cancel on
  // `pagehide`/`beforeunload`. With "Complete the song" now running as a DETACHED
  // background job (start + poll), that handler killed legitimate builds — it
  // fires on tab backgrounding / refresh, not just real navigation, silently
  // cancelling a build mid-section (the "it stops at Verse 1/6" bug). The build
  // is meant to survive page changes; the explicit Stop button is the only way it
  // should be cancelled. So the auto-kill-switch is intentionally removed.
  //
  // (Short single-shot ops like tweak/extend finish in seconds, so there's no
  // real "churning after we're gone" cost to dropping it.)

  if (!track) {
    return (
      <div style={{ padding: 60, textAlign: "center", color: "var(--muted)" }}>
        {status || "Pick a track from the Library to edit."}
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => router.push("/")}>← Back to Library</button>
        </div>
      </div>
    );
  }

  const isCurrent = current?.id === track.id;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 100px",
      display: "grid", gridTemplateColumns: "1fr 320px", gap: 22 }}>
      {/* MAIN */}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* header + player */}
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
            <button onClick={() => isCurrent ? toggle() : play(track)} style={{
              width: 48, height: 48, borderRadius: "50%", border: "none", flexShrink: 0,
              background: "linear-gradient(95deg,var(--accent),var(--accent2))",
              color: "#fff", fontSize: 18, cursor: "pointer"
            }}>{isCurrent && playing ? "⏸" : "▶"}</button>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 18, fontWeight: 800, whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis" }}>{track.title}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 10, marginTop: 2 }}>
                <span>#{track.id} · v{track.version}</span>
                <span>{fmtTime(track.duration)}</span>
                {track.bpm && <span>{Math.round(track.bpm)} BPM · {track.key}</span>}
                <span style={{ textTransform: "uppercase", opacity: .6 }}>{track.model}</span>
              </div>
            </div>
          </div>
          <Waveform key={track.id} trackId={track.id} height={80} color="#1ed760" />
          {track.prompt && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 10,
            fontStyle: "italic" }}>{track.prompt}</div>}
        </div>

        {status && <div style={{ fontSize: 13, padding: "8px 14px", borderRadius: 8,
          background: "var(--bg2)", border: "1px solid var(--line)", display: "flex",
          alignItems: "center", gap: 10,
          color: status.startsWith("✅") ? "var(--green)" : status.startsWith("❌") ? "var(--red)" : "var(--muted)" }}>
          <span style={{ flex: 1 }}>{status}</span>
          {["tweak", "region", "extend", "complete", "add_instrument", "chat", "structure"].includes(busy || "") && (
            <button onClick={onStop} title="Stop now"
              style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, borderRadius: 6,
                background: "var(--red, #ef4444)", color: "#fff", border: "none", cursor: "pointer" }}>
              ■ Stop
            </button>)}
        </div>}

        {/* AI TWEAK */}
        {/* PRODUCER CHAT */}
        <Panel title="💬 Producer — tell the AI what to change">
          <ChatBox busy={busy} log={chatLog} onSend={runChat} />
        </Panel>

        <Panel title="🤖 AI Tweak — describe a change">
          <TweakBox track={track} busy={busy} run={run} />
        </Panel>

        {/* REGION EDITOR */}
        <Panel title="🎯 Region Editor — regenerate a section">
          <RegionBox track={track} busy={busy} run={run} />
        </Panel>

        {/* EXTEND */}
        <Panel title="➕ Extend — continue the track">
          <ExtendBox track={track} busy={busy} run={run} />
        </Panel>

        {/* COMPLETE THE SONG */}
        <Panel title="🎼 Complete the song — build a full arrangement">
          <CompleteBox track={track} busy={busy} onRun={runComplete} />
        </Panel>

        {/* SONG STRUCTURE EDITOR */}
        <Panel title="🧱 Song structure — arrange the sections yourself">
          <StructureBox busy={busy} onRun={runStructure} />
        </Panel>

        {/* ADD INSTRUMENT */}
        <Panel title="🥁 Add an instrument — let AI play along">
          <AddInstrumentBox busy={busy} onRun={runAddInstrument} />
        </Panel>

        {/* QUICK PRESETS */}
        <Panel title="⚡ One-click presets">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {[
              ["bass-boost", "🔊 Bass Boost"],
              ["lofi", "📼 Lo-Fi"],
              ["stream-master", "🎚 Stream Master"],
              ["stereo-widen", "↔ Stereo Widen"],
              ["cut-silence", "✂️ Cut Silence"],
            ].map(([p, label]) => (
              <button key={p} className="btn" disabled={!!busy}
                onClick={() => run(`preset-${p}`, () => api.preset(track.id, p), label as string)}>
                {busy === `preset-${p}` ? <span className="spinner" /> : label}
              </button>
            ))}
            <button className="btn" disabled={!!busy}
              onClick={() => run("normalize", () => api.normalize(track.id), "Normalized")}>
              {busy === "normalize" ? <span className="spinner" /> : "📈 Normalize"}
            </button>
          </div>
        </Panel>

        {/* MASTER FOR PLATFORM */}
        <Panel title="🎚 Master for a platform">
          <MasterBox track={track} busy={busy} run={run} />
        </Panel>

        {/* PITCH / SPEED / FADE */}
        <Panel title="🎛 Pitch · Speed · Fade">
          <PitchSpeedFade track={track} busy={busy} run={run} />
        </Panel>

        {/* EFFECTS */}
        <Panel title="✨ Studio Effects">
          <EffectsBox track={track} effects={effects} busy={busy} run={run} />
        </Panel>

        {/* ARRANGE */}
        <Panel title="🔧 Arrange">
          <ArrangeBox track={track} busy={busy} run={run} />
        </Panel>
      </div>

      {/* SIDEBAR */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <button className="btn" onClick={() => router.push("/")}>← Back to Library</button>

        {/* version history */}
        <VersionsPanel
          versions={versions}
          currentId={track.id}
          onOpen={(id) => { router.replace(`/edit?id=${id}`); loadTrack(id); }}
          onDeleted={(remaining) => setVersions(remaining)}
        />

        {/* duplicate */}
        <button className="btn" disabled={!!busy}
          onClick={() => run("dup", () => api.duplicate(track.id).then(r => api.track(r.id).then(t => ({ id: r.id, track: t }))), "Duplicated")}>
          ⧉ Duplicate (safe copy)
        </button>

        {/* AI producer notes */}
        <div className="card" style={{ padding: 16 }}>
          <AiNotes trackId={track.id} />
        </div>

        {/* Share */}
        <div className="card" style={{ padding: 16 }}>
          <ShareTrack track={track} />
        </div>

        {/* Multitrack mixer */}
        <div className="card" style={{ padding: 16 }}>
          <MultitTrackMixer track={track} onMerged={t => { setTrack(t); play(t); }} />
        </div>

        {/* Live vocal recording */}
        <div className="card" style={{ padding: 16 }}>
          <VocalRecorder track={track} onMerged={t => { setTrack(t); play(t); }} />
        </div>

        {/* Instrument studio */}
        <div className="card" style={{ padding: 16 }}>
          <InstrumentStudio track={track} onMerged={t => { setTrack(t); play(t); }} />
        </div>

        {/* notes */}
        <div className="card" style={{ padding: 16 }}>
          <div className="label" style={{ marginBottom: 8 }}>Notes</div>
          <textarea className="input" rows={4} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Notes about this track…" style={{ resize: "vertical" }} />
          <button className="btn" style={{ marginTop: 8, width: "100%" }}
            onClick={async () => { await api.notes(track.id, notes); setStatus("✅ Notes saved"); }}>
            Save notes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── sub-components ───────────────────────────────────────────────────────────
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );
}

// Short "2h ago" style timestamp from an ISO / sqlite date string.
function timeAgo(iso?: string): string {
  if (!iso) return "";
  const then = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z").getTime();
  if (isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return "just now";
  if (s < 90) return "1 min ago";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function VersionsPanel({ versions, currentId, onOpen, onDeleted }: {
  versions: Track[];
  currentId: number;
  onOpen: (id: number) => void;
  onDeleted: (remaining: Track[]) => void;
}) {
  const { play, toggle, current, playing } = usePlayer();
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  // newest at the top
  const ordered = versions.slice().sort((a, b) => b.version - a.version);
  const latestVersion = ordered.length ? ordered[0].version : 1;

  const del = async (v: Track) => {
    setDeleting(v.id);
    try {
      const r = await api.deleteVersion(currentId, v.id);
      onDeleted(r.versions);
      // if we deleted the one we're editing, jump to the newest remaining
      if (v.id === currentId && r.versions.length) {
        const newest = r.versions.slice().sort((a, b) => b.version - a.version)[0];
        onOpen(newest.id);
      }
    } catch {
      /* guarded server-side; ignore */
    } finally {
      setDeleting(null);
      setConfirmId(null);
    }
  };

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
        <div className="label">Versions</div>
        <div style={{ fontSize: 11, color: "var(--muted2)" }}>
          {versions.length} take{versions.length === 1 ? "" : "s"}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted2)", marginBottom: 12, lineHeight: 1.4 }}>
        Every edit is saved as a new take — nothing is lost. Play any one to compare.
      </div>

      {ordered.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--muted2)" }}>No versions yet.</div>
      )}

      <div style={{ display: "flex", flexDirection: "column", maxHeight: 420, overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
        {ordered.map((v, i) => {
          const isCurrent = v.id === currentId;
          const isPlaying = current?.id === v.id && playing;
          const isOriginal = v.version === 1;
          const isLatest = v.version === latestVersion;
          return (
            <div key={v.id} style={{ display: "flex", gap: 10, position: "relative" }}>
              {/* timeline rail + dot */}
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 14, flexShrink: 0 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: "50%", marginTop: 16, zIndex: 1,
                  background: isCurrent ? "var(--accent)" : "var(--bg3)",
                  border: `2px solid ${isCurrent ? "var(--accent)" : "var(--line)"}`,
                  boxShadow: isCurrent ? "0 0 0 3px color-mix(in srgb, var(--accent) 25%, transparent)" : "none",
                }} />
                {i < ordered.length - 1 && (
                  <div style={{ flex: 1, width: 2, background: "var(--line)", marginTop: 2 }} />
                )}
              </div>

              {/* card */}
              <div
                onClick={() => !isCurrent && onOpen(v.id)}
                style={{
                  flex: 1, marginBottom: 10, borderRadius: 10, padding: "9px 11px",
                  cursor: isCurrent ? "default" : "pointer",
                  background: isCurrent ? "color-mix(in srgb, var(--accent) 10%, var(--bg2))" : "var(--bg2)",
                  border: `1px solid ${isCurrent ? "var(--accent)" : "var(--line)"}`,
                  transition: "border-color .15s, background .15s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* play / pause this version */}
                  <button
                    onClick={(e) => { e.stopPropagation(); current?.id === v.id ? toggle() : play(v); }}
                    title={isPlaying ? "Pause" : "Play this version"}
                    style={{
                      width: 30, height: 30, borderRadius: "50%", flexShrink: 0, border: "none", cursor: "pointer",
                      background: isPlaying ? "var(--accent)" : "var(--bg3)",
                      color: isPlaying ? "#06210f" : "var(--text)", fontSize: 12, lineHeight: 1,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >{isPlaying ? "⏸" : "▶"}</button>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 800 }}>v{v.version}</span>
                      {isCurrent && (
                        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: "#06210f",
                          background: "var(--accent)", borderRadius: 4, padding: "1px 5px" }}>NOW EDITING</span>
                      )}
                      {!isCurrent && isLatest && (
                        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: "var(--accent)",
                          border: "1px solid var(--accent)", borderRadius: 4, padding: "0 5px" }}>LATEST</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap",
                      overflow: "hidden", textOverflow: "ellipsis" }}>
                      {isOriginal ? "🌱 Original" : (v.edit_label || "edit")}
                    </div>
                  </div>

                  <span style={{ fontSize: 10, color: "var(--muted2)", flexShrink: 0 }}>{timeAgo(v.created_at)}</span>
                </div>

                {/* actions row */}
                {confirmId === v.id ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}
                    onClick={(e) => e.stopPropagation()}>
                    <span style={{ fontSize: 11, color: "var(--muted)", flex: 1 }}>Delete this take?</span>
                    <button onClick={() => del(v)} disabled={deleting === v.id}
                      style={{ fontSize: 11, fontWeight: 700, border: "none", borderRadius: 6, cursor: "pointer",
                        padding: "4px 10px", background: "var(--red, #ef4444)", color: "#fff" }}>
                      {deleting === v.id ? "…" : "Delete"}
                    </button>
                    <button onClick={() => setConfirmId(null)}
                      style={{ fontSize: 11, border: "1px solid var(--line)", borderRadius: 6, cursor: "pointer",
                        padding: "4px 10px", background: "transparent", color: "var(--muted)" }}>
                      Keep
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}
                    onClick={(e) => e.stopPropagation()}>
                    {!isCurrent && (
                      <button onClick={() => onOpen(v.id)}
                        style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", background: "none",
                          border: "none", cursor: "pointer", padding: 0 }}>
                        ✎ Edit this take
                      </button>
                    )}
                    <a href={api.downloadUrl(v.id)} onClick={(e) => e.stopPropagation()}
                      style={{ fontSize: 11, color: "var(--muted)", textDecoration: "none" }}>⬇ Download</a>
                    {versions.length > 1 && (
                      <button onClick={() => setConfirmId(v.id)} title="Delete this take"
                        style={{ fontSize: 11, color: "var(--muted2)", background: "none", border: "none",
                          cursor: "pointer", padding: 0, marginLeft: "auto" }}>
                        🗑
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type RunFn = (key: string, fn: () => Promise<{ id: number; track: Track }>, msg: string) => void;

function TweakBox({ track, busy, run }: { track: Track; busy: Busy; run: RunFn }) {
  const [tweak, setTweak] = useState("");
  const [keepVibe, setKeepVibe] = useState(true);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input className="input" value={tweak} onChange={e => setTweak(e.target.value)}
        placeholder='e.g. "less drums, more piano, slower and darker"' />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={keepVibe} onChange={e => setKeepVibe(e.target.checked)}
            style={{ accentColor: "var(--accent)" }} />
          Keep original vibe (use as reference)
        </label>
        <button className="btn btn-primary" disabled={!!busy || !tweak.trim()} style={{ marginLeft: "auto" }}
          onClick={() => run("tweak", () => api.tweak(track.id, { tweak, keep_vibe: keepVibe, model_size: track.model || "small" }), "Tweaked")}>
          {busy === "tweak" ? <span className="spinner" /> : "Apply tweak"}
        </button>
      </div>
    </div>
  );
}

function RegionBox({ track, busy, run }: { track: Track; busy: Busy; run: RunFn }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [prompt, setPrompt] = useState("");
  const parse = (s: string) => {
    s = s.trim();
    if (s.includes(":")) { const [m, sec] = s.split(":"); return parseInt(m) * 60 + parseFloat(sec); }
    return parseFloat(s) || 0;
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        Pick a time range and describe what should be there instead. AI regenerates just that part and crossfades it in.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" value={start} onChange={e => setStart(e.target.value)} placeholder="start (e.g. 0:45)" />
        <input className="input" value={end} onChange={e => setEnd(e.target.value)} placeholder={`end (e.g. ${fmtTime(track.duration)})`} />
      </div>
      <input className="input" value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder='what should this section be? e.g. "add a guitar solo"' />
      <button className="btn btn-primary" disabled={!!busy || !prompt.trim()}
        onClick={() => run("region", () => api.region(track.id, {
          start: parse(start), end: parse(end), prompt, model_size: track.model || "small",
        }), "Region replaced")}>
        {busy === "region" ? <span className="spinner" /> : "Replace region"}
      </button>
    </div>
  );
}

function ExtendBox({ track, busy, run }: { track: Track; busy: Busy; run: RunFn }) {
  const [add, setAdd] = useState(8);
  const [prompt, setPrompt] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input className="input" value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder="how should it continue? (blank = same vibe)" />
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Add {add}s</span>
        <input type="range" min={4} max={30} step={1} value={add}
          onChange={e => setAdd(parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
        <button className="btn btn-primary" disabled={!!busy}
          onClick={() => run("extend", () => api.extend(track.id, { prompt, add_duration: add, model_size: track.model || "small" }), "Extended")}>
          {busy === "extend" ? <span className="spinner" /> : "Extend"}
        </button>
      </div>
    </div>
  );
}

const INSTRUMENT_PRESETS: { key: string; label: string; emoji: string; prompt: string }[] = [
  { key: "drums", label: "Drums", emoji: "🥁", prompt: "add a tight drum kit and groove that locks to this track's tempo and feel" },
  { key: "bass",  label: "Bass",  emoji: "🎸", prompt: "add a bass line that follows this track's groove and key" },
  { key: "keys",  label: "Keys",  emoji: "🎹", prompt: "add a complementary piano / keys part that fits this track's chords and mood" },
];

const CHAT_SUGGESTIONS = ["make it darker", "add drums", "more energy", "make it slower", "add a piano", "master it for streaming"];

function ChatBox({ busy, log, onSend }: {
  busy: Busy; log: { role: "you" | "ai"; text: string }[]; onSend: (m: string) => void;
}) {
  const [msg, setMsg] = useState("");
  const disabled = !!busy;
  const send = () => { if (msg.trim() && !disabled) { onSend(msg.trim()); setMsg(""); } };

  // AI mode: optional user-supplied Groq key unlocks full natural-language
  // understanding. Without it, Producer still works via keyword matching.
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyVal, setKeyVal] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyErr, setKeyErr] = useState("");
  useEffect(() => { api.groqKeyStatus().then(r => setAiOn(r.configured)).catch(() => setAiOn(false)); }, []);
  const saveKey = async () => {
    if (!keyVal.trim()) return;
    setSavingKey(true); setKeyErr("");
    try { const r = await api.addGroqKey(keyVal.trim()); setAiOn(r.configured); setKeyOpen(false); setKeyVal(""); }
    catch (e) { setKeyErr((e as Error).message || "That key didn't work."); }
    setSavingKey(false);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Talk to it like a producer. Each message edits the track and becomes the new
        version — keep going to refine it.
      </div>

      {/* conversation */}
      {log.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 220, overflowY: "auto",
          background: "var(--bg, #0b0e13)", border: "1px solid var(--bg3)", borderRadius: 8, padding: 10 }}>
          {log.map((m, i) => (
            <div key={i} style={{ alignSelf: m.role === "you" ? "flex-end" : "flex-start", maxWidth: "85%" }}>
              <div style={{
                fontSize: 12.5, lineHeight: 1.45, padding: "6px 11px", borderRadius: 12,
                background: m.role === "you" ? "linear-gradient(95deg,var(--accent),var(--accent2))" : "var(--bg3)",
                color: m.role === "you" ? "#06210f" : "var(--text, #e8e8ec)",
                fontWeight: m.role === "you" ? 600 : 400,
              }}>{m.text}</div>
            </div>
          ))}
          {busy === "chat" && (
            <div style={{ alignSelf: "flex-start", fontSize: 12, color: "var(--muted)", display: "flex", gap: 6, alignItems: "center" }}>
              <span className="spinner" /> working on it…
            </div>
          )}
        </div>
      )}

      {/* suggestion chips (only before the first message) */}
      {log.length === 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {CHAT_SUGGESTIONS.map(s => (
            <button key={s} className="btn" disabled={disabled} style={{ fontSize: 11, padding: "4px 10px", color: "var(--muted)" }}
              onClick={() => onSend(s)}>{s}</button>
          ))}
        </div>
      )}

      {/* input */}
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" value={msg} onChange={e => setMsg(e.target.value)}
          placeholder='e.g. "make the drums punchier", "add a breakdown", "warmer and slower"'
          onKeyDown={e => { if (e.key === "Enter") send(); }} />
        <button className="btn btn-primary" disabled={disabled || !msg.trim()} onClick={send}>
          {busy === "chat" ? <span className="spinner" /> : "Send"}
        </button>
      </div>

      {/* AI mode footer — smart understanding via the user's own (optional) Groq key */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)" }}>
        <span style={{
          width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
          background: aiOn ? "#4fd1a5" : "#6c6c78",
        }} />
        {aiOn === null ? "Checking AI mode…"
          : aiOn ? "Smart AI mode on — full natural language."
          : "Basic mode — understands common commands."}
        <button className="btn" style={{ marginLeft: "auto", fontSize: 10, padding: "3px 9px" }}
          onClick={() => setKeyOpen(o => !o)}>
          {aiOn ? "Change key" : "Add AI key"}
        </button>
      </div>
      {keyOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, background: "var(--bg, #0b0e13)", border: "1px solid var(--bg3)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5 }}>
            Adding your free Groq key enhances Producer — it understands nuanced, multi-part
            requests ("make it dreamier and more spacious with a half-time groove") instead of
            just common commands. Free, stored locally, add as many as you like. Get one at{" "}
            <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>console.groq.com/keys</a>.
            Manage all keys in <a href="/settings" style={{ color: "var(--accent)" }}>Settings</a>.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" type="password" value={keyVal} placeholder="gsk_…"
              onChange={e => setKeyVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") saveKey(); }} />
            <button className="btn btn-primary" disabled={savingKey || !keyVal.trim()} onClick={saveKey}>
              {savingKey ? <span className="spinner" /> : "Verify & add"}
            </button>
          </div>
          {keyErr && <div style={{ fontSize: 11, color: "#e0564e" }}>{keyErr}</div>}
        </div>
      )}
    </div>
  );
}

const SECTION_TYPES = ["Intro", "Verse", "Chorus", "Bridge", "Drop", "Outro"];
const SECTION_COLOR: Record<string, string> = {
  Intro: "#5b9bd5", Verse: "#4fd1a5", Chorus: "#e0954f",
  Bridge: "#b06ec4", Drop: "#d56b8a", Outro: "#7a8ad5",
};

function StructureBox({ busy, onRun }: { busy: Busy; onRun: (sections: { role: string; duration: number }[], prompt: string) => void }) {
  const [sections, setSections] = useState<{ role: string; duration: number }[]>([
    { role: "Verse", duration: 12 }, { role: "Chorus", duration: 14 },
    { role: "Verse", duration: 12 }, { role: "Outro", duration: 10 },
  ]);
  const [prompt, setPrompt] = useState("");
  const disabled = !!busy;
  const total = sections.reduce((s, x) => s + x.duration, 0);

  const move = (i: number, dir: -1 | 1) => setSections(s => {
    const j = i + dir; if (j < 0 || j >= s.length) return s;
    const n = [...s]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const remove = (i: number) => setSections(s => s.filter((_, k) => k !== i));
  const setLen = (i: number, d: number) => setSections(s => s.map((x, k) => k === i ? { ...x, duration: d } : x));
  const setRole = (i: number, r: string) => setSections(s => s.map((x, k) => k === i ? { ...x, role: r } : x));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Lay out the song your way — order the sections, set each length, then build.
        Total: <b style={{ color: "var(--text, #e8e8ec)" }}>~{total}s</b>.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sections.map((s, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg, #0b0e13)",
            border: `1px solid ${SECTION_COLOR[s.role] || "var(--bg3)"}55`, borderRadius: 8, padding: "6px 8px" }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: SECTION_COLOR[s.role], flexShrink: 0 }} />
            <select className="input" style={{ width: "auto", fontSize: 12 }} value={s.role} onChange={e => setRole(i, e.target.value)}>
              {SECTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input type="range" min={4} max={24} step={1} value={s.duration}
              onChange={e => setLen(i, parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
            <span style={{ fontSize: 11, color: "var(--muted)", minWidth: 28, fontFamily: "var(--mono, monospace)" }}>{s.duration}s</span>
            <button className="btn" style={{ padding: "2px 7px", fontSize: 10 }} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
            <button className="btn" style={{ padding: "2px 7px", fontSize: 10 }} disabled={i === sections.length - 1} onClick={() => move(i, 1)}>▼</button>
            <button className="btn" style={{ padding: "2px 7px", fontSize: 11, color: "var(--red)" }} onClick={() => remove(i)}>✕</button>
          </div>
        ))}
      </div>

      {/* add section chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {SECTION_TYPES.map(t => (
          <button key={t} className="btn" disabled={disabled || sections.length >= 12} style={{ fontSize: 11, padding: "4px 10px", color: SECTION_COLOR[t] }}
            onClick={() => setSections(s => [...s, { role: t, duration: t === "Chorus" ? 14 : 12 }])}>+ {t}</button>
        ))}
      </div>

      <input className="input" value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder="overall direction? (blank = same vibe as this track)" />
      <button className="btn btn-primary" disabled={disabled || !sections.length}
        onClick={() => onRun(sections, prompt)}>
        {busy === "structure" ? <span className="spinner" /> : `🧱 Build this structure (${sections.length} sections)`}
      </button>
      <div style={{ fontSize: 11, color: "var(--muted)", opacity: .8 }}>
        Each section is generated to flow from the last — takes a few minutes. Saves to “Full Songs”.
      </div>
    </div>
  );
}

function MasterBox({ track, busy, run }: { track: Track; busy: Busy; run: RunFn }) {
  const [platforms, setPlatforms] = useState<{ key: string; label: string; lufs: number }[]>([]);
  useEffect(() => { api.masterPlatforms().then(setPlatforms).catch(() => {}); }, []);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        One-click master tuned for where it'll be heard — sets the right loudness
        (LUFS) and tone for each destination. Saves a new version.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {platforms.map(p => (
          <button key={p.key} className="btn" disabled={!!busy}
            style={{ fontSize: 12, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, padding: "8px 12px" }}
            onClick={() => run(`master-${p.key}`, () => api.master(track.id, p.key), `Mastered for ${p.label}`)}>
            {busy === `master-${p.key}` ? <span className="spinner" /> : (
              <>
                <span style={{ fontWeight: 700 }}>{p.label}</span>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{p.lufs} LUFS</span>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function AddInstrumentBox({ busy, onRun }: { busy: Busy; onRun: (prompt: string, label: string) => void }) {
  const [custom, setCustom] = useState("");
  const disabled = !!busy;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        No drummer? No bassist? AI listens to your track and plays along — matching the
        tempo and feel — then mixes the new part in. Saves as a new version.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {INSTRUMENT_PRESETS.map(p => (
          <button key={p.key} className="btn" disabled={disabled}
            style={{ flex: "1 1 90px", padding: "10px 0", fontSize: 13, fontWeight: 600,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
            onClick={() => onRun(p.prompt, p.label)}>
            {busy === "add_instrument" ? <span className="spinner" /> : <>{p.emoji} {p.label}</>}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input className="input" value={custom} onChange={e => setCustom(e.target.value)}
          placeholder='or describe it — e.g. "add a saxophone solo", "add strings"'
          onKeyDown={e => { if (e.key === "Enter" && custom.trim() && !disabled) onRun(`add ${custom.trim()} that fits this track`, custom.trim()); }} />
        <button className="btn btn-primary" disabled={disabled || !custom.trim()}
          onClick={() => onRun(`add ${custom.trim()} that fits this track`, custom.trim())}>
          {busy === "add_instrument" ? <span className="spinner" /> : "Add"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--muted)", opacity: .8 }}>
        Takes a minute or two — watch the top bar. Works best on tracks with a clear groove.
      </div>
    </div>
  );
}

function CompleteBox({ track, busy, onRun }: { track: Track; busy: Busy; onRun: (prompt: string) => void }) {
  const [prompt, setPrompt] = useState("");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--muted)" }}>
        Builds this take into a full ~72s song that flows from it:
        verse → chorus → verse → bridge → chorus → outro. Keeps the same vibe.
      </div>
      <input className="input" value={prompt} onChange={e => setPrompt(e.target.value)}
        placeholder="any direction for the full song? (blank = same vibe)" />
      <button className="btn btn-primary" disabled={!!busy}
        onClick={() => onRun(prompt)}>
        {busy === "complete" ? <span className="spinner" /> : "🎼 Complete the song"}
      </button>
      <div style={{ fontSize: 11, color: "var(--muted)", opacity: .8 }}>
        Generates 6 sections — takes a few minutes. Watch the top bar for
        real progress. Saves to “Full Songs”.
      </div>
    </div>
  );
}

function PitchSpeedFade({ track, busy, run }: { track: Track; busy: Busy; run: RunFn }) {
  const [semi, setSemi] = useState(0);
  const [speed, setSpeed] = useState(100);
  const [fin, setFin] = useState(0);
  const [fout, setFout] = useState(0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Row label={`Pitch · ${semi > 0 ? "+" : ""}${semi} st`}>
        <input type="range" min={-12} max={12} step={1} value={semi}
          onChange={e => setSemi(parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
        <button className="btn" disabled={!!busy || semi === 0}
          onClick={() => run("pitch", () => api.pitch(track.id, semi), `Pitch ${semi > 0 ? "+" : ""}${semi}st`)}>
          {busy === "pitch" ? <span className="spinner" /> : "Apply"}
        </button>
      </Row>
      <Row label={`Speed · ${speed}%`}>
        <input type="range" min={50} max={150} step={5} value={speed}
          onChange={e => setSpeed(parseInt(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
        <button className="btn" disabled={!!busy || speed === 100}
          onClick={() => run("speed", () => api.speed(track.id, speed), `Speed ${speed}%`)}>
          {busy === "speed" ? <span className="spinner" /> : "Apply"}
        </button>
      </Row>
      <Row label={`Fade in ${fin}s · out ${fout}s`}>
        <input type="range" min={0} max={8} step={0.5} value={fin}
          onChange={e => setFin(parseFloat(e.target.value))} style={{ flex: 1, accentColor: "var(--accent)" }} />
        <input type="range" min={0} max={8} step={0.5} value={fout}
          onChange={e => setFout(parseFloat(e.target.value))} style={{ flex: 1, accentColor: "var(--accent2)" }} />
        <button className="btn" disabled={!!busy || (fin === 0 && fout === 0)}
          onClick={() => run("fade", () => api.fade(track.id, fin, fout), "Fade applied")}>
          {busy === "fade" ? <span className="spinner" /> : "Apply"}
        </button>
      </Row>
    </div>
  );
}

function EffectsBox({ track, effects, busy, run }: {
  track: Track; effects: EffectDef[]; busy: Busy; run: RunFn;
}) {
  const [sel, setSel] = useState("");
  const [vals, setVals] = useState<Record<string, number>>({});
  const def = effects.find(e => e.name === sel);

  useEffect(() => {
    if (def) {
      const v: Record<string, number> = {};
      def.params.forEach(p => v[p.key] = p.default);
      setVals(v);
    }
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <select className="input" value={sel} onChange={e => setSel(e.target.value)}>
        <option value="">Choose an effect…</option>
        {effects.map(e => <option key={e.name} value={e.name}>{e.name}</option>)}
      </select>
      {def && def.params.map(p => (
        <Row key={p.key} label={`${p.label} · ${(vals[p.key] ?? p.default)}`}>
          <input type="range" min={p.min} max={p.max} step={(p.max - p.min) / 100}
            value={vals[p.key] ?? p.default}
            onChange={e => setVals(v => ({ ...v, [p.key]: parseFloat(e.target.value) }))}
            style={{ flex: 1, accentColor: "var(--accent)" }} />
        </Row>
      ))}
      {def && (
        <button className="btn btn-primary" disabled={!!busy}
          onClick={() => run("effect", () => api.effect(track.id, sel, vals), `Applied ${sel}`)}>
          {busy === "effect" ? <span className="spinner" /> : `Apply ${sel}`}
        </button>
      )}
    </div>
  );
}

function ArrangeBox({ track, busy, run }: { track: Track; busy: Busy; run: RunFn }) {
  const [stretch, setStretch] = useState(1.0);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <button className="btn" disabled={!!busy}
        onClick={() => run("reverse", () => api.arrange(track.id, "reverse"), "Reversed")}>
        {busy === "reverse" ? <span className="spinner" /> : "⏪ Reverse"}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Stretch {stretch.toFixed(2)}x</span>
        <input type="range" min={0.5} max={2} step={0.05} value={stretch}
          onChange={e => setStretch(parseFloat(e.target.value))} style={{ width: 90, accentColor: "var(--accent)" }} />
        <button className="btn" disabled={!!busy || stretch === 1}
          onClick={() => run("stretch", () => api.arrange(track.id, "stretch", stretch), `Stretched ${stretch}x`)}>
          {busy === "stretch" ? <span className="spinner" /> : "Apply"}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{children}</div>
    </div>
  );
}

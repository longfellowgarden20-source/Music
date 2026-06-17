"use client";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, API, fmtTime, type Track, type EffectDef } from "../lib/api";
import { usePlayer } from "../components/PlayerProvider";
import { useProgress } from "../components/ProgressContext";
import Waveform from "../components/Waveform";
import AiNotes from "../components/AiNotes";
import ShareTrack from "../components/ShareTrack";
import VocalRecorder from "../components/VocalRecorder";
import InstrumentStudio from "../components/InstrumentStudio";

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

  // Kill switch: if an op is running and the tab is closed/left, tell the backend
  // to stop so generation doesn't keep churning after we're gone.
  useEffect(() => {
    if (!busy) return;
    const stop = () => { try { navigator.sendBeacon(`${API}/api/cancel`); } catch { /* ignore */ } };
    window.addEventListener("pagehide", stop);
    window.addEventListener("beforeunload", stop);
    return () => {
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("beforeunload", stop);
    };
  }, [busy]);

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
          {["tweak", "region", "extend", "complete"].includes(busy || "") && (
            <button onClick={onStop} title="Stop now"
              style={{ padding: "5px 12px", fontSize: 12, fontWeight: 700, borderRadius: 6,
                background: "var(--red, #ef4444)", color: "#fff", border: "none", cursor: "pointer" }}>
              ■ Stop
            </button>)}
        </div>}

        {/* AI TWEAK */}
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
          <CompleteBox track={track} busy={busy} run={run} />
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
        <div className="card" style={{ padding: 16 }}>
          <div className="label" style={{ marginBottom: 10 }}>Version history</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
            {versions.length === 0 && <div style={{ fontSize: 12, color: "var(--muted2)" }}>No versions yet.</div>}
            {versions.slice().reverse().map(v => (
              <button key={v.id} onClick={() => { router.replace(`/edit?id=${v.id}`); loadTrack(v.id); }}
                style={{
                  textAlign: "left", background: v.id === track.id ? "var(--bg3)" : "transparent",
                  border: `1px solid ${v.id === track.id ? "var(--accent)" : "var(--line)"}`,
                  borderRadius: 8, padding: "7px 10px", cursor: "pointer", color: "var(--text)"
                }}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>v{v.version} · #{v.id}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{v.edit_label || "original"}</div>
              </button>
            ))}
          </div>
        </div>

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

function CompleteBox({ track, busy, run }: { track: Track; busy: Busy; run: RunFn }) {
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
        onClick={() => run("complete", () => api.complete(track.id,
          { prompt, model_size: track.model || "small" }), "Completed song")}>
        {busy === "complete" ? <span className="spinner" /> : "🎼 Complete the song"}
      </button>
      <div style={{ fontSize: 11, color: "var(--muted)", opacity: .8 }}>
        Generates 6 sections — takes a few minutes on CPU. Saves to “Full Songs”.
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

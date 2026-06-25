"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { C, mono, ui, withAlpha } from "./theme";
import type { DawEngine } from "./useDawEngine";

interface Props {
  engine: DawEngine;
  recording: boolean;
  bpm: number;
  // returns true if recording actually started
  onStart: (opts: { deviceId?: string; alongTransport: boolean }) => Promise<boolean>;
  onStop: () => void;
}

type Phase = "idle" | "counting" | "recording";

export default function VocalRecorder({ engine, recording, bpm, onStart, onStop }: Props) {
  const [devices, setDevices]       = useState<{ id: string; label: string }[]>([]);
  const [deviceId, setDeviceId]     = useState<string>("");
  const [monitoring, setMonitoring] = useState(false);
  const [alongBeat, setAlongBeat]   = useState(true);
  const [countIn, setCountIn]       = useState(true);
  const [level, setLevel]           = useState(0);
  const [phase, setPhase]           = useState<Phase>("idle");
  const [countNum, setCountNum]     = useState(0);
  const [elapsed, setElapsed]       = useState(0);
  const [micReady, setMicReady]     = useState(false);
  const [err, setErr]               = useState("");

  const rafRef     = useRef<number>(0);
  const elapsedRef = useRef<number>(0);
  const phaseRef   = useRef<Phase>("idle");
  const recordingRef = useRef(recording);
  useEffect(() => { phaseRef.current = phase; recordingRef.current = recording; }, [phase, recording]);

  // Open the mic (for metering + monitoring).
  const ensureMic = useCallback(async (id?: string) => {
    const res = await engine.openMicDetailed(id);
    setMicReady(res.ok);
    if (!res.ok) {
      // Distinguish OS-level denial (macOS Privacy settings) from a browser prompt
      // dismissal — they need different fixes.
      if (res.reason === "system") {
        setErr("macOS is blocking mic access. Open System Settings → Privacy & Security → Microphone, enable your browser, then fully quit & reopen it.");
      } else if (res.reason === "denied") {
        setErr("Mic permission was blocked. Click the 🔒/camera icon in the address bar, allow the microphone, then click Enable Microphone.");
      } else {
        setErr("No microphone found. Plug one in and click Enable Microphone.");
      }
    } else {
      setErr("");
      const list = await engine.listInputDevices();
      setDevices(list);
    }
    return res.ok;
  }, [engine]);

  // Clean up the mic on unmount. We do NOT auto-open on mount — opening the mic
  // triggers the OS/browser permission request, which should happen on an explicit
  // user click (the "Enable Microphone" button), not silently when the tab opens.
  useEffect(() => {
    return () => { engine.closeMic(); engine.setMonitoring(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Single rAF loop: input meter + elapsed timer + external-stop detection.
  // Reads refs so it never needs to re-subscribe, and setState here is in a
  // callback (the recommended "subscribe to external system" pattern).
  useEffect(() => {
    const loop = () => {
      setLevel(engine.getInputLevel());
      // If recording was stopped externally (R-key/transport), reset our phase.
      if (phaseRef.current === "recording" && !recordingRef.current) {
        setPhase("idle");
      } else if (phaseRef.current === "recording") {
        elapsedRef.current += 1 / 60;
        setElapsed(elapsedRef.current);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [engine]);

  // Apply monitoring toggle
  useEffect(() => { engine.setMonitoring(monitoring); }, [engine, monitoring]);

  const handleDeviceChange = async (id: string) => {
    setDeviceId(id);
    await ensureMic(id);
    engine.setMonitoring(monitoring);
  };

  const beginRecording = useCallback(async () => {
    elapsedRef.current = 0;
    setElapsed(0);
    const ok = await onStart({ deviceId: deviceId || undefined, alongTransport: alongBeat });
    if (ok) setPhase("recording");
    else { setPhase("idle"); setErr("Couldn't start recording."); }
  }, [onStart, deviceId, alongBeat]);

  const handleRecordClick = useCallback(async () => {
    if (phase === "recording" || recording) {
      onStop();
      setPhase("idle");
      return;
    }
    if (!micReady) { const ok = await ensureMic(deviceId || undefined); if (!ok) return; }

    if (countIn) {
      // 4-beat count-in at current BPM
      setPhase("counting");
      const beatMs = 60000 / Math.max(40, bpm);
      let n = 4;
      setCountNum(n);
      const tick = () => {
        n -= 1;
        if (n <= 0) { beginRecording(); return; }
        setCountNum(n);
        setTimeout(tick, beatMs);
      };
      setTimeout(tick, beatMs);
    } else {
      beginRecording();
    }
  }, [phase, recording, micReady, countIn, bpm, deviceId, beginRecording, ensureMic, onStop]);

  const recActive = phase === "recording" || recording;

  return (
    <div style={{
      height: 210, borderTop: `1px solid ${C.line}`,
      background: C.bg1, display: "flex", fontFamily: ui, overflow: "hidden",
    }}>
      {/* LEFT — big record button + meter */}
      <div style={{
        width: 220, flexShrink: 0, borderRight: `1px solid ${C.line}`,
        padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
      }}>
        <button
          onClick={handleRecordClick}
          disabled={phase === "counting"}
          style={{
            width: 78, height: 78, borderRadius: "50%", cursor: phase === "counting" ? "default" : "pointer",
            border: `2px solid ${recActive ? C.rec : C.lineBright}`,
            background: recActive
              ? `radial-gradient(circle, ${C.rec}, ${C.recDim})`
              : `radial-gradient(circle, ${C.bg4}, ${C.bg2})`,
            boxShadow: recActive ? `0 0 22px ${withAlpha(C.rec, 0.6)}` : "inset 0 1px 0 rgba(255,255,255,0.06)",
            color: "#fff", fontSize: 13, fontWeight: 800, letterSpacing: 0.5,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all .15s",
          }}>
          {phase === "counting" ? countNum : recActive ? "STOP" : "REC"}
        </button>

        <div style={{ fontSize: 11, color: recActive ? C.rec : C.text3, fontWeight: 700, fontFamily: mono }}>
          {phase === "counting" ? "Count-in…" : recActive ? fmt(elapsed) : "Ready"}
        </div>

        {/* Input level meter */}
        <div style={{ width: "100%" }}>
          <div style={{ fontSize: 8, color: C.text3, fontWeight: 700, letterSpacing: 1, marginBottom: 4 }}>INPUT LEVEL</div>
          <div style={{ height: 10, borderRadius: 3, background: C.bg0, overflow: "hidden", boxShadow: "inset 0 1px 2px rgba(0,0,0,0.6)" }}>
            <div style={{
              height: "100%", width: `${Math.round(level * 100)}%`,
              background: level > 0.92 ? C.meterHigh : level > 0.75 ? C.meterMid : C.meterLow,
              transition: "width .05s linear",
            }} />
          </div>
          {level > 0.95 && <div style={{ fontSize: 8, color: C.rec, marginTop: 3, fontWeight: 700 }}>⚠ Too hot — back off the mic</div>}
        </div>

        {/* Enable mic — only shown until the mic is granted */}
        {!micReady && (
          <button onClick={() => ensureMic(deviceId || undefined)} style={{
            width: "100%", padding: "8px 0", borderRadius: 6, cursor: "pointer",
            border: `1px solid ${C.accent}`, background: withAlpha(C.accent, 0.14),
            color: C.accent, fontSize: 11, fontWeight: 800, fontFamily: ui,
          }}>
            🎤 Enable Microphone
          </button>
        )}
      </div>

      {/* RIGHT — settings */}
      <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, color: C.accent, textTransform: "uppercase" }}>
          Vocal Recorder
        </div>

        {/* Mic device */}
        <label style={row}>
          <span style={lbl}>Microphone</span>
          <select
            value={deviceId}
            onChange={e => handleDeviceChange(e.target.value)}
            style={{
              flex: 1, minWidth: 0, background: C.bg3, color: C.text, fontSize: 11,
              border: `1px solid ${C.line}`, borderRadius: 5, padding: "5px 8px", fontFamily: ui, cursor: "pointer",
            }}>
            <option value="">System default</option>
            {devices.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        </label>

        {/* Toggles */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Toggle label="Monitor (hear self)" on={monitoring} onClick={() => setMonitoring(v => !v)} warn={monitoring} />
          <Toggle label="Record over beat" on={alongBeat} onClick={() => setAlongBeat(v => !v)} />
          <Toggle label="4-beat count-in" on={countIn} onClick={() => setCountIn(v => !v)} />
        </div>

        {monitoring && (
          <div style={{ fontSize: 9, color: C.warn, lineHeight: 1.4 }}>
            Use headphones while monitoring — speakers will cause feedback howl.
          </div>
        )}

        <div style={{ fontSize: 10, color: C.text3, lineHeight: 1.5, marginTop: "auto" }}>
          Recording lands as a new track. Add <b style={{ color: C.text2 }}>Reverb, Delay, De-Esser, Doubler &amp; Pitch</b> from the
          Effects tab to shape the vocal.
        </div>

        {err && <div style={{ fontSize: 10, color: C.rec, fontWeight: 600 }}>{err}</div>}
      </div>
    </div>
  );
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10 };
const lbl: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: C.text3, width: 80, flexShrink: 0, letterSpacing: 0.5 };

function Toggle({ label, on, onClick, warn }: { label: string; on: boolean; onClick: () => void; warn?: boolean }) {
  const color = warn && on ? C.warn : C.accent;
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
      padding: "6px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700, fontFamily: ui,
      border: `1px solid ${on ? color : C.line}`,
      background: on ? withAlpha(color, 0.12) : C.bg2,
      color: on ? color : C.text3,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: on ? color : C.text4, boxShadow: on ? `0 0 6px ${color}` : "none",
      }} />
      {label}
    </button>
  );
}

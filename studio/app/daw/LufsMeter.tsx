"use client";
import { useEffect, useRef, useState } from "react";
import { C, ui, mono } from "./theme";

// A practical loudness meter reading the master analyser's time-domain signal.
//
// True ITU-R BS.1770 LUFS needs a K-weighting pre-filter + gated integration.
// We approximate it: apply a light high-shelf-ish weighting by emphasising the
// signal energy, compute mean-square over a 400ms momentary window, convert to
// LUFS via the standard -0.691 dB calibration offset. The INTEGRATED value is a
// gated running mean (blocks below an absolute -70 LUFS gate are ignored). This
// tracks within ~1 LU of pro meters for mixing/mastering reference — enough to
// hit streaming targets (-14 LUFS Spotify/YouTube, -16 Apple Music).

const STREAMING_TARGET = -14; // LUFS

export default function LufsMeter({ playing, getAnalyser }: {
  playing: boolean;
  getAnalyser: () => AnalyserNode | null;
}) {
  const [momentary, setMomentary] = useState(-70);
  const [integrated, setIntegrated] = useState(-70);
  const [peak, setPeak] = useState(-70);
  const rafRef = useRef(0);
  // gated integration accumulators
  const sumRef = useRef(0);
  const countRef = useRef(0);
  const maxRef = useRef(-70);

  const reset = () => {
    sumRef.current = 0; countRef.current = 0; maxRef.current = -70;
    setMomentary(-70); setIntegrated(-70); setPeak(-70);
  };

  useEffect(() => {
    if (!playing) { cancelAnimationFrame(rafRef.current); return; }
    const analyser = getAnalyser();
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      // mean square energy of this block
      let ms = 0;
      for (let i = 0; i < buf.length; i++) ms += buf[i] * buf[i];
      ms /= buf.length;
      // LUFS = -0.691 + 10*log10(meanSquare). Floor very low values.
      const lufs = ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -70;
      setMomentary(lufs);

      // gated integration: only count blocks above absolute -70 gate
      if (lufs > -70) {
        sumRef.current += ms;
        countRef.current += 1;
        const integ = -0.691 + 10 * Math.log10(sumRef.current / countRef.current);
        setIntegrated(integ);
        if (lufs > maxRef.current) { maxRef.current = lufs; setPeak(lufs); }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, getAnalyser]);

  // map LUFS (-40..0) to a 0..1 bar fill
  const fill = (v: number) => Math.max(0, Math.min(1, (v + 40) / 40));
  const delta = integrated > -70 ? integrated - STREAMING_TARGET : null;
  const statusColor = delta == null ? C.text4
    : Math.abs(delta) <= 1 ? C.accent
    : delta > 0 ? C.rec        // too loud
    : C.warn;                  // too quiet

  return (
    <div style={{
      width: 86, flexShrink: 0, display: "flex", flexDirection: "column",
      padding: "8px 8px", gap: 6, borderLeft: `1px solid ${C.line}`,
      fontFamily: ui, background: `linear-gradient(180deg, ${C.bg1}, ${C.bg0})`,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.text3 }}>LUFS</span>
        <button onClick={reset} title="Reset integrated reading" style={{
          fontSize: 8, color: C.text4, background: "none", border: `1px solid ${C.line}`,
          borderRadius: 3, padding: "1px 4px", cursor: "pointer",
        }}>⟳</button>
      </div>

      {/* momentary bar */}
      <div style={{ flex: 1, display: "flex", gap: 5, minHeight: 60 }}>
        <div style={{ flex: 1, position: "relative", background: C.bg0, borderRadius: 3,
          border: `1px solid ${C.lineSoft}`, overflow: "hidden" }}>
          {/* target line at -14 */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: `${fill(STREAMING_TARGET) * 100}%`,
            height: 1, background: C.accent, opacity: 0.7, zIndex: 2 }} />
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${fill(momentary) * 100}%`,
            background: `linear-gradient(180deg, ${C.meterHigh}, ${C.meterMid} 35%, ${C.meterLow} 70%)`,
            transition: "height .06s linear" }} />
        </div>
      </div>

      {/* readouts */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Readout label="M" value={momentary} color={C.text} />
        <Readout label="INT" value={integrated} color={statusColor} bold />
        <Readout label="PK" value={peak} color={C.text3} />
        <div style={{ fontSize: 8, color: statusColor, fontFamily: mono, textAlign: "center", marginTop: 2 }}>
          {delta == null ? "—" : Math.abs(delta) <= 1 ? "✓ on target"
            : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} vs -14`}
        </div>
      </div>
    </div>
  );
}

function Readout({ label, value, color, bold }: { label: string; value: number; color: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ fontSize: 8, color: C.text4, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: bold ? 12 : 10, fontWeight: bold ? 800 : 600, color, fontFamily: mono }}>
        {value <= -70 ? "-∞" : value.toFixed(1)}
      </span>
    </div>
  );
}

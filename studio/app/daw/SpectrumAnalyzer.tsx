"use client";
import { useRef, useEffect, useCallback } from "react";
import { C, withAlpha } from "./theme";

interface Props {
  playing: boolean;
  getAnalyser: () => AnalyserNode | null;
}

const FREQ_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

export default function SpectrumAnalyzer({ playing, getAnalyser }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const peakHoldRef = useRef<Float32Array | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = getAnalyser();
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;

    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(8,10,14,1)";
    ctx.fillRect(0, 0, W, H);

    const AXIS_H = 16;
    const plotH = H - AXIS_H;
    const DB_MIN = -90;
    const DB_MAX = 0;

    // dB grid lines
    for (const db of [-72, -60, -48, -36, -24, -12]) {
      const y = plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.font = "8px 'SF Mono', monospace";
      ctx.fillText(`${db}`, 2, y - 2);
    }

    if (!analyser) {
      // No analyser yet — draw flat line + "waiting" label
      ctx.strokeStyle = withAlpha(C.accent, 0.2);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, plotH); ctx.lineTo(W, plotH); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.font = "10px 'Inter', system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Play to activate spectrum", W / 2, plotH / 2);
      ctx.textAlign = "left";
      drawAxis(ctx, W, H, plotH, analyser);
      return;
    }

    const nyquist = analyser.context.sampleRate / 2;
    const binCount = analyser.frequencyBinCount;
    const data = new Float32Array(binCount);
    analyser.getFloatFrequencyData(data);

    // Freq grid lines
    for (const freq of FREQ_LABELS) {
      const x = freqToX(freq, W, nyquist);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke();
    }

    const cols = Math.ceil(W);
    if (!peakHoldRef.current || peakHoldRef.current.length !== cols) {
      peakHoldRef.current = new Float32Array(cols).fill(DB_MIN);
    }
    const peaks = peakHoldRef.current;

    // Build spectrum path — one column per CSS pixel, logarithmic frequency mapping
    ctx.beginPath();
    let first = true;
    for (let col = 0; col < cols; col++) {
      const logMin = Math.log10(20);
      const logMax = Math.log10(nyquist);
      const freq = Math.pow(10, logMin + (col / cols) * (logMax - logMin));
      const binIdx = Math.round((freq / nyquist) * binCount);
      let sum = 0, count = 0;
      for (let b = Math.max(0, binIdx - 1); b <= Math.min(binCount - 1, binIdx + 1); b++) {
        sum += data[b]; count++;
      }
      const db = Math.max(DB_MIN, Math.min(DB_MAX, count ? sum / count : DB_MIN));
      const y = plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
      if (first) { ctx.moveTo(col, y); first = false; } else ctx.lineTo(col, y);
      // Peak hold: rise instantly, decay slowly
      if (db > peaks[col]) peaks[col] = db;
      else peaks[col] = Math.max(db, peaks[col] - 0.3);
    }
    ctx.lineTo(W, plotH);
    ctx.lineTo(0, plotH);
    ctx.closePath();

    // Filled gradient body
    const fillGrad = ctx.createLinearGradient(0, 0, 0, plotH);
    fillGrad.addColorStop(0,   withAlpha(C.accent, 0.85));
    fillGrad.addColorStop(0.4, withAlpha(C.accent, 0.45));
    fillGrad.addColorStop(0.8, withAlpha("#5fa8c4", 0.2));
    fillGrad.addColorStop(1,   "rgba(0,0,0,0)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // Bright top edge
    ctx.strokeStyle = withAlpha(C.accent, 0.9);
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Peak hold dots
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let col = 0; col < cols; col += 2) {
      const db = peaks[col];
      if (db > DB_MIN + 2) {
        const y = plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
        ctx.fillRect(col, y - 0.5, 1.5, 1);
      }
    }

    drawAxis(ctx, W, H, plotH, analyser);
  }, [getAnalyser]);

  // Always-running rAF loop so it draws idle state and animates during playback
  useEffect(() => {
    const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderBottom: `1px solid ${C.line}`, flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.accent }}>SPECTRUM</span>
        <span style={{ fontSize: 8, color: C.text4 }}>20Hz – 20kHz · LOG</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: playing ? C.accent : C.text4,
            boxShadow: playing ? `0 0 6px ${C.accent}` : "none", transition: "all .3s" }} />
          <span style={{ fontSize: 8, color: playing ? C.accent : C.text4 }}>{playing ? "LIVE" : "IDLE"}</span>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ flex: 1, width: "100%", display: "block" }} />
    </div>
  );
}

function freqToX(freq: number, width: number, nyquist: number): number {
  const logMin = Math.log10(20);
  const logMax = Math.log10(nyquist);
  return ((Math.log10(Math.max(20, freq)) - logMin) / (logMax - logMin)) * width;
}

function drawAxis(ctx: CanvasRenderingContext2D, W: number, H: number, plotH: number, analyser: AnalyserNode | null) {
  const nyquist = analyser ? analyser.context.sampleRate / 2 : 22050;
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.font = "8px 'SF Mono', monospace";
  ctx.textAlign = "center";
  for (const freq of FREQ_LABELS) {
    const x = freqToX(freq, W, nyquist);
    const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
    ctx.fillText(label, x, H - 3);
  }
  ctx.textAlign = "left";
}

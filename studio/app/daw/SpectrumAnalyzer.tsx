"use client";
import { useRef, useEffect, useCallback } from "react";
import { C, withAlpha } from "./theme";

interface Props {
  playing: boolean;
  getAnalyser: () => AnalyserNode | null;
}

const FREQ_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const DB_MIN = -90;
const DB_MAX = 0;
const AXIS_H = 18;

// Map a dB value to an RGB color: deep blue → cyan → green → yellow → red
function dbToColor(db: number, alpha = 1): string {
  const t = Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)));
  let r: number, g: number, b: number;
  if (t < 0.25) {
    // dark blue → cyan
    const s = t / 0.25;
    r = 0; g = Math.round(180 * s); b = Math.round(120 + 135 * s);
  } else if (t < 0.5) {
    // cyan → green
    const s = (t - 0.25) / 0.25;
    r = 0; g = Math.round(180 + 75 * s); b = Math.round(255 * (1 - s));
  } else if (t < 0.75) {
    // green → yellow
    const s = (t - 0.5) / 0.25;
    r = Math.round(255 * s); g = 255; b = 0;
  } else {
    // yellow → red
    const s = (t - 0.75) / 0.25;
    r = 255; g = Math.round(255 * (1 - s)); b = 0;
  }
  return `rgba(${r},${g},${b},${alpha})`;
}

function freqToX(freq: number, width: number, nyquist: number): number {
  const logMin = Math.log10(20);
  const logMax = Math.log10(nyquist);
  return ((Math.log10(Math.max(20, freq)) - logMin) / (logMax - logMin)) * width;
}

export default function SpectrumAnalyzer({ playing, getAnalyser }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const rafRef      = useRef<number>(0);
  const peakDbRef   = useRef<Float32Array | null>(null);
  const peakHoldRef = useRef<Float32Array | null>(null); // frames remaining in hold
  const smoothRef   = useRef<Float32Array | null>(null);

  const PEAK_HOLD_FRAMES = 60; // ~1 second at 60fps before drop
  const PEAK_DECAY       = 0.5; // dB per frame after hold
  const SMOOTH_UP        = 0.8; // attack
  const SMOOTH_DOWN      = 0.55; // release — slower fall than rise for smooth look

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = getAnalyser();
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;

    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width  = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width  = W + "px";
      canvas.style.height = H + "px";
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const plotH = H - AXIS_H;

    // Background
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(6,8,12,1)";
    ctx.fillRect(0, 0, W, H);

    // Subtle vignette on sides
    const vigL = ctx.createLinearGradient(0, 0, 28, 0);
    vigL.addColorStop(0, "rgba(6,8,12,0.7)");
    vigL.addColorStop(1, "rgba(6,8,12,0)");
    ctx.fillStyle = vigL; ctx.fillRect(0, 0, 28, plotH);
    const vigR = ctx.createLinearGradient(W - 28, 0, W, 0);
    vigR.addColorStop(0, "rgba(6,8,12,0)");
    vigR.addColorStop(1, "rgba(6,8,12,0.7)");
    ctx.fillStyle = vigR; ctx.fillRect(W - 28, 0, 28, plotH);

    // dB grid lines + right-side labels
    for (const db of [-72, -60, -48, -36, -24, -12, -6]) {
      const y = plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
      ctx.strokeStyle = db === -6 ? "rgba(255,120,60,0.10)" : "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = db === -6 ? "rgba(255,120,60,0.4)" : "rgba(255,255,255,0.18)";
      ctx.font = `700 8px 'SF Mono', monospace`;
      ctx.textAlign = "right";
      ctx.fillText(`${db}`, W - 2, y - 2);
    }
    ctx.textAlign = "left";

    // Frequency grid lines
    const nyquist = analyser ? analyser.context.sampleRate / 2 : 22050;
    for (const freq of FREQ_LABELS) {
      const x = freqToX(freq, W, nyquist);
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, plotH); ctx.stroke();
    }

    if (!analyser) {
      // Idle state — draw a calm noise floor curve
      ctx.strokeStyle = withAlpha(C.accent, 0.15);
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = plotH - 4 + Math.sin(x * 0.08) * 2;
        x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.font       = "11px 'Inter', system-ui";
      ctx.textAlign  = "center";
      ctx.fillText("Play to activate spectrum", W / 2, plotH / 2);
      ctx.textAlign  = "left";
      drawFreqAxis(ctx, W, H, plotH, nyquist);
      return;
    }

    const binCount = analyser.frequencyBinCount;
    const data = new Float32Array(binCount);
    analyser.getFloatFrequencyData(data);

    const cols = Math.ceil(W);

    // Init persistent arrays
    if (!smoothRef.current   || smoothRef.current.length   !== cols) smoothRef.current   = new Float32Array(cols).fill(DB_MIN);
    if (!peakDbRef.current   || peakDbRef.current.length   !== cols) peakDbRef.current   = new Float32Array(cols).fill(DB_MIN);
    if (!peakHoldRef.current || peakHoldRef.current.length !== cols) peakHoldRef.current = new Float32Array(cols).fill(0);

    const smooth   = smoothRef.current;
    const peakDb   = peakDbRef.current;
    const peakHold = peakHoldRef.current;
    const logMin   = Math.log10(20);
    const logMax   = Math.log10(nyquist);

    // --- Build smoothed spectrum values ---
    const dbValues = new Float32Array(cols);
    for (let col = 0; col < cols; col++) {
      const freq   = Math.pow(10, logMin + (col / cols) * (logMax - logMin));
      const binIdx = Math.round((freq / nyquist) * binCount);
      // Weighted average of 3 surrounding bins for smoothness
      let sum = 0, weight = 0;
      for (let b = Math.max(0, binIdx - 1); b <= Math.min(binCount - 1, binIdx + 1); b++) {
        const w = b === binIdx ? 2 : 1;
        sum += data[b] * w; weight += w;
      }
      const raw = Math.max(DB_MIN, Math.min(DB_MAX, weight ? sum / weight : DB_MIN));
      // Exponential smoothing — faster attack, slower decay
      smooth[col] = raw > smooth[col]
        ? smooth[col] + (raw - smooth[col]) * SMOOTH_UP
        : smooth[col] + (raw - smooth[col]) * SMOOTH_DOWN;
      dbValues[col] = smooth[col];

      // Peak hold logic
      if (dbValues[col] >= peakDb[col]) {
        peakDb[col]   = dbValues[col];
        peakHold[col] = PEAK_HOLD_FRAMES;
      } else {
        if (peakHold[col] > 0) {
          peakHold[col]--;
        } else {
          peakDb[col] = Math.max(DB_MIN, peakDb[col] - PEAK_DECAY);
        }
      }
    }

    // --- Draw filled bars (vertical gradient per-column for color-by-level) ---
    // Draw as thin filled columns so each can have its own color gradient
    const BAR_W = Math.max(1, Math.ceil(W / cols));
    for (let col = 0; col < cols; col += BAR_W) {
      const db = dbValues[col];
      if (db <= DB_MIN + 1) continue;
      const y = plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));

      const grad = ctx.createLinearGradient(0, y, 0, plotH);
      grad.addColorStop(0,    dbToColor(db, 0.9));
      grad.addColorStop(0.15, dbToColor(db, 0.55));
      grad.addColorStop(0.5,  dbToColor(db * 0.6, 0.25));
      grad.addColorStop(1,    "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(col, y, BAR_W, plotH - y);
    }

    // --- Draw smooth outline on top ---
    ctx.beginPath();
    let first = true;
    for (let col = 0; col < cols; col++) {
      const db = dbValues[col];
      const y  = plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
      first ? (ctx.moveTo(col, y), first = false) : ctx.lineTo(col, y);
    }
    // Outline: gradient from left to right edge (frequency colour)
    const lineGrad = ctx.createLinearGradient(0, 0, W, 0);
    lineGrad.addColorStop(0,    "rgba(0,120,255,0.7)");
    lineGrad.addColorStop(0.3,  "rgba(0,220,180,0.85)");
    lineGrad.addColorStop(0.55, "rgba(0,255,80,0.85)");
    lineGrad.addColorStop(0.75, "rgba(255,220,0,0.85)");
    lineGrad.addColorStop(1,    "rgba(255,60,0,0.85)");
    ctx.strokeStyle = lineGrad;
    ctx.lineWidth   = 1.5;
    ctx.lineJoin    = "round";
    ctx.stroke();

    // --- Glow pass on outline ---
    ctx.beginPath();
    first = true;
    for (let col = 0; col < cols; col++) {
      const db = dbValues[col];
      const y  = plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
      first ? (ctx.moveTo(col, y), first = false) : ctx.lineTo(col, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth   = 4;
    ctx.stroke();

    // --- Peak hold line (white dots, spaced every 2px) ---
    for (let col = 0; col < cols; col += 2) {
      const db = peakDb[col];
      if (db <= DB_MIN + 2) continue;
      const y   = plotH * (1 - (db - DB_MIN) / (DB_MAX - DB_MIN));
      const age = 1 - Math.min(1, (PEAK_HOLD_FRAMES - peakHold[col]) / 30);
      ctx.fillStyle = `rgba(255,255,255,${(0.65 * age).toFixed(2)})`;
      ctx.fillRect(col, y - 0.75, 1.5, 1.5);
    }

    drawFreqAxis(ctx, W, H, plotH, nyquist);
  }, [getAnalyser]);

  useEffect(() => {
    const loop = () => { draw(); rafRef.current = requestAnimationFrame(loop); };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative", overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "4px 10px", borderBottom: `1px solid ${C.line}`, flexShrink: 0,
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.accent }}>SPECTRUM</span>
        <span style={{ fontSize: 8, color: C.text4 }}>20Hz – 20kHz · LOG · SMOOTHED</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
          <div style={{
            width: 6, height: 6, borderRadius: "50%",
            background:  playing ? C.accent : C.text4,
            boxShadow:   playing ? `0 0 6px ${C.accent}` : "none",
            transition:  "all .3s",
          }} />
          <span style={{ fontSize: 8, color: playing ? C.accent : C.text4 }}>{playing ? "LIVE" : "IDLE"}</span>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ flex: 1, width: "100%", display: "block" }} />
    </div>
  );
}

function drawFreqAxis(ctx: CanvasRenderingContext2D, W: number, H: number, plotH: number, nyquist: number) {
  ctx.fillStyle  = "rgba(255,255,255,0.22)";
  ctx.font       = "700 8px 'SF Mono', monospace";
  ctx.textAlign  = "center";
  for (const freq of FREQ_LABELS) {
    const x     = freqToX(freq, W, nyquist);
    const label = freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
    // Tick mark
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, plotH); ctx.lineTo(x, plotH + 3); ctx.stroke();
    ctx.fillText(label, x, H - 3);
  }
  ctx.textAlign = "left";
}

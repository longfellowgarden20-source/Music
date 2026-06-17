"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

export default function Waveform({ trackId, color = "#1db954", height = 56, points = 600 }: {
  trackId: number; color?: string; height?: number; points?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<number[]>([]);

  useEffect(() => {
    let alive = true;
    api.waveform(trackId, points).then(d => { if (alive) setPeaks(d.peaks); }).catch(() => {});
    return () => { alive = false; };
  }, [trackId, points]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !peaks.length) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    const bars = Math.min(peaks.length, Math.floor(W / 2));
    const step = peaks.length / bars;
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const p = peaks[Math.floor(i * step)] ?? 0;
      const h = Math.max(1, p * (H - 4));
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.55 + p * 0.45;
      ctx.fillRect(i * bw, (H - h) / 2, Math.max(1, bw - 0.6), h);
    }
  }, [peaks, color]);

  return <canvas ref={canvasRef} style={{ width: "100%", height, display: "block" }} />;
}

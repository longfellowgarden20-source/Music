"use client";
import { useRef, useEffect, useState, useCallback } from "react";
import { api } from "../lib/api";
import { C, withAlpha } from "./theme";
import type { DawTrack } from "./dawTypes";

interface Note {
  pitch: number; note_name: string;
  start_sec: number; end_sec: number;
  velocity: number; confidence: number;
}

interface Props {
  track: DawTrack | null;
  trackId: number | null;
  positionSec: number;
  playing: boolean;
}

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const BLACK_KEYS = new Set([1,3,6,8,10]); // C#,D#,F#,G#,A#

const KEY_H = 10;    // height of each pitch row in px
const HEADER_W = 36; // piano keyboard width on left
const RULER_H = 20;  // time ruler height

function noteColor(pitch: number, velocity: number, trackColor: string): string {
  const alpha = 0.4 + velocity * 0.6;
  return withAlpha(trackColor, alpha);
}

export default function PianoRoll({ track, trackId, positionSec, playing }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(80); // px per second
  const rafRef = useRef<number>(0);
  const stateRef = useRef({ notes, zoom, positionSec, track });
  stateRef.current = { notes, zoom, positionSec, track };

  // Fetch notes when track changes
  useEffect(() => {
    if (!trackId || !track || track.id === "master") return;
    setLoading(true);
    setError(null);
    setNotes([]);
    api.stemNotes(trackId, track.id).then(res => {
      setNotes(res.notes);
      setLoading(false);
    }).catch(e => {
      setError(e.message);
      setLoading(false);
    });
  }, [trackId, track?.id]);

  // Pitch range from notes
  const pitchMin = notes.length ? Math.max(0,  Math.min(...notes.map(n => n.pitch)) - 4) : 36;
  const pitchMax = notes.length ? Math.min(127, Math.max(...notes.map(n => n.pitch)) + 4) : 84;
  const numRows = pitchMax - pitchMin + 1;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { notes, zoom, positionSec, track } = stateRef.current;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.offsetWidth;
    const H = canvas.offsetHeight;
    if (!W || !H) return;
    if (canvas.width !== Math.round(W * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const color = track?.color ?? C.accent;
    const pitchMinLocal = notes.length ? Math.max(0, Math.min(...notes.map(n => n.pitch)) - 4) : 36;
    const pitchMaxLocal = notes.length ? Math.min(127, Math.max(...notes.map(n => n.pitch)) + 4) : 84;
    const numRowsLocal = pitchMaxLocal - pitchMinLocal + 1;
    const rowH = Math.max(4, (H - RULER_H) / numRowsLocal);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, W, H);

    // Piano key sidebar
    ctx.fillStyle = C.bg1;
    ctx.fillRect(0, RULER_H, HEADER_W, H - RULER_H);
    for (let p = pitchMinLocal; p <= pitchMaxLocal; p++) {
      const row = pitchMaxLocal - p;
      const y = RULER_H + row * rowH;
      const semitone = p % 12;
      const isBlack = BLACK_KEYS.has(semitone);
      const isC = semitone === 0;
      ctx.fillStyle = isBlack ? "#1a1a20" : "#2a2a30";
      ctx.fillRect(0, y, HEADER_W - 1, rowH - 0.5);
      if (isC) {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = "7px 'SF Mono', monospace";
        ctx.fillText(`C${Math.floor(p / 12) - 1}`, 2, y + rowH - 2);
      }
      // Row bg
      const rowBg = isBlack ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.02)";
      ctx.fillStyle = rowBg;
      ctx.fillRect(HEADER_W, y, W - HEADER_W, rowH - 0.5);
      // C highlight
      if (isC) {
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        ctx.fillRect(HEADER_W, y, W - HEADER_W, rowH - 0.5);
      }
    }

    // Beat grid in content area
    const secPerBeat = 60 / 120; // default 120 bpm grid
    const beatW = secPerBeat * zoom;
    const startBeat = Math.floor(0);
    const endBeat = Math.ceil((W - HEADER_W) / zoom / secPerBeat) + 1;
    for (let b = startBeat; b <= endBeat; b++) {
      const x = HEADER_W + b * beatW;
      ctx.strokeStyle = b % 4 === 0 ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, RULER_H); ctx.lineTo(x, H); ctx.stroke();
      if (b % 4 === 0) {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.font = "8px 'SF Mono', monospace";
        ctx.fillText(`${Math.floor(b / 4) + 1}`, x + 2, RULER_H - 4);
      }
    }

    // Ruler bg
    ctx.fillStyle = C.bg2;
    ctx.fillRect(HEADER_W, 0, W - HEADER_W, RULER_H);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(HEADER_W, RULER_H - 1, W - HEADER_W, 1);

    // Note blocks
    for (const note of notes) {
      if (note.pitch < pitchMinLocal || note.pitch > pitchMaxLocal) continue;
      const row = pitchMaxLocal - note.pitch;
      const x = HEADER_W + note.start_sec * zoom;
      const w = Math.max(2, (note.end_sec - note.start_sec) * zoom - 1);
      const y = RULER_H + row * rowH + 0.5;
      const h = Math.max(2, rowH - 1.5);

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(x + 1, y + 1, w, h);

      // Note body
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, withAlpha(color, 0.9));
      grad.addColorStop(1, withAlpha(color, 0.55));
      ctx.fillStyle = grad;
      ctx.beginPath();
      const r = Math.min(2, h / 2);
      ctx.roundRect(x, y, w, h, r);
      ctx.fill();

      // Bright top edge
      ctx.strokeStyle = withAlpha(color, 1);
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + w, y + 0.5); ctx.stroke();

      // Note label if wide enough
      if (w > 22 && h > 7) {
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.font = `600 ${Math.min(8, h - 2)}px 'Inter', system-ui`;
        ctx.fillText(note.note_name, x + 3, y + h / 2 + 3);
      }
    }

    // Playhead
    const px = HEADER_W + positionSec * zoom;
    if (px >= HEADER_W && px <= W) {
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      ctx.fillStyle = C.accent;
      ctx.beginPath(); ctx.moveTo(px - 4, 0); ctx.lineTo(px + 4, 0); ctx.lineTo(px, 8); ctx.closePath(); ctx.fill();
    }
  }, []);

  useEffect(() => {
    const loop = () => { draw(); if (playing) rafRef.current = requestAnimationFrame(loop); };
    if (playing) rafRef.current = requestAnimationFrame(loop);
    else draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, draw]);

  useEffect(() => { draw(); }, [notes, zoom, draw]);

  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [draw]);

  return (
    <div ref={containerRef} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden", position: "relative" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderBottom: `1px solid ${C.line}`, flexShrink: 0, background: C.bg1 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.accent }}>PIANO ROLL</span>
        {track && <span style={{ fontSize: 8, color: C.text4 }}>{track.label.toUpperCase()} · {notes.length} NOTES</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 8, color: C.text4 }}>ZOOM</span>
          <input type="range" min={20} max={300} value={zoom} onChange={e => setZoom(+e.target.value)}
            style={{ width: 60, accentColor: C.accent }} />
        </div>
      </div>

      {/* canvas or state overlay */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(8,10,14,0.85)" }}>
            <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 1 }}>DETECTING NOTES…</div>
            <div style={{ fontSize: 9, color: C.text4, marginTop: 4 }}>basic-pitch ML inference running</div>
          </div>
        )}
        {!loading && !track && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: C.text4 }}>Select a track to see its piano roll</span>
          </div>
        )}
        {error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: "#c47b6e" }}>Note detection failed — {error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

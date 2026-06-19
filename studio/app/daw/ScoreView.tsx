"use client";
import { useRef, useEffect, useState } from "react";
import { api } from "../lib/api";
import { C } from "./theme";
import type { DawTrack } from "./dawTypes";

interface Note {
  pitch: number; note_name: string;
  start_sec: number; end_sec: number;
  velocity: number; confidence: number;
}

interface Props {
  track: DawTrack | null;
  trackId: number | null;
  bpm: number;
}

// MIDI pitch → VexFlow key string e.g. 60 → "c/4", 61 → "c#/4"
function pitchToVex(midi: number): { key: string; accidental: string | null } {
  const names = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
  const octave = Math.floor(midi / 12) - 1;
  const n = names[midi % 12];
  return { key: `${n}/${octave}`, accidental: n.includes("#") ? "#" : null };
}

// Duration in beats → VexFlow duration string
function durationToVex(beats: number): string {
  if (beats >= 3.5) return "1";    // whole
  if (beats >= 1.75) return "2";   // half
  if (beats >= 0.875) return "4";  // quarter
  if (beats >= 0.4375) return "8"; // eighth
  return "16";                     // sixteenth
}

export default function ScoreView({ track, trackId, bpm }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards against the render effect re-triggering itself. We render to the DOM
  // imperatively (VexFlow); we must NOT call setState from inside that effect,
  // or React loops forever ("Maximum update depth exceeded").
  const renderKeyRef = useRef<string>("");

  // Fetch notes when the selected stem changes.
  useEffect(() => {
    if (!trackId || !track || track.id === "master") {
      setNotes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotes([]);
    api.stemNotes(trackId, track.id)
      .then(res => { if (!cancelled) { setNotes(res.notes); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false); } });
    return () => { cancelled = true; };
  }, [trackId, track?.id]);

  // Render the staff imperatively whenever notes / bpm change.
  // No setState in here — purely DOM, so it can't loop.
  useEffect(() => {
    const el = divRef.current;
    if (!el) return;

    // Skip if nothing to draw.
    if (notes.length === 0) { el.innerHTML = ""; return; }

    // Dedupe re-renders for identical inputs.
    const key = `${bpm}|${notes.length}|${notes[0]?.start_sec}|${notes[notes.length - 1]?.end_sec}`;
    if (key === renderKeyRef.current) return;
    renderKeyRef.current = key;

    let cancelled = false;
    el.innerHTML = "";

    import("vexflow").then((VF: any) => {
      if (cancelled || !divRef.current) return;
      const { Renderer, Stave, StaveNote, Voice, Formatter, Accidental, Beam } = VF;
      const target = divRef.current;
      target.innerHTML = "";

      try {
        const secPerBeat = 60 / Math.max(40, bpm);
        const beatsPerMeasure = 4;
        const measDur = secPerBeat * beatsPerMeasure;

        // Decide clef from the median pitch: low material → bass clef.
        const sorted = [...notes].map(n => n.pitch).sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const clef = median < 60 ? "bass" : "treble";

        // Octave-fold every pitch into the staff's comfortable two-octave window
        // so notes sit ON the staff instead of on huge ledger-line ladders.
        // Treble centers around C4–C6, bass around C2–C4.
        const center = clef === "bass" ? 43 : 67; // G2 / G4
        const foldPitch = (p: number): number => {
          let q = p;
          while (q < center - 12) q += 12;
          while (q > center + 12) q -= 12;
          return q;
        };

        const totalDur = Math.max(...notes.map(n => n.end_sec), measDur);
        const numMeasures = Math.min(64, Math.ceil(totalDur / measDur)); // cap for sanity

        // One stave note per measure slot. We keep a clean melody: at most ~4
        // notes per measure so it stays readable.
        const measures: any[][] = Array.from({ length: numMeasures }, () => []);
        for (const note of notes) {
          const mIdx = Math.floor(note.start_sec / measDur);
          if (mIdx < 0 || mIdx >= numMeasures) continue;
          if (measures[mIdx].length >= 4) continue; // limit density per measure
          const durBeats = (note.end_sec - note.start_sec) / secPerBeat;
          const vexDur = durationToVex(durBeats);
          const { key: vkey, accidental } = pitchToVex(foldPitch(note.pitch));
          try {
            const sn = new StaveNote({ keys: [vkey], duration: vexDur, clef });
            if (accidental) sn.addModifier(new Accidental("#"), 0);
            measures[mIdx].push(sn);
          } catch { /* skip un-renderable note */ }
        }

        // Layout
        const STAVE_W = 280;
        const STAVE_H = 110;
        const width = target.offsetWidth || 800;
        const PER_ROW = Math.max(1, Math.floor((width - 20) / STAVE_W));
        const numRows = Math.ceil(numMeasures / PER_ROW);
        const totalH = numRows * STAVE_H + 30;

        const renderer = new Renderer(target, Renderer.Backends.SVG);
        renderer.resize(width, Math.max(160, totalH));
        const ctx = renderer.getContext();
        ctx.setFont("Inter, system-ui", 10);

        for (let m = 0; m < numMeasures; m++) {
          const row = Math.floor(m / PER_ROW);
          const col = m % PER_ROW;
          const x = 10 + col * STAVE_W;
          const y = 10 + row * STAVE_H;

          const stave = new Stave(x, y, STAVE_W - 10);
          if (col === 0) stave.addClef(clef);
          if (m === 0) stave.addTimeSignature("4/4");
          stave.setContext(ctx).draw();

          const mNotes = measures[m];
          const voice = new Voice({ numBeats: 4, beatValue: 4 });
          voice.setStrict(false);

          if (mNotes.length === 0) {
            const rest = new StaveNote({ keys: [clef === "bass" ? "d/3" : "b/4"], duration: "1r" });
            voice.addTickables([rest]);
            new Formatter().joinVoices([voice]).format([voice], STAVE_W - 30);
            voice.draw(ctx, stave);
            continue;
          }

          try {
            voice.addTickables(mNotes);
            new Formatter().joinVoices([voice]).format([voice], STAVE_W - 40);
            const beams = Beam.generateBeams(mNotes);
            voice.draw(ctx, stave);
            beams.forEach((b: any) => b.setContext(ctx).draw());
          } catch { /* skip bad measure */ }
        }

        // Recolor the SVG for the dark theme. VexFlow leaves most elements with
        // NO fill/stroke attribute, so they inherit the SVG default (black) —
        // invisible on our dark bg. We force the ink color on every shape: set
        // fill on fills, stroke on strokes, and leave fill="none" outlines alone
        // except to give them a visible stroke.
        const INK = "rgba(232,238,248,0.95)";
        const svg = target.querySelector("svg");
        if (svg) {
          svg.style.background = "transparent";
          // Root-level default so anything we miss still inherits a light color.
          svg.setAttribute("fill", INK);
          svg.style.color = INK;
          svg.querySelectorAll("path, rect, text, line, polygon, ellipse, circle").forEach(node => {
            const e = node as SVGElement;
            const fill = e.getAttribute("fill");
            const stroke = e.getAttribute("stroke");
            // Fill: anything not explicitly "none" should be ink.
            if (fill !== "none") e.setAttribute("fill", INK);
            // Stroke: staff lines / stems are stroked. If it's an outline
            // (fill=none) or already stroked, make the stroke ink.
            if (stroke !== "none" || fill === "none") e.setAttribute("stroke", INK);
          });
        }
      } catch (e) {
        console.warn("[score] render failed:", e);
        target.innerHTML =
          `<div style="padding:20px;font-size:11px;color:#c47b6e">Could not render score for this stem.</div>`;
      }
    });

    return () => { cancelled = true; };
  }, [notes, bpm]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 10px", borderBottom: `1px solid ${C.line}`, flexShrink: 0, background: C.bg1 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.accent }}>SCORE</span>
        {track && <span style={{ fontSize: 8, color: C.text4 }}>{track.label.toUpperCase()} · {bpm} BPM · 4/4 · {notes.length} notes</span>}
        <span style={{ marginLeft: "auto", fontSize: 8, color: C.text4 }}>basic-pitch + VexFlow</span>
      </div>

      {/* score area */}
      <div style={{ flex: 1, overflow: "auto", position: "relative", background: "#0a0c10" }}>
        <div ref={divRef} style={{ padding: "10px 10px 20px", minHeight: "100%" }} />

        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "rgba(8,10,14,0.9)" }}>
            <div style={{ fontSize: 10, color: C.accent, fontWeight: 700, letterSpacing: 1 }}>DETECTING NOTES…</div>
            <div style={{ fontSize: 9, color: C.text4, marginTop: 4 }}>Running basic-pitch ML model</div>
          </div>
        )}
        {!loading && !track && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: C.text4 }}>Select a track to see its score</span>
          </div>
        )}
        {!loading && track && !error && notes.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: C.text4 }}>No clear melody detected in this stem</span>
          </div>
        )}
        {error && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 10, color: "#c47b6e" }}>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

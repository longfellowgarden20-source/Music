"use client";
import { useRef, useEffect, useCallback } from "react";
import type { DawTrack, TransportState, ViewState, Gesture, Marker, TimeSelection } from "./dawTypes";
import { snapSec } from "./snap";
import { C, withAlpha } from "./theme";

const RULER_H = 30;
const EDGE_PX = 8;
const FADE_PX = 14;     // size of fade-handle hit zone
const MARKER_H = 14;

interface Props {
  tracks: DawTrack[];
  transport: TransportState;
  view: ViewState;
  positionSec: number;
  gesture: Gesture | null;
  markers: Marker[];
  selection: TimeSelection | null;
  selectMode: boolean;
  automationLane: "volume" | "pan" | null;
  onSeek: (sec: number) => void;
  // ruler-drag scrub: onScrub fires continuously while dragging, onScrubEnd on release
  onScrub: (sec: number) => void;
  onScrubEnd: (sec: number) => void;
  onAutomationEdit: (trackId: string, sec: number, value: number) => void;
  onScrollLeft: (v: number) => void;
  onScrollTop: (v: number) => void;
  onZoom: (z: number) => void;
  onGestureStart: (g: Gesture) => void;
  onGestureMove: (clientX: number, clientY: number) => void;
  onGestureEnd: () => void;
  onClipSplit: (trackId: string, clipId: string) => void;
  onClipGain: (trackId: string, clipId: string, delta: number) => void;
  onLoopRange: (start: number, end: number) => void;
  onMarkerClick: (m: Marker) => void;
  onSelectRegion: (sel: TimeSelection | null) => void;
  // right-click inside the active selection → open the region menu at the cursor
  onRegionContextMenu: (clientX: number, clientY: number) => void;
  // right-click on a track lane (no selection) → open the track menu for that track
  onTrackContextMenu: (clientX: number, clientY: number, trackId: string) => void;
}

export default function ArrangementCanvas({
  tracks, transport, view, positionSec, gesture, markers, selection, selectMode,
  automationLane, onAutomationEdit,
  onSeek, onScrub, onScrubEnd, onScrollLeft, onScrollTop, onZoom, onGestureStart, onGestureMove, onGestureEnd,
  onClipSplit, onClipGain, onLoopRange, onMarkerClick, onSelectRegion, onRegionContextMenu, onTrackContextMenu,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const stateRef = useRef({ tracks, transport, view, positionSec, markers, selection, automationLane });
  stateRef.current = { tracks, transport, view, positionSec, markers, selection, automationLane };

  // track an in-progress loop-range drag locally for live preview
  const loopDragRef = useRef<{ start: number; end: number } | null>(null);
  // in-progress marquee selection
  const marqueeRef = useRef<TimeSelection | null>(null);
  // in-progress playhead scrub (plain drag on the ruler) + last scrubbed time
  const scrubRef = useRef(false);
  const lastScrubSecRef = useRef(0);

  // ── render ──────────────────────────────────────────────────────────────────
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { tracks, transport, view, positionSec, markers } = stateRef.current;
    const { zoom } = transport;
    const { scrollLeft, scrollTop, trackHeight } = view;
    // Use CSS pixel dimensions (the DPR transform is already applied to ctx)
    const W = parseFloat(canvas.style.width) || canvas.width;
    const H = parseFloat(canvas.style.height) || canvas.height;

    // Clear uses the raw pixel buffer size (before the DPR transform)
    const dpr = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.fillStyle = C.arrange;
    ctx.fillRect(0, 0, W, H);

    // alternating track rows + bottom separators for depth
    tracks.forEach((_, i) => {
      const y = RULER_H + i * trackHeight - scrollTop;
      ctx.fillStyle = i % 2 === 0 ? C.rowA : C.rowB;
      ctx.fillRect(0, y, W, trackHeight);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(0, y + trackHeight - 1, W, 1);
      ctx.fillStyle = "rgba(255,255,255,0.02)";
      ctx.fillRect(0, y, W, 1);
    });

    // loop region shading
    const loopRange = loopDragRef.current ?? (transport.looping ? { start: transport.loopStart, end: transport.loopEnd } : null);
    if (loopRange && loopRange.end > loopRange.start) {
      const lx = loopRange.start * zoom - scrollLeft;
      const lw = (loopRange.end - loopRange.start) * zoom;
      ctx.fillStyle = withAlpha(C.accent, 0.07);
      ctx.fillRect(lx, RULER_H, lw, H - RULER_H);
      ctx.fillStyle = withAlpha(C.accent, 0.5);
      ctx.fillRect(lx, RULER_H, 1.5, H - RULER_H);
      ctx.fillRect(lx + lw - 1.5, RULER_H, 1.5, H - RULER_H);
      // loop band in ruler
      ctx.fillStyle = C.accent;
      ctx.fillRect(lx, MARKER_H, lw, 3);
    }

    // grid + ruler — TIME based (seconds), so the ruler, playhead, and the top
    // clock always agree. (A BPM-derived bar grid drifts from real time whenever
    // the auto-detected BPM is wrong — common on ambient/free-tempo tracks — which
    // made the ruler look compressed and disagree with the seconds clock.)
    const intervals = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    const interval = intervals.find(iv => iv * zoom > 60) ?? 60;
    const startSec = scrollLeft / zoom;
    const endSec = (scrollLeft + W) / zoom;
    let t = Math.floor(startSec / interval) * interval;

    // ruler bg with subtle gradient for depth
    const rg = ctx.createLinearGradient(0, 0, 0, RULER_H);
    rg.addColorStop(0, C.bg2);
    rg.addColorStop(1, C.bg1);
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, RULER_H);
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, RULER_H - 1, W, 1);

    while (t <= endSec + interval) {
      const x = Math.round(t * zoom - scrollLeft);
      // Major line every 5s (or every interval if interval >= 5), minor otherwise.
      const major = interval >= 5 ? true : (Math.round(t / interval) % 5 === 0);

      ctx.strokeStyle = major ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, RULER_H);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();

      const tickH = major ? 12 : 6;
      ctx.strokeStyle = major ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, RULER_H);
      ctx.lineTo(x + 0.5, RULER_H - tickH);
      ctx.stroke();

      if (major) {
        // mm:ss when over a minute, else whole seconds
        const m = Math.floor(t / 60);
        const s = Math.round(t % 60);
        const label = t >= 60 ? `${m}:${String(s).padStart(2, "0")}` : `${Math.round(t)}s`;
        ctx.fillStyle = C.text2;
        ctx.font = "700 10px 'SF Mono', monospace";
        ctx.fillText(label, x + 4, 12);
      }
      t += interval;
    }

    // clips + waveforms + fades
    tracks.forEach((track, i) => {
      const ry = RULER_H + i * trackHeight - scrollTop;
      track.clips.forEach(clip => {
        const cx = clip.startSec * zoom - scrollLeft;
        const cw = clip.durationSec * zoom;
        if (cx + cw < 0 || cx > W) return;

        const color = clip.color ?? track.color;
        const isMuted = track.muted;
        const alpha = isMuted ? 0.4 : 1;
        const top = ry + 4;
        const bh = trackHeight - 8;
        const HDR = 15;   // clip header strip height

        ctx.globalAlpha = alpha;

        // drop shadow under clip for depth
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        roundRect(ctx, cx + 1, top + 2, cw, bh, 4);
        ctx.fill();

        // clip body — vertical gradient of the muted color (Ableton style)
        const bodyGrad = ctx.createLinearGradient(0, top, 0, top + bh);
        bodyGrad.addColorStop(0, withAlpha(color, 0.42));
        bodyGrad.addColorStop(1, withAlpha(color, 0.24));
        ctx.fillStyle = bodyGrad;
        roundRect(ctx, cx, top, cw, bh, 4);
        ctx.fill();

        // header strip (brighter band at top, where the label sits)
        if (cw > 14) {
          ctx.save();
          roundRect(ctx, cx, top, cw, bh, 4);
          ctx.clip();
          ctx.fillStyle = withAlpha(color, 0.7);
          ctx.fillRect(cx, top, cw, HDR);
          ctx.fillStyle = "rgba(0,0,0,0.18)";
          ctx.fillRect(cx, top + HDR - 1, cw, 1);
          ctx.restore();
        }

        // crisp 1px border
        ctx.strokeStyle = withAlpha(color, 0.9);
        ctx.lineWidth = 1;
        roundRect(ctx, cx + 0.5, top + 0.5, cw - 1, bh - 1, 4);
        ctx.stroke();

        // label in header strip
        if (cw > 34) {
          ctx.fillStyle = "rgba(0,0,0,0.78)";
          ctx.font = "700 9px 'Inter', system-ui";
          ctx.fillText(track.label.toUpperCase(), cx + 6, top + 11);
          if ((clip.gain ?? 1) !== 1 && cw > 90) {
            const gdb = 20 * Math.log10(clip.gain ?? 1);
            ctx.fillStyle = "rgba(0,0,0,0.55)";
            ctx.font = "600 8px 'SF Mono', monospace";
            ctx.fillText(`${gdb > 0 ? "+" : ""}${gdb.toFixed(1)}`, cx + cw - 30, top + 11);
          }
        }

        // waveform (below header strip)
        if (track.peakData && cw > 8) {
          const maxPeak = track.peakData.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
          if (maxPeak > 0.001) {
            drawWaveform(ctx, clip, track.peakData, color, cx, ry + HDR, cw, trackHeight - HDR);
          } else if (cw > 60) {
            // stem is silent for this track (e.g. no guitar in an electronic track)
            const mid = ry + HDR + (trackHeight - HDR) / 2;
            ctx.strokeStyle = withAlpha(color, 0.25);
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 6]);
            ctx.beginPath(); ctx.moveTo(cx + 4, mid); ctx.lineTo(cx + cw - 4, mid); ctx.stroke();
            ctx.setLineDash([]);
            if (cw > 100) {
              ctx.fillStyle = withAlpha(color, 0.35);
              ctx.font = "700 8px 'Inter', system-ui";
              ctx.textAlign = "center";
              ctx.fillText("SILENT", cx + cw / 2, mid + 3);
              ctx.textAlign = "left";
            }
          }
        }

        // fade-in triangle
        const fiW = (clip.fadeInSec ?? 0) * zoom;
        if (fiW > 1) {
          ctx.fillStyle = "rgba(10,10,12,0.55)";
          ctx.beginPath();
          ctx.moveTo(cx, top);
          ctx.lineTo(cx + fiW, top);
          ctx.lineTo(cx, top + bh);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.3)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx, top + bh);
          ctx.lineTo(cx + fiW, top);
          ctx.stroke();
        }
        // fade-out triangle
        const foW = (clip.fadeOutSec ?? 0) * zoom;
        if (foW > 1) {
          ctx.fillStyle = "rgba(10,10,12,0.55)";
          ctx.beginPath();
          ctx.moveTo(cx + cw, top);
          ctx.lineTo(cx + cw - foW, top);
          ctx.lineTo(cx + cw, top + bh);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.3)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx + cw - foW, top);
          ctx.lineTo(cx + cw, top + bh);
          ctx.stroke();
        }

        // fade handles (small squares in top corners)
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        sq(ctx, cx + Math.max(fiW, 3), top + 2, 3);
        sq(ctx, cx + cw - Math.max(foW, 3), top + 2, 3);

        ctx.globalAlpha = 1;
      });
    });

    // markers
    markers.forEach(m => {
      const mx = m.sec * zoom - scrollLeft;
      if (mx < -10 || mx > W + 10) return;
      // flag pennant
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(mx, 0);
      ctx.lineTo(mx + 8, 0);
      ctx.lineTo(mx + 8, MARKER_H - 5);
      ctx.lineTo(mx, MARKER_H);
      ctx.closePath();
      ctx.fill();
      // guide line
      ctx.strokeStyle = withAlpha(m.color, 0.28);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx + 0.5, MARKER_H);
      ctx.lineTo(mx + 0.5, H);
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = C.text;
        ctx.font = "700 9px 'Inter', system-ui";
        ctx.fillText(m.label, mx + 11, MARKER_H - 3);
      }
    });

    // region selection highlight (committed or in-progress marquee)
    const sel = marqueeRef.current ?? stateRef.current.selection;
    if (sel && sel.endSec > sel.startSec) {
      const ti = tracks.findIndex(t => t.id === sel.trackId);
      if (ti >= 0) {
        const sx = sel.startSec * zoom - scrollLeft;
        const sw = (sel.endSec - sel.startSec) * zoom;
        const sy = RULER_H + ti * trackHeight - scrollTop;
        ctx.fillStyle = withAlpha(C.accent, 0.18);
        ctx.fillRect(sx, sy, sw, trackHeight);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, trackHeight - 1);
        ctx.setLineDash([]);
        // edge handles
        ctx.fillStyle = C.accent;
        ctx.fillRect(sx - 1, sy, 2, trackHeight);
        ctx.fillRect(sx + sw - 1, sy, 2, trackHeight);
      }
    }

    // automation overlay (volume/pan curve per track)
    const lane = stateRef.current.automationLane;
    if (lane) {
      tracks.forEach((track, i) => {
        const pts = track.automation?.[lane];
        const y0 = RULER_H + i * trackHeight - scrollTop;
        const h = trackHeight;
        // value→y: volume 0..1 (1 at top), pan -1..1 (top = +1)
        const valToY = (v: number) => lane === "volume"
          ? y0 + h - v * h
          : y0 + h / 2 - (v * h / 2);
        const color = lane === "volume" ? "#4fd1a5" : "#c4a96e";
        // faint lane bg tint
        ctx.fillStyle = withAlpha(color, 0.04);
        ctx.fillRect(0, y0, W, h);
        if (lane === "pan") { // center line
          ctx.strokeStyle = withAlpha(color, 0.2); ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(0, y0 + h / 2 + 0.5); ctx.lineTo(W, y0 + h / 2 + 0.5); ctx.stroke();
        }
        const sorted = pts && pts.length ? [...pts].sort((a, b) => a.sec - b.sec)
          : [{ sec: 0, value: lane === "volume" ? track.volume : track.pan }];
        ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        ctx.beginPath();
        sorted.forEach((pt, k) => {
          const x = pt.sec * zoom - scrollLeft;
          const y = valToY(pt.value);
          if (k === 0) { ctx.moveTo(0, y); ctx.lineTo(x, y); } else ctx.lineTo(x, y);
        });
        const last = sorted[sorted.length - 1];
        ctx.lineTo(W, valToY(last.value));
        ctx.stroke();
        // points
        (pts ?? []).forEach(pt => {
          const x = pt.sec * zoom - scrollLeft;
          const y = valToY(pt.value);
          ctx.fillStyle = color;
          ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = "#0c1714"; ctx.lineWidth = 1; ctx.stroke();
        });
      });
    }

    // playhead
    const px = Math.round(positionSec * zoom - scrollLeft);
    if (px >= 0 && px <= W) {
      const grad = ctx.createLinearGradient(px - 8, 0, px + 8, 0);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.5, withAlpha(C.accent, 0.12));
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(px - 8, RULER_H, 16, H - RULER_H);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, RULER_H);
      ctx.lineTo(px + 0.5, H);
      ctx.stroke();
      // playhead head triangle
      ctx.fillStyle = C.accent;
      ctx.beginPath();
      ctx.moveTo(px - 5, RULER_H - 7);
      ctx.lineTo(px + 5, RULER_H - 7);
      ctx.lineTo(px, RULER_H);
      ctx.closePath();
      ctx.fill();
    }
  }, []);

  // rAF loop during playback
  useEffect(() => {
    const loop = () => {
      render();
      if (stateRef.current.transport.playing) rafRef.current = requestAnimationFrame(loop);
    };
    if (transport.playing) rafRef.current = requestAnimationFrame(loop);
    else render();
    return () => cancelAnimationFrame(rafRef.current);
  }, [transport.playing, render]);

  useEffect(() => {
    if (!transport.playing) render();
  }, [tracks, transport, view, positionSec, markers, render]);

  // resize — scale canvas for HiDPI/Retina so pixels aren't blurry
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      const { width, height } = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      render();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [render]);

  // wheel: must be a non-passive native listener so preventDefault() actually works.
  // React 17+ attaches synthetic onWheel as passive, silently ignoring preventDefault.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (e: WheelEvent) => {
      const { tracks, transport, view } = stateRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = -e.deltaY * 0.003;
        onZoom(Math.max(30, Math.min(600, transport.zoom * (1 + delta))));
        return;
      }
      if (e.shiftKey) {
        const oy = e.offsetY;
        if (oy >= RULER_H) {
          const ti = Math.floor((oy - RULER_H + (view.scrollTop ?? 0)) / view.trackHeight);
          const track = tracks[ti];
          if (track) {
            const sec = (e.offsetX + view.scrollLeft) / transport.zoom;
            const clip = track.clips.find(c => sec >= c.startSec && sec <= c.startSec + c.durationSec);
            if (clip) { e.preventDefault(); onClipGain(track.id, clip.id, e.deltaY < 0 ? 0.05 : -0.05); return; }
          }
        }
      }
      const container = containerRef.current;
      const vw = container?.getBoundingClientRect().width ?? 0;
      const vh = container?.getBoundingClientRect().height ?? 0;
      const total = Math.max(60, ...stateRef.current.tracks.flatMap(t => t.clips.map(c => c.startSec + c.durationSec)));
      const cW = total * transport.zoom + 200;
      const maxScrollLeft = Math.max(0, cW - vw);
      const maxScrollTop  = Math.max(0, tracks.length * view.trackHeight - (vh - RULER_H));

      // Pure horizontal scroll (trackpad two-finger horizontal or Shift+wheel)
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        if (maxScrollLeft > 0) {
          e.preventDefault();
          onScrollLeft(Math.max(0, Math.min(maxScrollLeft, view.scrollLeft + e.deltaX)));
        }
        return;
      }

      // Vertical scroll — scroll tracks up/down
      if (maxScrollTop > 0 && Math.abs(e.deltaY) > 0) {
        e.preventDefault();
        onScrollTop(Math.max(0, Math.min(maxScrollTop, (view.scrollTop ?? 0) + e.deltaY)));
        return;
      }

      // Fallback: horizontal via vertical scroll when no vertical room
      if (maxScrollLeft > 0 && e.deltaY !== 0) {
        e.preventDefault();
        onScrollLeft(Math.max(0, Math.min(maxScrollLeft, view.scrollLeft + e.deltaY)));
      }
    };
    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [onZoom, onClipGain, onScrollLeft, onScrollTop]);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const { tracks, transport, view, positionSec } = stateRef.current;
    const { zoom, bpm, snap } = transport;
    const { scrollLeft, scrollTop, trackHeight } = view;
    const ox = e.nativeEvent.offsetX;
    const oy = e.nativeEvent.offsetY;
    const rawSec = (ox + scrollLeft) / zoom;

    // marker click (top band)
    if (oy < MARKER_H) {
      const hit = stateRef.current.markers.find(m => {
        const mx = m.sec * zoom - scrollLeft;
        return ox >= mx - 2 && ox <= mx + 11;
      });
      if (hit) { onMarkerClick(hit); return; }
    }

    // ruler (below marker band) — left = seek, with drag = loop range
    if (oy < RULER_H) {
      if (e.shiftKey) {
        loopDragRef.current = { start: snapSec(rawSec, snap, bpm), end: snapSec(rawSec, snap, bpm) };
        onGestureStart({
          type: "loop-range", clipId: "", trackId: "",
          startClientX: e.clientX, startClientY: e.clientY,
          origStartSec: rawSec, origDurSec: 0, origOffsetSec: 0,
          origFadeInSec: 0, origFadeOutSec: 0,
        });
        return;
      }
      // Plain click/drag on the ruler scrubs the playhead. We drive the drag with
      // window-level listeners (not the canvas onMouseMove) so it keeps tracking
      // even when the cursor moves fast or leaves the thin 16px ruler strip — the
      // same approach the scrollbar uses. This is why the earlier onMouseMove-based
      // version felt like it "didn't work": those events stop firing off-element.
      const canvas = canvasRef.current;
      const rect = canvas?.getBoundingClientRect();
      const toSec = (clientX: number) => {
        const { transport, view } = stateRef.current;
        const ox = clientX - (rect?.left ?? 0);
        const raw = (ox + view.scrollLeft) / transport.zoom;
        return snapSec(Math.max(0, raw), transport.snap, transport.bpm);
      };
      scrubRef.current = true;
      lastScrubSecRef.current = snapSec(rawSec, snap, bpm);
      onScrub(lastScrubSecRef.current);
      const move = (ev: MouseEvent) => {
        lastScrubSecRef.current = toSec(ev.clientX);
        onScrub(lastScrubSecRef.current);
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        scrubRef.current = false;
        onScrubEnd(lastScrubSecRef.current);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      return;
    }

    const ti = Math.floor((oy - RULER_H + scrollTop) / trackHeight);
    const track = tracks[ti];
    if (!track) { onSeek(snapSec(rawSec, snap, bpm)); return; }

    // automation editing: click on a lane adds/moves a point at this time+value
    const lane = stateRef.current.automationLane;
    if (lane && e.button === 0) {
      const y0 = RULER_H + ti * trackHeight;
      const rel = (oy - y0) / trackHeight;            // 0 top .. 1 bottom
      const value = lane === "volume"
        ? Math.max(0, Math.min(1, 1 - rel))
        : Math.max(-1, Math.min(1, 1 - rel * 2));
      onAutomationEdit(track.id, snapSec(rawSec, snap, bpm), value);
      return;
    }

    // right-click = split at playhead — but if the click lands inside the active
    // highlighted region, defer to the context menu (handled in onContextMenu)
    // and don't split.
    if (e.button === 2) {
      const sel = stateRef.current.selection;
      if (sel && track.id === sel.trackId && rawSec >= sel.startSec && rawSec <= sel.endSec) return;
      const clip = track.clips.find(c => positionSec > c.startSec && positionSec < c.startSec + c.durationSec);
      if (clip) onClipSplit(track.id, clip.id);
      return;
    }

    const clip = track.clips.find(c => rawSec >= c.startSec && rawSec <= c.startSec + c.durationSec);
    if (!clip) { onSeek(snapSec(rawSec, snap, bpm)); onSelectRegion(null); return; }

    // marquee region-select: in select mode, or holding Alt/Option, drag picks
    // a time range on this clip instead of moving it.
    if (selectMode || e.altKey) {
      const s = snapSec(rawSec, snap, bpm);
      marqueeRef.current = { trackId: track.id, clipId: clip.id, startSec: s, endSec: s };
      onGestureStart({
        type: "marquee", clipId: clip.id, trackId: track.id,
        startClientX: e.clientX, startClientY: e.clientY,
        origStartSec: s, origDurSec: 0, origOffsetSec: 0, origFadeInSec: 0, origFadeOutSec: 0,
      });
      return;
    }

    const clipX = clip.startSec * zoom - scrollLeft;
    const clipRight = (clip.startSec + clip.durationSec) * zoom - scrollLeft;
    const top = RULER_H + ti * trackHeight + 3;
    const fiW = (clip.fadeInSec ?? 0) * zoom;
    const foW = (clip.fadeOutSec ?? 0) * zoom;

    const g: Gesture = {
      clipId: clip.id, trackId: track.id,
      startClientX: e.clientX, startClientY: e.clientY,
      origStartSec: clip.startSec, origDurSec: clip.durationSec, origOffsetSec: clip.offsetSec,
      origFadeInSec: clip.fadeInSec ?? 0, origFadeOutSec: clip.fadeOutSec ?? 0,
      type: "idle",
    };

    const nearTop = oy - top < FADE_PX;
    // fade handles (top corners) take priority near the top edge
    if (nearTop && Math.abs(ox - (clipX + Math.max(fiW, 4))) < FADE_PX) g.type = "fade-in";
    else if (nearTop && Math.abs(ox - (clipRight - Math.max(foW, 4))) < FADE_PX) g.type = "fade-out";
    else if (ox - clipX < EDGE_PX) g.type = "trim-left";
    else if (clipRight - ox < EDGE_PX) g.type = "trim-right";
    else g.type = "dragging";

    onGestureStart(g);
  }, [onSeek, onScrub, onScrubEnd, onGestureStart, onClipSplit, onMarkerClick, onSelectRegion, selectMode, onAutomationEdit]);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    // Ruler scrub is driven by window listeners attached in onMouseDown, not here.
    if (scrubRef.current) return;
    if (gesture?.type === "loop-range") {
      const { transport, view } = stateRef.current;
      const rawSec = (e.nativeEvent.offsetX + view.scrollLeft) / transport.zoom;
      const snapped = snapSec(rawSec, transport.snap, transport.bpm);
      if (loopDragRef.current) {
        const startSec = snapSec(loopDragRef.current.start, transport.snap, transport.bpm);
        loopDragRef.current = { start: Math.min(startSec, snapped), end: Math.max(startSec, snapped) };
        render();
      }
      return;
    }
    if (gesture?.type === "marquee" && marqueeRef.current) {
      const { transport, view } = stateRef.current;
      const rawSec = (e.nativeEvent.offsetX + view.scrollLeft) / transport.zoom;
      const snapped = snapSec(rawSec, transport.snap, transport.bpm);
      const anchor = gesture.origStartSec;
      // clamp to the clip bounds
      const clip = stateRef.current.tracks.find(t => t.id === gesture.trackId)?.clips.find(c => c.id === gesture.clipId);
      const lo = clip ? clip.startSec : 0;
      const hi = clip ? clip.startSec + clip.durationSec : snapped;
      marqueeRef.current = {
        trackId: gesture.trackId, clipId: gesture.clipId,
        startSec: Math.max(lo, Math.min(anchor, snapped)),
        endSec: Math.min(hi, Math.max(anchor, snapped)),
      };
      render();
      return;
    }
    onGestureMove(e.clientX, e.clientY);
  }, [onGestureMove, gesture, render]);

  const onMouseUp = useCallback(() => {
    // Ruler scrub end is handled by the window "up" listener from onMouseDown.
    if (gesture?.type === "loop-range" && loopDragRef.current) {
      const { start, end } = loopDragRef.current;
      if (end - start > 0.05) onLoopRange(start, end);
      loopDragRef.current = null;
    }
    if (gesture?.type === "marquee") {
      const m = marqueeRef.current;
      marqueeRef.current = null;
      onSelectRegion(m && m.endSec - m.startSec > 0.02 ? m : null);
    }
    onGestureEnd();
  }, [onGestureEnd, gesture, onLoopRange, onSelectRegion, onScrubEnd]);

  // Right-click: if it lands inside the active highlighted region, open the
  // region menu at the cursor. Otherwise let the default (split-at-playhead,
  // handled in onMouseDown) proceed by just suppressing the browser menu.
  const onContextMenu = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { transport, view, selection: sel } = stateRef.current;
    const ox = e.nativeEvent.offsetX;
    const oy = e.nativeEvent.offsetY;
    if (oy < RULER_H) return;   // ruler/marker band — no menu
    const sec = (ox + view.scrollLeft) / transport.zoom;
    const ti = Math.floor((oy - RULER_H + (view.scrollTop ?? 0)) / view.trackHeight);
    const track = stateRef.current.tracks[ti];

    // 1) right-click inside the active highlighted region → region ops menu
    if (sel && track && track.id === sel.trackId && sec >= sel.startSec && sec <= sel.endSec) {
      onRegionContextMenu(e.clientX, e.clientY);
      return;
    }
    // 2) right-click on a track lane (no selection needed) → track menu
    if (track) onTrackContextMenu(e.clientX, e.clientY, track.id);
  }, [onRegionContextMenu, onTrackContextMenu]);

  const totalDur = Math.max(60, ...tracks.flatMap(t => t.clips.map(c => c.startSec + c.durationSec)));
  const contentW = totalDur * transport.zoom + 200;

  const cursor = gesture
    ? (gesture.type === "trim-left" || gesture.type === "trim-right" ? "ew-resize"
       : gesture.type === "marquee" ? "crosshair" : "grabbing")
    : (selectMode ? "crosshair" : "default");

  // viewport width drives the scrollbar thumb size + max scroll
  const viewW = containerRef.current?.getBoundingClientRect().width ?? 0;
  const maxScroll = Math.max(0, contentW - viewW);
  const curScroll = Math.min(view.scrollLeft, maxScroll);
  const thumbFrac = contentW > 0 ? Math.min(1, viewW / contentW) : 1;
  const thumbW = Math.max(40, thumbFrac * viewW);
  const thumbX = maxScroll > 0 ? (curScroll / maxScroll) * (viewW - thumbW) : 0;

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: "hidden", position: "relative" }}>
      {/* Canvas is PINNED to the viewport and pans by redrawing with a scrollLeft
          offset (all the draw + hit-test math already subtracts scrollLeft). It is
          NOT placed inside a scrolling element — doing so made it scroll away and
          only span one screen-width, leaving everything past it black. Scrolling is
          driven by the wheel and the custom scrollbar below. */}
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", top: 0, left: 0, cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onContextMenu={onContextMenu}
      />
      {/* custom horizontal scrollbar — only shown when content exceeds the viewport */}
      {maxScroll > 0 && (
        <div
          style={{
            position: "absolute", left: 0, right: 0, bottom: 0, height: 10,
            background: "rgba(0,0,0,0.25)", zIndex: 5,
          }}
          onMouseDown={(e) => {
            const bar = e.currentTarget.getBoundingClientRect();
            const seekTo = (clientX: number) => {
              const frac = Math.max(0, Math.min(1, (clientX - bar.left - thumbW / 2) / (viewW - thumbW)));
              onScrollLeft(frac * maxScroll);
            };
            seekTo(e.clientX);
            const move = (ev: MouseEvent) => seekTo(ev.clientX);
            const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
            window.addEventListener("mousemove", move);
            window.addEventListener("mouseup", up);
          }}
        >
          <div style={{
            position: "absolute", top: 1, height: 8, borderRadius: 4,
            width: thumbW, left: thumbX,
            background: "rgba(255,255,255,0.22)", cursor: "grab",
          }} />
        </div>
      )}
    </div>
  );
}

function sq(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.fillRect(x - s / 2, y, s, s);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  clip: { offsetSec: number; durationSec: number },
  peaks: Float32Array,
  color: string,
  cx: number, cy: number, cw: number, ch: number,
) {
  const mid = cy + ch / 2;
  const halfH = ch / 2 - 3;
  // peaks decoded at ~200/sec; map clip window into peak index range
  const totalDur = peaks.length / 200;
  const startFrac = clip.offsetSec / totalDur;
  const endFrac = (clip.offsetSec + clip.durationSec) / totalDur;
  const i0 = Math.floor(startFrac * peaks.length);
  const i1 = Math.floor(endFrac * peaks.length);
  const span = Math.max(1, i1 - i0);

  // Per-pixel min/max: for each screen pixel column, find the true peak
  // across all source samples that map into it — gives sharp "filled oscilloscope" look.
  const cols = Math.ceil(cw);
  const peakPos = new Float32Array(cols); // max amplitude (always ≥0)
  const rmsVal  = new Float32Array(cols); // RMS for the softer body layer

  for (let col = 0; col < cols; col++) {
    const f0 = col / cols;
    const f1 = (col + 1) / cols;
    const s0 = i0 + Math.floor(f0 * span);
    const s1 = i0 + Math.ceil(f1 * span);
    let maxAmp = 0;
    let sumSq = 0;
    let count = 0;
    for (let s = s0; s <= s1 && s < peaks.length; s++) {
      const v = Math.abs(peaks[s] ?? 0);
      if (v > maxAmp) maxAmp = v;
      sumSq += v * v;
      count++;
    }
    peakPos[col] = maxAmp;
    rmsVal[col]  = count > 0 ? Math.sqrt(sumSq / count) : 0;
  }

  ctx.save();

  // Layer 1 — soft RMS body (filled polygon, low alpha)
  const bodyGrad = ctx.createLinearGradient(0, mid - halfH, 0, mid + halfH);
  bodyGrad.addColorStop(0,   withAlpha(color, 0.25));
  bodyGrad.addColorStop(0.5, withAlpha(color, 0.45));
  bodyGrad.addColorStop(1,   withAlpha(color, 0.25));
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(cx, mid);
  for (let col = 0; col < cols; col++) {
    ctx.lineTo(cx + col, mid - rmsVal[col] * halfH);
  }
  for (let col = cols - 1; col >= 0; col--) {
    ctx.lineTo(cx + col, mid + rmsVal[col] * halfH);
  }
  ctx.closePath();
  ctx.fill();

  // Layer 2 — sharp peak outline (top + bottom, 1px stroke)
  const peakGrad = ctx.createLinearGradient(0, mid - halfH, 0, mid + halfH);
  peakGrad.addColorStop(0,   withAlpha(color, 0.85));
  peakGrad.addColorStop(0.5, "rgba(255,255,255,0.95)");
  peakGrad.addColorStop(1,   withAlpha(color, 0.85));
  ctx.strokeStyle = peakGrad;
  ctx.lineWidth = 1;
  ctx.lineJoin = "round";

  // top edge
  ctx.beginPath();
  for (let col = 0; col < cols; col++) {
    const y = mid - peakPos[col] * halfH;
    if (col === 0) ctx.moveTo(cx + col, y);
    else ctx.lineTo(cx + col, y);
  }
  ctx.stroke();

  // bottom edge (mirror)
  ctx.beginPath();
  for (let col = 0; col < cols; col++) {
    const y = mid + peakPos[col] * halfH;
    if (col === 0) ctx.moveTo(cx + col, y);
    else ctx.lineTo(cx + col, y);
  }
  ctx.stroke();

  // center line
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, mid + 0.5);
  ctx.lineTo(cx + cw, mid + 0.5);
  ctx.stroke();

  ctx.restore();
}

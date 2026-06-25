"use client";
import { useState } from "react";
import { useActionLog, clearLog } from "./actionLog";
import { C, mono } from "./theme";

// TEMP on-screen debug panel: shows the most recent engine/UI actions so we can
// see exactly what each feature *did* when clicked (e.g. "applyClipOps eq-high, +0"
// reveals a neutral-value bug). Toggle with the floating LOG button.

export default function ActionLog() {
  const [open, setOpen] = useState(false);
  const entries = useActionLog();

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="Toggle debug action log"
        style={{
          position: "fixed", bottom: 8, right: 8, zIndex: 2000,
          padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontFamily: mono,
          fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
          border: `1px solid ${open ? C.accent : C.line}`,
          background: open ? C.accent : C.bg2, color: open ? "#06231a" : C.text3,
        }}>
        LOG{entries.length ? ` ${entries.length}` : ""}
      </button>

      {open && (
        <div style={{
          position: "fixed", bottom: 38, right: 8, zIndex: 2000,
          width: 340, maxHeight: "55vh", display: "flex", flexDirection: "column",
          background: "rgba(10,12,16,0.97)", border: `1px solid ${C.lineBright}`,
          borderRadius: 8, boxShadow: "0 12px 40px rgba(0,0,0,0.7)", overflow: "hidden",
        }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
            borderBottom: `1px solid ${C.line}`, flexShrink: 0,
          }}>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: C.accent }}>ACTION LOG</span>
            <span style={{ fontSize: 9, color: C.text4 }}>newest first</span>
            <button onClick={clearLog} style={{
              marginLeft: "auto", fontSize: 9, fontWeight: 700, cursor: "pointer",
              background: "transparent", color: C.text3, border: `1px solid ${C.line}`,
              borderRadius: 4, padding: "2px 7px", fontFamily: mono,
            }}>CLEAR</button>
          </div>
          <div style={{ overflowY: "auto", padding: "4px 0" }}>
            {entries.length === 0 && (
              <div style={{ padding: "12px 10px", fontSize: 11, color: C.text4 }}>
                No actions yet — click a feature (fader, effect, region op…) and watch.
              </div>
            )}
            {entries.map(e => (
              <div key={e.id} style={{
                display: "flex", alignItems: "baseline", gap: 8, padding: "3px 10px",
                fontFamily: mono, fontSize: 11, borderBottom: `1px solid rgba(255,255,255,0.03)`,
              }}>
                <span style={{ color: C.text4, fontSize: 9, width: 54, flexShrink: 0 }}>
                  {new Date(e.t).toLocaleTimeString([], { hour12: false })}
                </span>
                <span style={{ color: e.source === "engine" ? C.accent : "#c4a96e", fontWeight: 700, flexShrink: 0 }}>
                  {e.name}
                </span>
                <span style={{ color: C.text2, wordBreak: "break-all" }}>{e.detail}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

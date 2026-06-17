"use client";
import { useEffect, useState } from "react";
import { api } from "../lib/api";

type Phase = "checking" | "locked" | "unlocked" | "offline";

/**
 * Wraps the whole app. On launch it asks the backend whether activation is
 * required and whether this machine is already activated. If a license is
 * required and missing, it renders a full-screen activation panel instead of
 * the app. In dev (license not required) it falls straight through.
 */
export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    // The window opens instantly but the engine takes a few seconds to boot,
    // so the first status check usually fails. Retry for a while before giving
    // up — only show the "offline" screen if it truly never comes up.
    const deadline = Date.now() + 45000;
    const check = () => {
      api.licenseStatus()
        .then((s) => {
          if (cancelled) return;
          if (!s.required || s.activated) setPhase("unlocked");
          else setPhase("locked");
        })
        .catch(() => {
          if (cancelled) return;
          if (Date.now() < deadline) setTimeout(check, 700);
          else setPhase("offline");
        });
    };
    check();
    return () => { cancelled = true; };
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api.activate(key.trim());
      setPhase("unlocked");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "unlocked") return <>{children}</>;

  // Full-screen overlay for every non-unlocked state.
  return (
    <div style={screen}>
      <div style={card}>
        <div style={logoRow}>
          <div style={logoMark}>
            <span style={{ display: "flex", gap: 3, alignItems: "flex-end" }}>
              <i style={{ ...bar, height: 12 }} />
              <i style={{ ...bar, height: 20 }} />
              <i style={{ ...bar, height: 9 }} />
              <i style={{ ...bar, height: 16 }} />
            </span>
          </div>
          <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: -0.5 }}>StemAI</span>
        </div>

        {phase === "checking" && (
          <p style={dim}>Starting up…</p>
        )}

        {phase === "offline" && (
          <>
            <h1 style={h1}>Can’t reach the engine</h1>
            <p style={dim}>
              The StemAI engine isn’t running yet. Give it a moment after launch —
              it can take ~10s to boot the first time.
            </p>
            <button style={btn} onClick={() => location.reload()}>Retry</button>
          </>
        )}

        {phase === "locked" && (
          <>
            <h1 style={h1}>Activate StemAI</h1>
            <p style={dim}>
              Paste the license key from your Gumroad purchase email. You only do
              this once — after that StemAI works fully offline.
            </p>
            <form onSubmit={submit} style={{ width: "100%" }}>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX"
                spellCheck={false}
                autoFocus
                style={input}
              />
              {error && <p style={errStyle}>{error}</p>}
              <button type="submit" disabled={busy || !key.trim()} style={{ ...btn, opacity: busy || !key.trim() ? 0.5 : 1 }}>
                {busy ? "Verifying…" : "Activate"}
              </button>
            </form>
            <p style={{ ...dim, fontSize: 12, marginTop: 14 }}>
              Lost your key? Check your Gumroad receipt, or email support.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const GREEN = "#1db954";
const GREEN_BRIGHT = "#1ed760";

const screen: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 9999,
  background: "#0a0a0a", color: "#fff",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};
const card: React.CSSProperties = {
  width: "min(440px, 90vw)", padding: 36, borderRadius: 18,
  background: "#161616", border: "1px solid #272727",
  boxShadow: "0 24px 70px rgba(0,0,0,.6)",
  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14,
};
const logoRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 };
const logoMark: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 9, background: GREEN,
  display: "flex", alignItems: "center", justifyContent: "center",
};
const bar: React.CSSProperties = { width: 3, background: "#000", borderRadius: 2, display: "block" };
const h1: React.CSSProperties = { fontSize: 22, fontWeight: 800, margin: 0, letterSpacing: -0.4 };
const dim: React.CSSProperties = { fontSize: 14, color: "#a7a7a7", lineHeight: 1.5, margin: 0 };
const input: React.CSSProperties = {
  width: "100%", marginTop: 16, padding: "13px 14px", borderRadius: 10,
  background: "#0a0a0a", border: "1px solid #272727", color: "#fff",
  fontSize: 14, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  outline: "none", letterSpacing: 0.5,
};
const btn: React.CSSProperties = {
  width: "100%", marginTop: 14, padding: "13px 14px", borderRadius: 500,
  background: `linear-gradient(to bottom, ${GREEN_BRIGHT}, ${GREEN})`,
  color: "#000", fontWeight: 800, fontSize: 15, border: "none", cursor: "pointer",
};
const errStyle: React.CSSProperties = {
  color: "#f87171", fontSize: 13, marginTop: 10, marginBottom: 0,
};

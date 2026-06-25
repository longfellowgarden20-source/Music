"use client";
import { useEffect, useState } from "react";
import { api, type GroqKeyInfo } from "../lib/api";

// App settings. Home for the user's own (optional) Groq AI key, license info, and
// future preferences. The Producer chat also has an inline key shortcut, but this
// is the canonical place people look for "Settings".

export default function SettingsPage() {
  // ── Groq / Producer AI keys ──
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [keys, setKeys] = useState<GroqKeyInfo[]>([]);
  const [keyVal, setKeyVal] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── license ──
  const [license, setLicense] = useState<{ required: boolean; activated: boolean; email: string } | null>(null);

  useEffect(() => {
    api.groqKeyStatus().then(r => { setAiOn(r.configured); setKeys(r.keys); }).catch(() => setAiOn(false));
    api.licenseStatus().then(setLicense).catch(() => {});
  }, []);

  const addKey = async () => {
    if (!keyVal.trim()) return;
    setSavingKey(true); setKeyMsg(null);
    try {
      const r = await api.addGroqKey(keyVal.trim());
      setAiOn(r.configured); setKeys(r.keys); setKeyVal("");
      setKeyMsg({ ok: true, text: "✓ Key verified and added — smart mode is on." });
    } catch (e) {
      // backend returns a clear message when the key fails its test call
      setKeyMsg({ ok: false, text: (e as Error).message || "That key didn't work." });
    }
    setSavingKey(false);
  };

  const removeKey = async (raw: string | null) => {
    if (!raw) return;
    try {
      const r = await api.removeGroqKey(raw);
      setAiOn(r.configured); setKeys(r.keys);
    } catch { /* noop */ }
  };

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "32px 24px", display: "flex", flexDirection: "column", gap: 24 }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: -0.5 }}>Settings</h1>

      {/* ── Producer AI ── */}
      <section style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 style={h2}>Producer AI</h2>
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", marginLeft: "auto" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: aiOn ? "#1ed760" : "#6c6c78" }} />
            {aiOn === null ? "Checking…" : aiOn ? "Smart mode on" : "Basic mode"}
          </span>
        </div>
        <p style={p}>
          Adding your own AI key <strong style={{ color: "var(--text)" }}>noticeably enhances the
          Producer experience.</strong> Without one, the chat understands common commands
          ("add drums", "make it slower", "master it"). <strong style={{ color: "var(--text)" }}>With
          a key</strong>, you can talk to it like a real producer — nuanced, multi-part requests like
          <em> "make it dreamier and more spacious with a half-time groove and a warmer low end"</em> —
          and it understands intent, mood, and combinations far more accurately.
        </p>
        <p style={p}>
          The key is <strong style={{ color: "var(--text)" }}>free</strong>, stored locally on your
          machine, and never shared. You can add <strong style={{ color: "var(--text)" }}>more than one</strong> —
          they're rotated automatically, so if one hits its free rate limit, the next keeps you going.
        </p>
        <ol style={{ ...p, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          <li>Get a free key at <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer" style={a}>console.groq.com/keys</a> (starts with <code>gsk_</code>)</li>
          <li>Paste it below — we verify it works before saving.</li>
        </ol>

        {/* existing keys */}
        {keys.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {keys.map((k, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 11px",
                background: "var(--bg, #0b0e13)", border: "1px solid var(--bg3)", borderRadius: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1ed760", flexShrink: 0 }} />
                <code style={{ fontSize: 12, color: "var(--text)" }}>{k.masked}</code>
                {k.removable
                  ? <button className="btn" style={{ marginLeft: "auto", fontSize: 11, padding: "3px 10px" }} onClick={() => removeKey(k.raw)}>Remove</button>
                  : <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--muted)" }}>from environment</span>}
              </div>
            ))}
          </div>
        )}

        {/* add a key */}
        <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
          <input className="input" type="password" placeholder="gsk_…  (add a key)" value={keyVal}
            onChange={e => setKeyVal(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addKey(); }} />
          <button className="btn btn-primary" disabled={savingKey || !keyVal.trim()} onClick={addKey}>
            {savingKey ? <span className="spinner" /> : "Verify & add"}
          </button>
        </div>
        {keyMsg && <div style={{ fontSize: 12, marginTop: 4, color: keyMsg.ok ? "#1ed760" : "#e0564e" }}>{keyMsg.text}</div>}
      </section>

      {/* ── License ── */}
      <section style={card}>
        <h2 style={h2}>License</h2>
        {!license ? <p style={p}>Loading…</p> : license.activated ? (
          <p style={p}>✓ Activated{license.email ? ` — ${license.email}` : ""}.</p>
        ) : (
          <p style={p}>{license.required ? "Not activated." : "No license required."}</p>
        )}
      </section>

      {/* ── Acknowledgements (required attribution for the AI music engine) ── */}
      <section style={card}>
        <h2 style={h2}>Acknowledgements</h2>
        <p style={{ ...p, fontWeight: 700, color: "var(--text)" }}>Powered by Stability AI</p>
        <p style={p}>
          Music is generated with Stable Audio 3, licensed under the{" "}
          <a href="https://stability.ai/license" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Stability AI Community License
          </a>. This product includes a T5Gemma text encoder, provided under and subject to the{" "}
          <a href="https://ai.google.dev/gemma/terms" target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>
            Gemma Terms of Use
          </a>.
        </p>
      </section>
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--bg1)", border: "1px solid var(--line)", borderRadius: 12,
  padding: 20, display: "flex", flexDirection: "column", gap: 10,
};
const h2: React.CSSProperties = { fontSize: 15, fontWeight: 800 };
const p: React.CSSProperties = { fontSize: 13, color: "var(--muted)", lineHeight: 1.6, margin: 0 };
const a: React.CSSProperties = { color: "var(--accent)", textDecoration: "none" };

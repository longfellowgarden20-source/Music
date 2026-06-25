import type { Metadata } from "next";
import { MiniNav, MiniFooter, T } from "../_shared/ui";
import BuyButton from "./BuyButton";

export const metadata: Metadata = {
  title: "Get StemAI — $49 one-time",
  description: "Buy StemAI: a one-time $49 purchase for the full local AI music studio. Mac, Windows, Linux. 14-day refund.",
};

const INCLUDES = [
  "AI beat generation from text prompts",
  "Extend, loop & generate variations",
  "6-stem AI separation",
  "Full DAW with per-stem FX & automation",
  "Export full mix or stems as WAV",
  "Runs 100% offline",
  "Free updates for life",
];

export default function Buy() {
  return (
    <div style={{ background: T.bg, color: T.text, minHeight: "100vh" }}>
      <MiniNav />
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "64px max(24px,5vw) 100px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "start" }} className="v2buy">
          {/* left — pitch */}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.green, letterSpacing: 2, textTransform: "uppercase", marginBottom: 16 }}>Checkout</div>
            <h1 style={{ fontSize: "clamp(34px,5vw,56px)", fontWeight: 900, letterSpacing: -2, lineHeight: 1.02, marginBottom: 20 }}>
              One payment.<br />Yours forever.
            </h1>
            <p style={{ fontSize: 16, color: T.muted, lineHeight: 1.7, maxWidth: 420, marginBottom: 32 }}>
              No subscription, no export limits, no account. Pay once and own the
              full StemAI studio on every computer you use.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {INCLUDES.map(x => (
                <div key={x} style={{ display: "flex", gap: 11, fontSize: 15, color: "#e3e3e3" }}>
                  <span style={{ color: T.green, fontWeight: 800, flexShrink: 0 }}>✓</span>{x}
                </div>
              ))}
            </div>
          </div>

          {/* right — purchase card */}
          <div style={{ background: T.bg2, border: `1px solid ${T.green}44`, borderRadius: 24, padding: "40px 36px", boxShadow: `0 0 90px ${T.green}12`, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 20, right: 20, fontSize: 11, fontWeight: 800, color: T.green, background: `${T.green}18`, border: `1px solid ${T.green}44`, borderRadius: 500, padding: "5px 12px", letterSpacing: 0.5 }}>
              LIFETIME LICENSE
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.green, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 18 }}>StemAI — full version</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 80, fontWeight: 900, letterSpacing: -3, lineHeight: 1 }}>$49</span>
              <span style={{ fontSize: 16, color: T.faint, fontWeight: 600 }}>one-time</span>
            </div>
            <div style={{ fontSize: 14, color: T.muted, marginBottom: 30 }}>Mac · Windows · Linux</div>

            <BuyButton />

            <div style={{ marginTop: 18, display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap", fontSize: 12, color: T.faint }}>
              <span>🔒 Secure checkout</span>
              <span>↓ Instant download</span>
              <span>↩ 14-day refund</span>
            </div>
            <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${T.line}`, fontSize: 12, color: T.faint, lineHeight: 1.6, textAlign: "center" }}>
              After payment you&rsquo;ll get a download link and a license key by email.
            </div>
          </div>
        </div>
      </main>
      <MiniFooter />
      <style>{`@media (max-width:760px){ .v2buy{ grid-template-columns:1fr !important; } }`}</style>
    </div>
  );
}

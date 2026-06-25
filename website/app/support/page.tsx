import type { Metadata } from "next";
import { MiniNav, MiniFooter, T } from "../_shared/ui";

export const metadata: Metadata = {
  title: "Support — StemAI",
  description: "Get help with StemAI: activation, downloads, refunds, and troubleshooting.",
};

// TODO: replace with your real support inbox before launch.
const SUPPORT_EMAIL = "support@stemai.app";

const TOPICS = [
  { t: "Activation & license keys", d: "Lost your key, moved to a new machine, or seeing an activation error? Email us your order email and we'll sort it." },
  { t: "Downloads & installation", d: "Trouble downloading or installing on Mac, Windows, or Linux? Tell us your OS and what you see." },
  { t: "Refunds", d: "Within 14 days of purchase and it's not for you? Email us — no questions asked." },
  { t: "Bugs & feedback", d: "Found something broken or have an idea? We read everything and ship updates for free." },
];

export default function Support() {
  return (
    <div style={{ background: T.bg, color: T.text, minHeight: "100vh" }}>
      <MiniNav />
      <main style={{ maxWidth: 820, margin: "0 auto", padding: "72px max(24px,5vw) 100px" }}>
        <h1 style={{ fontSize: "clamp(32px,5vw,52px)", fontWeight: 900, letterSpacing: -1.5, marginBottom: 14 }}>Support</h1>
        <p style={{ fontSize: 17, color: T.muted, lineHeight: 1.6, maxWidth: 560, marginBottom: 32 }}>
          A real person reads every message. Email us and we&rsquo;ll usually reply
          within one business day.
        </p>

        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          style={{ display: "inline-flex", alignItems: "center", gap: 10, background: T.green, color: "#000", fontSize: 16, fontWeight: 800, padding: "14px 28px", borderRadius: 500, textDecoration: "none", marginBottom: 56 }}
        >
          ✉ {SUPPORT_EMAIL}
        </a>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 18 }} className="v2support">
          {TOPICS.map(x => (
            <div key={x.t} style={{ background: T.bg2, border: `1px solid ${T.line}`, borderRadius: 14, padding: "24px 24px" }}>
              <div style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>{x.t}</div>
              <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.6 }}>{x.d}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 40, fontSize: 14, color: T.muted }}>
          Looking for answers fast? Check the{" "}
          <a href="/#faq" style={{ color: T.green, textDecoration: "none", fontWeight: 700 }}>FAQ</a>.
        </div>
      </main>
      <MiniFooter />
      <style>{`@media (max-width:640px){ .v2support{ grid-template-columns:1fr !important; } }`}</style>
    </div>
  );
}

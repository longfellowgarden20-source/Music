import type { Metadata } from "next";
import { MiniNav, MiniFooter, T } from "../../_shared/ui";

export const metadata: Metadata = {
  title: "Thank you — StemAI",
  description: "Your StemAI purchase is complete.",
};

export default function Success() {
  return (
    <div style={{ background: T.bg, color: T.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <MiniNav />
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px max(24px,5vw)" }}>
        <div style={{ maxWidth: 520, textAlign: "center" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: `${T.green}1a`, border: `1px solid ${T.green}55`, color: T.green, fontSize: 34, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 28px" }}>✓</div>
          <h1 style={{ fontSize: "clamp(30px,5vw,46px)", fontWeight: 900, letterSpacing: -1.5, marginBottom: 16 }}>You&rsquo;re in.</h1>
          <p style={{ fontSize: 16, color: T.muted, lineHeight: 1.7, marginBottom: 32 }}>
            Thanks for buying StemAI. Your download link and license key are on
            their way to your email — check your inbox (and spam, just in case).
            Didn&rsquo;t get it within a few minutes?{" "}
            <a href="/support" style={{ color: T.green, textDecoration: "none", fontWeight: 700 }}>We&rsquo;ll help →</a>
          </p>
          <a href="/" style={{ display: "inline-block", border: `1px solid ${T.line}`, color: "#fff", fontSize: 15, fontWeight: 700, padding: "13px 30px", borderRadius: 500, textDecoration: "none" }}>
            Back to home
          </a>
        </div>
      </main>
      <MiniFooter />
    </div>
  );
}

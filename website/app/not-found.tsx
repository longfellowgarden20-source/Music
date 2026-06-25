import { MiniNav, MiniFooter, T } from "./_shared/ui";

export default function NotFound() {
  return (
    <div style={{ background: T.bg, color: T.text, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <MiniNav />
      <main style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "80px max(24px,5vw)", textAlign: "center" }}>
        <div style={{ maxWidth: 460 }}>
          <div style={{ fontSize: "clamp(72px,16vw,140px)", fontWeight: 900, letterSpacing: -6, lineHeight: 1, color: T.green }}>404</div>
          <h1 style={{ fontSize: "clamp(22px,4vw,32px)", fontWeight: 800, letterSpacing: -1, margin: "12px 0 14px" }}>This track doesn&rsquo;t exist</h1>
          <p style={{ fontSize: 16, color: T.muted, lineHeight: 1.6, marginBottom: 30 }}>
            The page you&rsquo;re looking for isn&rsquo;t here. Let&rsquo;s get you back to the studio.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <a href="/" style={{ background: T.green, color: "#000", fontSize: 15, fontWeight: 800, padding: "13px 28px", borderRadius: 500, textDecoration: "none" }}>Home</a>
            <a href="/buy" style={{ border: `1px solid ${T.line}`, color: "#fff", fontSize: 15, fontWeight: 700, padding: "13px 28px", borderRadius: 500, textDecoration: "none" }}>Get StemAI</a>
          </div>
        </div>
      </main>
      <MiniFooter />
    </div>
  );
}

"use client";

// ── swap this one line when you have your Suno referral link ──────────────
const SUNO_REFERRAL_URL = "https://suno.com"; // TODO: replace with your referral link

const FEATURES = [
  { label: "Sung", sub: "Melodic, pitched vocals" },
  { label: "Rap", sub: "Rhythmic, on-beat bars" },
  { label: "Spoken", sub: "Narration & spoken word" },
  { label: "50+ voices", sub: "Male, female, genre-matched" },
];

export default function VocalsPage() {
  return (
    <div style={{
      minHeight: "calc(100vh - 56px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "48px 24px",
    }}>
      <div style={{ maxWidth: 480, width: "100%" }}>

        {/* Wordmark */}
        <div style={{ marginBottom: 36 }}>
          <div style={{
            display: "inline-block",
            fontSize: 10, fontWeight: 800, letterSpacing: 2.5,
            textTransform: "uppercase", color: "var(--accent)",
            marginBottom: 14,
          }}>
            Vocals
          </div>
          <h1 style={{
            margin: 0, fontSize: 36, fontWeight: 900,
            letterSpacing: -1, lineHeight: 1.1, color: "var(--text)",
          }}>
            Add a voice<br />to your track.
          </h1>
          <p style={{
            marginTop: 14, fontSize: 14, color: "var(--muted)",
            lineHeight: 1.7, maxWidth: 380,
          }}>
            Sung, rapped, or spoken — generated in seconds.
            Powered by Suno, the industry standard for AI vocals.
          </p>
        </div>

        {/* Feature grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          gap: 10, marginBottom: 32,
        }}>
          {FEATURES.map(f => (
            <div key={f.label} style={{
              background: "var(--bg2)", border: "1px solid var(--line)",
              borderRadius: 12, padding: "14px 16px",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 3 }}>
                {f.label}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted2)" }}>{f.sub}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div style={{
          background: "var(--bg2)", border: "1px solid var(--line)",
          borderRadius: 16, padding: "24px",
        }}>
          <div style={{
            fontSize: 13, color: "var(--muted)", lineHeight: 1.65, marginBottom: 20,
          }}>
            Sign up free and get{" "}
            <span style={{ color: "var(--text)", fontWeight: 700 }}>250 credits</span>
            {" "}— enough to generate your first vocals immediately. No card required.
          </div>

          <a
            href={SUNO_REFERRAL_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "block", width: "100%", padding: "14px 0",
              borderRadius: 10, textDecoration: "none", textAlign: "center",
              background: "var(--accent)",
              color: "#000", fontWeight: 800, fontSize: 14,
              letterSpacing: 0.2, transition: "opacity .15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            Open Suno
          </a>

          <div style={{
            display: "flex", justifyContent: "space-between",
            marginTop: 16, paddingTop: 16,
            borderTop: "1px solid var(--line)",
          }}>
            <span style={{ fontSize: 12, color: "var(--muted2)" }}>Free account · No card required</span>
            <a
              href={SUNO_REFERRAL_URL}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: "var(--muted2)", textDecoration: "none" }}
            >
              Already have Suno?
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}

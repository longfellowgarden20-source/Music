"use client";
import { useState } from "react";
import { API, fmtTime, type Track } from "../lib/api";

const SOUNDCLOUD_UPLOAD = "https://soundcloud.com/upload"; // user's own upload page

type Status = "idle" | "uploading" | "done" | "error";

export default function ShareTrack({ track }: { track: Track }) {
  const [status, setStatus] = useState<Status>("idle");
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(false);

  async function share() {
    setOpen(true);
    setStatus("uploading");
    try {
      // Upload via backend — avoids browser CSP restrictions on direct uploads
      const res = await fetch(`${API}/api/track/${track.id}/share`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || "Upload failed");
      }
      const { url } = await res.json();
      setShareUrl(url);
      setStatus("done");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Seamless SoundCloud upload: download the WAV, then open the user's own
  // SoundCloud upload page so they just drag the freshly-saved file in.
  // (SoundCloud closed its upload API, so a true one-click push isn't possible —
  // this gets them from StemAI to their upload screen in one tap.)
  function uploadToSoundCloud() {
    const a = document.createElement("a");
    a.href = `${API}/api/download/${track.id}`;
    a.download = `${track.title || "track"}.wav`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => window.open(SOUNDCLOUD_UPLOAD, "_blank", "noreferrer"), 600);
  }

  const caption = `"${track.title}" — made with StemAI`;

  return (
    <div style={{ marginTop: 12 }}>
      <button
        onClick={open ? () => setOpen(false) : share}
        disabled={status === "uploading"}
        className="btn"
        style={{
          width: "100%", fontSize: 13, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        {status === "uploading"
          ? <><span className="spinner" /> Uploading…</>
          : open ? "Close" : "Share track"}
      </button>

      {open && (
        <div style={{
          marginTop: 12, background: "var(--bg2)", border: "1px solid var(--line)",
          borderRadius: 14, padding: "20px 22px",
          display: "flex", flexDirection: "column", gap: 14,
          animation: "fadeUp .25s ease both",
        }}>

          {status === "error" && (
            <p style={{ color: "var(--red)", fontSize: 13, margin: 0 }}>
              Upload failed. Check your internet connection and try again.
            </p>
          )}

          {status === "done" && shareUrl && (
            <>
              {/* Track info */}
              <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 14 }}>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 2 }}>{track.title}</div>
                <div style={{ fontSize: 12, color: "var(--muted)", display: "flex", gap: 10 }}>
                  {track.bpm && <span>{Math.round(track.bpm)} BPM</span>}
                  {track.key && <span>{track.key}</span>}
                  <span>{fmtTime(track.duration)}</span>
                  <span style={{ color: "var(--accent)" }}>Made with StemAI</span>
                </div>
              </div>

              {/* Playable link */}
              <div>
                <SectionLabel>Playable link</SectionLabel>
                <div style={{
                  display: "flex", gap: 8, alignItems: "center",
                  background: "var(--bg3)", borderRadius: 8, padding: "10px 12px",
                }}>
                  <span style={{
                    flex: 1, fontSize: 12, color: "var(--muted)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{shareUrl}</span>
                  <button
                    onClick={() => copy(shareUrl)}
                    className="btn"
                    style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>

              {/* Seamless SoundCloud upload — downloads the track + opens the
                  user's own upload page, ready to drag the file in. */}
              <button onClick={uploadToSoundCloud}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  border: "none", cursor: "pointer", width: "100%",
                  fontSize: 13, fontWeight: 700,
                  background: "linear-gradient(95deg, #ff7700, #ff3300)",
                  color: "#fff", borderRadius: 8, padding: "11px 0",
                }}>
                ☁ Upload to SoundCloud
              </button>
              <p style={{ fontSize: 10, color: "var(--muted2)", margin: "-4px 0 0", textAlign: "center" }}>
                Saves the track, then opens your SoundCloud upload page — just drag the file in.
              </p>

              {/* Caption */}
              <div>
                <SectionLabel>Caption (paste anywhere)</SectionLabel>
                <div style={{
                  background: "var(--bg3)", borderRadius: 8, padding: "10px 12px",
                  fontSize: 12, color: "var(--muted)", lineHeight: 1.7,
                  whiteSpace: "pre-wrap", wordBreak: "break-word",
                }}>
                  {caption}
                </div>
                <button
                  onClick={() => copy(caption)}
                  className="btn"
                  style={{ width: "100%", marginTop: 8, fontSize: 12 }}
                >
                  Copy caption
                </button>
              </div>

              {/* Post buttons */}
              <div style={{ display: "flex", gap: 8 }}>
                {[
                  { label: "Twitter / X", url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption + "\n" + shareUrl)}` },
                  { label: "Reddit", url: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`"${track.title}" — made with StemAI`)}` },
                ].map(b => (
                  <a key={b.label} href={b.url} target="_blank" rel="noreferrer"
                    className="btn"
                    style={{ flex: 1, textDecoration: "none", fontSize: 12, fontWeight: 700, textAlign: "center", padding: "8px 0" }}>
                    {b.label}
                  </a>
                ))}
              </div>

              <p style={{ fontSize: 11, color: "var(--muted2)", margin: 0, lineHeight: 1.5 }}>
                Link hosted on catbox.moe · no account needed · direct audio URL
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 800, letterSpacing: 1.5,
      textTransform: "uppercase", color: "var(--muted)", marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

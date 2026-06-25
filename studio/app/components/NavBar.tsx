"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/",          label: "Library"   },
  { href: "/playlists", label: "Playlists" },
  { href: "/generate",  label: "Generate"  },
  { href: "/song",      label: "Song"      },
  { href: "/mashup",    label: "Mashup"    },
  { href: "/vocals",    label: "Vocals"    },
  { href: "/youtube",   label: "YouTube"   },
  { href: "/guide",     label: "Guide"     },
];

export default function NavBar() {
  const path = usePathname();
  const active = (href: string) =>
    href === "/" ? path === "/" : path.startsWith(href);

  // DAW is full-screen — hide nav entirely
  if (path.startsWith("/daw")) return null;

  // Edit Studio is only shown when we're actually in it (arrived via track card)
  const inEdit = path.startsWith("/edit");

  return (
    <nav style={{
      height: 56, background: "var(--bg1)", borderBottom: "1px solid var(--line)",
      display: "flex", alignItems: "center", gap: 26, padding: "0 24px",
      position: "sticky", top: 0, zIndex: 40
    }}>
      <Link href="/" style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          fontSize: 17, fontWeight: 900, letterSpacing: -0.5,
          background: "linear-gradient(90deg,#1ed760,#1db954)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
        }}>
          ♫ StemAI
        </div>
      </Link>
      <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
        {LINKS.map(l => (
          <Link key={l.href} href={l.href} style={{
            textDecoration: "none", fontSize: 13, fontWeight: 600,
            padding: "7px 14px", borderRadius: 8,
            color: active(l.href) ? "var(--text)" : "var(--muted)",
            background: active(l.href) ? "var(--bg3)" : "transparent",
            transition: "all .15s"
          }}>{l.label}</Link>
        ))}

        {/* Only show DAW tab when a track is open */}
        {inEdit && (
          <div style={{
            fontSize: 13, fontWeight: 600, padding: "7px 14px", borderRadius: 8,
            color: "var(--text)", background: "var(--bg3)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", display: "inline-block" }} />
            DAW
          </div>
        )}
      </div>

      {/* Settings — pinned to the far right */}
      <Link href="/settings" title="Settings" style={{
        marginLeft: "auto", textDecoration: "none", fontSize: 18, lineHeight: 1,
        padding: "7px 12px", borderRadius: 8,
        color: active("/settings") ? "var(--text)" : "var(--muted)",
        background: active("/settings") ? "var(--bg3)" : "transparent",
      }}>⚙</Link>
    </nav>
  );
}

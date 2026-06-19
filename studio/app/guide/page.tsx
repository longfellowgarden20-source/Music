"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function GuidePage() {
  const router = useRouter();
  return (
    <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 24px 100px" }}>
      {/* header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 30, fontWeight: 900, letterSpacing: -0.5, margin: 0 }}>
          How StemAI works
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 15, marginTop: 8, lineHeight: 1.6 }}>
          A quick tour of every feature — where to find it and what it does. New here?
          Start with <b style={{ color: "var(--text)" }}>Generate</b> to make your first track,
          then open it in the <b style={{ color: "var(--text)" }}>DAW</b> to mix it.
        </p>
      </div>

      {/* quick start */}
      <Section title="🚀 Quick start" accent>
        <Step n={1} title="Generate a track">
          Go to <PageLink href="/generate" router={router}>Generate</PageLink>, describe the music you
          want (or pick genres/moods), and hit Generate. It saves to your Library.
        </Step>
        <Step n={2} title="Find it in your Library">
          The <PageLink href="/" router={router}>Library</PageLink> is your home base — every track
          you make or import lives here. Play, rate, tag, and filter them.
        </Step>
        <Step n={3} title="Open it in the DAW to mix">
          Click <b>Open in DAW</b> on any track. It auto-splits into stems (drums, bass, vocals…) so
          you can remix, add effects, and export.
        </Step>
        <Step n={4} title="Export or complete it">
          Use <b>Edit</b> to build a short clip into a full song, or the <b>↓ export</b> menu to
          download as MP3/WAV/FLAC, stems, or MIDI.
        </Step>
      </Section>

      {/* the pages */}
      <Section title="🧭 The main pages">
        <Feature icon="📚" title="Library" href="/" router={router}>
          Your collection of every track. <b>Search</b> by name, <b>filter</b> by BPM range, key,
          or tag, and <b>sort</b> by newest/longest/top-rated. Click a track title or the
          <b> ⓘ</b> button to see full generation details (prompt, seed, guidance — everything
          needed to reproduce it). Turn on <b>Select</b> for bulk actions (tag, move, delete several
          at once). Drag-and-drop audio files anywhere to import them.
        </Feature>

        <Feature icon="✨" title="Generate" href="/generate" router={router}>
          Make new music from a text prompt. Add genres, moods, and instruments, or type
          <i> &quot;sounds like…&quot;</i> and let AI write the prompt. Controls:
          <b> Duration</b>, <b>Model</b> (Small = fast, Medium = better),
          <b> Guidance</b> (how closely it follows the prompt), <b>Temperature</b> (randomness),
          and <b>Seed</b> (leave blank for a fresh result, or set one to reproduce an exact track).
        </Feature>

        <Feature icon="🎛" title="DAW (multitrack studio)" href="/" router={router} hrefLabel="open a track → Open in DAW">
          A full mixing studio. Your track is split into <b>stems</b> on its own tracks. You get:
          per-track <b>volume / pan / mute / solo</b>, a <b>color picker</b> (click the colored strip
          on a track), an <b>effects rack</b> (EQ, reverb, delay, compression…), <b>automation</b>
          lanes, a <b>spectrum analyzer</b>, and a <b>LUFS meter</b> (shows loudness vs. the −14 LUFS
          streaming target). Transport has play/loop/metronome, <b>chord detection</b>, and keyboard
          shortcuts (Space = play, M = marker, ⌘Z = undo).
        </Feature>

        <Feature icon="🔧" title="Edit Studio" href="/" router={router} hrefLabel="open a track → Edit">
          Single-track editing &amp; AI tools. <b>AI Tweak</b> (&quot;less drums, more piano&quot;),
          <b> Region Editor</b> (regenerate just a section), <b>Extend</b> (continue the track), and
          <b> 🎼 Complete the song</b> — builds a short clip into a full ~72s arrangement
          (verse → chorus → bridge → outro). Also one-click presets (Bass Boost, Lo-Fi,
          Stream Master), pitch/speed/fade, and studio effects. Watch the top bar for progress on
          longer jobs.
        </Feature>

        <Feature icon="🎤" title="Vocals" href="/vocals" router={router}>
          Record your own vocals over a track, or generate AI vocals (lyrics + voice) to layer on
          top. Great for turning an instrumental into a full song.
        </Feature>

        <Feature icon="▶️" title="YouTube" href="/youtube" router={router}>
          Paste a YouTube link to import the audio, strip the vocals, and get a clean instrumental —
          all in one step. Useful for remixes and backing tracks.
        </Feature>
      </Section>

      {/* exporting */}
      <Section title="💾 Getting your music out">
        <Bullet><b>Download formats</b> — on any Library track, the <b>↓</b> button offers WAV, MP3,
          FLAC, AIFF, M4A, and OGG.</Bullet>
        <Bullet><b>MIDI</b> — export the detected melody as a <code>.mid</code> file to open in
          Ableton, Logic, etc.</Bullet>
        <Bullet><b>Stems</b> — download all separated stems as a <code>.zip</code>.</Bullet>
        <Bullet><b>Apple Music</b> — the <b>♫</b> button adds a track straight to your Apple Music
          library (Mac only).</Bullet>
      </Section>

      {/* tips */}
      <Section title="💡 Good to know">
        <Bullet><b>Complete the song takes a few minutes</b> — it generates 6 sections one after
          another. The top progress bar shows which section it&apos;s on. Don&apos;t worry if it sits on
          one section for ~a minute; that&apos;s normal.</Bullet>
        <Bullet><b>Reproduce a track</b> — open its details (ⓘ) and hit <b>Regenerate (same seed)</b>
          for an identical result, or <b>New variation</b> to keep the prompt but reroll.</Bullet>
        <Bullet><b>Tags &amp; filters</b> — tag tracks (loop, draft, banger…) and filter your Library
          by BPM/key/tag to find the right sample fast.</Bullet>
        <Bullet><b>Everything is local</b> — your tracks live on your computer, not the cloud.</Bullet>
      </Section>

      {/* cta */}
      <div style={{ display: "flex", gap: 12, marginTop: 32, flexWrap: "wrap" }}>
        <button className="btn btn-primary" style={{ padding: "11px 22px", fontSize: 14, fontWeight: 700 }}
          onClick={() => router.push("/generate")}>✨ Make your first track</button>
        <button className="btn" style={{ padding: "11px 22px", fontSize: 14 }}
          onClick={() => router.push("/")}>📚 Go to Library</button>
      </div>
    </div>
  );
}

function Section({ title, children, accent }: { title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={{
        fontSize: 18, fontWeight: 800, margin: "0 0 14px",
        color: accent ? "var(--accent2)" : "var(--text)",
      }}>{title}</h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function Feature({ icon, title, href, hrefLabel, router, children }: {
  icon: string; title: string; href: string; hrefLabel?: string;
  router: ReturnType<typeof useRouter>; children: React.ReactNode;
}) {
  return (
    <div className="card" style={{ padding: 16, display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{ fontSize: 24, lineHeight: 1, flexShrink: 0, marginTop: 2 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{title}</span>
          <button onClick={() => router.push(href)} style={{
            fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "var(--bg3)",
            border: "1px solid var(--line2)", borderRadius: 6, padding: "2px 9px", cursor: "pointer",
          }}>{hrefLabel || "open →"}</button>
        </div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.65 }}>{children}</div>
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: 14, display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div style={{
        width: 26, height: 26, borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(95deg,var(--accent),var(--accent2))",
        color: "#fff", fontSize: 13, fontWeight: 800,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>{n}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ color: "var(--accent)", fontWeight: 800, flexShrink: 0, marginTop: 1 }}>›</span>
      <div style={{ fontSize: 13.5, color: "var(--muted)", lineHeight: 1.65 }}>{children}</div>
    </div>
  );
}

function PageLink({ href, router, children }: { href: string; router: ReturnType<typeof useRouter>; children: React.ReactNode }) {
  return (
    <a onClick={(e) => { e.preventDefault(); router.push(href); }} href={href}
      style={{ color: "var(--accent2)", cursor: "pointer", fontWeight: 600 }}>{children}</a>
  );
}

import type { Metadata } from "next";
import "./globals.css";

const DESC =
  "Type a prompt — StemAI generates an original track, then lets you extend it, split it into stems, and mix it in a full DAW. One-time $49. Runs 100% offline.";

export const metadata: Metadata = {
  metadataBase: new URL("https://stemai.app"),
  title: "StemAI — Make the beat in your head",
  description: DESC,
  keywords: [
    "AI music generator", "text to music", "AI beat maker", "stem separation",
    "offline music studio", "local AI DAW", "royalty free music", "music production",
  ],
  openGraph: {
    title: "StemAI — Make the beat in your head",
    description: DESC,
    type: "website",
    siteName: "StemAI",
    images: [{ url: "/daw-screenshot.png", width: 1180, height: 737, alt: "StemAI DAW" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "StemAI — Make the beat in your head",
    description: DESC,
    images: ["/daw-screenshot.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "StemAI — AI Music Studio",
  description: "Strip any song into stems, remix with AI, export clean stems. Runs 100% locally on your machine.",
  openGraph: {
    title: "StemAI — AI Music Studio",
    description: "Strip any song into stems, remix with AI, export clean stems.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

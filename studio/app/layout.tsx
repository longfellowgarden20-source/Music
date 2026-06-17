import type { Metadata } from "next";
import "./globals.css";
import NavBar from "./components/NavBar";
import { PlayerProvider } from "./components/PlayerProvider";
import LicenseGate from "./components/LicenseGate";
import { ProgressProvider } from "./components/ProgressContext";

export const metadata: Metadata = {
  title: "AI Music Studio",
  description: "Generate, edit, and master AI music",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <LicenseGate>
          <ProgressProvider>
            <PlayerProvider>
              <NavBar />
              <main style={{ minHeight: "calc(100vh - 56px)" }}>{children}</main>
            </PlayerProvider>
          </ProgressProvider>
        </LicenseGate>
      </body>
    </html>
  );
}

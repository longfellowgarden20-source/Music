import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `export` emits a self-contained ./out folder we ship inside the app.
  // Electron serves it over a local http server (see desktop/main.js), so
  // absolute root-relative asset URLs resolve correctly on nested routes
  // like /generate/ — which file:// + "./" could not do.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;

import type { NextConfig } from "next";
import { resolveRelease } from "./lib/offline/release";

// the commit Vercel built from, so an error report and the service worker agree on the release
const release = resolveRelease();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_RELEASE: release,
    NEXT_PUBLIC_RELEASE_ENV: process.env.VERCEL_ENV ?? "development",
  },
  images: {
    // the 32 stickers are shown at 40px/56px; 1× and 2× only
    imageSizes: [40, 56, 80, 112],
    deviceSizes: [640, 1200],
    formats: ["image/webp"],
  },
};

export default nextConfig;

import type { NextConfig } from "next";

// the commit Vercel built from, so an error report can name the release it came from
const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    NEXT_PUBLIC_RELEASE: sha ? sha.slice(0, 7) : "local",
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

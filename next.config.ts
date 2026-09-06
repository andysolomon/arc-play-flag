import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    // the 32 stickers are shown at 40px/56px; 1× and 2× only
    imageSizes: [40, 56, 80, 112],
    deviceSizes: [640, 1200],
    formats: ["image/webp"],
  },
};

export default nextConfig;

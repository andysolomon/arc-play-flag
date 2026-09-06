import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flag Football Play Designer",
    short_name: "Play Designer",
    description: "A 5v5 flag-football whiteboard: drag players, hand out routes and coverages, save and export plays.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f4efe2",
    theme_color: "#fffdf6",
    icons: [
      { src: "/icons/app-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/app-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/app-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

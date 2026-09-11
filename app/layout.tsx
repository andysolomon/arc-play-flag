import type { Metadata, Viewport } from "next";
import type React from "react";
import { Patrick_Hand } from "next/font/google";
import { OfflineStatus } from "@/components/OfflineStatus";
import "./globals.css";

const patrickHand = Patrick_Hand({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-patrick-hand",
});

export const metadata: Metadata = {
  title: "Flag Football Play Designer",
  description:
    "A 5v5 flag-football whiteboard. Drag players on the field, tap one to give them a route or a coverage, save plays and export a PNG.",
};

export const viewport: Viewport = {
  themeColor: "#fffdf6",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${patrickHand.variable} h-full`}>
      <body className="h-full">
        {children}
        {process.env.NODE_ENV === "production" ? <OfflineStatus /> : null}
      </body>
    </html>
  );
}

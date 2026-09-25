import type { Metadata, Viewport } from "next";
import type React from "react";
import { Patrick_Hand } from "next/font/google";
import { OfflineStatus } from "@/components/OfflineStatus";
import { themeScript } from "@/lib/theme";
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
  // no themeColor: the inline theme script owns that tag, so it can follow a chosen theme too
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set by the inline script before hydration, so the server's <html> never has it
    <html lang="en" className={`${patrickHand.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">
        {children}
        {process.env.NODE_ENV === "production" ? <OfflineStatus /> : null}
      </body>
    </html>
  );
}

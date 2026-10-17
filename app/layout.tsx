import type { Metadata, Viewport } from "next";
import type React from "react";
import { Patrick_Hand } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { AccountSync } from "@/components/account/AccountSync";
import { OfflineStatus } from "@/components/OfflineStatus";
import { Repainting } from "@/components/Repainting";
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
    "A 5v5 flag-football whiteboard. Drag players on the field, tap one to give them a route or a coverage, press play to watch it run, then print wristbands and playbooks or share a link.",
};

export const viewport: Viewport = {
  // no themeColor: the inline theme script owns that tag, so it can follow a chosen theme too
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Clerk wraps the app only on a deployment with its keys; elsewhere accounts are the journeys' fixture, or off (lib/account/session.ts). */
const CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const app = (
    <>
      {children}
      <AccountSync />
    </>
  );
  return (
    // data-theme is set by the inline script before hydration, so the server's <html> never has it
    <html lang="en" className={`${patrickHand.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="h-full">
        {CLERK ? <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/">{app}</ClerkProvider> : app}
        <Repainting />
        {process.env.NODE_ENV === "production" ? <OfflineStatus /> : null}
      </body>
    </html>
  );
}

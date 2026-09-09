"use client";

import { Patrick_Hand } from "next/font/google";
import { ErrorRecovery } from "@/components/ErrorRecovery";
import "./globals.css";

const patrickHand = Patrick_Hand({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-patrick-hand",
});

/** The last resort: the root layout itself broke, so this draws its own document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className={`${patrickHand.variable} h-full`}>
      <body className="h-full">
        <title>Something broke · Flag Football Play Designer</title>
        <ErrorRecovery error={error} retry={retry} />
      </body>
    </html>
  );
}

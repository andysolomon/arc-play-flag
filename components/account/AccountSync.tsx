"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { start } from "@/lib/account/sync";

/** Clerk's hooks are loaded only on a deployment with its keys; a fork or the journeys never fetch them. */
const ClerkBridge = dynamic(() => import("./ClerkBridge"), { ssr: false });
const CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

/** Mounted once in the root layout: starts the account engine on every visit and keeps it told of sign-ins. */
export function AccountSync() {
  useEffect(() => { void start(); }, []);
  return CLERK ? <ClerkBridge /> : null;
}

"use client";

import { useAuth, useClerk } from "@clerk/nextjs";
import { useEffect, useRef } from "react";
import { accountChanged, registerAuthBridge } from "@/lib/account/sync";

/**
 * Inside Clerk's provider only: hands the sync engine Clerk's sign-out and profile, and tells it
 * when the signed-in coach changes without a page load (Clerk finishes sign-in with a client-side
 * navigation), so the device settles against the new account (lib/account/sync.ts).
 */
export function ClerkBridge() {
  const clerk = useClerk();
  const { isLoaded, userId } = useAuth();
  const seen = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    registerAuthBridge({ signOut: () => clerk.signOut(), openProfile: () => { clerk.openUserProfile(); } });
    return () => { registerAuthBridge(null); };
  }, [clerk]);
  useEffect(() => {
    if (!isLoaded) return;
    const id = userId ?? null;
    if (seen.current !== undefined && seen.current !== id) accountChanged();
    seen.current = id;
  }, [isLoaded, userId]);
  return null;
}

export default ClerkBridge;

"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { fixtureSignIn } from "@/lib/account/api";
import { useAccount } from "./AccountPanel";
import { Sticker } from "../Sticker";
import { pill, pillSm } from "../ui";

const CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
/** The journeys' coaches (lib/account/session.ts); a real deployment never lists them. */
const COACHES = [["otter", "Coach Otter"], ["heron", "Coach Heron"]] as const;

/**
 * Sign in, or sign up: Clerk's own form with the Google and X buttons its dashboard turns on; on a
 * deployment without Clerk, the browser journeys' fixture coaches, or a note that accounts are off.
 */
export function SignInScreen({ up = false }: { up?: boolean }) {
  const params = useSearchParams();
  const s = useAccount();
  const [error, setError] = useState<string | null>(null);
  const run = params.get("run") ?? "local";
  const onCoach = async (coach: string) => {
    try {
      await fixtureSignIn(coach, run);
      // a full load on purpose: the account engine settles the device against the new account from the start
      window.location.assign(new URL("/", window.location.origin).href);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sign in.");
    }
  };
  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5">
        <Link href="/" className={`${pillSm} inline-flex items-center !text-ink no-underline`}>‹ Designer</Link>
        <Sticker icon="roster" size={26} className="flex-none" priority />
        <h1 className="min-w-0 truncate text-header font-normal">{up ? "Create an account" : "Sign in"}</h1>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[520px] flex-col items-center gap-3 px-3 py-6">
          <p className="m-0 text-center text-base leading-body">
            An account keeps your plays, playbooks, team and lineups, and opens them on any device. Sign in with Google or X; your work on this device comes with you.
          </p>
          {CLERK ? (
            up
              ? <SignUp path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl="/" />
              : <SignIn path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl="/" />
          ) : s.mode === "fixture" ? (
            <div role="group" aria-label="Fixture coaches" className="flex w-full flex-col gap-2 rounded-tile border-2 border-dashed border-ink p-3">
              <span className="text-caption leading-note text-ink-muted">Browser journeys only: two coaches who do not exist, in run “{run}”.</span>
              {COACHES.map(([id, name]) => (
                <button key={id} type="button" onClick={() => { void onCoach(id); }} className={`${pill} min-h-11 px-4 text-small`}>Continue as {name}</button>
              ))}
              {error && <span role="alert" className="text-small">{error}</span>}
            </div>
          ) : s.mode === "off" ? (
            <span className="text-base text-ink-muted">Sign-in isn&apos;t set up on this deployment. Your work stays on this device.</span>
          ) : (
            <span className="text-base text-ink-muted">Checking…</span>
          )}
        </div>
      </div>
    </div>
  );
}

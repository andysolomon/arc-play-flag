"use client";

import { SignIn, SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { fixtureSignIn } from "@/lib/account/api";
import { previewInvite } from "@/lib/org/api";
import { useAccount } from "./AccountPanel";
import { Sticker } from "../Sticker";
import { pill, pillSm } from "../ui";

const CLERK = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
/** The journeys' coaches (lib/account/session.ts); a real deployment never lists them. */
const COACHES = [["otter", "Coach Otter"], ["heron", "Coach Heron"], ["ibis", "Coach Ibis"]] as const;

/**
 * Sign in, or sign up: Clerk's own form with the Google and X buttons its dashboard turns on; on a
 * deployment without Clerk, the browser journeys' fixture coaches, or a note that accounts are off.
 */
export function SignInScreen({ up = false }: { up?: boolean }) {
  const params = useSearchParams();
  const s = useAccount();
  const [error, setError] = useState<string | null>(null);
  const run = params.get("run") ?? "local";
  // an invite link (ADR 013, rule 4): the organization's name before sign-in, and the token carried on to the designer, which joins
  const token = params.get("invite");
  const [invited, setInvited] = useState<{ org: string } | { error: string } | null>(null);
  useEffect(() => {
    if (!token) return;
    previewInvite(token).then((p) => { setInvited({ org: p.org }); }, (e: unknown) => { setInvited({ error: e instanceof Error ? e.message : "That invite couldn't be read." }); });
  }, [token]);
  const after = token ? `/?invite=${encodeURIComponent(token)}` : "/";
  const onCoach = async (coach: string) => {
    try {
      await fixtureSignIn(coach, run);
      // a full load on purpose: the account engine settles the device against the new account from the start
      window.location.assign(new URL(after, window.location.origin).href);
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
          {invited && (
            <p role="status" className="m-0 w-full rounded-tile border-2 border-ink bg-yellow-soft px-3 py-2 text-center text-base leading-body" data-invite>
              {"org" in invited ? <>You&apos;re invited to <strong className="font-normal">{invited.org}</strong>. Sign in to join.</> : invited.error}
            </p>
          )}
          <p className="m-0 text-center text-base leading-body">
            An account keeps your plays, playbooks, team and lineups, the play on your board and how the app looks to you, so you pick up where you left off on any device. Sign in with Google or X; your work on this device comes with you.
          </p>
          {CLERK ? (
            up
              ? <SignUp path="/sign-up" signInUrl="/sign-in" fallbackRedirectUrl={after} />
              : <SignIn path="/sign-in" signUpUrl="/sign-up" fallbackRedirectUrl={after} />
          ) : s.mode === "fixture" ? (
            <div role="group" aria-label="Fixture coaches" className="flex w-full flex-col gap-2 rounded-tile border-2 border-dashed border-ink p-3">
              <span className="text-caption leading-note text-ink-muted">Browser journeys only: three coaches who do not exist, in run “{run}”.</span>
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

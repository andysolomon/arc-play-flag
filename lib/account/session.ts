import { auth, currentUser } from "@clerk/nextjs/server";
import type { AccountMode, AccountUser } from "./types";

/**
 * Who is signed in, on the server (docs/adr/010-coach-accounts.md). Clerk when its keys are set;
 * else, for the browser journeys only, two fictional coaches picked on the sign-in page and
 * remembered in a cookie. The fixture never runs on Vercel, whatever the variables say.
 */
export function accountMode(env: Record<string, string | undefined> = process.env): AccountMode {
  if (env.CLERK_SECRET_KEY && env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return "clerk";
  if (env.ACCOUNT_FIXTURE === "1" && !env.VERCEL) return "fixture";
  return "off";
}

/** The journeys' coaches: a run id keeps each test's account apart from every other's. */
export const FIXTURE_COACHES: ReadonlyMap<string, string> = new Map([["otter", "Coach Otter"], ["heron", "Coach Heron"]]);
export const FIXTURE_COOKIE = "ffpd_fixture_account";
const RUN = /^[a-z0-9]{1,24}$/;

/** The fixture cookie's value for a coach in a run, or null when either is not one. */
export function fixtureSession(coach: unknown, run: unknown): string | null {
  if (typeof coach !== "string" || !FIXTURE_COACHES.has(coach) || typeof run !== "string" || !RUN.test(run)) return null;
  return `${coach}.${run}`;
}

function fixtureUser(request: Request): AccountUser | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = new RegExp(`(?:^|;\\s*)${FIXTURE_COOKIE}=([a-z0-9.]+)`).exec(cookie);
  const [coach, run] = match?.[1]?.split(".") ?? [];
  const name = coach ? FIXTURE_COACHES.get(coach) : undefined;
  if (!coach || !run || !name || !RUN.test(run)) return null;
  return { id: `fx_${coach}_${run}`, name, email: `${coach}.${run}@example.test`, imageUrl: null };
}

async function clerkUser(): Promise<AccountUser | null> {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  const name = user?.fullName ?? user?.username ?? user?.primaryEmailAddress?.emailAddress ?? "Coach";
  return { id: userId, name, email: user?.primaryEmailAddress?.emailAddress ?? null, imageUrl: user?.imageUrl ?? null };
}

/** The signed-in coach, or null. Never throws: a session that can't be read is nobody. */
export async function signedIn(request: Request): Promise<AccountUser | null> {
  const mode = accountMode();
  if (mode === "clerk") {
    try {
      return await clerkUser();
    } catch {
      return null;
    }
  }
  if (mode === "fixture") return fixtureUser(request);
  return null;
}

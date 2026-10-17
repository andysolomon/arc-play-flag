# Coach accounts: Clerk setup

Accounts ([ADR 010](../adr/010-coach-accounts.md)) sign coaches in through [Clerk](https://clerk.com) and keep each coach's teams in the same Upstash Redis the share links use ([sharing runbook](sharing.md)). Without Clerk's keys the app says sign-in isn't set up and works on the device as before, so a fork or a preview deploys fine without them.

## Configure Clerk

1. Create a Clerk application. Under **User & authentication → Social connections**, turn on **Google** and **X / Twitter** with your own OAuth credentials for production (Clerk's shared development credentials are fine for a development instance). Turn **off** email, phone and username sign-in if coaches should only ever use Google or X; the sign-in page shows whatever the dashboard turns on.
2. Under **Paths**, leave the sign-in and sign-up paths to the app: it mounts them at `/sign-in` and `/sign-up` and sends a coach back to `/` afterwards.
3. Add the keys to the Vercel environment (production and preview each with their own Clerk instance):

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | the instance's publishable key (`pk_…`); read at build time |
   | `CLERK_SECRET_KEY` | the instance's secret key (`sk_…`); server only |

   Both must be set for accounts to turn on. Never commit them. The Redis credentials from the sharing runbook are needed too: a signed-in coach with no store gets "Accounts aren't set up on this deployment yet."
4. Redeploy. Open **Play tools → ACCOUNT → Sign in** in a fresh browser: Clerk's form shows the Google and X buttons. Sign in with a fictional team drawn first, and confirm it is listed as the account's team; sign in on a second browser and confirm the team comes down.

## What is stored, where

- `ffpd:account:<user>:teams` (a list of team ids, at most 12), `ffpd:account:<user>:current`, and `ffpd:team:<id>` (a hash: `owner`, `rev`, `updated`, `name`, `color`, `plays`, `playbooks`, `data`). `data` is the team as JSON, at most 4 MB, 1,000 plays and 1,000 playbooks. Nothing expires.
- Writes are rate limited per account (600 writes and 1,200 reads an hour, keyed by a hash of the user id). 429 means the bucket is spent; the device keeps the write and tries again later.
- The draft on the chalkboard and the designer's picked playbook never leave the device.

## Failure and recovery

- **503** is a missing or unreachable store; the panel says the account is unavailable and the device keeps working. Fix the store; the next write or visit pushes what the device holds.
- **409** is two devices writing one team; the device merges and writes again by itself. If a coach reports a play missing after that, their own version of a play with the same id won on their device; the other device's version is in that device's local copy until it next pushes.
- **A team deleted by mistake** is gone from Redis; a device that still mirrors it makes a new team from its own copy on its next push, so the data survives on any device that had it open. Ask the coach not to sign out or switch on that device until it has.
- **Clerk down**: `auth()` fails closed, so every account request is "signed out"; the device keeps its work and its marker, and the next successful sign-in pushes it.
- **Rotating Clerk keys** signs everyone out; nothing in Redis changes, since teams are keyed by Clerk's stable user id.
- **Operator removal** of a team: delete the hash and `LREM` the id from the owner's list together, and clear `…:current` if it names the team.

## Local and CI verification

The browser journeys never talk to Clerk. With `ACCOUNT_FIXTURE=1` on the app's process (and never on Vercel), the sign-in page lists two fictional coaches whose sessions are a cookie; `playwright.config.ts` sets it on the server it starts. The account journey also needs the disposable Redis adapter of the sharing journeys:

```sh
redis-server --port 6379 --save "" &
export SHARING_TEST_REDIS_URL=redis://127.0.0.1:6379/15 UPSTASH_REDIS_REST_URL=http://127.0.0.1:3134 UPSTASH_REDIS_REST_TOKEN=fixture-only
bun run build && bunx playwright test e2e/journeys/account.journey.ts
```

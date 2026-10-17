# Coach accounts: Clerk setup

Accounts ([ADR 012](../adr/012-coach-accounts.md)) sign coaches in through [Clerk](https://clerk.com) and keep each coach's teams in the same Upstash Redis the share links use ([sharing runbook](sharing.md)). Without Clerk's keys the app says sign-in isn't set up and works on the device as before, so a fork or a preview deploys fine without them.

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

- `ffpd:account:<user>:teams` (a list of team ids, at most 12), `ffpd:account:<user>:current`, `ffpd:account:<user>:prefs` (a hash: `rev`, `json`, `touchdowns`: the coach's look, [ADR 014](../adr/014-whole-desk-in-account.md)), and `ffpd:team:<id>` (a hash: `owner`, `rev`, `updated`, `name`, `color`, `plays`, `playbooks`, `data`). `data` is the team as JSON, at most 4 MB, 1,000 plays and 1,000 playbooks; since ADR 014 it also holds the team's desk (`draft`, `currentBook`, `reader`, `shares`), and a team written before then reads with an empty desk. Nothing expires.
- Writes are rate limited per account (1,200 writes and 1,200 reads an hour, keyed by a hash of the user id; the board goes up as it changes, after a 5-second quiet). 429 means the bucket is spent; the device keeps the write and tries again later.
- The whole desk goes up: the draft on the chalkboard, the picked playbook, the reader's places and the share links' revoke keys with the team; the theme, field, end zone, Deep field, the ball's spot ([ADR 015](../adr/015-line-of-scrimmage-setting.md)), touchdowns and whether the getting-started guide was seen with the account. Signing out clears all of it from the device, the look included.

## Failure and recovery

- **503** is a missing or unreachable store; the panel says the account is unavailable and the device keeps working. Fix the store; the next write or visit pushes what the device holds.
- **409** is two devices writing one team; the device merges and writes again by itself. If a coach reports a play missing after that, their own version of a play with the same id won on their device; the other device's version is in that device's local copy until it next pushes. The board is one slot: the device whose push was refused keeps its own board when it has anything on it, and the other device's is gone.
- **A look that won't stick** on one device while another is open: the device that wrote last wins, except touchdowns, which only ever go up (`touchdowns` in the prefs hash is the higher of the two).
- **A team deleted by mistake** is gone from Redis; a device that still mirrors it makes a new team from its own copy on its next push, so the data survives on any device that had it open. Ask the coach not to sign out or switch on that device until it has.
- **Clerk down**: `auth()` fails closed, so every account request is "signed out"; the device keeps its work and its marker, and the next successful sign-in pushes it.
- **Rotating Clerk keys** signs everyone out; nothing in Redis changes, since teams are keyed by Clerk's stable user id.
- **Operator removal** of a team: delete the hash and `LREM` the id from the owner's list together, and clear `…:current` if it names the team.

## Running locally with real Clerk keys

Put the two keys in the environment of `bun run build` (the publishable key is read at build time) and `next start`. Two things to know:

- Start the server **without** `--hostname 127.0.0.1` when Clerk is on, or address it by the hostname you gave. Clerk's middleware passes a request on as a rewrite to its own absolute URL, built from the Host header; Next's router compares that with the address it was started on, and when the two differ (`localhost` in the browser, `127.0.0.1` on the flag) it treats the rewrite as external and forwards the request to itself until it times out. `playwright.config.ts` passes the flag, which is fine only because the journeys never set Clerk's keys.
- `CLERK_DEBUG=1` makes the middleware log every request's auth state (`proxy.ts`). Behind an egress proxy, give Node `NODE_USE_ENV_PROXY=1` so the server's own calls to Clerk's API go through it.

A complete sign-in without a Google or X account: create a user and a sign-in token with the Backend API (`POST /v1/users`, `POST /v1/sign_in_tokens`), open `/sign-in?__clerk_ticket=<token>`, and Clerk signs the browser in and sends it to the designer. Delete the user afterwards.

## Local and CI verification

The browser journeys never talk to Clerk. With `ACCOUNT_FIXTURE=1` on the app's process (and never on Vercel), the sign-in page lists two fictional coaches whose sessions are a cookie; `playwright.config.ts` sets it on the server it starts. The account journey also needs the disposable Redis adapter of the sharing journeys:

```sh
redis-server --port 6379 --save "" &
export SHARING_TEST_REDIS_URL=redis://127.0.0.1:6379/15 UPSTASH_REDIS_REST_URL=http://127.0.0.1:3134 UPSTASH_REDIS_REST_TOKEN=fixture-only
bun run build && bunx playwright test e2e/journeys/account.journey.ts
```

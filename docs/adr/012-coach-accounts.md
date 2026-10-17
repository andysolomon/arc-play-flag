# ADR 012: coach accounts, with teams

Status: implemented. It adds an account over the on-device library of [ADR 001](001-short-playbook-links.md) and the backups that already describe it, without changing what the device stores or how any screen reads it.

Amended by [ADR 013](013-whole-desk-in-account.md): the draft on the chalkboard and the playbook picked in the designer, which rule 2 below kept on the device, now go up with the team, along with the rest of the desk and the coach's look.

## Why

A coach's plays, playbooks, team settings and lineups lived in one browser on one device. A new phone, a laptop at the field, or a cleared browser meant a backup file, or nothing. And a coach with two teams (the 10U side and the 12U side, an offense and a scout team) had one team name, one colour and one library per device.

This change gives a coach an **account**, signed in with **Google or X** through [Clerk](https://clerk.com), that holds **any number of teams**, each with its own plays, playbooks, settings and lineups. Any device signed in to the account opens any of its teams, and every save goes up to the team the device has open.

## Rules

1. **The device is the working copy.** Every screen keeps reading and writing the device's storage exactly as before (`lib/play/storage.ts`, `lib/play/library.ts`). Signed out, offline, or on a deployment without accounts, nothing changes.
2. **A device mirrors one team.** Signed in, the device's plays, playbooks, team settings and lineups are one of the account's teams, and a marker (`ffpd.account.v1`) says which, at which write count (`rev`), and whether anything here has not gone up yet. The draft on the chalkboard and the playbook picked in the designer are the device's and never go up.
3. **Every write goes up.** Each write to the library is pushed, debounced, as the whole team. A push names the rev the device last read; a team written since by another device is refused with the account's copy, which the device merges in (its own version of a play wins, the other device's new plays and books are kept, its own settings and lineups stand) and pushes again. Nothing is reported saved to the account until the account has it.
4. **Signing in keeps the device's work.** A device with work that no team of the account mirrors becomes a new team, named after its team settings (or "My team"). An empty device opens the team the account opened last, or its first, or gets an empty "My team".
5. **Switching teams changes the device.** The pending push goes first (refused when it can't), the new team's data lands on the device as one write, the draft and the picked book are cleared, and the page reloads so every screen starts on the new team.
6. **Signing out clears the device**, after the last push, since the work is in the account; signing in brings it back. A session that ends mid-work keeps everything on the device, marked as not yet pushed, for the next sign-in.
7. **A team is its owner's.** Every read and write on the server checks the account that owns the team; another account's team is "not in your account", and a write from a page that is not the app's own origin is refused.

`lib/account/sync.ts` writes down the ways this could fail before the code (A1–A18): accounts off, signed out, first sign-in on a full or empty device, a marker for a team that isn't this account's, offline writes, two devices on one team, a team deleted elsewhere, a switch or a sign-out with a push pending, a session that ends, blocked storage, a team too big, rate limits, the device's own draft and pick, and a write that changes nothing.

## Data model

```ts
interface TeamData { plays: SavedPlay[]; playbooks: Playbook[]; team: TeamSettings; lineups: Lineups }
interface TeamSummary { id: string; name: string; color: string; plays: number; playbooks: number; updated: string; rev: number }
```

- A team's data is what a device backup carries (`lib/export/backup.ts`) less the draft: read on the server with the same normalizers the device uses, every book's reference to a play that isn't there dropped, up to 1,000 plays and 4 MB.
- In Redis, an account is a list of team ids (`ffpd:account:<user>:teams`) and the team it opened last (`…:current`); a team is a hash (`ffpd:team:<id>`) of its owner, rev, data and the summary the list shows. Each write is one Lua script: the owner is checked, the rev is compared and bumped, and the list and the team change together.
- The signed-in coach comes from Clerk's session (`auth()` and `currentUser()`) when its keys are set. For the browser journeys, and never on Vercel, `ACCOUNT_FIXTURE=1` lets two fictional coaches sign in from the sign-in page and be remembered in a cookie. With neither, `GET /api/account` says accounts are off and the panel says so.

## In the app

- **Play tools** and the playbooks' **settings** have an **ACCOUNT** section: signed out, what an account is for and **Sign in**; signed in, who, **Sign out**, a team button that drops the account's teams down (a tap switches), **+ New team…** and **Delete “<team>”…**, and a status line (`Saved to your account`, `Saving…`, `Not yet in your account`, `Offline…`). The note under the team fields says where the team is kept.
- `/sign-in` and `/sign-up` show Clerk's own form, with the Google and X buttons its dashboard turns on (see [the runbook](../runbook/accounts.md)).

## Verification

`e2e/journeys/account.journey.ts` signs in as the fixture coaches against the disposable Redis: a device's work becomes the account's first team, a save goes up, a second device signed in opens the team and its playbook, and a play saved there reaches the first after a reload; a new team starts empty and open, its plays are its own, a switch back brings the first team whole and the account remembers the pick, and deleting the open team takes its plays from the account and opens another; a push refused as changed elsewhere merges both devices' plays; a write while offline stays on the device and goes up when it is back; signing out clears the device and refuses nothing of the account, a play drawn signed out becomes a second team on sign-in, and the first team is a switch away with its book. Each test leaves `test-results/account-<device>-<test>.json` and pictures of the panel and the sign-in page, uploaded as `account`.

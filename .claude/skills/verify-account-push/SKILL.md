---
name: verify-account-push
model: verification/account-push
watches: lib/account/sync.ts lib/account/state.ts lib/account/store.ts
description: Model-check how a device pushes a coach's team to the account (lib/account/sync.ts push, noteWrite, synced, the 409 merge) with TLA+. Use when changing lib/account/sync.ts or lib/account/state.ts, when a save goes missing between devices, or when the "Model-check the sync protocols" CI job fails.
---

# Verify the account push

**Property.** A play the coach saves on a device is never taken off it (`NoLostSave`), and whenever the device has nothing pending and nothing in flight, the account holds every play saved there (`HonestSaved`).

**Harm when broken.** The panel says Saved, the coach closes the laptop, and the play never reaches the account or the next device.

## Run it

```sh
bun run verify:models verification/account-push   # about 15s
```

Every line must start with `ok`. `AccountPush.cfg` checks the code as it is and must pass. Each `AccountPush.<variant>.cfg` replays a bug this code once had and must break the invariant on its `\* expect:` line. A variant that starts passing means the model lost the ability to catch that bug.

Read a counterexample with `/statechart`: it turns TLC's trace into the shortest path in plain words.

## What the model covers

| Model (`verification/account-push/AccountPush.tla`) | Code |
| --- | --- |
| `Save(e)` | the library subscriber in `wire()` calling `noteWrite(PUSH_DELAY)`: `markDirty`, `schedule` |
| `TimerFires`, `Push`, `StartPush` | `schedule`'s timer and `push()`: the `pushing`/`pushAgain` guard, the A18 skip against `getLastSynced()` |
| `Resume` | the `online`, `focus`, `visibilitychange` and `pagehide` listeners in `wire()` |
| `ServerHandles` | `PUT /api/account/teams/:id`, `writeTeam` in lib/account/store.ts: written on a matching rev, else 409 with the account's copy |
| `Written` | the success branch of `push()`: `synced(teamId, rev, prefsRev, account)` |
| `Refused` | the 409 branch of `push()`: `mergeTeamData` over `deviceDesk()` as it is now, `applyDesk`, one retry |
| `OtherDevice(o)` | another device's successful push |

A team is its set of plays, and a merge is a union, which is what `mergeTeamData` does for plays saved on both sides. Each action is one step because nothing awaits inside it in the code.

**Left out.** Pulls on focus (`check`, A21 accepts that a tap mid-pull is lost to the pull), sign-in and `settle`, the 401 and 404 paths, deletes, the look (prefs), and organization teams (lib/org/sync.ts). The bound is 3 saves and 2 other-device writes for the passing check.

## A failure: real bug or modelling error?

1. Rerun the failing config and read the trace with `/statechart`.
2. Walk the trace against the code table above. If each step is something `push()` can really do, it is a bug in the code. Reproduce it in the browser with the journey "a save made while a push is on its way still reaches the account" in `e2e/journeys/account.journey.ts`, which holds a PUT with `page.route`, as the pattern for a new one.
3. If a step is impossible in the code (an await the model splits that the code does not, a guard the model lacks), fix the model, and say so in the PR.

Never weaken an invariant or a bound to get a pass.

## Keeping it in step

CI (`scripts/check-model-drift.ts`) refuses a PR that changes a file under `watches:` without touching `verification/account-push/` or this file. Walk the table again, then change the model, or touch this file to record that the model still describes the code. An intended protocol change goes into the model first, then the code, then a new `AccountPush.<variant>.cfg` for any bug it fixes.

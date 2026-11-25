---
name: verify-org-push
model: verification/org-push
watches: lib/org/sync.ts lib/org/teams.ts lib/org/api.ts
description: Model-check how a device pushes an organization team's settings and lineups (lib/org/sync.ts noteWrite, push, poll, settle, the marker) with TLA+. Use when changing lib/org/sync.ts or the settings and poll endpoints in lib/org/teams.ts, when an organization team's rename or roster edit goes missing or reverts, or when the "Model-check the sync protocols" CI job fails.
---

# Verify the organization settings push

**Property.** A settings edit the coach makes is never lost: it stays on the device until the server has had it (`NoLostEdit`). Neither the panel nor the marker says saved over settings the server never had (`HonestSaved`). Once nothing is pending, in flight or scheduled and the device has read every write, the device holds what the server holds and the marker is clean (`QuietAgrees`).

**Harm when broken.** The coach renames the team, the panel says Saved, and the rename never reaches the organization, is lost to a reload, or reverts on this device while the other coaches see it.

## Run it

```sh
bun run verify:models verification/org-push   # about 30s
```

Every line must start with `ok`. `OrgPush.cfg` checks the code as it is and must pass. Each `OrgPush.<variant>.cfg` replays a bug this code once had and must break the invariant on its `\* expect:` line. A variant that starts passing means the model lost the ability to catch that bug.

Read a counterexample with `/statechart`: it turns TLC's trace into the shortest path in plain words.

## What the model covers

| Model (`verification/org-push/OrgPush.tla`) | Code |
| --- | --- |
| `Edit(e)` | a settings write in the library, whose subscriber in `wire()` (lib/account/sync.ts) calls `noteWrite()`: `notePending`, the marker dirty, status pending, `pushTimer` |
| `TimerFires`, `StartPush` | `pushTimer` and the start of `push()`: the `pushing`/`pushAgain` guard, `notePending`, saved when nothing is pending, else the settings read once into `sent` |
| `Resume` | the `online`, `focus` and `visibilitychange` listeners in `wire()`: a dirty marker pushes |
| `ServerTakesPush` | `PUT .../settings`, `writeSettings` in lib/org/teams.ts: the last write wins and `settings_rev` takes the new rev |
| `PushLands` | the end of `push()` after `api.writeSettings`: `hashes.settings` from `sent`, `settingsRev`, `dirty = notePending(d) \|\| hasPending(d)`, the marker, the status, `finally` |
| `PollTicks` | `poll()`: pushes instead when a change is pending and no push is out, else asks from `d.rev` |
| `ServerAnswersPoll` | `changesSince` in lib/org/teams.ts: the settings come back when `settings_rev > since` |
| `PollLands` | the rest of `poll()`: a pending change is kept and holds `d.rev` (D2), settings older than `settingsRev` are dropped, the marker is written |
| `Reload` | a reload and `settle()`: timers and the poll are gone, a push already sent may still reach the server (`orphan`), a dirty marker or pending change pushes |
| `OtherCoach(o)`, `OtherPlay` | another head coach's settings write; another coach's play write, which moves the rev and not the settings |

Each action is one step because nothing awaits inside it in the code. The settings are one value because the server replaces them whole.

**Left out.** Plays and books (they go up record by record with their own stamps, and the server keeps the newer one, rule 5), presence, network failures and the 401, 403 and 404 paths, `flushed`, `open` and `release`, and the level guard. The bound is 3 edits, 1 other head coach and 1 other play write for the passing check.

## A failure: real bug or modelling error?

1. Rerun the failing config and read the trace with `/statechart`.
2. Walk the trace against the code table above. If each step is something `push()`, `poll()` or `settle()` can really do, it is a bug in the code. Reproduce it in the browser with the journeys "a team rename made while a settings push is on its way still reaches the organization" and "a team rename made as its settings push lands survives a reload straight after" in `e2e/journeys/organization.journey.ts`, which hold a request with `page.route`, as the pattern for a new one.
3. If a step is impossible in the code (an await the model splits that the code does not, a guard the model lacks), fix the model, and say so in the PR.

Never weaken an invariant or a bound to get a pass.

## Keeping it in step

CI (`scripts/check-model-drift.ts`) refuses a PR that changes a file under `watches:` without touching `verification/org-push/` or this file. Walk the table again, then change the model, or touch this file to record that the model still describes the code. An intended protocol change goes into the model first, then the code, then a new `OrgPush.<variant>.cfg` for any bug it fixes.

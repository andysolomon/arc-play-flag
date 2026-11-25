---
name: verify-org-push
model: verification/org-push
watches: lib/org/sync.ts lib/org/teams.ts lib/org/api.ts
description: Model-check how a device syncs an organization team (lib/org/sync.ts noteWrite, push, land, poll, settle, the marker) with TLA+, for its settings and lineups (OrgPush.tla) and its plays and books (OrgRecords.tla). Use when changing lib/org/sync.ts or the play, book, settings and poll endpoints in lib/org/teams.ts, when an organization team's rename, roster edit, play or book goes missing or reverts, or when the "Model-check the sync protocols" CI job fails.
---

# Verify the organization sync

Two sibling models share one rule for `d.rev`, the rev the device polls from: only a poll moves it.

- `OrgPush.tla`: the settings and lineups, one value the server replaces whole.
- `OrgRecords.tla`: one play or book (plays and books run the same code, one loop each), which the coach edits and deletes here while another coach writes and deletes it and writes a second record the device never touches. They are apart because crossing the two would multiply the state space, and they share only `d.rev`, which each models.

**Property.** An edit the coach makes is never lost: it stays on the device until the server has had it (`NoLostEdit`). Neither the panel nor the marker says saved over a value the server never had (`HonestSaved`). The device never puts an older version over a newer one it already had from the server (`NoStaleTake`). Once nothing is pending, in flight or scheduled and the device has read every write, the device holds what the server holds, other coaches' writes included, and the marker is clean (`QuietAgrees`).

**Harm when broken.** The coach renames the team or saves a play, the panel says Saved, and the change never reaches the organization, is lost to a reload, reverts to another coach's older version, or the device never shows a play another coach wrote.

## Run it

```sh
bun run verify:models verification/org-push   # about 2 minutes
```

Every line must start with `ok`. `OrgPush.cfg`, `OrgRecords.cfg` (two edits) and `OrgRecords.deletes.cfg` (one edit, a delete on each side) check the code as it is and must pass. Each other `<Module>.<variant>.cfg` replays a bug this code once had and must break the invariant on its `\* expect:` line. A variant that starts passing means the model lost the ability to catch that bug.

Read a counterexample with `/statechart`: it turns TLC's trace into the shortest path in plain words.

## What OrgPush.tla covers

| Model (`verification/org-push/OrgPush.tla`) | Code |
| --- | --- |
| `Edit(e)` | a settings write in the library, whose subscriber in `wire()` (lib/account/sync.ts) calls `noteWrite()`: `notePending`, the marker dirty, status pending, `pushTimer` |
| `TimerFires`, `StartPush` | `pushTimer` and the start of `push()`: the `pushing`/`pushAgain` guard, `notePending`, saved when nothing is pending, else the settings read once into `sent` |
| `Resume` | the `online`, `focus` and `visibilitychange` listeners in `wire()`: a dirty marker pushes |
| `ServerTakesPush` | `PUT .../settings`, `writeSettings` in lib/org/teams.ts: the last write wins and `settings_rev` takes the new rev |
| `PushLands` | the end of `push()` after `api.writeSettings`: `hashes.settings` from `sent`, `settingsRev`, `d.rev` left alone, `dirty = notePending(d) \|\| hasPending(d)`, the marker, the status, `finally` |
| `PollTicks` | `poll()`: pushes instead when a change is pending and no push is out, else asks from `d.rev` |
| `ServerAnswersPoll` | `changesSince` in lib/org/teams.ts: the settings come back when `settings_rev > since`, another coach's play when its rev is |
| `PollLands` | the rest of `poll()`: a pending change is kept and holds `d.rev` (D2), settings no newer than `settingsRev` are dropped, the marker is written |
| `Reload` | a reload and `settle()`: timers and the poll are gone, a push already sent may still reach the server (`orphan`), a dirty marker or pending change pushes |
| `OtherCoach(o)`, `OtherPlay` | another head coach's settings write; another coach's play write, which moves the rev and the play's row rev, not the settings |

## What OrgRecords.tla covers

| Model (`verification/org-push/OrgRecords.tla`) | Code |
| --- | --- |
| `Edit(e)`, `Delete` | a play or book saved or deleted in the library, then `noteWrite()`: `notePending` (a delete is pending when the record was in `hashes`), the marker, `pushTimer` |
| `TimerFires`, `Resume`, `StartPush` | as in OrgPush; the record is read once into `sent` before its write |
| `ServerTakesPush`, `Outcome` | `writePlay`/`deletePlay` (and the book twins) in lib/org/teams.ts: another coach's newer row (`outranks`, free under clock skew) sets the write aside as a sideline copy or ignores the delete without a bump; else the write stands with a new rev |
| `PushLands` | `land()` and the end of `push()`: `revs` and `hashes` from the version that stood, storage takes it only while storage still holds `sent`, `d.rev` left alone, the marker |
| `PollTicks`, `ServerAnswersPoll` | `poll()` and `changesSince`: every row above `since`, tombstones included |
| `PollLands` | a pending record is kept and holds `d.rev` (D2); a row no newer than `revs` is dropped; else storage, `hashes` and `revs` take it |
| `Reload`, `ServerTakesOrphan` | as in OrgPush |
| `OtherWrite(o)`, `OtherDelete`, `OtherQ` | another coach's write or delete of the record, and their write to a record this device never touches |

Each action is one step because nothing awaits inside it in the code.

**Left out.** The sideline copy on the device (the server keeps it, which `held` counts), the `at` stamps themselves (outranking is a free choice instead), presence, network failures and the 401, 403 and 404 paths, `flushed`, `open`, `release`, `copyTo`, and the level guard. OrgPush's passing bound is 3 edits, 1 other head coach and 1 other play write. OrgRecords' are 2 edits, 1 other write and 1 write to the other record; and 1 edit, 1 delete here, 1 other write, 1 other delete and 1 write to the other record. The two OrgRecords bounds together pass too, but at about 23 million states they are too slow for CI.

## A failure: real bug or modelling error?

1. Rerun the failing config and read the trace with `/statechart`.
2. Walk the trace against the code tables above. If each step is something `push()`, `land()`, `poll()` or `settle()` can really do, it is a bug in the code. Reproduce it in the browser with the journeys "a team rename made while a settings push is on its way still reaches the organization", "a team rename made as its settings push lands survives a reload straight after" and "a play saved while a poll is on its way back keeps the save" in `e2e/journeys/organization.journey.ts`, which hold a request with `page.route`, as the pattern for a new one.
3. If a step is impossible in the code (an await the model splits that the code does not, a guard the model lacks), fix the model, and say so in the PR.

Never weaken an invariant or a bound to get a pass.

## Keeping it in step

CI (`scripts/check-model-drift.ts`) refuses a PR that changes a file under `watches:` without touching `verification/org-push/` or this file. Walk the tables again, then change the model, or touch this file to record that the model still describes the code. An intended protocol change goes into the model first, then the code, then a new `<Module>.<variant>.cfg` for any bug it fixes.

# ADR 005: laterals to anyone, as often as the play needs

Status: implemented. It replaces ADR 004's data model, its rule 4 and its known limit. The rest of ADR 004 still holds: never forward, behind the line, the sidebar, the arcs and handles, the words, the Pitch migration and playback.

## Why

ADR 004 kept the chain in one route per player: each carrier's `lateral` route named who took it next. A player could therefore carry it only once. QB → Z → QB wasn't drawable, and a chain topped out at one lateral fewer than the offense had players: four with five on offense. The game has no such limit, so the review held it as a separate change.

## Rules

1. The chain starts with the quarterback, who takes the snap. A carrier laterals, throws forward, or keeps it on any run route.
2. **A lateral is never forward:** `catch.y >= release.y`. The quarterback lets it go where they stand at the snap. Every later carrier lets it go where they caught it.
3. **Every lateral is behind the line:** `catch.y >= LOS_GAP`.
4. **A lateral goes to any other offensive player:** the same player again included, the quarterback too. It can't go to the player tossing it. This replaces ADR 004's "no player twice".
5. Every time a carrier has the ball and tosses it on, their job that time is the lateral. Only the last carrier has a job of their own, a throw or a keep, and no carrier after the quarterback runs a pass route.
6. A chain that ends in a throw is a pass, legal from a no-run zone and never flagged. A chain that ends in a keep is a run.
7. The primary read is the final throw's target, never a carrier.

There's no limit on laterals in the rules. Storage keeps up to `MAX_LATERALS` (60), far beyond any play.

## Data model

The chain is stored once, in order, on the quarterback:

```ts
interface Hop { to: PlayerId; catch?: Pair }
interface Player { …; laterals?: Hop[] } // the quarterback only
```

- Hop *i* is tossed by whoever took hop *i − 1*, or by the quarterback for hop 0, and caught by `to`. With no `catch` stored, the catch is worked out from where the target is at that moment: their last catch if they've had it before, otherwise their spot.
- The last player in the chain does their own `route`'s job with it: `throw`, or a run route. When the quarterback takes it back last, their own route is that job, which is why the chain isn't stored in the quarterback's route.
- `lateral` is no longer a route type, and `Route.catch` is gone. The Lateral tile is now its own reducer action.

The chain lives on a player, not on the play, so everything that already carries players carries it unchanged: undo and redo, the draft, saved plays, share links, play and playbook files, backups, and every picture. `normalizePlayers` reads it like `preSnap`. A list of laterals is cut at the first entry that isn't one, since each hop depends on the one before.

`lib/play/lateral.ts` works out everything else from the players:

- `chainOf` lists the carriers in order, a player as often as they have it.
- `chainLinks` gives every toss with its release and clamped catch.
- `carriers`, `visits`, `releasePoint(players, hop)` and `startOf` (the last carrier's job starts at the last catch).
- `settleChain` cuts the chain at the first lateral to nobody, to a defender or to the player holding it. It clamps every stored catch in order and drops laterals from anyone but the quarterback. It also removes a carrier's own route every time they toss it on, and a pass route or the read from the last carrier. The reducer settles after every action, and storage settles on read.

## Migration

`normalizePlayers` reads two older shapes:

- **ADR 004's chain**, one `{ type: "lateral", target, catch }` route per carrier. It is walked from the quarterback the way that version did, stopping at a player already in it or one who isn't there, and becomes the quarterback's `laterals` in the same order with the same catches. The last carrier's own route was already their job.
- **Pitch**, as ADR 004 describes: the ball stays with the carrier the old words named. When that was the pitch runner, the quarterback's `laterals` is `[{ to: runner }]`.

## In the designer

- **Lateral** asks "Lateral to who?" and rings every red player except the one tossing it. Players who had the ball before are included. The player tapped is selected next.
- A player can have the ball more than once, so the palette edits one **time** with the ball, called a visit in the code. Tapping a player opens their last time. The ball path (`BALL → QB → Z → QB → X → throw`) is now a row of 44px buttons, and tapping a step opens that time.
- For the selected time:
  - If the ball goes on from them, Lateral is on. Tapping it takes that lateral and every one after it off. Picking Throw, a keep or a pass route ends the chain there with that job.
  - If it's their last time, Lateral asks who takes it next, as before.
- The heading reads "{label} has the ball", or "{label} has it again" for a later time with it.
- Each lateral has its own arc and catch handle, keyed by hop: `data-lateral` and `data-catch` are the hop's index.

## Playback and words

- Each carrier runs one track: from their spot to each of their catches in turn, with a hold at each one. At a catch they wait for the ball, then hold it until they toss it on, or until they do their job if they're last.
- A quarterback who takes it back holds their spot until their first toss leaves, then drifts to their next catch.
- Each toss is timed to land as its target arrives, a beat after the toss before it lands, and never goes forward.
- The call line names every toss, for example "Lateral pass: QB laterals to Z, Z laterals to QB, QB laterals to X, X throws."
- A player's job lists each time they have it: "Lateral to Z, then lateral to X", or "Lateral to Z, then take the lateral, throw, look to Y first".
- The wristband line repeats them too: `QB › Z › QB › X › Y`.

## Verification

- Unit tests: `lib/play/lateral.test.ts` (revisits, a toss to oneself, broken hops, the cap, defaults for a player who had it before, settling), `reducer.test.ts` (back to the QB, picking a time in the path, cutting and re-targeting from it, catch moves by hop, flip, clear), `motion.test.ts` (the QB holding, drifting back and taking it again), `assignments.test.ts`, `call.test.ts`, `share.test.ts` and `storage.test.ts` (ADR 004's per-carrier chain and Pitch migrations).
- `e2e/journeys/lateral-chain.journey.ts` also draws QB → Z → QB → X, plays it with the ball reaching every catch in order before the throw, changes Z's time from the ball path, undoes it, and opens a play saved in ADR 004's shape. It leaves `lateral-chain-<device>-boomerang.json` with the playback samples.

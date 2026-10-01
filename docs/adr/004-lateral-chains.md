# ADR 004: lateral chains

Status: implemented. It replaces the Pitch route. An earlier attempt (#122, reverted in #124) kept a separate ball plan beside the routes. This one keeps the whole chain in the routes it is made of.

## Rules

In flag football a ball lateraled behind the line of scrimmage can still be thrown forward, and whoever takes a lateral can lateral again. The game puts no limit on how many laterals a play has, as long as every one is behind the line and none goes forward. This model has one: each player is in the chain at most once (rule 4), so a play has at most one lateral fewer than it has offensive players (four for a five-player offense). See "Known limit".

1. The chain starts with the quarterback, who takes the snap. Each carrier does one of three things: **lateral** to another offensive player, **throw** forward, or **keep** it on any run route.
2. **A lateral is never forward.** Its catch point is level with or behind where it is let go: `catch.y >= release.y`, where +y points to the offense's backfield. The quarterback lets it go where they stand at the snap, after any pre-snap motion. Every later carrier lets it go where they caught it.
3. **Every lateral is behind the line:** `catch.y >= LOS_GAP` (0.9 yards, the same gap every offensive player keeps).
4. A chain never includes the same player twice. Only offensive players not already in the chain can be picked to take a lateral.
5. A carrier runs no pass route. After the quarterback, their only choices are lateral, throw or a run.
6. A chain that ends in a throw is a pass: legal from a no-run zone and never flagged. A chain that ends in a keep is a run and is flagged there like one (`runInNoRunZone`). A chain whose last carrier has no job yet is neither.
7. The primary read is still the final throw's target, so it is never a carrier in the chain.

## Data model

The chain is stored only in routes (`lib/play/types.ts`):

- `{ type: "lateral"; target: PlayerId; catch?: Pair }`: this carrier tosses it to `target`, who catches it at `catch` (absolute yards).
- `{ type: "throw" }`: this carrier sets up at the old pitch set depth (`PITCH_SET`, 2.6 yards back), a step toward their own sideline, and throws to the read.

`"pitch"` is gone from the offense's route types. Everything else is derived by pure helpers in `lib/play/lateral.ts`, never stored:

- `chainOf(players)` walks from the quarterback through each `lateral.target`. It stops at a player it has already visited, a target that isn't on the field, or a defender.
- `releasePoint(player, players)` and `chainLinks(players)` give each lateral's release and clamped catch, in chain order.
- `clampCatch(catch, release)` sets `y = max(LOS_GAP, release.y, y)` and keeps `x` inside the field. A lateral with no stored catch defaults to 3 yards past its target, and at least a yard behind the release and the set depth.
- `startOf(player, players)` puts a carrier's own job at their catch point. Geometry, playback and every picture draw it from there.
- `settleChain(players)` clamps every stored catch in chain order, since each catch depends on the one before it. It also takes off what a carrier can't have: a lateral or throw on someone the chain doesn't reach, a lateral that goes nowhere, a pass route or the read on a carrier after the quarterback. A settled play comes back as the same array.

Every edit settles, because the reducer runs `settleChain` after each action that changes the players. That covers a player or the quarterback dragged or stepped, a catch dragged or nudged (`catchMove`), a lateral retargeted, a flip (which flips each catch too) and a formation reset. So an edit that moves a release point re-clamps everything downstream, and undo brings it all back together. `normalizePlayers` settles every play as it is read in.

## Migration

`normalizePlayers` is where every play is read in: the library, the draft, share links, play and playbook files, and backups. The ball stays with whoever the play's words gave it to before laterals (`runnerOf`), so no saved play changes hands. That carrier is a runner marked as the read. Failing that, with receivers out, it is the first pitch runner from left to right, who threw it (the call was an option). Otherwise it is the first runner from left to right.

- If that carrier is a pitch runner P, the quarterback laterals to P. P throws if the play was an option. Otherwise P keeps it on a Stretch, the wide run the pitch was. A pitch runner marked as the read loses the mark, because the keep now says it.
- If the carrier is the quarterback on a pitch, that was a rollout, so it becomes the quarterback's own `throw`, or a Stretch keep.
- Every other pitch becomes a Stretch decoy with no lateral, and the carrier keeps their own route and read. This covers a primary Dive beside a Pitch, a second pitch, and a play with no quarterback to toss it.

A migrated play reads back identically the second time. `lib/play/storage.test.ts` covers each case, and `lateral-chain.journey.ts` opens a stored pitch in the gallery and the designer.

## In the designer

- **Lateral** replaces Pitch in the RUN group, with the pitch sticker for now. It shows only for players with the ball: in the RUN group for the quarterback, and under **WITH THE BALL** for later carriers. On anyone else it would make a lateral the chain can't reach, so the empty palette says "Tap the QB to start a lateral."
- Lateral works like Man. It asks "Lateral to who?", rings every eligible red player dashed, and the player tapped is selected next.
- A carrier after the quarterback sees "{label} has the ball", a `BALL → QB → Z → … → throw|keeps|?` path, **Throw / Lateral / Done**, then **OR KEEP IT** with the runs. They get no pass tree and no "Mark primary".
- Tapping the active Lateral tile takes the lateral off, like Man, and the rest of the chain falls away with it. Undo brings it back.
- Each lateral is drawn as a dashed arc bowing back from release to catch. A football sits at the curve's true midpoint (`0.25·A + 0.5·ctrl + 0.25·C`), and the arc stays on the field. A diamond at the catch, labelled "{target} catches", drags and arrow-keys with the clamp applied live.
- A snapped catch shakes and shows a flag-yellow note naming the rule it landed on. "Can't go forward" is used when the release decided where it landed, which is almost always. "Behind the line" is used when the ball is let go on the line itself. The mock showed the line note whenever the drag crossed the line, but the catch then sits level with a release five yards back, so that note would say the wrong thing.
- "Mark primary" stays on a quarterback with no lateral, so a QB keeper marked as the read is still a run, as saved plays expect.

## Playback, words and pictures

`lib/play/motion.ts` runs the snap, then each lateral in order. The target drifts to the catch from the snap, and the ball flies a low backward arc that lands as they arrive. The last carrier then sets up and throws to the read, keeps it from the catch, or just holds it. Everyone off the chain runs their route from the snap. `touchdownAt` works unchanged, with the last carrier as the passer.

The call is named by how the chain ends: **Double pass** (one lateral, then a throw), **Lateral pass** (two or more, then a throw), **Lateral run** (a keep), or **Lateral · unfinished** (gold pill). For example, "Double pass: QB laterals to Z, Z throws. Primary read: Y (Go)." Players' jobs read "Lateral to X", "Take the lateral, throw, look to Y first", "Take the lateral, keep it: Reverse", or "Takes the lateral · no job yet" in the error colour. Wristbands follow the play's name with `QB › Z › X › Y` or `QB › Z keeps`, and slide alt text and speaker notes say it as "Ball: …". Every export draws the arcs in ink.

## Known limit

A route belongs to one player, so a chain can't revisit a player: QB → Z → QB isn't drawable, and the quarterback can't take the ball back after lateraling it. It also caps a chain at one lateral fewer than the offense has players: four with five on offense, eleven with the twelve a play may hold. The game allows more, so this model doesn't give "unlimited" laterals. A lateral back to someone already in the chain is never offered, and one stored that way ends the chain at the thrower (`chainOf`) and is settled away. Lifting the limit would need the chain stored as its own ordered list of hops, each with its own target, catch and job, rather than one route per player. That is what the reverted attempt did.

## Verification

- Unit tests: `lib/play/lateral.test.ts` (chain walk, clamps, settling), `assignments.test.ts` and `call.test.ts` (every chain ending, no-run zones), `reducer.test.ts` (targeting, catch moves, re-clamping on a drag, flip, undo), `motion.test.ts` (tosses never forward, order, keep, unfinished, pre-snap), `geometry.test.ts` (carrier starts, throw path, arcs), and `storage.test.ts` (migration).
- `lib/play/share.test.ts` covers a moved catch going through a snapshot link and back. A link carrying a forward catch opens with it snapped back.
- `e2e/journeys/lateral-chain.journey.ts` drives the chain, clamps, playback, migration and no-run flag on all four device projects. It also opens moved catches from a snapshot link on a cleared device, and a pitch beside a primary Dive stays that Dive's play. It leaves `test-results/lateral-chain-<device>-<test>.json` with screenshots, uploaded as `lateral-chain`.

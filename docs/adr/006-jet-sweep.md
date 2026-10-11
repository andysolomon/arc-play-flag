# ADR 006: the jet sweep

Status: implemented.

## Why

A jet sweep brings a receiver across the formation at full speed, just behind the line of scrimmage or a few yards behind it, and the quarterback hands them the ball as they pass. In US flag football a forward pass may not be thrown to a player who is behind the line when the ball is caught, so the exchange on a jet sweep is a handoff, never a pass or a shovel. The designer had the runs (Handoff, Dive, Stretch, Counter, Reverse, Delay) and pre-snap motion, but no way to draw a run whose runner is already moving when the ball is snapped and takes it in stride.

## Rules

1. **A jet sweep is a run.** It is a handoff from the quarterback, so it is flagged in a no-run zone like any other run, and beside pass routes with no run marked as the read it is play-action: the jet fake.
2. **The runner is moving at the snap.** The ball is snapped so that it reaches the quarterback just before the runner passes them, and the exchange happens as they go by. Nobody else moves until the snap.
3. **The exchange is behind the line.** The runner crosses on a lane `JET_GAP` (1.2 yards) in front of a shotgun quarterback, or the same distance behind a quarterback under centre when the lane in front would be on the line. Either way the lane is at least `LOS_GAP + 0.5` yards behind the line, and every point of the crossing is behind it.
4. **The runner crosses the formation.** They go the way that takes them past the quarterback: a runner lined up left of the quarterback sweeps right, and the reverse. A runner lined up at the quarterback's x sweeps right. A jet sweep is never mirrored; to sweep the other way, line the runner up on the other side.
5. **Only a player who can take a handoff at the snap can be given one:** an offensive player who is not the quarterback (who hands it off) and not the centre (who snaps it), and who is not carrying the ball in a lateral chain (the ball comes to a carrier by lateral, not by handoff). Everyone else is never offered the tile, and a jet sweep stored on them is taken off when the play is read or edited, the way a route a carrier can't have is.
6. **Pre-snap motion still works.** A runner with motion drawn runs it first, with everyone holding as before, then goes straight into the sweep from where the motion ends, without stopping.

## Data model

`"jet"` is a new offensive route type, a run (`run: true`) with no fixed points: `{ type: "jet" }` on the runner. Nothing else is stored. It goes everywhere a route goes (the draft, saved plays, links, files, backups, undo) through `normalizeRoute`, which accepts any type the route table knows.

- `jetLegs(px, qx, qy, across)` in `lib/play/routes.ts` lays the sweep out after the runner's spot: into the lane on the near side of the quarterback (at their own x if they already stand within 3 yards), across the lane past the quarterback, on toward the far sideline and up to 5 yards past the line, like every run. `jetLane(qy)` picks the lane's depth (rule 3).
- `canJet(p, players)` in `lib/play/lateral.ts` answers rule 5. `settleChain` takes a jet sweep off anyone it says no to, so the reducer (which settles after every edit) and storage (which settles on read) agree.
- `mirrorable` is false for a jet sweep (rule 4). Flipping the play flips the runner's spot, and the sweep follows from it.

## Playback

`buildAfterSnap` lays the runner's track out like any run, then works out the **lead**: how long before the snap begins they have to start so that they pass the quarterback a tenth of a second after the ball gets there. Their track's `wait` is set to minus that lead, so in the snap's frame they are already yards along when the snap starts, and the plan is shifted by the lead, as pre-snap motion already shifted it: `preSnapFor` grows by the lead and `jetLead` records it. `buildMotion` then puts any drawn motion in front, so `preSnapFor` is the motion's time plus the lead.

`positionsAt` runs the motion tracks until the motion is done (`preSnapFor - jetLead`), then the post-snap tracks from `t - preSnapFor`, which is negative during the lead. A negative time puts everyone with a wait of zero at their spot and moves only the jet runner, so nothing else needed to change: the ball sits with the centre until `preSnapFor` (rule 2), flies to the quarterback by `snapAt`, and is handed off at `handAt`, which `meshPoint` reads off the track with its negative wait. With receivers and no run read, the same lead makes the jet fake: the ball dips toward the runner as they pass.

Ways it could go wrong, written down before the code:

- J1 the runner reaches the quarterback before the snap does: the lead is cut so the handoff is never before `snapAt`. A runner already within reach starts with the snap, as any run does.
- J2 another player moves during the lead: a negative time along a track with `wait: 0` is clamped to its start, holds included, and a man defender's closing share is clamped to zero.
- J3 the ball leaves the centre during the lead: `ballAt` keeps it there until `preSnapFor`.
- J4 pre-snap motion on another player: it runs first, everyone holds, then the lead runs with the motion done; the runner's own motion runs first and the sweep starts where it ends.
- J5 the lane sits on or over the line: `jetLane` keeps it at least half a yard behind `LOS_GAP`, and the handoff is where the runner is nearest the quarterback, on the lane.
- J6 a runner lined up within 3 yards of the quarterback on the near side doubles back to the lane's entry: the entry is at their own x.
- J7 a quarterback near a sideline sends the sweep off the field: every point is clamped inside the field like every run's.
- J8 a jet sweep on the quarterback, the centre or a lateral carrier: never offered, refused by the reducer, and taken off by `settleChain`.
- J9 a jet runner off a lateral chain: they run their sweep from the snap with the lead, without the ball, as a decoy, the same as any run off the chain.
- J10 a touchdown: the jet is a run, so `touchdownAt` ignores it, as it does every run.

## In the designer

- **Jet sweep** is a tile in the RUN group, after Delay, shown only for a player who can take one (rule 5). It is hatched in a no-run zone like the other runs.
- With the tile on, a note under the runs says what the sweep is and why it is a handoff.
- The field's description for a screen reader says the sweep is in motion at the snap and takes the handoff behind the line.
- Everything that names a run names this one: "Run: X takes it (Jet sweep).", "Hand off to X" for the quarterback, "Play-action: fake to X, then throw." for the fake, "Jet sweep" on wristbands and slides.

## Verification

`e2e/journeys/jet-sweep.journey.ts` drives it on all four device projects: the palette offers the tile to a receiver and not to the quarterback or centre, the drawn sweep stays behind the line until past the quarterback and crosses the formation, actual playback tokens show the runner moving while everyone else and the ball hold, the handoff happens behind the line with the ball riding with the runner after it, the play saves, reloads and flips, the ball on the 5 flags it as a run, a jet beside a primary pass is play-action with the fake, and a lateral to the runner takes the sweep off and undo brings it back. Each test leaves `test-results/jet-sweep-<device>-<test>.json` with screenshots beside it, uploaded as `jet-sweep`.

# ADR 010: the quarterback's rollout and boot

Status: implemented.

## Why

Every pass so far was thrown from where the quarterback took the snap. The designer could move the ball before the throw (a handoff, laterals, a pitch on the run), but the quarterback themself could only stand and throw, keep it on a run, or toss it back. Two of the most-called flag plays move the quarterback first:

- **The rollout** (a sprint-out): the quarterback takes the snap and runs across behind the line toward a sideline, then throws on the run. It moves the launch point away from the rusher and puts half the field, and a flood of routes, in front of them.
- **The boot** (a bootleg): play-action the other way. The quarterback fakes the handoff to a runner going one way, then rolls out the opposite way to throw, after the defence has flowed with the fake. In 5v5 flag nobody blocks for them, so every boot is a naked boot.

Both are the quarterback's own jobs, so they get a group of their own in the palette.

## Rules

1. **Only the quarterback, at the snap.** Rollout and Boot are offered to the quarterback (the player labelled QB, else the default QB slot, as everywhere) in a **QB** group, and to nobody else: not the centre, not a receiver, and not a carrier after a lateral. Picked for a time the quarterback tosses the ball on, one ends the chain there with that job, as a run picked there does. A rollout or boot on anyone else, or on a quarterback whose play has a lateral, is taken off when the play is read or edited.
2. **Both are passes.** The quarterback carries the ball to a **launch point** behind the line and throws from there to the read, as on any pass. Neither is a run, so neither is flagged in a no-run zone, and neither makes a play match Run in the playbook filter.
3. **The ball comes first.** The quarterback waits for the snap to reach them before moving. With a runner on the play, they also wait at the mesh until the handoff or the fake is done.
4. **A rollout goes right unless mirrored.** It runs to the quarterback's right (the field's +x) wherever they line up; **⇄ Mirror route** sends it left, and **Flip play** flips it with the field.
5. **A boot goes the other way from the fake.** The quarterback fakes to the runner (the read when the read is a run, else the first runner left to right), stepping toward them, then turns back behind where they stood and rolls out the opposite way: away from the side of the quarterback the runner's path ends on (their own side when it ends straight ahead of the quarterback). With no runner to fake to, a boot goes right. A boot is never mirrored; it follows the fake, so moving or flipping the runner turns it.
6. **The launch point is behind the line.** Every point of either path stays on the field, behind the line and in the backfield, and the launch point is at least `PITCH_SET` (2.6 yards) behind the line, so the throw is always a legal forward pass. Near a sideline the path is pulled in to fit, like every run's.
7. **The quarterback is never the read.** A rollout or boot can't be marked primary; a read stored on one is taken off.
8. **With the read on a run, the quarterback hands off and carries out the fake.** The play is a run: the handoff goes to the runner, then the quarterback runs their rollout or boot without the ball, as a decoy. It is flagged in a no-run zone like any run.

## Data model

`"rollout"` and `"boot"` are two new offensive route types: `{ type: "rollout" }`, `{ type: "rollout", mirror: true }` and `{ type: "boot" }` on the quarterback. Nothing else is stored, so they travel everywhere a route does (the draft, saved plays, share links, play and playbook files, backups, undo) through `normalizeRoute`, which accepts any type the route table knows.

- In the route table each has `end: "set"` (the ring the throw leaves from), `ball: "throw"` (a job only the player with the ball can take, so neither is in the passing tree or counts as a route to throw to) and `qb: true`. `isQbAction(type)` answers for both.
- `rolloutLegs(qx, qy, side)` and `bootLegs(qx, qy, side)` in `lib/play/routes.ts` lay the paths out after the quarterback's spot (after any pre-snap motion): the rollout opens and gains depth, runs flat across and turns up to the launch point 8 yards over; the boot steps toward the fake, turns back behind the spot and runs out the other way to the same launch point on its side. Both are measured from the quarterback's depth or 4 yards, whichever is deeper, so a quarterback under centre drops before rolling.
- `fakeOf(players)` in `lib/play/lateral.ts` is the runner a rollout or boot fakes to or hands off to. `qbSide(players)` in `lib/play/geometry.ts` is which way the quarterback goes (rules 4 and 5); it reads the fake's path from `routeYards`, whose across-the-field shape does not depend on the card.
- `settleChain` takes a rollout or boot off anyone but the quarterback, and off the quarterback when the chain has a lateral (rule 1), and takes a read off one (rule 7), so the reducer and storage agree.
- `mirrorable` is true for a rollout and false for a boot; `flipRoute` toggles a rollout's mirror.

## Playback

`planAfterSnap` lays the quarterback's track out from `routeYards` like any route, waiting `snapAt` (rule 3). With a quarterback on a rollout or boot the runner is always `fakeOf`, in teaching and simulation alike, so the fake the field shows is the fake the ball dips to. Once the runner's mesh is timed, the quarterback's track holds at the mesh step (their spot on a rollout, the step toward the fake on a boot) until the exchange is done: `handAt + FAKE` on a pass, `handAt + handFor` on a run. The throw leaves as the quarterback reaches the launch point (or later, if the route needs it), from where they are, so the ball rides in their hands until then and flies from the ring.

Ways it could go wrong, written down before the code:

- Q1 a rollout or boot offered to, or stored on, someone who is not the quarterback: never offered; `settleChain` takes it off; the reducer refuses the pick.
- Q2 a rollout or boot on a quarterback whose play has a lateral (QB → Z, or QB → Z → QB): a carrier tosses it on or throws from where they caught it, so it is taken off, and a lateral picked over one replaces it (undo brings it back).
- Q3 the quarterback leaves before the ball reaches them: their track waits `snapAt`.
- Q4 the quarterback rolls away from the mesh before the handoff or fake: their track holds at the mesh step until it is done, so the ball never chases a quarterback who already left.
- Q5 the boot's direction and the fake disagree: the drawn boot and the playback read the same `fakeOf`, and simulation never picks another runner for the fake.
- Q6 a boot with no runner: it goes right, and the palette says there is nothing to fake yet.
- Q7 a runner whose path ends straight ahead of the quarterback: the boot goes away from the side they lined up on, else right.
- Q8 the launch point on or past the line: every point is held at least `LOS_GAP` behind the line and the launch point at least `PITCH_SET`.
- Q9 the path off the field: x is clamped inside the sidelines and y inside the backfield, so a quarterback near a sideline rolls a shorter way; points that collapse together are dropped from the track.
- Q10 a quarterback under centre, a yard behind the line: the path is measured from 4 yards deep, so they drop, then roll.
- Q11 Flip play on a rollout from the middle of the field: the side is not read off the spot (a quarterback at x = 15 would never flip), so `flipRoute` toggles the mirror; a boot flips with its fake.
- Q12 a read on the quarterback: not offered, `togglePrimary` refuses it, and `settleChain` takes one off a stored rollout or boot.
- Q13 the call words: a rollout is a pass, a boot beside a run is play-action; with the read on a run it is a run and the quarterback is a decoy (rule 8). Nothing is flagged unless the call is a run.
- Q14 pre-snap motion on the quarterback: the path starts where the motion ends, like every route.
- Q15 a jet sweep as the fake: the jet runner's lead runs first, the quarterback holds until the fake as they pass, then boots away from the sweep.
- Q16 no receivers: a rollout or boot with nobody to throw to and no runner is no call yet; the quarterback runs it with the ball and holds.
- Q17 two players labelled QB, or the quarterback renamed: only `quarterback(players)` is offered either, and the other has it taken off.

## In the designer

- The **QB** group (Rollout, Boot) sits between the passing tree and the run game for the quarterback at the snap. A note under it says what the picked one does: which way they go, who they fake to, or that there is no run to fake yet.
- On the field the path is drawn as a route is, ending in the ring the ball is thrown from, and **⇄ Mirror route** shows for a rollout. ★ Mark primary never shows for either.
- The field's description for a screen reader says which way the quarterback rolls out or boots, and who they fake to.
- The words follow the call: "Pass: QB rolls out right and throws." and "Play-action: fake to Z, QB boots left, then throws." on the call line; "Roll out right, throw, look to Y first", "Fake to Z, boot left, throw, look to X first" and, on a run, "Hand off to Z, then boot left" as the quarterback's job, on slides, their alt text and speaker notes.

## Verification

`e2e/journeys/qb-actions.journey.ts` runs on all four device projects. It draws a rollout to the read and checks the palette offers the QB group only to the quarterback, the drawn path stays behind the line and lands at the ring, playback holds the quarterback until the snap, carries the ball with them and throws from the ring, then mirrors, flips, saves and reloads it. It draws a boot off a Dive fake and checks the step toward the fake, the path the other way, the fake at the mesh before the boot, the throw from the far ring, the boot turning when the runner lines up on the other side, the ball on the 5 leaving it unflagged, the read moved onto the runner making it a flagged run with the quarterback as decoy, and a lateral replacing it with undo bringing it back. It downloads a book of both as slides and reads the call lines and jobs from the speaker notes. Each test leaves `test-results/qb-actions-<device>-<test>.json` and pictures, uploaded as `qb-actions`.

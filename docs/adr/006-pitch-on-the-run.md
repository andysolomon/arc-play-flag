# ADR 006: a pitch on the run

Status: implemented. It extends [ADR 005](005-unlimited-laterals.md), whose rules, data model, migration, sidebar, arcs, handles, words and playback all still hold. Nothing in ADR 004 or ADR 005 is superseded.

## Why

Every lateral so far was let go from where its carrier stood: the quarterback's spot at the snap, or the catch before it. That draws a double pass or a trick lateral, but not the play most 5v5 offenses actually run with a pitch: the **option**, where the quarterback runs down the line with the ball, reads a defender, and pitches back to the trailing back from wherever the run takes them. The speed option, the pitch sweep and the hook-and-lateral all need the toss to leave from a point the carrier runs to, not the point they lined up on. This change adds that point.

## Rules

1. A carrier may **run with the ball before pitching it**: straight from where they have it (their spot, or their own catch) to a **release** point, and let the lateral go there. Without one they let it go where they stand, as before.
2. **The run stays behind the line:** `release.y >= LOS_GAP`, and on the field. So a pitch is still never let go past the line, and ADR 005's rules 2 and 3 hold against the release unchanged: the catch is level with or behind the release and behind the line.
3. The catch is clamped against the **release**, never the start of the run. A pitch from up at the line can be caught anywhere behind it, deeper than where the run began included; a release dragged deeper than its catch pushes the catch back level with it, and the catch never comes forward again on its own.
4. A run before a pitch is part of the toss it precedes. It goes with the hop when the hop is cut, flips with the field, and is kept by undo, the draft, saved plays, share links, files, backups and every picture.
5. The words call a lateral let go on the run a **pitch**: "QB runs and pitches to Z". The call names (Double pass, Lateral pass, Lateral run) are unchanged, since what the ball does after the toss is what it was.

## Data model

```ts
interface Hop { to: PlayerId; catch?: Pair; release?: Pair }
```

- `release` is where hop *i* is let go, in absolute yards, when its thrower runs there first. With none stored the release is where they have it, exactly as ADR 005 worked it out. Storage reads it like `catch` (a finite point, clamped onto the field) and `settleChain` clamps it behind the line in chain order, each catch then clamped against it.
- `Link` gains `start`, where the thrower has the ball when it is theirs to toss. `runsBefore(link)` is true when `start` and `release` differ, and everything downstream (the arc, the words, the playback) reads that.
- A play saved before this change stores no `release`, reads back without one, and is drawn and played as it always was. A play saved with one by this version is not readable as that older version's shape, so a device backup of it is checked against today's shape only (`storedPlayers` returns null for it, as for any play in today's shape).

`lib/play/lateral.ts` writes down the ways it could fail before the code (P1–P9): a release past the line or off the field, one where the carrier already stands, the catch clamped against the release rather than the start, a release moved behind its catch, a release on a cut hop, the flip, a carrier who takes it back after running, and pre-snap motion.

## In the designer

- For a time with the ball that the ball goes on from, the palette offers **On the run** beside **Lateral**: in the RUN group for the quarterback at the snap, in WITH THE BALL for a later carrier. Tapping it gives that lateral a release 4 yards across toward whoever takes it and 3 yards up toward the line, so the toss reads as the option it is and the arc clears a back lined up beside the carrier; tapping it again takes the run off and the pitch leaves from where they stand. A note under the tiles says which it is.
- On the field the run is a solid line from the carrier to a **round handle** labelled "QB pitches", and the dashed arc leaves from the handle. The handle drags and takes the arrow keys like a catch's diamond (half a yard a press, a yard with Shift), keyed by hop as `data-release`; the run itself is `data-run`. One dragged or nudged past the line snaps back to it, shakes, and says "QB has to pitch from behind the line. Snapped the pitch back to it." on a flag-yellow note.
- Pictures (thumbnails, the share snapshot, printouts, slides) draw the run as the field does, without the handle.

## Playback and words

- The thrower waits where they have the ball until it is theirs (the snap, or the catch before), runs straight to the release carrying it, holds it there for a beat, and pitches. The target waits at the catch as before. A quarterback who takes it back later reaches their next catch from the release, so their track never jumps.
- `Toss.release` is already the point the ball leaves from, so the flight is unchanged: a straight line from the release to the catch, never forward.
- The call line reads "Lateral run: QB runs and pitches to Z, Z keeps it (Stretch)." and the carrier's job "Run and pitch to Z"; a lateral from a standstill still reads "laterals to" and "Lateral to". Wristbands and slides say where the ball goes as before (`QB › Z keeps`).

## Verification

`e2e/journeys/option-pitch.journey.ts` draws the speed option (QB runs and pitches to Z, who keeps it on a Stretch), toggles the run off and on with undo, saves, reloads, reaches the gallery and the share page with the run drawn and no handle, and opens the link on a cleared device with the release intact. It drags the release past the line (snapped, shaken, the note), places the catch and drags the release deeper (the catch follows), nudges it by keyboard, and undoes it all. It plays the option with the ball carried along the run, held at the pitch, caught by Z behind the line and only then across it. It gives a later carrier a run too, flips the play, and opens a play saved before this change unchanged. Each test leaves `test-results/option-pitch-<device>-<test>.json` and pictures, uploaded as `option-pitch`. The lateral-chain journey still passes, so a lateral from a standstill is unchanged.

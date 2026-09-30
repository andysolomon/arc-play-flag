# Lateral ball assignments

Open an offensive play's **Route palette → Ball assignments**. Movement routes
describe where a player goes; ball assignments describe who possesses the ball.
The sequence starts with the quarterback after the snap.

1. Choose **Add lateral** and its receiver. **Wait (seconds)** is how long the
   current carrier holds the ball after receiving it before releasing this step.
2. Add another lateral, including one back to QB or a previous carrier. There is
   no limit on the number of steps. Every receiver becomes the next step's source.
3. Finish with **Add forward pass**, or leave the last carrier to keep the ball.
   A forward pass finishes the sequence. Remove it to add more laterals first.
4. Run the play. Numbered dashed arrows show ball transfers, separately from the
   movement routes. Invalid assignments display the step and correction and
   disable playback until corrected.

A lateral must travel sideways or backward and both its release and reception
must be behind the LOS. A carrier who crosses the LOS cannot return and throw
or lateral. The one forward pass must be released behind the LOS. A lateral
does not use that pass. These checks use the animated positions at transfer time,
including route bends while the carrier possesses the ball.

Explicit assignments override the inferred run/play-action/pitch simulation;
plays without them keep the existing behavior. Save, Duplicate, draft autosave,
undo/redo, snapshots, JSON transfers, backups and playbook printouts carry the
sequence. A lateral chain with no forward pass remains a run for no-run zones.
Formation templates omit both movement routes and ball assignments.

## Repeatable verification

```sh
bun install --frozen-lockfile
bun run build
bun run test:e2e e2e/journeys/lateral-chain.journey.ts
```

The journey builds sixteen laterals plus a forward pass using the controls,
returns to QB repeatedly, saves and reloads, opens a snapshot in the designer,
checks JSON transfer preservation, observes possession during playback, refuses
illegal exchanges, tests a lateral-only run in a no-run zone, and exports a play
through the gallery and imports it on another device. A changed ball assignment
is imported as a distinct copy even when its movement routes are identical. It leaves
screenshots, the stored play and assignment text, playback frames, validation
messages and exported SVG in each test's output folder. CI uploads these as
`lateral-chains` for desktop, both phones and iPad.

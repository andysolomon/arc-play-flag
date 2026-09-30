# Pre-snap motion

An offensive player can have one pre-snap path alongside their existing post-snap route or run. The coach selects the player, chooses **Pre-snap motion**, taps backfield waypoints, and finishes using the existing path controls. **Redraw motion** starts a replacement draft; cancellation keeps the old assignment. **Remove motion** preserves the route. Assigning motion to another player transfers it when the new path is finished. Each change is undoable.

`Player.preSnap.pts` contains absolute yard points. It is optional, so old plays and links keep their shape. The reducer and storage normalizer retain one offensive motion assignment. Points are bounded inside the offensive backfield; invalid points are dropped and the normal waypoint cap applies. This bounds the editor, rather than attempting to validate every league's motion rules.

Post-snap geometry starts at the motion endpoint. Preset routes are calculated from that spot; custom routes continue through their existing absolute waypoints. Mirroring a custom route uses the endpoint as its pivot; flipping the play also flips the motion. Clear routes clears both assignments for the selected side.

Playback first runs the pre-snap path at the usual player speed while everyone else and the ball hold. The snap, exchanges, throws, catches and playback duration then shift by that path's duration. Man coverage starts from its target's spot at the snap. Live playback and video exports use the same planner. All diagrams use a dashed motion arrow before the post-snap route; export assignment text names motion before the player's job.

Drafts, saved plays, snapshot URLs, short links, play/playbook files and backups preserve the optional player field through their shared normalization. Screen and print renderers share the motion geometry.

## Verification

`e2e/journeys/pre-snap-motion.journey.ts` drives drawing, backfield bounds, route preservation, undo/redo, save/reload, actual playback tokens and stationary ball, return to formation, flip, snapshot preview/share, redraw/cancel, transfer to another player, removal, defense palette, and file export/import on another device. Each device leaves screenshots, a manifest and a play file in its test-results directory. The phone-palette journey includes the new 44px motion controls in its width and hit checks.

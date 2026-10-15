# ADR 008: the roster, a depth chart by position

Status: implemented.

## Why

A play names its players by position: C, QB, X, Y and Z on offense, LC, LB, R, RC and S on defense, the tags the wristbands, slides and binder pages count by. A coach knows those positions by the kids who play them, and wanted the field to say so: who X is, and who steps in at X when that kid is away. A tag is three letters wide, so a name can't go in it, and a name on a play would be stored in every play, every share link and every printout, where a child's name has no business going. So the roster is its own thing: a mode that lays the positions out on the field, with a depth chart per position that the whole library reads from.

## Rules

1. **A position is a tag.** The roster keys its slots by team and tag, exactly as a player's label is stored. Whoever wears X on any play is played by X's starter; two players wearing the same tag on one play share the slot (R5). A tag renamed on a play is a fresh position with nobody down for it (R1); the old slot keeps its names for whoever wears that tag next, and undoing the rename brings them back. A player with no tag has no slot (R6).
2. **Starter first.** Each slot is a list of names, the starter at the top; **▲** moves a line up, **✕** takes it off, **Add a player** puts a blank line at the bottom, up to eight (`MAX_DEPTH`). A blank line is kept as typed while the coach fills it in (R2): nothing is trimmed under their fingers. A slot with no lines left is dropped (R3), so an empty depth chart stores nothing.
3. **The starter's name goes under the tag on the field**, in roster mode and while drawing the play, shortened to fit (R4): whole when it is twelve letters or fewer, else the first word, else cut with an ellipsis. The panel keeps the whole name. A position nobody is down for shows no caption on a play; in roster mode it reads "Unassigned" (or "No tag"), so the gaps are plain.
4. **The roster is the team's, on this device.** It is written as it is typed, like the team's name, never undone, and goes into a device backup and comes back from one. It is never written into a play, a share link, a playbook file, a thumbnail or a printout: the names stay with the coach.
5. **Roster mode is the formation alone.** Routes, arcs, man tags, the no-run stamp, waypoints and the ▶ button are off; both teams are on the field, the play's own side in front and the other faded, every position tappable; dragging still lines players up, and that is the play's edit, undoable as ever. Leaving roster mode brings the play back as it was.

## Data model

`ffpd.roster.v1` holds a list of slots: `{ team, tag, depth }`, `tag` up to three letters as a label is stored, `depth` the names, starter first, each up to forty letters with control characters out. `normalizeRoster` (lib/play/storage.ts) drops a slot with no tag or no lines, ignores a second slot for the same tag on the same team, and caps the list at thirty slots and each slot at eight lines; `readRoster` answers an empty roster for a device that has none. The library store (lib/play/library.ts) serves it with `getRoster` / `setRoster` beside the team, so every screen re-renders on a write and nothing is reported kept until it reads back. The pure helpers are in `lib/play/roster.ts`: `slotOf`, `depthOf`, `starterOf`, `withDepth`, `shortName`, `starters` (the starter under each player id, shortened) and `depthWord` ("Starter", "2nd", "3rd"…).

The device backup (`lib/export/backup.ts`) carries `roster`; a backup from before this change has none and restores an empty one, so version 1 stands. A playbook file does not carry it.

## In the designer

- **Roster** is a tile in Play tools, under its own ROSTER heading before TEAM. It toggles the mode; the header's right toggle reads **Roster** instead of **Routes** and opens the roster panel in the same sidebar; **Clear** waits for the play. The field's title reads "Roster" with the team's name under it.
- The roster panel shows the position tapped: its tag field (the same one the route palette has) and heading "Who plays X", the DEPTH CHART with a numbered line per name, the starter's number on the highlighter, and a note saying where the names go and don't. Under it, every position on both sides, the play's side first, left to right as the wristbands count them, each a button that selects that player and says who starts and how deep ("X: Devon, 2 deep"), and **‹ Back to routes**.
- Entering roster mode leaves whatever was being drawn, keeps the selection (so a player picked in the palette is the position whose chart opens) and opens the panel.
- A screen reader hears "Played by Devon" on a token that has a starter.

## Verification

`e2e/journeys/roster.journey.ts` drives it on all four device projects: roster mode hides the routes and the ▶ button and lists all ten positions as unassigned; X takes three names, the second is moved up to start and the third taken off, the field's caption following each step; the list is the way to the quarterback, whose long name is shortened under the token and whole in the list; the stored roster is exactly the two slots; back in the play the routes return and the names stay, only where somebody is down; the roster outlasts a reload; a share link and its page carry no name, and opening it back in the designer shows the names again; a defensive call lists the defenders first; a tag renamed reads unassigned and undo brings the names back; a device backup carries the roster and restoring it on a wiped device brings the captions back; and a write the device refuses is said once and stores nothing. Each test leaves `test-results/roster-<device>*.json` with pictures of the panel and the field beside it, uploaded as `roster`.

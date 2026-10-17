# ADR 014: the line of scrimmage is the board's setting

Status: implemented. It changes what the **Line of scrimmage** picker in Play tools is: a setting of the coach's board, kept with their look ([ADR 013](013-whole-desk-in-account.md)), rather than a property of the play on it. What a saved play stores does not change.

## Why

The ball's spot was the play's. Picking **From the 5** moved that play's ball, marked the play changed, and was saved with it; New play went back to the 40, and opening another play put the ball wherever that play had been saved from. A coach drawing a set of red-zone plays, or a conversion package, put the ball on the 5 for every one of them, and a coach who had set the ball once found it moved under them every time they opened or started a play.

The spot is where the coach is working, like Deep field is how they are looking. So it becomes a setting of the board.

## Rules

1. **The ball is where the board puts it.** The picker sets the board's spot (`ffpd.los.v1`, one of the four spots of `lib/play/field.ts`). Every play on the board is drawn from it: a new play, a play opened from the gallery, a book or the play switcher, a shared link opened in the designer, and the draft restored on a visit. None of them move it, and neither does Undo or Redo: the spot is no edit.
2. **A play is saved from the board's spot.** Save, Duplicate and the share link write the board's spot into the record, last and only when it is off the 40, exactly as before. So the gallery, the printouts, the slides, the files and the links keep each play's own field: a play's stored spot is where it was last drawn.
3. **A stored spot stands until the play is saved again.** Opening a play saved from the 5 while the board is on the 40 draws it from the 40 and leaves its record alone; its card still shows the 5. Saving it from the 40 writes the 40. Nothing is migrated.
4. **The spot never marks a play changed.** A play drawn from another spot than it was saved from is as saved as it was; the Save tile offers "Save this play", not "Save changes".
5. **The spot is part of the look.** Signed in, it goes up with the coach's look and comes down with it, so the board is on the same yard line on every device; signing out puts the ball back on the drive start. The drive start is the default and leaves no key behind.
6. **The draft carries the board's spot** when it is written, as it always has, so a device backup, the error-recovery file and the account's copy of the board read as before; on restore the board's own setting stands.

`lib/los.ts` writes down the ways this could fail before the code (L1–L5).

## Data model

Unchanged on disk and on the wire for plays, drafts, files and links: `SavedPlay.los` and `DraftRecord.los` keep their meaning and encoding. The board's spot is one new device key, `ffpd.los.v1` (the yard line as a string; absent for the drive start), and one new field of the coach's look in the account, `CoachPrefs.los`, read with the same `readLos` as a stored play's spot.

## In the app

- **Line of scrimmage** in Play tools reads as the board's: "Your board's spot: every play you open or start is drawn from here, and saved from here." The no-run notes keep their warnings.
- `components/App.tsx` draws the board at the setting (`useSyncExternalStore` on `lib/los.ts`) and the reducer keeps `los` out of `openPlay`, `hydrate` and each step of history, so only the picker moves the ball.
- The demo recorder seeds the board's spot from the chapter's play, so a chapter drawn from their 10 still opens there.

## Verification

`e2e/journeys/line-of-scrimmage.journey.ts`: the sweep through the four spots is unchanged; back on the 40 the board keeps no key; the 10 autosaves into the draft without marking the play changed and Undo leaves it; Save and Duplicate write the board's spot; reload and reopen find the board where it was; New play stays on the 10; a play stored on the 40 opens on the board's 10, as saved as it was, with its record untouched; and back on the 40 it is drawn exactly as before. The share-link test puts the board on the 5 before sharing and back on the 40 before sharing a plain play. The journeys that open plays stored off the 40 (end zones, their performance, lateral chains) seed the board's spot where the play was stored, so what they measure is what they measured. The account journey sets the ball on the 10 on one device and finds the second device's board there at sign-in.

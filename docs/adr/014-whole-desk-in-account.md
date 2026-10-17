# ADR 014: the whole desk in the account

Status: implemented. It amends rule 2 of [ADR 012](012-coach-accounts.md): the account now holds everything a coach would find on their desk, not only the library, so any device signed in picks up exactly where the last one left off.

## Why

ADR 012 put a coach's plays, playbooks, team settings and lineups in their account, and kept two things on the device on purpose: the draft on the chalkboard and the playbook picked in the designer. Everything else the app remembers (the theme, the themed field, the end zone and the touchdowns that open the rest, Deep field, where the game-day reader was, the share links a coach can still revoke, whether the getting-started guide was seen) was never in the account at all.

So a coach who sketched a play on a laptop and opened a phone at the field found the saved plays, but not the sketch, not the book they were working in, a light board instead of their dark one, the classic end zone instead of the one they had earned, and a share link they could not revoke. That is not "where I left off".

## Rules

1. **The desk goes up with the team.** A team's data now holds its **desk** beside the library: the **draft** on the chalkboard (saved or not; null when the board is clear), the **playbook picked** in the designer, the **reader's place** in each book, and the **share links** made for its plays and books with their revoke keys. Every one of them is written the way the library is: to the device first, then up to the team.
2. **The look goes up with the account.** How the app looks to the coach is the same on every team: the **theme**, the **themed field**, the **end zone**, **Deep field**, where the board puts the **ball** ([ADR 015](015-line-of-scrimmage-setting.md)), the **touchdowns** counted, and whether the **guide** was seen. The account keeps them once, with their own write count, and every push carries them; a device brings them down whenever the account's are newer, whichever team was open when they changed.
3. **The board goes up on a longer quiet, and at once when the page is hidden.** A save is pushed 1.2 seconds after it lands, as before. A touch on the board, or a pick of a look, waits for 5 seconds of quiet, since a coach drawing touches the board many times a minute; when the tab is hidden or the page is left, anything pending goes up at once, so the next device has it.
4. **A device left open catches up.** On focus, when the tab becomes visible, or when it comes back online, a device with nothing pending asks the account whether the team or the look changed elsewhere and brings it down; the designer redraws the board from the pulled draft. A device with a write pending pushes instead, and a refused push brings the rest down in the merge.
5. **Merging keeps the coach's latest touch.** Two devices' plays and books merge as in ADR 012. The board is one slot: the device whose push was refused keeps its own board when it has anything on it. The reader's places and share links are both devices', this device's word on any book or play both know. The look is the pushing device's, except touchdowns, which only ever go up.
6. **A look picked on the device wins at sign-in.** A device whose look is not the defaults has the coach's latest word, so it goes up over the account's; a device that never picked anything takes the account's look. A sketch on an otherwise empty device stays on the board when the team it opens has none, and goes up.
7. **Signing out clears the look too.** The next coach on the device starts with the defaults; signing in brings the look back. The device is cleared as the page leaves, not before, so nothing still open on it (the chalkboard follows the board's spot, [ADR 015](015-line-of-scrimmage-setting.md)) can write any of it back.
8. **Old builds do no harm.** A build from before this change, still cached by the browser, pushes a team without its desk; the server keeps the desk it has for that team. A team written before this change reads with an empty desk.

`lib/account/sync.ts` writes the new ways this could fail before the code (A19–A28), after ADR 012's A1–A18.

## Data model

```ts
interface TeamData {
  plays: SavedPlay[]; playbooks: Playbook[]; team: TeamSettings; lineups: Lineups;
  draft: DraftRecord | null; currentBook: string | null; reader: Record<string, number>; shares: Record<string, Share[]>;
}
interface CoachPrefs { theme: ThemeChoice; field: FieldChoice; endZone: EndZoneId; deepField: boolean; los: number; touchdowns: number; firstUseDone: boolean }
interface AccountPrefs extends CoachPrefs { rev: number }
```

- The desk is read on the server with the same normalizers the device uses (`lib/account/data.ts`, `readTeamData`): the draft as a draft, the pick kept only when it names a book of the team, the reader's places only for the team's books, and the share links as the share panel reads them (`lib/sharing/shares.ts`).
- In Redis, the look is one more hash per account, `ffpd:account:<user>:prefs` (`rev`, `json`, `touchdowns`), written by the same Lua script as the team, so the two change together; the script moves the rev only when something changed and keeps the higher touchdown count.
- `PUT /api/account/teams/<id>` takes `{ data, rev, prefs }` and answers with the team's summary and the look as the account now holds it; `GET /api/account` and `GET /api/account/teams/<id>` carry `prefs` too. A write whose `data` names none of the desk's keys is an old build's, and the stored desk is carried forward.
- On the device, every write outside the library announces itself (`lib/device-writes.ts`): the draft's autosave, the theme, field, end zone, Deep field, the ball's spot, touchdowns, the reader, the share panel and the guide. The account engine listens, and the device's marker (`ffpd.account.v1`) gains `prefsRev` and a hash over the whole desk and look.

## In the app

- Nothing new to tap. The account panel and the sign-in page now say the play on the board comes too, and the share panel says revoke controls are in the account when signed in.
- The chalkboard redraws when a pull lands (`components/App.tsx` listens through `subscribePulls`), so a device left open on the designer shows what was drawn on the other device once it is focused.

## Verification

`e2e/journeys/account.journey.ts` gains "a coach picks up exactly where they left off on another device": a sketch on the board, a picked playbook, a dark theme, an end zone and Deep field set on one device are on the second device's board and in its settings at sign-in; a touch on the second device's board reaches the first device's board without a reload once it is focused; and signing out clears the board and the look. It leaves `account-<device>-where-i-left-off.json` and pictures of both boards in `test-results/`, uploaded as `account` with the rest.

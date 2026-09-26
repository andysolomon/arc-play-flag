# Browser journeys

End-to-end tests that drive the app the way a coach does, against the **production build** (`next start`), in isolated Chromium contexts. They are the release gate from issue #38: the unit tests in `lib/` prove the pieces, these prove the journeys.

```sh
bun run build            # the tests refuse to run against `next dev`
bun run test:e2e         # all journeys, headless
bunx playwright test --ui                      # pick and step through journeys
bunx playwright test e2e/journeys/history.journey.ts --headed
bun run test:e2e:report  # open the last HTML report (traces for failures)
```

First time only: `bunx playwright install chromium`.

## Rules

- **Fictional fixtures, per test.** Everything comes from `support/fixtures.ts` (the Riverside Otters, a team that does not exist). Each test gets a fresh browser context, so no test can see another's storage, and none of them can ever read or write a real browser profile.
- **Assert what a coach sees**, then what was durably stored. Reading the test's own `localStorage` is fine; it is how we prove a "Saved" was true and a refused import changed nothing.
- **Failure states are induced, not simulated.** `armSabotage` makes storage throw `QuotaExceededError` or canvases refuse a 2D context while a flag is up (or, with `canvasBudget`, once a set number of full-page canvases have drawn), so the app's real failure paths run.
- **Spec files end in `.journey.ts`.** `bun test` picks up `*.spec.*` and `*.test.*`; this suffix keeps the two runners apart.
- Only add a journey for behaviour a coach would notice breaking. Lint, typecheck, unit tests and build stay the fast gates; this suite is for the slow, whole-app promises.

## Coverage

| Journey | File |
| --- | --- |
| Name, draw, save, reload, reopen; failed save → warning, recovery file, retry | `save-and-reopen` |
| Save A, open B, each diagram stays under its own id; New play keeps undo and redo inside the new play; Duplicate | `history` |
| Custom route: primary read survives Mirror and Flip, through to the share page | `custom-route` |
| Playbook create, add, reorder, remove, persist; export disabled/success/failure (including slides); validated import; backup round-trip to a second device | `playbooks` |
| Slides: a 7-play book downloads as a `.pptx` whose stored ZIP, every XML part (parsed by the browser) and package graph (content types, relationships, ids, notes links, one theme per master) check out; titles, alt text and speaker notes match the book for every call type, both sides, idle and unlabelled players; hostile text is escaped or stripped; no "Patrick Hand" in the XML; route labels stay on the field; with the clock pinned a second export is byte-identical; a slide that cannot be drawn, first or mid-deck, reports it and downloads nothing. The deck, a manifest and every slide face are kept in `test-results/slides-<project>.*` and uploaded as `slide-decks` | `slides` |
| Share link shows both teams read-only, opens back in the designer; bad link is a 404 | `sharing` |
| Picture card saves a real PNG; a card that cannot be drawn reports it | `export` |
| ▶ runs and comes back with nothing moved (browser smoke) | `playback` |
| Offense/Defense toggle marks the play, follows it through save, reload and reopen; gallery badge and filter | `play-side` |
| A release that lands while the app is open is offered as **Update ready**; **Update now** reloads onto it, the reloaded page takes over its own worker quietly, plays survive | `update` |
| First visit: the draw-and-run hint, the editable example that never replaces a draft, Demo from the collapsed layout | `first-use` |
| A device backup waits for merge or replace; an invalid one changes nothing | `backup` |
| A dark device gets the dark theme; a picked theme outlasts a reload and reaches other tabs; Auto follows the device; yellow keeps dark ink; printing stays ink on paper; stickers are chalk on the dark board and ink on paper, with a screenshot of each in `test-results/` | `theme` |
| A 100-play library searches, filters and sorts; a playbook fits 320px; open from an entry, add from the designer | `library-discovery` |
| Offline: the shells, exact shared plays and demo media are ready before it says so, imports and exports (a playbook file and a slide deck) work offline, a first install says **Offline updating…** until the whole shell is verified, a broken release never takes over, and a sound one keeps the shared play | `offline` |

Live ▶ playback throws to the primary read 80% of the time: primary-read odds and run/pass/play-action choreography are covered by `lib/play/motion.test.ts`.

## Devices

Every journey runs under four Playwright projects: `chromium` (desktop), `pixel-7` and `iphone-15` (phones) and `ipad-gen-7` (tablet). The phone and tablet projects are Chromium emulating the device's viewport, touch, pixel ratio and user agent, so the overlay drawers, 44px targets and the 393px, 412px and 810px layouts are exercised on every pull request (the 320px check lives in `library-discovery`, which sets its own viewport). Two things that leaves out, and that no automated check here claims:

- **WebKit.** iPhone and iPad run Safari; these projects run Chromium with an iOS viewport. Safari-only rendering or input differences are not caught.
- **Real hardware.** Emulation does not cover real touch latency, memory pressure, iOS Safari's viewport quirks, or a printer.

The `Designer` helper folds a floating drawer before tapping the field (`foldOverlays`), since on a phone or tablet an open drawer covers the players. A journey that reads a palette control after an action that folds the palette on compact layouts (picking a route, marking the primary read) opens the palette again first.

## Checking the slides by hand

`test-results/slides-chromium.pptx` is the exact deck the `slides` journey downloaded, and `slides-chromium.json` is its manifest: the file's size and sha256, every entry's size, CRC-32 and sha256, and each slide's title, alt text, notes and face (also kept as `slides-chromium-<i>.png`). The XML hashes do not depend on font metrics; the PNG hashes hold for the Chromium build the manifest names. CI uploads the decks, manifests and faces of every project as `slide-decks` on every run.

Set `SLIDES_SOFFICE=/path/to/soffice` (LibreOffice with Impress) to have the journey convert the chromium deck to PDF and count its 10 pages; the input path it passes is absolute. CI has no LibreOffice, so there the journey notes it as skipped.

Before a release that touches `lib/export/pptx.ts`, `zip.ts` or `slides.ts`:

- open the deck in PowerPoint (Windows and Mac): no repair prompt, titles in the outline, notes in presenter view;
- open it in Keynote (Mac and iPad): no font banner, presenter notes present;
- upload it to Google Slides: it opens and the speaker notes are present;
- save it once from iOS Safari into Files and open it in Keynote.

Why the deck is built the way it is, and what was validated, is in [ADR 002](../docs/adr/002-playbook-slides.md).

## In CI

`.github/workflows/pr.yml` runs the suite in its own **Browser journeys** job: build, run, always upload `test-results/slides-*` as the `slide-decks` artifact, and on failure upload `test-results/` (traces, screenshots) and `playwright-report/` as the `browser-journeys` artifact. `support/summary-reporter.ts` writes the pass/fail table and each failure's first error line to the job summary.

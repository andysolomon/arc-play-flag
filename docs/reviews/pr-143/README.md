# PR #143 review evidence

Reviewed head: `4cf0d488f34caf492dcebacbe8079048c83586f4`.
Compared with base: `5d3f0705ba679ab45992453cfe79eb653301cd97`.

## P2: custom position depth charts become inaccessible

The roster's slot identity is still `(team, tag)`. Existing data and renamed play tags remain supported by storage and starter captions, but the roster editor now receives only `defaults()`. That list contains no custom tags such as FS. The player page still advertises `FS · Starter`; tapping it closes the page without opening a chart, because `goTo()` cannot find FS in the standard formation. Coaches cannot reorder or remove just one FS assignment, add another player to FS, or populate a newly renamed position.

Reproduction uses fictional Riverside Otters data: a defensive play whose S is tagged FS, and an existing FS depth chart with Jordan first and Casey second. On the base commit the FS chart opens and Move Casey up changes its starter. On the PR head FS is absent from the formation and chart list, while Jordan's player page still shows FS. Clicking FS lands on the position-selection placeholder. The JSON confirms the original FS slot remains stored.

Screenshots are unmodified browser captures:

- `base-fs-chart-chromium.png`: base commit exposes the FS depth chart.
- `custom-fs-player-chromium.png`: PR head still advertises FS on Jordan's page.
- `custom-fs-dead-end-chromium.png`: after tapping FS, no chart opens.
- `custom-fs-dead-end-ipad-gen-7.png`: same dead end on iPad emulation.

Keep the roster independent of the open play, but make custom/existing roster slots editable independently of field-token IDs. Include a regression for imported custom slots and for assigning a renamed play tag.

## Validation

- Production build and TypeScript passed locally; ESLint passed for the five changed UI files. GitHub's lint/typecheck/unit-test/build job also passed.
- All 60 existing roster/playbook-switch cases passed across desktop, Pixel 7, iPhone 15, and iPad gen 7. The initial run had two output-artifact ENOENT errors caused by overlapping reviewer test runners; rerunning the affected Pixel cases alone passed (3/3 selected tests).
- Custom-slot regression observed on all four layouts (4/4 reviewer assertions). Base behavior verified on desktop and iPad (2/2).
- Browser: Chromium Headless Shell 134.0.6998.35, using Playwright 1.63.0. Device layouts are Chromium emulation, not Safari or real hardware.
- Existing checks verify standard formation, fixed tokens, hidden play tools, restored play/history, lineup changes, backup/restore, persistence refusal, and share/print name isolation.

`reproduction.journey.ts.txt` contains the reviewer test used for the head. Copy into `e2e/journeys/pr143-review.journey.ts`, adjust its `out` directory, create that directory, and run against a production build. Its assertions document the observed bug; a permanent regression should instead require FS's chart to open and be editable.

This evidence branch is for review attachments and is not intended to merge.

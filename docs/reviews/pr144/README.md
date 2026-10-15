# PR 144 review evidence

Reviewed commit: 22ec4c98681a0351e2e3f5a32eae8a5b214d1054.

## Finding

P2: The new lineup menu clips distinct lineup names to identical visible labels. Create `Saturday vs Falcons - Rotation A` and `Saturday vs Falcons - Rotation B`, return to Starting Lineup, and open Lineups. Both appear as `Saturday vs Falcons - Rot…`. The label spans use `truncate` and the buttons provide no title or other full-name disclosure. A coach cannot identify the desired rotation before changing the active lineup. Reproduced on all four device projects. Wrap the labels within the menu and allow rows to grow, or provide another touch-accessible way to read the full names before selection.

See `*-ambiguous-lineup-names.png` and corresponding JSON measurements (label text and dimensions only). Source: components/RosterSidebar.tsx:274.

## Validation

- Production build using Next webpack: passed.
- TypeScript and ESLint on changed TypeScript files: passed.
- Existing roster and playbook-switch journeys: 60 passed across chromium, pixel-7, iphone-15, ipad-gen-7.
- Additional edge journey: 4 passed. Checks 20-lineup limit, selected-item focus, Home/End/arrows/Enter/Escape, outside click, protected Starting Lineup, Keep/Delete focus, deletion freeing a slot, branch name selection, and dark mode.
- Name-clipping reproduction: 4 passed, confirming the defect, not asserting correct behavior.

All screenshots are browser captures from a local production build of the reviewed commit, using synthetic fixtures. Playwright 1.63 used the available Chromium 134 headless executable. Phone/tablet coverage is Chromium emulation, not physical hardware or Safari/WebKit. The build was invoked directly without the Bun service-worker stamping step; the Offline unavailable badge is a local harness limitation, not a PR finding. No application source was changed.

The first edge-test attempt clicked a covered element to test outside dismissal and timed out; the harness was corrected to click the unobstructed ROSTER heading and passed on all four projects. Final logs are included. Serialized test state is omitted.

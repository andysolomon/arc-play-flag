# PR #137 review evidence

Reviewed commit: `19bf7597ebde741a2f00b77ccc347cfe38ecb234` (October 15, 2026).

Recommendation: request changes. Two P2 defects and one P3 defect were reproduced across desktop Chromium, Pixel 7, iPhone 15 and iPad gen 7 emulation.

- P2: Reimporting the same book with a different primary silently retains the local primary because book deduplication ignores primary. `primary-not-imported.png` shows the successful import with Slant Left still Primary, although the incoming file requests Wheel Right. See `review-cases/review-import-primary-chromium.json`.
- P2: When the current-book preference write fails, a later successful playbook edit clears the in-memory selection and falls back to another book. `current-book-reverted.png` shows Added to Road Book while the menu shows Game Plan. The test injects a write failure only for `ffpd.current-book.v1`, not a real device quota exhaustion. See `review-cases/review-current-chromium.json`.
- P3: Escape does not close an empty book's play menu when the board is unsaved, because no menu item receives focus and the trigger's key never reaches the panel handler. `empty-menu-after-escape.png` is captured after Escape. See `review-cases/review-empty-escape-chromium.json`.

## Passing checks

Lint, typecheck, production build and 339 unit tests pass. Seven Redis integration tests skipped. All 60 existing journeys in playbook-switch, playbooks, history and library-discovery pass across the four projects. Four additional dark-mode 40-play list checks pass; `ipad-dark-menu.png` shows the End-key focus on the last row.

The 12 defect reproduction cases intentionally assert the observed broken behavior. Their passing results demonstrate reproducibility, not fixed functionality. The two additional import runs recapture the screenshots with the Primary chip in view.

## Repeat

Place `pr137-review.journey.ts` in `e2e/journeys/` of a checkout of the reviewed commit. Use the repository dependencies and Chromium, then:

```sh
bun run build
bunx playwright test e2e/journeys/pr137-review.journey.ts --workers=2
```

## Scope

A local production build was tested using Playwright 1.63 with Chromium headless shell 141.0.7390.37. Phone/tablet profiles emulate viewport and touch in Chromium. Real Safari, physical devices and Redis-backed short-link endpoints were not verified. All fixtures are fictional.

At review time the PR had six merge conflicts against main `11c0cc16561c6c0ab9d00d667f52f487a6d73029`: components/App.tsx, components/PlaySidebar.tsx, components/demo/recorded-from.json, e2e/README.md, e2e/support/fixtures.ts and lib/play/library.ts. Retest after resolving the conflicts.

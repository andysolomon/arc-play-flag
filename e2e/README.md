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
- **Failure states are induced, not simulated.** `armSabotage` makes storage throw `QuotaExceededError` or canvases refuse a 2D context while a flag is up, so the app's real failure paths run.
- **Spec files end in `.journey.ts`.** `bun test` picks up `*.spec.*` and `*.test.*`; this suffix keeps the two runners apart.
- Only add a journey for behaviour a coach would notice breaking. Lint, typecheck, unit tests and build stay the fast gates; this suite is for the slow, whole-app promises.

## Coverage

| Journey | File |
| --- | --- |
| Name, draw, save, reload, reopen; failed save → warning, recovery file, retry | `save-and-reopen` |
| A → B → undo → save writes under A's id and leaves B alone; New play + undo/redo; Duplicate | `history` |
| Custom route: primary read survives Mirror and Flip, through to the share page | `custom-route` |
| Playbook create, add, reorder, remove, persist; export disabled/success/failure; validated import; backup round-trip to a second device | `playbooks` |
| Share link shows both teams read-only, opens back in the designer; bad link is a 404 | `sharing` |
| Picture card saves a real PNG; a card that cannot be drawn reports it | `export` |
| ▶ runs and comes back with nothing moved (browser smoke) | `playback` |

Offline navigation and update coverage is added with #28. The default teaching path is deterministic: primary-read selection and run/pass/play-action choreography are covered by `lib/play/motion.test.ts`, while exported-clip path parity and timing are covered by `lib/export/video.test.ts`.

## In CI

`.github/workflows/pr.yml` runs the suite in its own **Browser journeys** job: build, run, and on failure upload `test-results/` (traces, screenshots) and `playwright-report/` as the `browser-journeys` artifact. `support/summary-reporter.ts` writes the pass/fail table and each failure's first error line to the job summary.

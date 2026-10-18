# Playbook landing verification

The two new browser regressions failed against the unmodified production build: selecting the automatically current Road Book left “New play” on the board, and returning through Designer from its editor did not open its primary.

The fix covers selecting the current book from New play or another play, retaining edits when the primary is already open, falling back to the first available play when a primary is missing, and returning from the book editor. An empty book opens a blank board, explicit play links take precedence, and invalid book links preserve the restored draft. Each JSON file records the asserted board and selected playbook at each step using fictional Otters fixtures.

Validation:
- Production build, ESLint and TypeScript passed.
- Bun: 339 passed, 7 Redis-dependent tests skipped, 0 failed.
- Full playbook-switch browser journey: 40 passed across desktop, Pixel 7, iPhone 15 and iPad Chromium emulation.
- The journey also emits screenshots and JSON under `test-results/playbook-switch-*`, collected by CI's existing `playbook-switch` artifact.
- Demo media is unchanged. Its fingerprint records why the changed navigation paths do not occur in any of the ten recorded chapters.

Reproduce after installing dependencies and building:

```sh
bun run build
bunx playwright test e2e/journeys/playbook-switch.journey.ts --workers=2
```

The local run used the supported `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` override. Real Safari was not tested.

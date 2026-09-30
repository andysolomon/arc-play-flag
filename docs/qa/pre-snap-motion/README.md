# Pre-snap motion verification

Verified against the production webpack build on 2026-09-30.

- Lint and TypeScript: passed.
- Existing unit suite: 254 passed, 7 Redis integration tests skipped (no disposable Redis service).
- Motion, custom-route, playback and phone-palette journeys: 40 passed across Chromium desktop, Pixel 7, iPhone 15 and iPad emulation.
- Final motion-to-route join adjustment: all 12 motion journeys passed again.
- Production build: passed with `bun run build --webpack`. This environment blocked Turbopack's worker port; Playwright's CDN browser archive was unavailable, so the local journeys used npm-distributed Chromium via `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`. CI retains the repository's normal build and browser setup.

Reproduce with `bun run build && bun run test:e2e e2e/journeys/pre-snap-motion.journey.ts e2e/journeys/custom-route.journey.ts e2e/journeys/playback.journey.ts e2e/journeys/phone-palette.journey.ts --workers=2`.

The screenshots use only the fictional Otters fixture. Phone and tablet profiles emulate their viewports in Chromium; real Safari and hardware are outside these checks. CI uploads the repeatable screenshots, playback manifest and exported play JSON as `pre-snap-motion`.

![Desktop editor: dashed motion joins the solid route](desktop-editor.png)

![Shared play on a phone](phone-shared-play.png)

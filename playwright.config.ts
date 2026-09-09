import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journey tests (issue #38). They run against the production build served by
 * `next start`, never `next dev`, so `bun run build` must have run first. Every test
 * gets its own browser context, so storage starts empty and nothing outside the test
 * is ever read or written; the fictional fixtures live in e2e/support/fixtures.ts.
 *
 * Spec files end in `.journey.ts` so `bun test` (which picks up *.spec.* and *.test.*)
 * never tries to run them.
 */
const PORT = 3123;
const CI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e/journeys",
  testMatch: /.*\.journey\.ts$/,
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: CI,
  // one retry in CI so a flaky run is reported as flaky rather than failing the gate outright
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: CI
    ? [["github"], ["html", { open: "never" }], ["./e2e/support/summary-reporter.ts"]]
    : [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${String(PORT)}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // playback and route drawing animate; the tests read committed state, not frames
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run start -p ${String(PORT)}`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !CI,
    timeout: 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});

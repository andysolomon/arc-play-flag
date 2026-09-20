import { expect, test } from "@playwright/test";
import { SLANT_LEFT, seed, storedPlays } from "../support/fixtures";

/**
 * What a coach sees when a release lands while the app is open. From this tab's point of
 * view a deploy is a worker of another release turning up at the same scope, so the test
 * registers one (`?release=` is the worker's test hook; production only ever sees the
 * release stamped in at build time).
 */
test("a new release is offered while the app is open, applied on request, and the reloaded page takes it over quietly", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT] });
  await page.goto("/");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  const before = await page.evaluate(() => caches.keys());
  expect(before.filter((name) => name.startsWith("ffpd-shell-"))).toHaveLength(1);

  await page.evaluate(() => navigator.serviceWorker.register("/sw.js?release=e2e-next").then(() => undefined));
  const banner = page.getByRole("region", { name: "Update ready" });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(banner).toContainText("your plays stay on this device");
  // the worker waits: this tab is still served by the release it loaded with
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toMatch(/\/sw\.js$/);

  const reloaded = page.waitForEvent("load");
  await banner.getByRole("button", { name: "Update now" }).click();
  await reloaded;
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toContain("release=e2e-next");

  // The reloaded page registers the build's own /sw.js. That is the release the page is
  // already running, so it takes over without another prompt or reload. The controller
  // switches as activation starts; the shell of the replaced release goes once it ends.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null), { timeout: 30_000 }).toMatch(/\/sw\.js$/);
  await expect(banner).toBeHidden();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => caches.keys()), { timeout: 30_000 }).not.toContain("ffpd-shell-e2e-next");
  const after = await page.evaluate(() => caches.keys());
  expect(after.filter((name) => name.startsWith("ffpd-shell-"))).toEqual(before.filter((name) => name.startsWith("ffpd-shell-")));
  expect(Object.keys(await storedPlays(page))).toEqual([SLANT_LEFT.id]);
});

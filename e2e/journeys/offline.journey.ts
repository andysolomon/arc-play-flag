import { readFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { Designer, downloadBytes, downloadText } from "../support/designer";
import { encodeShare } from "../../lib/play/share";
import { KEYS, SLANT_LEFT, WHEEL_RIGHT, jsonUpload, playbook } from "../support/fixtures";
import { readZip } from "../support/pptx";

test("a direct demo mount prepares the shells, exact shared plays, and advertised media", async ({ context, page }) => {
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  const visitedId = encodeShare({ name: SLANT_LEFT.name, players: SLANT_LEFT.players });
  await page.goto(`/p/${visitedId}`);
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name })).toBeVisible();

  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
  const range = await page.evaluate(async () => {
    const response = await fetch("/demos/run-play.webm", { headers: { Range: "bytes=0-31" } });
    return { status: response.status, range: response.headers.get("content-range"), bytes: (await response.arrayBuffer()).byteLength };
  });
  expect(range).toEqual({ status: 206, range: expect.stringMatching(/^bytes 0-31\/\d+$/), bytes: 32 });

  const unseenId = encodeShare({ name: WHEEL_RIGHT.name, players: WHEEL_RIGHT.players });
  const unavailable = await page.goto(`/p/${unseenId}`);
  expect(unavailable?.status()).toBe(503);
  await expect(page.getByRole("heading", { name: "Shared play unavailable offline" })).toBeVisible();
});

test("a direct playbooks mount keeps critical imports and exports usable after readiness", async ({ context, page }) => {
  const book = playbook("offline-book", "Offline Book", [WHEEL_RIGHT]);
  await page.addInitScript(([keys, savedPlay, savedBook]) => {
    if (!localStorage.getItem(keys.plays)) localStorage.setItem(keys.plays, JSON.stringify({ [savedPlay.id]: savedPlay }));
    if (!localStorage.getItem(keys.books)) localStorage.setItem(keys.books, JSON.stringify({ [savedBook.id]: savedBook }));
  }, [KEYS, WHEEL_RIGHT, book] as const);

  await page.goto("/playbooks?book=offline-book");
  await expect(page.getByRole("textbox", { name: "Playbook name" })).toHaveValue("Offline Book");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  const failedChunks: string[] = [];
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname.startsWith("/_next/static/")) failedChunks.push(request.url());
  });
  await context.setOffline(true);

  const [playbookDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download playbook file" }).click(),
  ]);
  const playbookJson = await downloadText(playbookDownload);
  expect(JSON.parse(playbookJson)).toMatchObject({ kind: "ffpd.playbook", playbook: { id: "offline-book" } });

  // the slide deck draws and packs with the network off; one play needs no glance slide
  const [slidesDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 40_000 }),
    page.getByRole("button", { name: "Download slides" }).click(),
  ]);
  await expect(page.locator("div[role='status']")).toHaveText("Saved", { timeout: 40_000 });
  expect(slidesDownload.suggestedFilename()).toBe("offline-book-slides.pptx");
  const deck = await downloadBytes(slidesDownload);
  expect(deck.subarray(0, 4).toString("latin1")).toBe("PK\x03\x04");
  expect(readZip(deck).map((i) => i.name).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml"]);

  await page.goto("/playbooks");
  await expect(page.getByRole("heading", { name: "Playbooks" })).toBeVisible();
  await page.getByRole("button", { name: /team, theme & backup settings/ }).click();
  const [backupDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup" }).click(),
  ]);
  expect(JSON.parse(await downloadText(backupDownload))).toMatchObject({ kind: "ffpd.backup" });
  await page.getByRole("button", { name: "Close preview" }).click();
  await page.getByLabel("Import a playbook file").setInputFiles(jsonUpload("offline.playbook.json", playbookJson));
  await page.getByRole("button", { name: "Import playbook", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Playbook name" })).toHaveValue("Offline Book");

  await page.goto("/?open=fx-wheel-right");
  const designer = new Designer(page);
  await expect(designer.field).toBeVisible();
  expect(failedChunks).toEqual([]);
});

/**
 * A deploy the test can break. The browser fetches a worker's script itself, so a release
 * that must fail is registered under `?release=` and answered with the worker source edited
 * to require an asset this server does not have. A sound release uses the built worker as-is.
 */
async function releaseBrokenWorker(context: BrowserContext, page: Page): Promise<void> {
  const source = await readFile(new URL("../../lib/offline/sw.js", import.meta.url), "utf8");
  const script = source.replace(
    'const SHELLS = ["/", "/playbooks", "/demo"];',
    'const SHELLS = ["/nothing-is-served-here", "/playbooks", "/demo"];',
  );
  if (script === source) throw new Error("worker script has no SHELLS list to break");
  await context.route(/\/sw\.js\?release=broken$/, (route) => route.fulfill({ body: script, contentType: "text/javascript" }));
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js?release=broken"); });
}

const shellCaches = (page: Page): Promise<string[]> =>
  page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("ffpd-shell-")).sort());
const readyMarked = (page: Page, cache: string): Promise<boolean> =>
  page.evaluate(async (name) => !!(await (await caches.open(name)).match("/__ffpd_offline_ready__")), cache);
const controllerUrl = (page: Page): Promise<string> =>
  page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? "");

test("a first install says it is updating until the shell is verified, a broken release never takes over, and a sound one keeps the shared play", async ({ context, page }) => {
  await page.goto("/demo");
  // the pill stays on "updating" until every shell page, icon and demo asset is in the cache
  await expect(page.getByText("Offline updating…", { exact: true })).toBeVisible();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  const sharedId = encodeShare({ name: SLANT_LEFT.name, players: SLANT_LEFT.players });
  await page.goto(`/p/${sharedId}`);
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name })).toBeVisible();
  await page.goto("/demo");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  const [current] = await shellCaches(page);
  expect(current).toBeTruthy();

  // one required asset 404s: install fails, the offer never appears, the ready shell stays ready
  await releaseBrokenWorker(context, page);
  await expect.poll(async () => {
    const caches = await shellCaches(page);
    return {
      ready: await readyMarked(page, "ffpd-shell-broken"),
      offered: await page.getByRole("region", { name: "Update ready" }).count(),
      hasBroken: caches.includes("ffpd-shell-broken"),
      controller: await controllerUrl(page),
    };
  }, { timeout: 30_000 }).toEqual({
    ready: false,
    offered: 0,
    hasBroken: true,
    controller: expect.stringMatching(/\/sw\.js$/),
  });
  expect(await readyMarked(page, String(current))).toBe(true);
  await context.setOffline(true);
  await page.goto(`/p/${sharedId}`);
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name })).toBeVisible();
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  // a complete release waits for the coach, then the exact shared play survives the swap
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js?release=e2e-shell"); });
  const banner = page.getByRole("region", { name: "Update ready" });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  expect(await readyMarked(page, "ffpd-shell-e2e-shell")).toBe(true);
  expect(await controllerUrl(page)).toMatch(/\/sw\.js$/);
  const reloaded = page.waitForEvent("load");
  await banner.getByRole("button", { name: "Update now" }).click();
  await reloaded;
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => controllerUrl(page), { timeout: 30_000 }).toMatch(/\/sw\.js$/);
  await expect.poll(() => shellCaches(page), { timeout: 30_000 }).not.toContain("ffpd-shell-broken");
  await context.setOffline(true);
  await page.goto(`/p/${sharedId}`);
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name })).toBeVisible();
  await page.goto("/playbooks");
  await expect(page.getByRole("heading", { name: "Playbooks" })).toBeVisible();
});

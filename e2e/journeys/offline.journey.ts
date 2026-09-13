import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Designer, downloadBytes, downloadText } from "../support/designer";
import { encodeShare } from "../../lib/play/share";
import { KEYS, SLANT_LEFT, WHEEL_RIGHT, jsonUpload, playbook } from "../support/fixtures";

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

  await page.goto("/playbooks");
  await expect(page.getByRole("heading", { name: "Playbooks" })).toBeVisible();
  const [backupDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup" }).click(),
  ]);
  expect(JSON.parse(await downloadText(backupDownload))).toMatchObject({ kind: "ffpd.backup" });
  await page.getByLabel("Import a playbook file").setInputFiles(jsonUpload("offline.playbook.json", playbookJson));
  await expect(page.locator("div[role='status']")).toContainText("already here");

  await page.goto("/?open=fx-wheel-right");
  const designer = new Designer(page);
  await expect(designer.field).toBeVisible();
  await designer.clickTool("Export");
  const [cardDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save picture card" }).click(),
  ]);
  expect((await downloadBytes(cardDownload)).subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(failedChunks).toEqual([]);
});

/**
 * A deploy is new bytes at the worker's URL. The browser fetches a worker's script itself,
 * outside anything a test can route, so a "new version" is registered here under a query
 * string the route can answer for: same scope, same code, whatever the test changed in it.
 */
async function releaseWorker(context: BrowserContext, page: Page, tag: string, edit: (script: string) => string): Promise<void> {
  const script = edit(await readFile(new URL("../../public/sw.js", import.meta.url), "utf8"));
  await context.route(`**/sw.js?${tag}`, (route) => route.fulfill({ body: script, contentType: "text/javascript" }));
  await page.evaluate(async (url) => { await navigator.serviceWorker.register(url); }, `/sw.js?${tag}`);
}

/** The offline pill's states in the order a coach would have seen them, from now on. */
async function watchOfflineStates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pill = document.querySelector("[data-offline-state]");
    if (!pill) throw new Error("no offline status pill");
    const w = window as unknown as { __offlineStates: string[] };
    w.__offlineStates = [pill.getAttribute("data-offline-state") ?? ""];
    new MutationObserver(() => { w.__offlineStates.push(pill.getAttribute("data-offline-state") ?? ""); })
      .observe(pill, { attributes: true, attributeFilter: ["data-offline-state"] });
  });
}
const offlineStates = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __offlineStates: string[] }).__offlineStates);
const shellCaches = (page: Page): Promise<string[]> =>
  page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("ffpd-shell-")).sort());
const readyMarked = (page: Page, cache: string): Promise<boolean> =>
  page.evaluate(async (name) => !!(await (await caches.open(name)).match("/__ffpd_offline_ready__")), cache);
const controllerUrl = (page: Page): Promise<string> =>
  page.evaluate(() => new URL(navigator.serviceWorker.controller?.scriptURL ?? "about:blank").search);

test("a new worker says it is updating, verifies its whole shell, then takes over; a broken one never does", async ({ context, page }) => {
  await page.goto("/demo");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  const sharedId = encodeShare({ name: SLANT_LEFT.name, players: SLANT_LEFT.players });
  await page.goto(`/p/${sharedId}`);
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name })).toBeVisible();
  await page.goto("/demo");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  const [current] = await shellCaches(page);
  expect(current).toBeTruthy();

  // A release whose shell cannot be completed: one asset it needs is not on the server.
  await watchOfflineStates(page);
  await releaseWorker(context, page, "broken", (s) =>
    s.replace(`const CACHE = "${String(current)}";`, 'const CACHE = "ffpd-shell-broken";')
      .replace("const SHELLS = [", 'const SHELLS = ["/nothing-is-served-here",'));
  await expect.poll(() => offlineStates(page), { timeout: 30_000 }).toContain("updating");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  expect(await controllerUrl(page)).toBe("");
  // the shell that was ready stays ready; the failed one never got its ready marker
  expect(await shellCaches(page)).toContain(current);
  expect(await readyMarked(page, String(current))).toBe(true);
  expect(await readyMarked(page, "ffpd-shell-broken")).toBe(false);
  await context.setOffline(true);
  await page.goto(`/p/${sharedId}`);
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name })).toBeVisible();
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Demo" })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  // A sound release: the pill says updating until every asset is verified, then the new
  // worker owns the page, the old shell is gone and the exact shared play survived.
  await watchOfflineStates(page);
  await releaseWorker(context, page, "next", (s) => s.replace(`const CACHE = "${String(current)}";`, 'const CACHE = "ffpd-shell-next";'));
  await expect.poll(() => controllerUrl(page), { timeout: 30_000 }).toBe("?next");
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });
  const states = await offlineStates(page);
  expect(states.indexOf("updating")).toBeGreaterThanOrEqual(0);
  expect(states.lastIndexOf("ready")).toBeGreaterThan(states.indexOf("updating"));
  expect(states).not.toContain("unavailable");
  await expect.poll(() => shellCaches(page)).toEqual(["ffpd-shell-next"]);
  await context.setOffline(true);
  await page.goto(`/p/${sharedId}`);
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name })).toBeVisible();
  await page.goto("/playbooks");
  await expect(page.getByRole("heading", { name: "Playbooks" })).toBeVisible();
});

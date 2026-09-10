import { expect, test } from "@playwright/test";
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

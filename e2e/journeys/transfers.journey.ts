import { expect, test } from "@playwright/test";
import { encodePlayFile } from "../../lib/export/transfer";
import { jsonUpload, playbook, seed, SLANT_LEFT, WHEEL_RIGHT, COVER_TWO, storageSnapshot, storedPlaybooks, storedPlays } from "../support/fixtures";
import { armSabotage, downloadText, sabotage } from "../support/designer";

test("standalone play export/import previews first, preserves notes, and creates no book", async ({ page, browser }) => {
  await seed(page, { plays: [SLANT_LEFT] });
  await page.goto("/playbooks");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export play", exact: true }).click()]);
  expect(download.suggestedFilename()).toBe("otter-slant-left.play.json");
  const text = await downloadText(download);
  const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const recipient = await other.newPage();
    await recipient.goto("/playbooks");
    const before = await storageSnapshot(recipient);
    await recipient.getByLabel("Import a play or playbook file").setInputFiles(jsonUpload("play.json", text));
    await expect(recipient.getByRole("region", { name: "Import preview" })).toContainText("1 added");
    expect(await storageSnapshot(recipient)).toEqual(before);
    await recipient.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(await storageSnapshot(recipient)).toEqual(before);
    await recipient.getByLabel("Import a play or playbook file").setInputFiles(jsonUpload("play.json", text));
    await recipient.getByRole("button", { name: "Import play", exact: true }).click();
    await expect.poll(async () => Object.keys(await storedPlays(recipient)).length).toBe(1);
    expect(await storedPlays(recipient)).toEqual({ [SLANT_LEFT.id]: SLANT_LEFT });
    expect(await storedPlaybooks(recipient)).toEqual({});
    await recipient.reload();
    await expect(recipient.getByText(SLANT_LEFT.name, { exact: true })).toBeVisible();
    await recipient.getByLabel("Import a play or playbook file").setInputFiles(jsonUpload("play.json", text));
    await recipient.getByRole("button", { name: "Import play", exact: true }).click();
    expect(Object.keys(await storedPlays(recipient))).toHaveLength(1);
    expect(await recipient.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally { await other.close(); }
});

test("a failed standalone import leaves the library intact and the preview can retry", async ({ page }) => {
  await armSabotage(page);
  await seed(page, { plays: [SLANT_LEFT] });
  await page.goto("/playbooks");
  await page.getByLabel("Import a play or playbook file").setInputFiles(jsonUpload("wheel.play.json", encodePlayFile(WHEEL_RIGHT)));
  const before = await storageSnapshot(page);
  await sabotage(page, "quota", true);
  await page.getByRole("button", { name: "Import play", exact: true }).click();
  await expect(page.getByRole("region", { name: "Import preview" }).getByRole("alert")).toContainText("Nothing was imported");
  expect(await storageSnapshot(page)).toEqual(before);
  await sabotage(page, "quota", false);
  await page.getByRole("button", { name: "Import play", exact: true }).click();
  await expect.poll(async () => Object.keys(await storedPlays(page)).length).toBe(2);
});

test("short link opens on another device, imports a snapshot, survives reload, and can be revoked", async ({ page, browser }) => {
  test.skip(!process.env.SHARING_TEST_REDIS_URL, "Requires disposable Redis REST adapter; enabled in CI");
  const book = playbook("share-book", "Otter Shared Calls", [WHEEL_RIGHT, SLANT_LEFT, COVER_TWO]);
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [book] });
  await page.goto(`/playbooks?book=${book.id}`);
  await page.getByRole("button", { name: "Share playbook…", exact: true }).click();
  await page.getByRole("button", { name: "Create link", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Share URL", exact: true });
  await expect(field).toHaveValue(/\/s\/[A-Za-z0-9_-]{16}$/);
  const url = await field.inputValue();
  expect(url.length).toBeLessThan(60);
  // Management controls survive a sender reload without adding the revoke capability to the URL.
  await page.reload();
  await expect(field).toHaveValue(url);
  await page.getByRole("textbox", { name: "Playbook name" }).fill("Sender edited later");
  const other = await browser.newContext({ viewport: { width: 768, height: 1024 }, hasTouch: true });
  try {
    const recipient = await other.newPage();
    await recipient.goto("/playbooks");
    await recipient.getByRole("textbox", { name: "Playbook share URL" }).fill(url);
    await recipient.getByRole("button", { name: "Preview link", exact: true }).click();
    await expect(recipient.getByRole("heading", { name: book.name, exact: true })).toBeVisible();
    expect(await storedPlaybooks(recipient)).toEqual({});
    await recipient.getByText("Preview plays and notes", { exact: true }).click();
    await expect(recipient.getByText("X wins inside.", { exact: true })).toBeVisible();
    await recipient.screenshot({ path: "test-results/share-preview-tablet.png", fullPage: true });
    await recipient.getByRole("button", { name: "Import playbook", exact: true }).click();
    await expect(recipient.getByRole("textbox", { name: "Playbook name" })).toHaveValue(book.name);
    expect((await storedPlaybooks(recipient))[book.id]?.plays).toEqual(book.plays);
    await recipient.reload();
    await expect(recipient.getByRole("textbox", { name: "Playbook name" })).toHaveValue(book.name);
    await recipient.getByRole("textbox", { name: "Playbook name" }).fill("Recipient copy");
    expect((await storedPlaybooks(page))[book.id]?.name).toBe("Sender edited later");
    await recipient.goto(url);
    await expect(recipient.getByRole("heading", { name: book.name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Revoke link", exact: true }).click();
    await expect(page.getByText("Link revoked. Copies already imported are unaffected.", { exact: true })).toBeVisible();
    await recipient.reload();
    await expect(recipient.getByRole("alert").filter({ hasText: /missing|Paste an Arc/ })).toContainText("missing, expired, or revoked");
    expect((await storedPlaybooks(recipient))[book.id]?.name).toBe("Recipient copy");
    await recipient.goto("/playbooks");
    await recipient.getByRole("textbox", { name: "Playbook share URL" }).fill("https://evil.test/s/abcdefghijklmnop");
    await recipient.getByRole("button", { name: "Preview link", exact: true }).click();
    await expect(recipient.getByRole("alert").filter({ hasText: /missing|Paste an Arc/ })).toContainText("Paste an Arc Play Flag");
  } finally { await other.close(); }
});

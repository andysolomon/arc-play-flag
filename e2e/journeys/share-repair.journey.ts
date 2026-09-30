import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Designer, downloadText } from "../support/designer";
import { KEYS, OTTERS, SLANT_LEFT, jsonUpload, play, playbook, playbookFile, seed, storedDraft, storedPlays } from "../support/fixtures";
import { freshShareBudget } from "../support/share-budget";
import type { Route, SavedPlay } from "../../lib/play/types";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * A play the designer saved is one the app will share (issue #113). Mirroring Y's Cross and mirroring
 * it back stored `mirror: false`, and unmarking a read (or marking another player's) stored
 * `primary: false`. The loader reads either as nothing, so the strict reader behind Create link and
 * the file import saw a play that "needed repair": the book could not be shared until the coach
 * toggled the route off and on, and its file imported with a warning. How this could break, and the
 * test that catches each:
 *  - a preset mirrored back is stored with `mirror: false`, a read unmarked with `primary: false` → "saved as drawn"
 *  - mirroring back does not bring the route's geometry back                                → "saved as drawn"
 *  - the saved play, or the file exported from the book it is in, carries a false flag       → "saved as drawn"
 *  - the file import calls such a file repaired                                              → "saved as drawn"
 *  - a file from an older build that carries them is called repaired, or its team's no-run
 *    zones (stored only when off) are read as on                                             → "an older file"
 *  - a file that really was repaired (a name too long to keep) is no longer said to be       → "an older file"
 *  - Create link refuses the book, or the play's own Share button does                       → "shares"
 * Leaves `share-repair-<device>-<test>.json` (each step's stored routes, whether the stored text or
 * the exported file carried a false flag, what the import preview said and what Create link returned)
 * and pictures of the import preview and the share panel in test-results/.
 */

const Y_CROSS = play("fx-y-cross", "Otter Y Cross", { o3: { type: "slant" }, o4: { type: "cross", primary: true } }, "Y crosses under the safety.");
const BOOK = playbook("fx-cross-book", "Otter Cross Book", [Y_CROSS]);
const FALSE_FLAG = /"(mirror|primary)":\s*false/;

interface Step { step: string; x: Route | null | undefined; y: Route | null | undefined; red: number }

const routeOf = async (page: Page, id: string): Promise<Route | null | undefined> =>
  (await storedPlays(page))["fx-y-cross"]?.players.find((p) => p.id === id)?.route;
const draftRouteOf = async (page: Page, id: string): Promise<Route | null | undefined> =>
  (await storedDraft(page))?.players.find((p) => p.id === id)?.route;

async function step(d: Designer, steps: Step[], name: string, y: Route | null, x: Route | null): Promise<void> {
  await expect.poll(() => draftRouteOf(d.page, "o4"), { message: name }).toEqual(y);
  await expect.poll(() => draftRouteOf(d.page, "o3"), { message: name }).toEqual(x);
  steps.push({ step: name, x, y, red: await d.primaryRoutes.count() });
}

/**
 * Y's Cross mirrored and mirrored back, its read unmarked, X's marked instead, and the play saved.
 * The stored play must read exactly as drawn: no `mirror: false`, no `primary: false`.
 */
async function drawAndSave(page: Page, steps: Step[]): Promise<Designer> {
  const d = new Designer(page);
  await d.goto("?open=fx-y-cross");
  await d.select("Y");
  const drawn = await d.primaryRoutes.first().getAttribute("d");
  await d.mirrorButton.click();
  await step(d, steps, "Cross mirrored", { type: "cross", primary: true, mirror: true }, { type: "slant" });
  expect(await d.primaryRoutes.first().getAttribute("d"), "the mirrored Cross is drawn the other way").not.toBe(drawn);
  await d.palette();
  await d.mirrorButton.click();
  await step(d, steps, "Cross mirrored back", { type: "cross", primary: true }, { type: "slant" });
  expect(await d.primaryRoutes.first().getAttribute("d"), "mirrored back, the Cross is drawn as it was").toBe(drawn);
  await d.undo.click();
  await step(d, steps, "Undo", { type: "cross", primary: true, mirror: true }, { type: "slant" });
  await d.redo.click();
  await step(d, steps, "Redo", { type: "cross", primary: true }, { type: "slant" });

  await d.select("Y");
  await d.primaryButton.click();
  await step(d, steps, "Y's read unmarked", { type: "cross" }, { type: "slant" });
  await d.select("X");
  await d.primaryButton.click();
  await step(d, steps, "X's read marked", { type: "cross" }, { type: "slant", primary: true });
  await d.select("Y");
  await d.primaryButton.click();
  await step(d, steps, "read moved to Y", { type: "cross", primary: true }, { type: "slant" });
  await d.select("X");
  await d.primaryButton.click();
  await step(d, steps, "read moved back to X", { type: "cross" }, { type: "slant", primary: true });

  await d.save();
  await expect(d.toast).toHaveText("Saved");
  return d;
}

/** From the designer to the book, the way a coach goes: Play tools › Playbooks, then Open. */
async function hopToBook(d: Designer): Promise<void> {
  await d.tools();
  await d.page.locator("#play-sidebar").getByRole("link", { name: "Playbooks" }).click();
  await expect(d.page).toHaveURL(/\/playbooks$/);
  // the book's own Open, not the play card's Open into the designer
  await d.page.locator(`a[href="/playbooks?book=${BOOK.id}"]`, { hasText: "Open" }).click();
  await expect(d.page).toHaveURL(/book=fx-cross-book/);
}

test("a play saved after mirroring back and unmarking a read is stored as drawn, exports clean and imports without a word about repair", async ({ page, browser }, testInfo) => {
  const steps: Step[] = [];
  await seed(page, { plays: [Y_CROSS], playbooks: [BOOK], team: OTTERS });
  const d = await drawAndSave(page, steps);

  const storedText = await page.evaluate((k) => localStorage.getItem(k) ?? "", KEYS.plays);
  expect(storedText, "the stored library carries no false flag").not.toMatch(FALSE_FLAG);
  expect(await routeOf(page, "o4")).toEqual({ type: "cross" });
  expect(await routeOf(page, "o3")).toEqual({ type: "slant", primary: true });

  // the file exported from the book, reached without a reload, as a coach reaches it
  await hopToBook(d);
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download playbook file" }).click()]);
  expect(download.suggestedFilename()).toBe("otter-cross-book.playbook.json");
  const text = await downloadText(download);
  expect(text, "the exported file carries no false flag").not.toMatch(FALSE_FLAG);
  const file = JSON.parse(text) as { plays: SavedPlay[] };
  expect(file.plays[0]?.players.find((p) => p.id === "o4")?.route).toEqual({ type: "cross" });
  expect(file.plays[0]?.players.find((p) => p.id === "o3")?.route).toEqual({ type: "slant", primary: true });

  // another coach's device: the file previews and imports with nothing repaired
  const other = await browser.newContext();
  try {
    const page2 = await other.newPage();
    await page2.goto("/playbooks");
    await page2.getByLabel("Import a playbook file").setInputFiles(jsonUpload("otter-cross-book.playbook.json", text));
    const preview = page2.getByRole("region", { name: "Import preview" });
    await expect(preview).toContainText("1 added");
    const said = (await preview.innerText()).replace(/\s+/g, " ").trim();
    expect(said).not.toContain("repaired");
    await preview.screenshot({ path: `test-results/share-repair-${testInfo.project.name}-import.png` });
    await page2.getByRole("button", { name: "Import playbook", exact: true }).click();
    await expect(page2.locator("div[role='status']")).toHaveText(/^Imported “Otter Cross Book”/);
    expect((await storedPlays(page2))["fx-y-cross"]).toEqual((await storedPlays(page))["fx-y-cross"]);
    writeFileSync(`test-results/share-repair-${testInfo.project.name}-saved.json`, `${JSON.stringify({
      test: "saved as drawn", steps, stored: { falseFlag: FALSE_FLAG.test(storedText) }, file: { falseFlag: FALSE_FLAG.test(text), plays: file.plays }, preview: said,
    }, null, 2)}\n`);
  } finally { await other.close(); }
});

test("a file from an older build that carries false flags imports without a word about repair, and one that really was repaired still says so", async ({ page }, testInfo) => {
  const older: SavedPlay = { ...Y_CROSS, players: Y_CROSS.players.map((p) =>
    p.id === "o4" ? { ...p, route: { type: "cross", mirror: false, primary: false } }
      : p.id === "o3" ? { ...p, route: { type: "slant", primary: true } } : p) };
  const olderTeam = { ...OTTERS, noRunZones: false };
  await page.goto("/playbooks");
  const importInput = page.getByLabel("Import a playbook file");
  const preview = page.getByRole("region", { name: "Import preview" });
  const said = async (): Promise<string> => (await preview.innerText()).replace(/\s+/g, " ").trim();

  await importInput.setInputFiles(jsonUpload("older.playbook.json", playbookFile(BOOK, [older], olderTeam)));
  await expect(preview).toContainText("1 added");
  const olderSaid = await said();
  expect(olderSaid).not.toContain("repaired");
  await page.getByRole("button", { name: "Import playbook", exact: true }).click();
  await expect(page.locator("div[role='status']")).toHaveText(/^Imported “Otter Cross Book”/);
  expect(await routeOf(page, "o4")).toEqual({ type: "cross" });
  expect(await routeOf(page, "o3")).toEqual({ type: "slant", primary: true });
  // the team came with the file, no-run zones off and all: only the flags the app writes as true are read as absent
  const team = JSON.parse(await page.evaluate((k) => localStorage.getItem(k) ?? "{}", KEYS.team)) as Record<string, unknown>;
  expect(team).toMatchObject({ name: OTTERS.name, noRunZones: false });

  // the same play as a standalone file
  await page.goto("/playbooks");
  await page.getByLabel("Import a play file").setInputFiles(jsonUpload("older.play.json", JSON.stringify({ kind: "ffpd.play", version: 1, play: { ...older, id: "fx-y-cross-2" } })));
  await expect(preview).toContainText("1 added");
  const playSaid = await said();
  expect(playSaid).not.toContain("repaired");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  // a file that was repaired is still said to be
  const broken = playbookFile(playbook("fx-broken-book", "Otter Broken Book", [SLANT_LEFT]), [{ ...SLANT_LEFT, name: "x".repeat(90) }]);
  await importInput.setInputFiles(jsonUpload("broken.playbook.json", broken));
  await expect(preview).toContainText("repaired or removed");
  const brokenSaid = await said();

  writeFileSync(`test-results/share-repair-${testInfo.project.name}-older.json`, `${JSON.stringify({
    test: "an older file", older: olderSaid, standalone: playSaid, broken: brokenSaid, team,
  }, null, 2)}\n`);
});

test("Create link shares a book, and the play's own Share button a play, saved after mirroring back and unmarking a read", async ({ page, browser }, testInfo) => {
  test.skip(!process.env.SHARING_TEST_REDIS_URL, "Requires disposable Redis REST adapter; enabled in CI");
  await freshShareBudget();
  const steps: Step[] = [];
  await seed(page, { plays: [Y_CROSS], playbooks: [BOOK], team: OTTERS });
  const d = await drawAndSave(page, steps);
  await hopToBook(d);

  // the book's own share panel
  const panel = page.getByRole("region", { name: "Share playbook" });
  await panel.getByRole("button", { name: "Share playbook…", exact: true }).click();
  await panel.getByRole("button", { name: "Create link", exact: true }).click();
  const field = panel.getByRole("textbox", { name: "Share URL", exact: true });
  await expect(field, "the book is shared, not sent back for repair").toHaveValue(/\/s\/[A-Za-z0-9_-]{16}$/);
  await expect(panel.getByRole("status").filter({ hasText: /repair/ })).toHaveCount(0);
  const status = (await panel.getByRole("status").allInnerTexts()).join(" ");
  const url = await field.inputValue();
  await panel.screenshot({ path: `test-results/share-repair-${testInfo.project.name}-link.png` });

  // the play's own Share button, on its card
  await page.getByRole("link", { name: "‹ All playbooks" }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Link copied" })).toBeVisible();
  const playUrl = await page.evaluate(() => navigator.clipboard.readText());
  expect(playUrl).toMatch(/\/s\/[A-Za-z0-9_-]{16}$/);

  // whoever opens the link gets the play as drawn
  const other = await browser.newContext();
  try {
    const recipient = await other.newPage();
    await recipient.goto(url);
    await expect(recipient.getByRole("heading", { name: BOOK.name, exact: true })).toBeVisible();
    await recipient.getByRole("button", { name: "Import playbook", exact: true }).click();
    await expect.poll(() => routeOf(recipient, "o4")).toEqual({ type: "cross" });
    expect(await routeOf(recipient, "o3")).toEqual({ type: "slant", primary: true });
  } finally { await other.close(); }

  writeFileSync(`test-results/share-repair-${testInfo.project.name}-shares.json`, `${JSON.stringify({
    test: "shares", steps, book: { url: url.replace(/\/s\/.*$/, "/s/<token>"), status }, play: { url: playUrl.replace(/\/s\/.*$/, "/s/<token>") },
  }, null, 2)}\n`);
});

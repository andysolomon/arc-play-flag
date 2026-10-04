import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Designer } from "../support/designer";
import { COVER_ONE_D, OTTERS, SLANT_LEFT, play, playbook, seed, storedDraft } from "../support/fixtures";

/**
 * Inside one playbook a coach sees each play big enough to read, and taps one to look at it in a
 * modal instead of being sent to the designer. How it could break, and where each is caught:
 *  - the plays in the book are still small pictures a coach has to squint at                   → "cards" (width per picture)
 *  - tapping a play does nothing, or leaves the book for the designer                          → "cards" (address unchanged)
 *  - the modal shows a different play, or numbers it differently from the book                 → "modal"
 *  - Previous/Next or the arrow keys don't step, or run past either end                        → "modal"
 *  - a play's notes are missing, or a play without notes shows an empty notes panel            → "modal"
 *  - the modal can't be closed (×, Escape), or closing loses the coach's place on the page     → "modal"
 *  - the modal's way to the reader opens it at another play                                     → "modal"
 *  - the modal's way to the designer opens another play                                         → "designer"
 * Leaves `book-play-view-<device>.json` (each picture's size against its card, and what the modal
 * showed at each step) and pictures of the book and of the modal in test-results/.
 */

const MESH = play("fx-o01", "O01 Trips Mesh", { o3: { type: "cross", primary: true }, o4: { type: "cross", mirror: true }, o5: { type: "flat" } }, "Mesh at 6 yards.\nQB reads the flat.");
const PLAYS = [MESH, SLANT_LEFT, COVER_ONE_D];
const BOOK = playbook("fx-view", "Otter View Book", PLAYS);

interface ModalStep { step: string; title: string; counter: string; notes: string | null; prevDisabled: boolean; nextDisabled: boolean }

const rows = (page: Page): Locator => page.locator("ol > li");
const modal = (page: Page): Locator => page.getByRole("dialog");
const counterOf = (page: Page): Locator => modal(page).getByText(/^Play \d+ of \d+$/);
const notesOf = (page: Page): Locator => modal(page).getByRole("region", { name: "Coaching notes" });
const next = (page: Page): Locator => modal(page).getByRole("button", { name: "Next play", exact: true });
const prev = (page: Page): Locator => modal(page).getByRole("button", { name: "Previous play", exact: true });

async function showing(page: Page, steps: ModalStep[], step: string, n: number): Promise<void> {
  const p = PLAYS[n - 1];
  if (!p) throw new Error(`no play ${String(n)}`);
  await expect(page.getByRole("dialog", { name: p.name }), step).toBeVisible();
  await expect(counterOf(page), step).toHaveText(`Play ${String(n)} of ${String(PLAYS.length)}`);
  await expect(modal(page).getByRole("img", { name: new RegExp(`^${p.name}`) }), step).toBeVisible();
  if (p.notes.trim()) await expect(notesOf(page), step).toContainText(p.notes.split("\n")[0] ?? "");
  else await expect(notesOf(page), step).toHaveCount(0);
  await expect(prev(page), step).toBeEnabled({ enabled: n > 1 });
  await expect(next(page), step).toBeEnabled({ enabled: n < PLAYS.length });
  steps.push({
    step,
    title: (await modal(page).getByRole("heading", { level: 2 }).innerText()).trim(),
    counter: (await counterOf(page).innerText()).trim(),
    notes: (await notesOf(page).count()) ? (await notesOf(page).innerText()).replace(/\s+/g, " ").trim() : null,
    prevDisabled: await prev(page).isDisabled(),
    nextDisabled: await next(page).isDisabled(),
  });
}

test("a coach sees each play in a book big, opens one in a modal, steps through the book there, and goes on to the reader or the designer", async ({ page }, testInfo) => {
  await seed(page, { plays: PLAYS, playbooks: [BOOK], team: OTTERS });
  const bookUrl = `/playbooks?book=${BOOK.id}`;
  await page.goto(bookUrl);
  await expect(rows(page)).toHaveCount(PLAYS.length);

  // cards: every picture fills its card, so it is as wide as the gallery's, not a postage stamp
  const cards: { name: string; picture: number; card: number }[] = [];
  for (const [i, p] of PLAYS.entries()) {
    const row = rows(page).nth(i);
    await expect(row.getByLabel(`Play ${String(i + 1)}`, { exact: true })).toBeVisible();
    const picture = await row.getByRole("button", { name: `View ${p.name}` }).boundingBox();
    const box = await row.boundingBox();
    if (!picture || !box) throw new Error("card not laid out");
    cards.push({ name: p.name, picture: Math.round(picture.width), card: Math.round(box.width) });
    expect(picture.width, p.name).toBeGreaterThanOrEqual(Math.min(240, box.width - 40));
    expect(picture.width / box.width, p.name).toBeGreaterThan(0.8);
  }
  await page.locator("ol").screenshot({ path: `test-results/book-play-view-${testInfo.project.name}-cards.png` });

  // modal: tapping a play opens it over the book, without leaving the page
  const steps: ModalStep[] = [];
  await rows(page).nth(0).getByRole("button", { name: `View ${MESH.name}` }).click();
  await expect(page).toHaveURL(bookUrl);
  await showing(page, steps, "opened from the first card", 1);
  await modal(page).screenshot({ path: `test-results/book-play-view-${testInfo.project.name}-modal.png` });

  await next(page).click();
  await showing(page, steps, "Next", 2);
  await page.keyboard.press("ArrowRight");
  await showing(page, steps, "ArrowRight to the last play", 3);
  await page.keyboard.press("ArrowRight");
  await showing(page, steps, "ArrowRight stays on the last play", 3);
  await page.keyboard.press("ArrowLeft");
  await showing(page, steps, "ArrowLeft", 2);
  await prev(page).click();
  await showing(page, steps, "Previous to the first play", 1);

  await page.keyboard.press("Escape");
  await expect(modal(page)).toHaveCount(0);
  await expect(rows(page).nth(0).getByRole("button", { name: `View ${MESH.name}` })).toBeFocused();
  await expect(page).toHaveURL(bookUrl);

  await rows(page).nth(1).getByRole("button", { name: `View ${SLANT_LEFT.name}` }).click();
  await showing(page, steps, "opened from the second card", 2);
  await modal(page).getByRole("button", { name: "Close play" }).click();
  await expect(modal(page)).toHaveCount(0);

  // on to the reader at the play the modal showed
  await rows(page).nth(2).getByRole("button", { name: `View ${COVER_ONE_D.name}` }).click();
  await showing(page, steps, "opened from the third card", 3);
  await modal(page).getByRole("link", { name: "Game-day reader at this play" }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("read")).toBe("3");
  await expect(page.getByText("Play 3 of 3", { exact: true })).toBeVisible();

  // designer: the modal's way out opens that play, not another
  await page.goto(bookUrl);
  await rows(page).nth(0).getByRole("button", { name: `View ${MESH.name}` }).click();
  await showing(page, steps, "opened again for the designer", 1);
  await modal(page).getByRole("link", { name: "Open in designer ›" }).click();
  await expect(page).toHaveURL("/");
  const designer = new Designer(page);
  await designer.tools();
  await expect(designer.nameInput).toHaveValue(MESH.name);
  await expect.poll(async () => (await storedDraft(page))?.id).toBe(MESH.id);

  writeFileSync(
    `test-results/book-play-view-${testInfo.project.name}.json`,
    `${JSON.stringify({ device: testInfo.project.name, viewport: page.viewportSize(), cards, steps }, null, 2)}\n`,
  );
});

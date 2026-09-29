import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { unfoldBook } from "../support/designer";
import { COVER_TWO, OTTERS, WHEEL_RIGHT, playbook, seed } from "../support/fixtures";

/**
 * Share and Export fold away in a playbook, so its plays come first. How this could break, and
 * the test that catches each:
 *  - a section starts open, so the share card and every export option are in the way   → "start folded"
 *  - a folded section can still be seen, tabbed into or read out                        → "start folded"
 *  - the header isn't a button, or doesn't say whether it is open (aria-expanded)       → "start folded"
 *  - a tap or the keyboard doesn't open it, or it can't be closed again                 → "start folded"
 *  - folding Export forgets the options a coach set                                     → "start folded"
 *  - folding Share throws away a link whose revoke control is only on the page          → kept mounted, as Export is
 *  - the Share header doesn't say how many links this device holds for the book         → "links"
 *  - a reload leaves either open                                                        → "start folded"
 * Leaves `book-folds-<device>.json` (each step's folds and what their headers said) and a picture
 * of the playbook folded and unfolded in test-results/.
 */

const BOOK = playbook("fx-fold-book", "Otter Fold Book", [WHEEL_RIGHT, COVER_TWO]);

interface Fold { expanded: string | null; says: string }
interface Step { step: string; share: Fold; export: Fold }

const fold = (page: Page, label: "Share" | "Export"): Locator => page.locator(`button[data-fold='${label}']`);
const shareCard = (page: Page): Locator => page.getByRole("region", { name: "Share playbook" });
const binder = (page: Page): Locator => page.getByRole("button", { name: "Download binder PDF" });

async function read(page: Page, step: string): Promise<Step> {
  const one = async (label: "Share" | "Export"): Promise<Fold> => ({
    expanded: await fold(page, label).getAttribute("aria-expanded"),
    says: (await fold(page, label).innerText()).replace(/\s+/g, " ").trim(),
  });
  return { step, share: await one("Share"), export: await one("Export") };
}

test("Share and Export start folded in a playbook, open and close on a tap or a key, and keep what was set inside", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  await seed(page, { plays: [WHEEL_RIGHT, COVER_TWO], playbooks: [BOOK], team: OTTERS });
  await page.goto(`/playbooks?book=${BOOK.id}`);
  await expect(page.getByRole("textbox", { name: "Playbook name" })).toHaveValue(BOOK.name);

  // folded: buttons that say so and what is inside, and nothing of either section to see or reach
  for (const label of ["Share", "Export"] as const) {
    await expect(fold(page, label)).toHaveRole("button");
    await expect(fold(page, label)).toHaveAttribute("aria-expanded", "false");
    expect(await fold(page, label).getAttribute("aria-controls"), "the header names the section it folds").toBeTruthy();
  }
  await expect(fold(page, "Share")).toContainText("Not shared yet");
  await expect(fold(page, "Export")).toContainText("Wristbands, binder, slides, postcards, flyer");
  await expect(shareCard(page)).toBeHidden();
  await expect(binder(page)).toBeHidden();
  await expect(page.getByRole("img", { name: "Playbook PDF preview" })).toBeHidden();
  // the plays are what the page is for
  await expect(page.getByRole("list").getByRole("listitem")).toHaveCount(2);
  steps.push(await read(page, "fresh"));
  await page.screenshot({ path: `test-results/book-folds-${testInfo.project.name}-folded.png`, fullPage: true });

  // a tap opens each
  await unfoldBook(page, "Export");
  await expect(binder(page)).toBeVisible();
  await expect(page.getByRole("img", { name: "Playbook PDF preview" })).toBeVisible();
  await unfoldBook(page, "Share");
  await expect(shareCard(page)).toBeVisible();
  await expect(shareCard(page).getByRole("button", { name: "Share playbook…" })).toBeVisible();
  steps.push(await read(page, "unfolded"));
  await page.screenshot({ path: `test-results/book-folds-${testInfo.project.name}-unfolded.png`, fullPage: true });

  // an option set in Export outlasts folding it
  await page.getByRole("combobox", { name: "Binder layout" }).selectOption("four");
  await fold(page, "Export").click();
  await expect(fold(page, "Export")).toHaveAttribute("aria-expanded", "false");
  await expect(binder(page)).toBeHidden();
  await fold(page, "Export").click();
  await expect(page.getByRole("combobox", { name: "Binder layout" })).toHaveValue("four");

  // the keyboard folds Share away again, and focus stays on the header
  await fold(page, "Share").focus();
  await page.keyboard.press("Enter");
  await expect(fold(page, "Share")).toHaveAttribute("aria-expanded", "false");
  await expect(shareCard(page)).toBeHidden();
  await expect(fold(page, "Share")).toBeFocused();
  await page.keyboard.press("Space");
  await expect(fold(page, "Share")).toHaveAttribute("aria-expanded", "true");
  await expect(shareCard(page)).toBeVisible();
  steps.push(await read(page, "keyboard"));

  // a reload folds both again
  await page.reload();
  await expect(fold(page, "Share")).toHaveAttribute("aria-expanded", "false");
  await expect(fold(page, "Export")).toHaveAttribute("aria-expanded", "false");
  await expect(binder(page)).toBeHidden();
  steps.push(await read(page, "reloaded"));

  writeFileSync(`test-results/book-folds-${testInfo.project.name}.json`, `${JSON.stringify({ test: "start folded", steps }, null, 2)}\n`);
});

test("a folded Share says how many links this device holds for the book", async ({ page }) => {
  await seed(page, { plays: [WHEEL_RIGHT, COVER_TWO], playbooks: [BOOK], team: OTTERS });
  const expiresAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const link = (n: number) => ({ token: `otterfoldlink00${String(n)}`, revokeKey: `otter-fold-revoke-key-000000000${String(n)}`, expiresAt });
  await page.evaluate(([id, links]) => { localStorage.setItem("ffpd.shares.v1", JSON.stringify({ [id]: links })); }, [BOOK.id, [link(1), link(2)]] as const);
  await page.goto(`/playbooks?book=${BOOK.id}`);
  await expect(fold(page, "Share")).toHaveAttribute("aria-expanded", "false");
  await expect(fold(page, "Share")).toContainText("2 links");

  await unfoldBook(page, "Share");
  await expect(shareCard(page).getByRole("textbox", { name: "Share URL" })).toHaveCount(2);
});

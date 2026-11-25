import { writeFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import { expectNoClippedText } from "../support/clipped";
import { Designer } from "../support/designer";
import { play, playbook, seed } from "../support/fixtures";

/**
 * A coach's long names are shown whole, or one line with the whole name held in a title, wherever they are
 * drawn: two names that differ only at the end must never both read "Saturday vs Falcons - Rot…" (22ec4c9,
 * fixed in 3b401ea for lineups). How this could break, and the step that catches each:
 *  - the play's name over the field is cut off with no title holding it whole       → "over the field"
 *  - the plays dropped down from that name, or the playbooks in Play tools, cut off  → "over the field"
 *  - a playbook or play card, or the team's settings pill, cut off with no title    → "playbooks"
 *  - a play's row in its playbook cut off with no title                              → "the book"
 *  - the game-day reader's header cuts the playbook's name off                       → "the book"
 * Every step reads the words under it with expectNoClippedText, so a hand-rolled ellipsis anywhere in those
 * regions fails here, not only in the places named. Leaves `long-names-<device>.json` (each region, how many
 * boxes it read and what was cut off) and a picture of each menu in test-results/.
 */

const ROT_A = play("fx-long-a", "Saturday vs Falcons - Trips Right Mesh Rotation A", { o3: { type: "slant" } });
const ROT_B = play("fx-long-b", "Saturday vs Falcons - Trips Right Mesh Rotation B", { o4: { type: "out" } });
const WEEK_A = playbook("fx-long-week-a", "Riverside Otters Fall Season Game Plan - Week 7 A", [ROT_A, ROT_B]);
const WEEK_B = playbook("fx-long-week-b", "Riverside Otters Fall Season Game Plan - Week 7 B", [ROT_B]);
const TEAM = { name: "Riverside Otters Under-12 Saturday Morning Flag Football", color: "#2a9d8f" };

interface Region { region: string; checked: number; clipped: string[] }

async function read(regions: Region[], region: string, scope: Locator): Promise<void> {
  regions.push({ region, ...(await expectNoClippedText(scope)) });
}

function save(device: string, regions: Region[]): void {
  writeFileSync(`test-results/long-names-${device}.json`, `${JSON.stringify({ regions }, null, 2)}\n`);
}

test("long play, playbook and team names are shown whole, or with the whole name in a title, on every screen that lists them", async ({ page }, info) => {
  const device = info.project.name;
  const regions: Region[] = [];
  await seed(page, { plays: [ROT_A, ROT_B], playbooks: [WEEK_A, WEEK_B], team: TEAM });
  const d = new Designer(page);

  // over the field: the play's name, the plays dropped down from it, and every playbook in Play tools
  await d.openSaved(ROT_B.name);
  await d.closeSidebars();
  await read(regions, "the name over the field", page.locator("#field-title"));
  await page.getByRole("button", { name: "Switch play" }).click();
  const plays = page.getByRole("menu", { name: "Switch play" });
  await expect(plays.getByRole("menuitemradio")).toHaveText([new RegExp(ROT_A.name), new RegExp(ROT_B.name)]);
  await read(regions, "the plays over the field", plays);
  await page.screenshot({ path: `test-results/long-names-${device}-plays.png` });
  await page.keyboard.press("Escape");
  await expect(plays).toHaveCount(0);
  await d.tools();
  await page.locator("#play-sidebar").getByRole("button", { name: "Playbooks" }).click();
  const books = page.getByRole("menu", { name: "Playbooks" });
  await expect(books.getByRole("menuitemradio")).toHaveText([new RegExp(WEEK_A.name), new RegExp(WEEK_B.name)]);
  await read(regions, "the playbooks in Play tools", books);
  await page.locator("#play-sidebar").screenshot({ path: `test-results/long-names-${device}-playbooks-menu.png` });
  await page.keyboard.press("Escape");

  // playbooks: each book's and play's card, and the team's settings pill
  await page.goto("/playbooks");
  await expect(page.getByRole("heading", { name: "Playbooks", level: 1 })).toBeVisible();
  await expect(page.locator(`span[title="${WEEK_B.name}"]`)).toBeVisible();
  await read(regions, "playbooks", page.locator(".app-root"));

  // the book: each play's row, and the game-day reader's header
  await page.goto(`/playbooks?book=${WEEK_A.id}`);
  await expect(page.locator("ol > li")).toHaveCount(2);
  await read(regions, "the book", page.locator(".app-root"));
  await page.getByRole("link", { name: /Game-day reader/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(WEEK_A.name);
  await read(regions, "the game-day reader's header", page.getByRole("banner"));

  save(device, regions);
});

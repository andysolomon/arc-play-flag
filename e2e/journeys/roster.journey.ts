import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Lineups, Roster, SavedPlay } from "../../lib/play/types";
import { Designer, armSabotage, downloadText, sabotage } from "../support/designer";
import { OTTERS, SLANT_LEFT, jsonUpload, play, seed, storedLineups } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * The roster (docs/adr/008-roster-depth-chart.md): a mode that lays the positions out on the field with
 * nothing drawn on them, lists every position on both sides, and, for the one tapped, takes a depth chart
 * of names, starter first, with a way to move a player up and to take one off. The starter's name is
 * drawn under the tag, in roster mode and while drawing the play, is the device's (it outlasts a reload,
 * goes into a device backup and comes back from one), and never reaches a share link. Roster mode is the
 * team's standard formation, never the play that is open: none of its routes, tags, spots, side or tools,
 * nothing to drag or undo, and the play is back as it was on the way out. A write the device refuses is said, and
 * stores nothing. Every name on the lineup has a page of its own: the positions they play and where they
 * sit at each. Lineups are versions of it all: the Starting Lineup is always there, any lineup branches
 * into a copy to change, the field follows the one picked, and a deleted lineup falls back to the one it
 * came from. Players join the team by name, any time, the same on every lineup, and a depth chart is
 * filled from the team; a name typed new at a position joins the team too. A caption at a sideline is pulled in so the whole name stays on the field, and no caption is
 * printed. Leaves `roster-<device>*.json` (what was stored at each step) and pictures of the panel and
 * the field in `test-results/`.
 */

const panel = (page: Page) => page.locator("#route-sidebar");
const openSettings = (page: Page) => page.getByRole("button", { name: /team, theme & backup settings/ }).click();
/** The starting lineup alone, holding these slots, and the team's players. */
const main = (slots: Roster, players: string[] = []): Lineups => ({ active: "main", lineups: [{ id: "main", name: "Starting Lineup", slots }], players });
/** The names on a depth chart, starter first. */
const lines = (chart: Locator) => chart.locator("ol").getByRole("button", { name: /^(Starter|\d+(st|nd|rd|th)) at \w+: / });
/** Opens a depth chart's chooser and adds a player by a name typed new (or already on the team). */
async function addNew(chart: Locator, name: string): Promise<void> {
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  const field = chart.getByRole("textbox", { name: /^New player at / });
  await expect(field).toBeVisible();
  await field.fill(name);
  await field.press("Enter");
}
/** The name of the active lineup, the button dropping every lineup down from it, and its menu, in the roster panel. */
const lineupName = (page: Page) => panel(page).getByRole("textbox", { name: "Lineup name" });
const lineupsButton = (page: Page) => panel(page).getByRole("button", { name: "Lineups", exact: true });
const lineupMenu = (page: Page) => panel(page).getByRole("menu", { name: "Lineups" });
/** Opens the lineups menu and picks one: the field follows it and focus goes back to the button. */
async function pickLineup(page: Page, name: string): Promise<void> {
  await lineupsButton(page).click();
  await lineupMenu(page).getByRole("menuitemradio", { name, exact: true }).click();
  await expect(lineupMenu(page)).toHaveCount(0);
  await expect(lineupsButton(page)).toBeFocused();
}
/** The lineups the menu lists, in order, and the one checked; Escape closes it again. */
async function expectLineups(page: Page, names: string[], active: string): Promise<void> {
  await lineupsButton(page).click();
  await expect(lineupMenu(page).getByRole("menuitemradio")).toHaveText(names);
  await expect(lineupMenu(page).getByRole("menuitemradio", { checked: true })).toHaveText(active);
  await expect(lineupMenu(page).getByRole("menuitemradio", { checked: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(lineupMenu(page)).toHaveCount(0);
  await expect(lineupsButton(page)).toBeFocused();
}

test("positions are laid out, each takes a depth chart, the starter is named on the field, kept on the device and out of links", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await expect(d.routes).toHaveCount(2);
  await expect(d.caption("X")).toHaveCount(0);

  // roster mode: the formation alone, both sides, nothing to run, and the panel on the positions
  await d.roster();
  await expect(page.getByRole("heading", { name: "Roster", level: 1 })).toBeVisible();
  await expect(d.routes).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run the play" })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("button", { name: "Clear routes" })).toBeDisabled();
  await expect(d.player("S", "Defense")).toBeVisible();
  await expect(d.caption("X")).toHaveText("Unassigned");
  // no play is open in roster mode: Play tools keeps the roster and the team, not the play's own sections
  await d.tools();
  const tools = page.locator("#play-sidebar");
  await expect(tools.getByRole("button", { name: "Roster", exact: true })).toBeVisible();
  for (const tile of ["New play", "Save", "Duplicate", "Copy share link", "Flip play", "Reset spots"]) {
    await expect(tools.getByRole("button", { name: tile, exact: true })).toHaveCount(0);
  }
  await expect(tools.getByRole("textbox", { name: "Play name" })).toHaveCount(0);
  await d.rosterPanel();
  const offense = panel(page).getByRole("group", { name: "Offense positions" });
  await expect(panel(page).getByRole("group", { name: /positions$/ }).first()).toHaveAttribute("aria-label", "Offense positions");
  await expect(offense.getByRole("button")).toHaveCount(5);
  await expect(offense.getByRole("button", { name: "X: Unassigned" })).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Defense positions" }).getByRole("button")).toHaveCount(5);

  // X's depth chart: three names, the second moved up to start, the third taken off
  await d.select("X");
  await expect(panel(page).getByRole("heading", { name: "Who plays X" })).toBeVisible();
  const chart = panel(page).getByRole("group", { name: "Depth chart at X" });
  await expect(chart).toContainText("Nobody is down for X yet.");
  // with nobody on the team, the chooser goes straight to a new name, which joins the team and the chart
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  const chooser = chart.getByRole("group", { name: "Add a player at X" });
  await expect(chooser).toContainText("Nobody is on the team yet.");
  await expect(chooser.getByRole("textbox", { name: "New player at X" })).toBeFocused();
  await chooser.getByRole("textbox", { name: "New player at X" }).fill("Marcus Lee");
  await chooser.getByRole("textbox", { name: "New player at X" }).press("Enter");
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  await addNew(chart, "Devon");
  await addNew(chart, "Priya");
  await expect(offense.getByRole("button", { name: "X: Marcus Lee, 3 deep" })).toBeVisible();
  await chart.getByRole("button", { name: "Move Devon up" }).click();
  await expect(lines(chart)).toHaveText(["Devon", "Marcus Lee", "Priya"]);
  await expect(d.caption("X")).toHaveText("Devon");
  // off the chart is not off the team
  await chart.getByRole("button", { name: "Remove Priya" }).click();
  await expect(lines(chart)).toHaveText(["Devon", "Marcus Lee"]);
  await expect(offense.getByRole("button", { name: "X: Devon, 2 deep" })).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Players" }).getByRole("button", { name: "Priya", exact: true })).toContainText("No position");
  const afterX = await storedLineups(page);

  // the list is the way to the next position; a long name is shortened under the token, whole in the panel
  await offense.getByRole("button", { name: "QB: Unassigned" }).click();
  await expect(panel(page).getByRole("heading", { name: "Who plays QB" })).toBeVisible();
  const qb = panel(page).getByRole("group", { name: "Depth chart at QB" });
  await addNew(qb, "Aaliyah Brooks-Washington");
  await expect(d.caption("QB")).toHaveText("Aaliyah");
  await expect(offense.getByRole("button", { name: "QB: Aaliyah Brooks-Washington" })).toBeVisible();
  const expected = main([
    { team: "offense", tag: "X", depth: ["Devon", "Marcus Lee"] },
    { team: "offense", tag: "QB", depth: ["Aaliyah Brooks-Washington"] },
  ], ["Marcus Lee", "Devon", "Priya", "Aaliyah Brooks-Washington"]);
  await expect.poll(() => storedLineups(page)).toEqual(expected);
  await panel(page).screenshot({ path: `test-results/roster-${device}-panel.png` });

  // a player's own page: every position they play and where they sit at each, across both sides
  await d.select("LC", "Defense");
  const lc = panel(page).getByRole("group", { name: "Depth chart at LC" });
  // the chooser offers the whole team; a name typed another way is the player already on it
  await lc.getByRole("button", { name: "+ Add a player" }).click();
  await expect(lc.getByRole("group", { name: "Add a player at LC" }).locator("li").getByRole("button"))
    .toHaveText([/^Aaliyah Brooks-Washington\s*QB starter$/, /^Devon\s*X starter$/, /^Marcus Lee\s*X 2nd$/, /^Priya\s*No position$/]);
  await lc.getByRole("button", { name: "Add Priya at LC" }).click();
  await addNew(lc, "devon");
  await expect(lines(lc)).toHaveText(["Priya", "Devon"]);
  const players = panel(page).getByRole("group", { name: "Players" });
  await expect(players.locator("li").getByRole("button")).toHaveText([/^Aaliyah Brooks-Washington/, /^Devon/, /^Marcus Lee/, /^Priya/]);
  await players.getByRole("button", { name: "Devon", exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: "Devon" })).toBeVisible();
  const positions = panel(page).getByRole("group", { name: "Devon's positions" });
  await expect(positions.locator("li").getByRole("button")).toHaveText(["X · Starter", "LC · 2nd"]);
  await panel(page).screenshot({ path: `test-results/roster-${device}-player.png` });
  // a position on the page is the way to its depth chart
  await positions.getByRole("button", { name: "X · Starter" }).click();
  await expect(panel(page).getByRole("heading", { name: "Who plays X" })).toBeVisible();
  await expect(d.player("X")).toHaveAttribute("aria-pressed", "true");
  await d.foldOverlays();
  await d.field.screenshot({ path: `test-results/roster-${device}-field.png` });

  // back to the play: the routes return, the names stay under the tags, and only where somebody is down
  await d.rosterPanel();
  await panel(page).getByRole("button", { name: "‹ Back to the play" }).click();
  await expect(page.getByRole("button", { name: "Route palette" })).toBeVisible();
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name, level: 1 })).toBeVisible();
  await expect(d.routes).toHaveCount(2);
  await expect(d.caption("X")).toHaveText("Devon");
  await expect(d.caption("Y")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible();

  // the roster is the device's: it outlasts a reload
  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(d.caption("X")).toHaveText("Devon");
  await d.roster();
  await d.rosterPanel();
  await expect(offense.getByRole("button", { name: "X: Devon, 2 deep" })).toBeVisible();
  await d.roster(false);

  // a share link carries the play, never the names; opening it back in the designer shows them again, from this device
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog.locator("svg").first()).not.toContainText("Devon");
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toContain("/p/");
  await page.goto(url);
  await expect(page.locator("[aria-label='Play diagram']")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Devon");
  await expect(page.locator("body")).not.toContainText("Aaliyah");
  await page.getByRole("link", { name: "Open in designer ›" }).click();
  await expect(d.field).toBeVisible();
  await expect(d.caption("X")).toHaveText("Devon");

  writeFileSync(`test-results/roster-${device}.json`, `${JSON.stringify({ afterX, stored: await storedLineups(page), shareUrl: url }, null, 2)}\n`);
});

test("roster mode is the team's standard formation, never the open play: its tags, spots, side and history stay out, and a backup carries the roster", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  await d.newPlay("Defense");
  // the defensive call's own changes: S retagged FS, LC stepped two yards in
  await d.select("S", "Defense");
  await panel(page).getByRole("textbox", { name: "Player tag" }).fill("FS");
  await d.foldOverlays();
  await d.player("LC", "Defense").press("ArrowRight");
  await d.player("LC", "Defense").press("ArrowRight");
  const lcInPlay = await d.playerX("LC", "Defense");
  expect(lcInPlay).toBeGreaterThan(3.5);
  await expect(d.undo).toBeEnabled();

  // the roster lays out the standard ten at their home spots, both sides at full strength, offense first
  await d.roster();
  await expect(d.player("FS", "Defense")).toHaveCount(0);
  await expect(d.caption("S", "Defense")).toHaveText("Unassigned");
  expect(await d.playerX("LC", "Defense")).toBeCloseTo(3, 1);
  for (const [tag, team] of [["C", "Offense"], ["X", "Offense"], ["LC", "Defense"], ["S", "Defense"]] as const) {
    await expect(d.player(tag, team)).not.toHaveClass(/opacity-40/);
  }
  // nothing of the play's history is reachable from here
  await expect(d.undo).toBeDisabled();
  await expect(d.redo).toBeDisabled();
  await d.rosterPanel();
  await expect(panel(page).getByRole("group", { name: /positions$/ }).first()).toHaveAttribute("aria-label", "Offense positions");
  const defense = panel(page).getByRole("group", { name: "Defense positions" });
  // left to right, as the wristbands count them, then the call's own FS, which has no spot on the field
  expect(await defense.getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))))
    .toEqual(["LC: Unassigned", "LB: Unassigned", "S: Unassigned", "R: Unassigned", "RC: Unassigned", "FS: Unassigned"]);

  // a position is tapped, never dragged or stepped, and its tag is the standard one, not a field to rename
  await d.foldOverlays();
  const s = d.player("S", "Defense");
  const sAt = await d.playerX("S", "Defense");
  const box = await s.boundingBox();
  if (!box) throw new Error("no S on the field");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 20, { steps: 8 });
  await page.mouse.up();
  await expect(s).toHaveAttribute("aria-pressed", "true");
  expect(await d.playerX("S", "Defense")).toBeCloseTo(sAt, 1);
  await s.press("ArrowLeft");
  expect(await d.playerX("S", "Defense")).toBeCloseTo(sAt, 1);
  await d.rosterPanel();
  await expect(panel(page).getByRole("heading", { name: "Who plays S" })).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "Player tag" })).toHaveCount(0);
  const chart = panel(page).getByRole("group", { name: "Depth chart at S" });
  await addNew(chart, "Jordan");
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");
  await expect(defense.getByRole("button", { name: "S: Jordan" })).toBeVisible();
  await expect.poll(() => storedLineups(page)).toEqual(main([{ team: "defense", tag: "S", depth: ["Jordan"] }], ["Jordan"]));
  await d.foldOverlays();
  await d.field.screenshot({ path: `test-results/roster-${device}-formation.png` });
  // the keyboard's undo is the play's too, so it does nothing here
  await page.keyboard.press("Control+z");
  await expect(d.player("S", "Defense")).toBeVisible();

  // out of roster mode the call is back as it was drawn, its history whole; FS is a position nobody is down for
  await d.roster(false);
  await expect(d.player("FS", "Defense")).toBeVisible();
  await expect(d.caption("FS", "Defense")).toHaveCount(0);
  expect(await d.playerX("LC", "Defense")).toBeCloseTo(lcInPlay, 1);
  await expect(d.undo).toBeEnabled();
  await d.undo.click();
  await d.undo.click();
  await d.undo.click();
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");

  // a device backup carries the roster, and restoring it on a wiped device brings the names back
  await page.goto("/playbooks");
  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup" }).click(),
  ]);
  const backup = await downloadText(download);
  const parsed = JSON.parse(backup) as { lineups: Lineups };
  expect(parsed.lineups).toEqual(main([{ team: "defense", tag: "S", depth: ["Jordan"] }], ["Jordan"]));
  await page.evaluate(() => { localStorage.removeItem("ffpd.lineups.v1"); });
  await page.reload();
  await openSettings(page);
  await page.getByLabel("Restore a device backup").setInputFiles(jsonUpload("device-backup.json", backup));
  await page.getByRole("region", { name: "Restore preview" }).getByRole("button", { name: "Replace device data" }).click();
  await expect(page.getByRole("dialog", { name: "Team, theme & backup" }).getByRole("status")).toContainText("Replaced with backup");
  await expect.poll(() => storedLineups(page)).toEqual(main([{ team: "defense", tag: "S", depth: ["Jordan"] }], ["Jordan"]));
  await d.goto();
  await d.newPlay("Defense");
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");

  writeFileSync(`test-results/roster-${device}-defense.json`, `${JSON.stringify({ stored: await storedLineups(page), backup: parsed.lineups }, null, 2)}\n`);
});

/** A saved play with one player retagged, a position the standard formation has no token for. */
const retagged = (p: SavedPlay, id: string, label: string): SavedPlay => ({ ...p, players: p.players.map((q) => (q.id === id ? { ...q, label } : q)) });

test("a depth chart kept for a tag the standard formation lacks stays in reach: listed beyond the field, opened from a player's page, reordered and filled", async ({ page }, info) => {
  const device = info.project.name;
  const fsCall = retagged(play("fx-fs-call", "Otter FS Call", {}, "", "defense"), "d5", "FS");
  const hSet = retagged(play("fx-h-set", "Otter H Set"), "o5", "H");
  await seed(page, {
    plays: [fsCall, hSet],
    team: OTTERS,
    lineups: main([{ team: "defense", tag: "FS", depth: ["Jordan", "Casey"] }], ["Jordan", "Casey"]),
  });
  const d = new Designer(page);
  await d.openSaved(fsCall.name);
  await expect(d.caption("FS", "Defense")).toHaveText("Jordan");

  // the field is the standard ten; FS (kept on the lineup and worn by the call) and H (worn by a saved play) are listed after them
  await d.roster();
  await expect(d.player("FS", "Defense")).toHaveCount(0);
  await expect(d.player("H")).toHaveCount(0);
  await d.rosterPanel();
  const labels = (team: "Offense" | "Defense") =>
    panel(page).getByRole("group", { name: `${team} positions` }).getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label")));
  expect(await labels("Offense")).toEqual(["X: Unassigned", "C: Unassigned", "QB: Unassigned", "Z: Unassigned", "Y: Unassigned", "H: Unassigned"]);
  expect(await labels("Defense")).toEqual(["LC: Unassigned", "LB: Unassigned", "S: Unassigned", "R: Unassigned", "RC: Unassigned", "FS: Jordan, 2 deep"]);

  // Jordan's page leads to FS's chart, which says it is off the field, and Casey moves up to start
  await panel(page).getByRole("group", { name: "Players" }).getByRole("button", { name: "Jordan", exact: true }).click();
  const positions = panel(page).getByRole("group", { name: "Jordan's positions" });
  await expect(positions.locator("li").getByRole("button")).toHaveText(["FS · Starter"]);
  await positions.getByRole("button", { name: "FS · Starter" }).click();
  await expect(panel(page).getByRole("heading", { name: "Who plays FS" })).toBeVisible();
  await expect(panel(page)).toContainText("FS has no spot in the standard formation");
  const fs = panel(page).getByRole("group", { name: "Depth chart at FS" });
  await fs.getByRole("button", { name: "Move Casey up" }).click();
  await expect(lines(fs)).toHaveText(["Casey", "Jordan"]);
  await panel(page).screenshot({ path: `test-results/roster-${device}-off-field.png` });

  // H, worn only by a saved play, takes a chart of its own from the list
  await panel(page).getByRole("group", { name: "Offense positions" }).getByRole("button", { name: "H: Unassigned" }).click();
  const h = panel(page).getByRole("group", { name: "Depth chart at H" });
  await addNew(h, "Riley");
  await expect(lines(h)).toHaveText(["Riley"]);
  const expected = main([
    { team: "defense", tag: "FS", depth: ["Casey", "Jordan"] },
    { team: "offense", tag: "H", depth: ["Riley"] },
  ], ["Jordan", "Casey", "Riley"]);
  await expect.poll(() => storedLineups(page)).toEqual(expected);

  // back in the call, FS's new starter is named under the player wearing it
  await d.roster(false);
  await expect(page.getByRole("heading", { name: fsCall.name, level: 1 })).toBeVisible();
  await expect(d.caption("FS", "Defense")).toHaveText("Casey");

  writeFileSync(`test-results/roster-${device}-off-field.json`, `${JSON.stringify({ stored: await storedLineups(page) }, null, 2)}\n`);
});

test("a name the device will not keep is said once and stores nothing", async ({ page }) => {
  await armSabotage(page);
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await d.roster();
  await d.select("Z");
  const chart = panel(page).getByRole("group", { name: "Depth chart at Z" });
  await sabotage(page, "quota", true);
  await addNew(chart, "Sam");
  await expect(d.toast).toContainText("Couldn't save: this browser's storage is full.");
  await expect(chart).toContainText("Nobody is down for Z yet.");
  await expect(panel(page).getByRole("group", { name: "Players" })).toContainText("Nobody is on the team yet.");
  expect(await storedLineups(page)).toBeNull();
  await sabotage(page, "quota", false);
  await addNew(chart, "Sam");
  await expect(d.caption("Z")).toHaveText("Sam");
  await expect.poll(() => storedLineups(page)).toEqual(main([{ team: "offense", tag: "Z", depth: ["Sam"] }], ["Sam"]));
});

test("a player already on the team is picked for another position by name, only where they are not down yet, and never past a full chart", async ({ page }, info) => {
  const device = info.project.name;
  const slots: Roster = [
    { team: "offense", tag: "X", depth: ["Devon", "Marcus Lee"] },
    { team: "offense", tag: "QB", depth: ["Aaliyah"] },
    { team: "defense", tag: "LC", depth: ["devon"] },
  ];
  // Priya is on the team but only on another lineup's chart: still the team's, so still offered here
  const rainy = { id: "rainy", name: "Rainy day", from: "main", slots: [{ team: "offense" as const, tag: "Z", depth: ["Priya"] }] };
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS, lineups: { active: "main", lineups: [...main(slots).lineups, rainy], players: [] } });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await d.roster();
  await d.select("Y");
  const chart = panel(page).getByRole("group", { name: "Depth chart at Y" });
  const chooser = chart.getByRole("group", { name: "Add a player at Y" });
  const offered = chooser.locator("li").getByRole("button");
  await expect(chart).toContainText("Nobody is down for Y yet.");
  // the lineup controls carry no help paragraph
  await expect(panel(page).getByRole("group", { name: "Lineup" })).not.toContainText("A branch starts as a copy");
  // everyone on the team, each once however it was typed, in alphabetical order
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await expect(offered).toHaveText([/^Aaliyah/, /^Devon/, /^Marcus Lee/, /^Priya\s*No position$/]);

  // a pick goes on at the bottom, as the team writes it, and leaves the list
  await chooser.getByRole("button", { name: "Add Devon at Y" }).click();
  await expect(lines(chart)).toHaveText(["Devon"]);
  await expect(d.caption("Y")).toHaveText("Devon");
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await expect(offered).toHaveText([/^Aaliyah/, /^Marcus Lee/, /^Priya/]);
  await chooser.getByRole("button", { name: "Add Marcus Lee at Y" }).click();
  await expect(lines(chart)).toHaveText(["Devon", "Marcus Lee"]);
  // a picked line is an ordinary line: it moves up like any other
  await chart.getByRole("button", { name: "Move Marcus Lee up" }).click();
  await expect(d.caption("Y")).toHaveText("Marcus Lee");
  await expect(panel(page).getByRole("group", { name: "Offense positions" }).getByRole("button", { name: "Y: Marcus Lee, 2 deep" })).toBeVisible();
  await panel(page).screenshot({ path: `test-results/roster-${device}-from-team.png` });

  // the player's page counts the new position; the team is the same on every lineup, Priya with no position on this one
  const players = panel(page).getByRole("group", { name: "Players" });
  await expect(players.locator("li").getByRole("button")).toHaveText([/^Aaliyah/, /^Devon/, /^Marcus Lee/, /^Priya\s*No position$/]);
  await players.getByRole("button", { name: "Devon", exact: true }).click();
  await expect(panel(page).getByRole("group", { name: "Devon's positions" }).locator("li").getByRole("button"))
    .toHaveText(["X · Starter", "LC · Starter", "Y · 2nd"]);
  await panel(page).getByRole("button", { name: "‹ Back", exact: true }).click();

  // "devon" at LC is Devon: across the ball, a name typed two ways is already down
  await d.select("LC", "Defense");
  const lc = panel(page).getByRole("group", { name: "Depth chart at LC" });
  await lc.getByRole("button", { name: "+ Add a player" }).click();
  await expect(lc.getByRole("group", { name: "Add a player at LC" }).locator("li").getByRole("button")).toHaveText([/^Aaliyah/, /^Marcus Lee/, /^Priya/]);
  await lc.getByRole("button", { name: "Cancel" }).click();

  // Priya, from the other lineup's chart, joins this one by a pick; a new name joins the team and the chart
  await d.select("QB");
  const qb = panel(page).getByRole("group", { name: "Depth chart at QB" });
  const qbAdd = qb.getByRole("button", { name: "+ Add a player" });
  await qbAdd.click();
  await qb.getByRole("button", { name: "Add Devon at QB" }).click();
  await qbAdd.click();
  await qb.getByRole("button", { name: "Add Priya at QB" }).click();
  await expect(lines(qb)).toHaveText(["Aaliyah", "Devon", "Priya"]);
  for (const name of ["Jordan", "Sam", "Riley", "Kai", "Noor"]) await addNew(qb, name);
  // eight lines: the chart is full, and neither way adds a ninth
  await expect(lines(qb)).toHaveCount(8);
  await expect(qbAdd).toBeDisabled();
  // off the chart is still on the team, and offered again
  await qb.getByRole("button", { name: "Remove Noor" }).click();
  await expect(qbAdd).toBeEnabled();
  await qbAdd.click();
  await expect(qb.getByRole("group", { name: "Add a player at QB" }).locator("li").getByRole("button")).toHaveText([/^Marcus Lee/, /^Noor\s*No position$/]);
  await qb.getByRole("button", { name: "Add Marcus Lee at QB" }).click();
  await expect(lines(qb)).toHaveText(["Aaliyah", "Devon", "Priya", "Jordan", "Sam", "Riley", "Kai", "Marcus Lee"]);
  await expect(qbAdd).toBeDisabled();

  // only the active lineup's charts changed; the other keeps its own, and the team holds everyone
  const expected: Lineups = {
    active: "main",
    lineups: [
      ...main([
        { team: "offense", tag: "X", depth: ["Devon", "Marcus Lee"] },
        { team: "offense", tag: "QB", depth: ["Aaliyah", "Devon", "Priya", "Jordan", "Sam", "Riley", "Kai", "Marcus Lee"] },
        { team: "defense", tag: "LC", depth: ["devon"] },
        { team: "offense", tag: "Y", depth: ["Marcus Lee", "Devon"] },
      ]).lineups,
      rainy,
    ],
    players: ["Devon", "Marcus Lee", "Aaliyah", "Priya", "Jordan", "Sam", "Riley", "Kai", "Noor"],
  };
  await expect.poll(() => storedLineups(page)).toEqual(expected);
  writeFileSync(`test-results/roster-${device}-from-team.json`, `${JSON.stringify({ stored: await storedLineups(page) }, null, 2)}\n`);
});

test("lineups branch from the starting lineup or from each other, each with its own depth charts, and the field follows the one picked", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, {
    plays: [SLANT_LEFT], team: OTTERS,
    lineups: main([{ team: "offense", tag: "X", depth: ["Devon", "Marcus Lee"] }, { team: "offense", tag: "QB", depth: ["Aaliyah"] }]),
  });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await expect(d.caption("X")).toHaveText("Devon");
  await d.roster();
  await d.rosterPanel();
  // the lineup is one row: its name, the menu of every lineup dropped down from it, and the fork that branches it
  const fork = panel(page).getByRole("button", { name: "Branch lineup" });
  const name = await lineupName(page).boundingBox();
  const forked = await fork.boundingBox();
  const menuAt = await lineupsButton(page).boundingBox();
  expect(name && forked && menuAt).toBeTruthy();
  if (name && forked && menuAt) {
    expect(Math.abs(name.y + name.height / 2 - (forked.y + forked.height / 2))).toBeLessThan(2);
    expect(forked.x).toBeGreaterThanOrEqual(name.x + name.width);
    expect(menuAt.x + menuAt.width).toBeLessThanOrEqual(name.x + name.width + 1);
    expect(forked.width).toBeGreaterThanOrEqual(44);
    expect(forked.height).toBeGreaterThanOrEqual(44);
  }
  await expect(lineupName(page)).toHaveValue("Starting Lineup");
  await expectLineups(page, ["Starting Lineup"], "Starting Lineup");
  await expect(page.locator("#field-title")).toContainText("Starting Lineup");
  // the starting lineup can't be deleted: its menu has no Delete
  await lineupsButton(page).click();
  await expect(lineupMenu(page).getByRole("menuitem")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // a branch is a copy of the lineup it comes from, named at once, and the field follows it
  await fork.click();
  await expect(lineupName(page)).toBeFocused();
  await expect(lineupName(page)).toHaveValue("Lineup 2");
  await expect(panel(page)).toContainText("Branched from Starting Lineup.");
  await lineupName(page).fill("No Devon");
  await expectLineups(page, ["Starting Lineup", "No Devon"], "No Devon");
  await expect(page.locator("#field-title")).toContainText("No Devon");
  await d.select("X");
  const chart = panel(page).getByRole("group", { name: "Depth chart at X" });
  await expect(lines(chart)).toHaveText(["Devon", "Marcus Lee"]);
  await chart.getByRole("button", { name: "Remove Devon" }).click();
  await expect(lines(chart)).toHaveText(["Marcus Lee"]);
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  // the starting lineup is untouched: picking it back brings Devon back
  await pickLineup(page, "Starting Lineup");
  await expect(lineupName(page)).toHaveValue("Starting Lineup");
  await expect(d.caption("X")).toHaveText("Devon");
  await expect(lines(chart)).toHaveText(["Devon", "Marcus Lee"]);
  // the team is the same on every lineup: Devon is still on it, with no position on this one
  await pickLineup(page, "No Devon");
  await expect(panel(page).getByRole("group", { name: "Players" }).locator("li").getByRole("button"))
    .toHaveText([/^Aaliyah\s*QB starter$/, /^Devon\s*No position$/, /^Marcus Lee\s*X starter$/]);
  await expect(d.caption("X")).toHaveText("Marcus Lee");

  // a branch of a branch copies the branch
  await fork.click();
  await expect(lineupName(page)).toHaveValue("Lineup 3");
  await expect(panel(page)).toContainText("Branched from No Devon.");
  await lineupName(page).fill("Rainy day");
  await expect(lines(chart)).toHaveText(["Marcus Lee"]);
  const stored = await storedLineups(page);
  expect(stored?.lineups.map((l) => [l.name, l.from ?? null, l.slots.find((s) => s.tag === "X")?.depth])).toEqual([
    ["Starting Lineup", null, ["Devon", "Marcus Lee"]],
    ["No Devon", "main", ["Marcus Lee"]],
    ["Rainy day", stored?.lineups[1]?.id, ["Marcus Lee"]],
  ]);
  expect(stored?.active).toBe(stored?.lineups[2]?.id);
  await panel(page).screenshot({ path: `test-results/roster-${device}-lineups.png` });

  // the pick outlasts a reload, and the play view reads from it
  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  await d.roster();
  await d.rosterPanel();
  await expect(lineupName(page)).toHaveValue("Rainy day");

  // deleting, from the foot of the menu, asks once in place; the field falls back to the lineup it was branched
  // from, and its own branches forget it
  await pickLineup(page, "No Devon");
  await lineupsButton(page).click();
  await expect(lineupMenu(page).getByRole("menuitem")).toHaveText(["Delete “No Devon”"]);
  await panel(page).screenshot({ path: `test-results/roster-${device}-lineup-menu.png` });
  await lineupMenu(page).getByRole("menuitem", { name: "Delete “No Devon”" }).click();
  await expect(lineupMenu(page)).toHaveCount(0);
  await expect(panel(page)).toContainText("Delete No Devon?");
  await expect(panel(page).getByRole("button", { name: "Keep" })).toBeFocused();
  await panel(page).getByRole("button", { name: "Keep" }).click();
  await expect(panel(page)).not.toContainText("Delete No Devon?");
  await expectLineups(page, ["Starting Lineup", "No Devon", "Rainy day"], "No Devon");
  await lineupsButton(page).click();
  await lineupMenu(page).getByRole("menuitem", { name: "Delete “No Devon”" }).click();
  await panel(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expectLineups(page, ["Starting Lineup", "Rainy day"], "Starting Lineup");
  await expect(lineupName(page)).toHaveValue("Starting Lineup");
  await expect(d.caption("X")).toHaveText("Devon");
  await pickLineup(page, "Rainy day");
  await expect(panel(page)).not.toContainText("Branched from");
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  const after = await storedLineups(page);
  expect(after?.lineups.map((l) => [l.name, l.from ?? null])).toEqual([["Starting Lineup", null], ["Rainy day", null]]);

  writeFileSync(`test-results/roster-${device}-lineups.json`, `${JSON.stringify({ stored, after }, null, 2)}\n`);
});

test("a long lineup name is shown whole in the lineups menu, so two that differ only at the end are told apart before either is picked", async ({ page }, info) => {
  const device = info.project.name;
  const rotA = "Saturday vs Falcons - Rotation A", rotB = "Saturday vs Falcons - Rotation B";
  await seed(page, {
    plays: [SLANT_LEFT], team: OTTERS,
    lineups: {
      active: "main", players: [],
      lineups: [{ id: "main", name: "Starting Lineup", slots: [] }, { id: "rot-a", name: rotA, from: "main", slots: [] }, { id: "rot-b", name: rotB, from: "main", slots: [] }],
    },
  });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await d.roster();
  await d.rosterPanel();
  /** The words in the open menu that are drawn cut off, and whether the menu itself scrolls sideways. */
  const cutOff = () => lineupMenu(page).evaluate((menu) => ({
    words: [...menu.querySelectorAll("[role^='menuitem'] span")].filter((s) => s.scrollWidth > s.clientWidth + 1).map((s) => s.textContent),
    sideways: menu.scrollWidth > menu.clientWidth + 1,
  }));

  await lineupsButton(page).click();
  const rows = lineupMenu(page).getByRole("menuitemradio");
  await expect(rows).toHaveText(["Starting Lineup", rotA, rotB]);
  expect(await cutOff()).toEqual({ words: [], sideways: false });
  // a name too long for one line wraps, and its row grows past the 44px a row starts at
  const one = await rows.first().boundingBox(), long = await rows.nth(2).boundingBox();
  expect(one && long).toBeTruthy();
  if (one && long) {
    expect(one.height).toBeGreaterThanOrEqual(44);
    expect(long.height).toBeGreaterThan(one.height);
  }
  await panel(page).screenshot({ path: `test-results/roster-${device}-long-lineup-names.png` });

  // the one picked by its whole name is the one on the field, and its Delete names it whole too
  await rows.nth(2).click();
  await expect(lineupName(page)).toHaveValue(rotB);
  await expect(page.locator("#field-title")).toContainText(rotB);
  await lineupsButton(page).click();
  await expect(lineupMenu(page).getByRole("menuitem")).toHaveText([`Delete “${rotB}”`]);
  expect(await cutOff()).toEqual({ words: [], sideways: false });
});

test("players join the team any time, the same on every lineup, and depth charts are filled from the team", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await d.roster();
  await d.rosterPanel();
  const players = panel(page).getByRole("group", { name: "Players" });
  const names = players.locator("li").getByRole("button");
  const addButton = players.getByRole("button", { name: "+ Add to team" });
  const nameField = players.getByRole("textbox", { name: "Player name" });
  const back = panel(page).getByRole("button", { name: "‹ Back", exact: true });

  // nothing tapped on the field and nobody on the team: the list is there, and a player can join
  await expect(players).toContainText("Nobody is on the team yet.");
  await addButton.click();
  await expect(nameField).toBeFocused();
  await expect(players.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await nameField.fill("Josiah");
  await nameField.press("Enter");
  // a new name opens its page, with nowhere to play yet and every position on the field to put them at
  await expect(panel(page).getByRole("heading", { name: "Josiah" })).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Josiah's positions" })).toContainText("Josiah is not down for any position on Starting Lineup yet.");
  const putJosiah = panel(page).getByRole("group", { name: "Put Josiah at a position" });
  await expect(putJosiah.getByRole("button")).toHaveCount(10);
  await expect.poll(() => storedLineups(page)).toEqual(main([], ["Josiah"]));
  const joined = await storedLineups(page);
  await panel(page).screenshot({ path: `test-results/roster-${device}-team-page.png` });
  await back.click();
  await expect(names).toHaveText([/^Josiah\s*No position$/]);

  // a cancelled add, by Cancel or by Escape, adds nobody; the same name typed again is the same player
  await addButton.click();
  await nameField.fill("Zed");
  await players.getByRole("button", { name: "Cancel" }).click();
  await addButton.click();
  await expect(nameField).toHaveValue("");
  await nameField.fill("Zed");
  await nameField.press("Escape");
  await expect(addButton).toBeVisible();
  await addButton.click();
  await nameField.fill("  josiah ");
  await players.getByRole("button", { name: "Add", exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: "Josiah" })).toBeVisible();
  // from his page, Josiah goes in at QB, and the field names him
  await putJosiah.getByRole("button", { name: "Put Josiah at QB" }).click();
  await expect(d.caption("QB")).toHaveText("Josiah");
  await expect(panel(page).getByRole("group", { name: "Josiah's positions" }).locator("li").getByRole("button")).toHaveText(["QB · Starter"]);
  await expect(putJosiah.getByRole("button", { name: "Put Josiah at QB" })).toHaveCount(0);
  await back.click();

  // two more join the team with no position, one with a depth chart open
  for (const name of ["Logan", "Noah"]) {
    if (name === "Noah") await d.select("X");
    await addButton.click();
    await nameField.fill(name);
    await nameField.press("Enter");
    await expect(panel(page).getByRole("heading", { name })).toBeVisible();
    await back.click();
  }
  await expect(names).toHaveText([/^Josiah\s*QB starter$/, /^Logan\s*No position$/, /^Noah\s*No position$/]);

  // X's depth chart is filled from the team: everyone not on it yet, with where they play
  const chart = panel(page).getByRole("group", { name: "Depth chart at X" });
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  const chooser = chart.getByRole("group", { name: "Add a player at X" });
  await expect(chooser.locator("li").getByRole("button")).toHaveText([/^Josiah\s*QB starter$/, /^Logan\s*No position$/, /^Noah\s*No position$/]);
  await expect(chooser.locator("li").getByRole("button").first()).toBeFocused();
  await panel(page).screenshot({ path: `test-results/roster-${device}-team-chooser.png` });
  await chooser.getByRole("button", { name: "Add Logan at X" }).click();
  await expect(d.caption("X")).toHaveText("Logan");
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await expect(chooser.locator("li").getByRole("button")).toHaveText([/^Josiah/, /^Noah/]);
  await chooser.getByRole("button", { name: "Add Noah at X" }).click();
  await expect(lines(chart)).toHaveText(["Logan", "Noah"]);
  // Cancel and Escape close the chooser and add nobody
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await chooser.getByRole("button", { name: "Cancel" }).click();
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await chooser.getByRole("textbox", { name: "New player at X" }).press("Escape");
  await expect(chooser).toHaveCount(0);
  await expect(lines(chart)).toHaveText(["Logan", "Noah"]);
  await expect(names).toHaveText([/^Josiah\s*QB starter$/, /^Logan\s*X starter$/, /^Noah\s*X 2nd$/]);
  // off the chart is still on the team
  await chart.getByRole("button", { name: "Remove Noah" }).click();
  await expect(names).toHaveText([/^Josiah/, /^Logan\s*X starter$/, /^Noah\s*No position$/]);
  await panel(page).screenshot({ path: `test-results/roster-${device}-team-list.png` });

  // a name on a chart opens its page, where a rename follows the player onto every chart; another player's name is refused
  await chart.getByRole("button", { name: "Starter at X: Logan" }).click();
  await expect(panel(page).getByRole("heading", { name: "Logan" })).toBeVisible();
  const renameLogan = panel(page).getByRole("textbox", { name: "Rename Logan" });
  await renameLogan.fill("noah");
  await panel(page).getByRole("button", { name: "Save name" }).click();
  await expect(panel(page).getByRole("status")).toHaveText("Somebody on the team is already called noah.");
  await renameLogan.fill("Logan B.");
  await renameLogan.press("Enter");
  await expect(panel(page).getByRole("heading", { name: "Logan B." })).toBeVisible();
  await expect(d.caption("X")).toHaveText("Logan B.");
  await back.click();
  await expect(names).toHaveText([/^Josiah/, /^Logan B\.\s*X starter$/, /^Noah\s*No position$/]);

  // the team outlasts a reload, a player with no position too
  await page.reload();
  await expect(d.field).toBeVisible();
  await d.roster();
  await d.rosterPanel();
  await expect(names).toHaveText([/^Josiah/, /^Logan B\./, /^Noah\s*No position$/]);
  const kept = await storedLineups(page);
  expect(kept?.players).toEqual(["Josiah", "Logan B.", "Noah"]);

  // a branch has the same team; taking Josiah off its QB chart leaves him on the team and at QB on the Starting Lineup
  await panel(page).getByRole("button", { name: "Branch lineup" }).click();
  await expect(names).toHaveText([/^Josiah\s*QB starter$/, /^Logan B\./, /^Noah/]);
  await d.select("QB");
  await panel(page).getByRole("group", { name: "Depth chart at QB" }).getByRole("button", { name: "Remove Josiah" }).click();
  await expect(d.caption("QB")).toHaveText("Unassigned");
  await expect(names).toHaveText([/^Josiah\s*No position$/, /^Logan B\./, /^Noah/]);
  await pickLineup(page, "Starting Lineup");
  await expect(d.caption("QB")).toHaveText("Josiah");

  // removing a player from the team asks once, and takes them off every lineup
  await players.getByRole("button", { name: "Logan B.", exact: true }).click();
  await panel(page).getByRole("button", { name: "Remove from team" }).click();
  await expect(panel(page)).toContainText("Remove Logan B. from the team?");
  await panel(page).getByRole("button", { name: "Keep" }).click();
  await expect(panel(page).getByRole("heading", { name: "Logan B." })).toBeVisible();
  await panel(page).getByRole("button", { name: "Remove from team" }).click();
  await panel(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(names).toHaveText([/^Josiah/, /^Noah/]);
  await expect(d.caption("X")).toHaveText("Unassigned");
  await pickLineup(page, "Lineup 2");
  await expect(names).toHaveText([/^Josiah\s*No position$/, /^Noah/]);
  await expect(d.caption("X")).toHaveText("Unassigned");
  const after = await storedLineups(page);
  expect(after?.players).toEqual(["Josiah", "Noah"]);
  expect(after?.lineups.map((l) => [l.name, l.slots])).toEqual([
    ["Starting Lineup", [{ team: "offense", tag: "QB", depth: ["Josiah"] }]],
    ["Lineup 2", []],
  ]);

  // a device backup carries the team
  await page.goto("/playbooks");
  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup" }).click(),
  ]);
  const backup = JSON.parse(await downloadText(download)) as { lineups: Lineups };
  expect(backup.lineups).toEqual(after);

  writeFileSync(`test-results/roster-${device}-team.json`, `${JSON.stringify({ joined, kept, after, backup: backup.lineups }, null, 2)}\n`);
});

/** Sixteen fictional first names, for a team at and past its limit. */
const SIXTEEN = ["Ari", "Bea", "Cal", "Dee", "Eli", "Fay", "Gus", "Hal", "Ivy", "Jay", "Kit", "Lou", "Max", "Ned", "Oz", "Pip"];

test("a team holds fifteen players: the fifteenth fills it, a teammate can still go on a chart, and removing one opens it again", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS, lineups: main([], SIXTEEN.slice(0, 14)) });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await d.roster();
  await d.rosterPanel();
  const players = panel(page).getByRole("group", { name: "Players" });
  const names = players.locator("li").getByRole("button");
  const addButton = players.getByRole("button", { name: "+ Add to team" });
  await expect(names).toHaveCount(14);
  await expect(players).toContainText("(14 of 15)");
  await expect(addButton).toBeEnabled();

  // the fifteenth fills the team: adding to it is off, and the panel says why
  await addButton.click();
  await players.getByRole("textbox", { name: "Player name" }).fill("Oz");
  await players.getByRole("textbox", { name: "Player name" }).press("Enter");
  await expect(panel(page).getByRole("heading", { name: "Oz" })).toBeVisible();
  await panel(page).getByRole("button", { name: "‹ Back", exact: true }).click();
  await expect(names).toHaveCount(15);
  await expect(players).toContainText("(15 of 15)");
  await expect(addButton).toBeDisabled();
  await expect(players).toContainText("The team is full at 15 players. Remove one from the team to add another.");

  // a depth chart still takes a teammate, picked or typed, but not a new name
  await d.select("X");
  const chart = panel(page).getByRole("group", { name: "Depth chart at X" });
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  const chooser = chart.getByRole("group", { name: "Add a player at X" });
  await expect(chooser).toContainText("The team is full at 15 players: pick from it");
  await expect(chooser.locator("li").getByRole("button")).toHaveCount(15);
  const fresh = chooser.getByRole("textbox", { name: "New player at X" });
  await fresh.fill("Pip");
  await expect(chooser.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await fresh.fill("ari");
  await expect(chooser.getByRole("button", { name: "Add", exact: true })).toBeEnabled();
  await fresh.press("Enter");
  await expect(d.caption("X")).toHaveText("Ari");
  await expect(lines(chart)).toHaveText(["Ari"]);
  const full = await storedLineups(page);
  expect(full?.players).toEqual(SIXTEEN.slice(0, 15));
  await panel(page).screenshot({ path: `test-results/roster-${device}-team-full.png` });

  // removing a player opens the team again
  await players.getByRole("button", { name: "Oz", exact: true }).click();
  await panel(page).getByRole("button", { name: "Remove from team" }).click();
  await panel(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(names).toHaveCount(14);
  await expect(addButton).toBeEnabled();
  await expect(players).not.toContainText("The team is full");
  const reopened = await storedLineups(page);
  expect(reopened?.players).toEqual(SIXTEEN.slice(0, 14));

  writeFileSync(`test-results/roster-${device}-team-full.json`, `${JSON.stringify({ full, reopened }, null, 2)}\n`);
});

test("sixteen names typed on depth charts before the team's list all stay on the team, which is full until it is back under fifteen", async ({ page }, info) => {
  const device = info.project.name;
  // lineups as a device stored them before the team's list: names on depth charts, no `players`
  const before = {
    active: "main",
    lineups: [{ id: "main", name: "Starting Lineup", slots: [
      { team: "offense", tag: "X", depth: SIXTEEN.slice(0, 8) },
      { team: "defense", tag: "LC", depth: SIXTEEN.slice(8, 16) },
    ] }],
  } as unknown as Lineups;
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS, lineups: before });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await expect(d.caption("X")).toHaveText("Ari");
  await d.roster();
  await d.rosterPanel();
  const players = panel(page).getByRole("group", { name: "Players" });
  await expect(players.locator("li").getByRole("button")).toHaveCount(16);
  await expect(players).toContainText("(16 of 15)");
  await expect(players.getByRole("button", { name: "+ Add to team" })).toBeDisabled();
  await expect(players).toContainText("The team is full at 15 players. Remove 2 from the team to add another.");
  // the first write keeps every name on the team's list, and on its chart
  await players.getByRole("button", { name: "Pip", exact: true }).click();
  await panel(page).getByRole("button", { name: "Remove from team" }).click();
  await panel(page).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(players.locator("li").getByRole("button")).toHaveCount(15);
  await expect(players).toContainText("Remove one from the team to add another.");
  const after = await storedLineups(page);
  expect(after?.players).toEqual(SIXTEEN.slice(0, 15));
  expect(after?.lineups[0]?.slots.map((sl) => sl.depth)).toEqual([SIXTEEN.slice(0, 8), SIXTEEN.slice(8, 15)]);

  writeFileSync(`test-results/roster-${device}-team-legacy.json`, `${JSON.stringify({ before, after }, null, 2)}\n`);
});

test("a name at either sideline stays whole on the field, and no name goes to the printer", async ({ page }, info) => {
  const device = info.project.name;
  // the wide receivers as far out as they can be lined up, with an eleven-letter name that is never shortened
  const wide = play("fx-wide-splits", "Otter Wide Splits", { o3: { type: "go" } });
  wide.players = wide.players.map((p) => (p.id === "o3" ? { ...p, x: 1.2 } : p.id === "o4" ? { ...p, x: 28.8 } : p));
  await seed(page, {
    plays: [wide], team: OTTERS,
    lineups: main([{ team: "offense", tag: "X", depth: ["Christopher"] }, { team: "offense", tag: "Y", depth: ["Christopher"] }]),
  });
  const d = new Designer(page);
  await d.openSaved(wide.name);
  await d.roster();
  await d.closeSidebars();
  const field = await d.field.boundingBox();
  if (!field) throw new Error("the field has not laid out");
  const boxes: Record<string, { left: number; right: number }> = {};
  for (const tag of ["X", "Y"]) {
    await expect(d.caption(tag)).toHaveText("Christopher");
    const box = await d.caption(tag).boundingBox();
    if (!box) throw new Error(`no caption under ${tag}`);
    boxes[tag] = { left: box.x - field.x, right: field.x + field.width - (box.x + box.width) };
    expect(boxes[tag].left, `${tag}'s caption starts inside the field`).toBeGreaterThanOrEqual(0);
    expect(boxes[tag].right, `${tag}'s caption ends inside the field`).toBeGreaterThanOrEqual(0);
  }
  await d.field.screenshot({ path: `test-results/roster-${device}-sidelines.png` });

  // the printer gets the play and never a name, in roster mode and on the play alike
  await page.emulateMedia({ media: "print" });
  await expect(d.caption("X")).toBeHidden();
  await expect(d.player("X")).toBeVisible();
  await page.emulateMedia({ media: "screen" });
  await expect(d.caption("X")).toBeVisible();
  await d.roster(false);
  await d.closeSidebars();
  await expect(d.caption("X")).toHaveText("Christopher");
  await page.emulateMedia({ media: "print" });
  await expect(d.caption("X")).toBeHidden();
  await expect(d.routes).toHaveCount(1);
  await page.emulateMedia({ media: "screen" });

  writeFileSync(`test-results/roster-${device}-sidelines.json`, `${JSON.stringify({ field, boxes }, null, 2)}\n`);
});

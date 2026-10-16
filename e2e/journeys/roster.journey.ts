import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEEP_FIELD_KEY } from "../../lib/deepfield";
import type { Lineups, Roster, SavedPlay, Spot } from "../../lib/play/types";
import { Designer, armSabotage, downloadText, sabotage } from "../support/designer";
import { OTTERS, SLANT_LEFT, jsonUpload, play, seed, storedLineups } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * The roster (docs/adr/008-roster-depth-chart.md): a mode that lays the positions out on the field with
 * nothing drawn on them, one side of the roster at a time (the header's badge flips it, or shows both at
 * once, neither faded), lists the positions on view, and, for the one tapped, takes a depth chart of
 * names, starter first, with a way to move a player up and to take one off. The starter's name is drawn
 * under the tag in roster mode, and on a play only once "Show player names" is on in Play tools, which
 * waits for a roster and picks the lineup to show. The roster is the device's (it outlasts a reload, goes
 * into a device backup and comes back from one), and never reaches a share link. Roster mode is the
 * team's standard formation, never the play that is open: none of its routes, tags, spots or tools, and
 * nothing in it undoes; a position dragged or stepped there stands on the roster, on every lineup and held
 * to its side of the line, until Reset spots, and the play is back as it was on the way out. A write the device refuses is
 * said, and stores nothing. Every name on the lineup has a page of its own: the positions they play and
 * where they sit at each. Lineups are versions of it all: the Starting Lineup is always there, and the
 * Secondary Lineup made from its depth charts (the next player up starting, nobody twice on a side, read
 * only and never stored), any lineup branches into a copy to change, the field follows the one picked, and
 * a deleted lineup falls back to the one it came from. Players join the team by name, any time, the same on every lineup, and a depth chart
 * is filled from the team; a name typed new at a position joins the team too. A name is drawn at 13px or
 * more on every screen, its letters clear of every token and every other name; a caption at a sideline is
 * pulled in so the whole name stays on the field, and no caption is
 * printed. Leaves `roster-<device>*.json` (what was stored at each step) and pictures of the panel and
 * the field in `test-results/`.
 */

const panel = (page: Page) => page.locator("#route-sidebar");
const tools = (page: Page) => page.locator("#play-sidebar");
/** The field's line-of-scrimmage label: "LOS" on the 40, where every drive starts, else "LOS <yards to go>". */
const losLabel = (d: Designer) => d.field.locator("g[fill-opacity='0.5'] > text").filter({ hasText: /^LOS/ });
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
/** The same lineups with the names shown on plays. */
const named = (ls: Lineups): Lineups => ({ ...ls, names: true });
/** The same lineups with positions of the standard formation dragged off their home spots in roster mode. */
const spotted = (ls: Lineups, spots: Spot[]): Lineups => ({ ...ls, spots });
/** Presses a token and drags it by so many pixels, as a coach's finger or mouse does. */
async function drag(page: Page, token: Locator, dx: number, dy: number): Promise<void> {
  const box = await token.boundingBox();
  if (!box) throw new Error("no such token on the field");
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
}
/** The positions stored as moved off their home spots in roster mode, in the order they first moved. */
const storedSpots = async (page: Page): Promise<Spot[]> => (await storedLineups(page))?.spots ?? [];
/** The SHOW pills in the roster panel: which side of the roster is on the field. */
const show = (page: Page, which: "Offense" | "Defense" | "Both") =>
  panel(page).getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: which }).check();
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
  // a play can't show names before there is a roster to take them from
  await d.tools();
  await expect(d.namesSwitch).toBeDisabled();
  await expect(tools(page)).toContainText("Build a roster first");

  // roster mode: the formation alone, nothing to run, the play's own side on the field and the panel on its positions
  await d.roster();
  await expect(page.getByRole("heading", { name: "Roster", level: 1 })).toBeVisible();
  await expect(d.routes).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run the play" })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("button", { name: "Clear routes" })).toBeDisabled();
  await expect(d.rosterView).toHaveAccessibleName("Showing offense");
  await expect(d.player("X")).toBeVisible();
  await expect(d.player("S", "Defense")).toHaveCount(0);
  await expect(d.caption("X")).toHaveText("Unassigned");
  // the badge flips the roster to the defense, then shows both sides, neither a faded shadow of the other
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing defense");
  await expect(d.player("S", "Defense")).toBeVisible();
  await expect(d.player("X")).toHaveCount(0);
  await expect(d.caption("S", "Defense")).toHaveText("Unassigned");
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing both");
  await expect(d.player("X")).toBeVisible();
  await expect(d.player("S", "Defense")).toBeVisible();
  await expect(d.player("S", "Defense")).not.toHaveClass(/opacity-40/);
  await expect(d.player("X")).not.toHaveClass(/opacity-40/);
  // no play is open in roster mode: Play tools keeps the roster and the team, not the play's own sections
  await d.tools();
  await expect(tools(page).getByRole("button", { name: "Roster", exact: true })).toBeVisible();
  for (const tile of ["New play", "Save", "Duplicate", "Copy share link", "Flip play", "Reset spots"]) {
    await expect(tools(page).getByRole("button", { name: tile, exact: true })).toHaveCount(0);
  }
  await expect(tools(page).getByRole("textbox", { name: "Play name" })).toHaveCount(0);
  await d.rosterPanel();
  const offense = panel(page).getByRole("group", { name: "Offense positions" });
  await expect(panel(page).getByRole("group", { name: /positions$/ }).first()).toHaveAttribute("aria-label", "Offense positions");
  await expect(offense.getByRole("button")).toHaveCount(5);
  await expect(offense.getByRole("button", { name: "X: Unassigned" })).toBeVisible();
  await expect(panel(page).getByRole("group", { name: "Defense positions" }).getByRole("button")).toHaveCount(5);
  // the panel's SHOW pills do the same: the offense alone again, and the list follows
  await show(page, "Offense");
  await expect(d.rosterView).toHaveAccessibleName("Showing offense");
  await expect(d.player("S", "Defense")).toHaveCount(0);
  await expect(panel(page).getByRole("group", { name: "Defense positions" })).toHaveCount(0);

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
  await show(page, "Both");
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

  // back to the play, from the Roster tile (the panel has no way back of its own): the routes return and
  // the names stay off the play until the coach turns them on, then show under the tags, only where somebody is down
  await d.roster(false);
  await expect(page.getByRole("button", { name: "Route palette" })).toBeVisible();
  await expect(panel(page).getByRole("button", { name: /Back to routes/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: SLANT_LEFT.name, level: 1 })).toBeVisible();
  await expect(d.routes).toHaveCount(2);
  await expect(d.caption("X")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible();
  await expect(d.namesSwitch).toBeEnabled();
  await d.showNames(true);
  await expect(d.caption("X")).toHaveText("Devon");
  await expect(d.caption("Y")).toHaveCount(0);
  await expect(tools(page).getByRole("combobox", { name: "Lineup" })).toHaveValue("main");
  await expect.poll(() => storedLineups(page)).toEqual(named(main([
    { team: "offense", tag: "X", depth: ["Devon", "Marcus Lee"] },
    { team: "offense", tag: "QB", depth: ["Aaliyah Brooks-Washington"] },
    { team: "defense", tag: "LC", depth: ["Priya", "Devon"] },
  ], ["Marcus Lee", "Devon", "Priya", "Aaliyah Brooks-Washington"])));

  // the roster and the choice to show it are the device's: they outlast a reload
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
  await expect(losLabel(d)).toHaveText("LOS");

  // the roster lays out the standard formation at its home spots, opening on the call's own side, the defense
  await d.roster();
  await expect(d.rosterView).toHaveAccessibleName("Showing defense");
  await expect(d.player("X")).toHaveCount(0);
  await expect(d.player("FS", "Defense")).toHaveCount(0);
  await expect(d.caption("S", "Defense")).toHaveText("Unassigned");
  expect(await d.playerX("LC", "Defense")).toBeCloseTo(3, 1);
  // the ball is on the 15 in roster mode, whatever the play's own spot
  await expect(losLabel(d)).toHaveText("LOS 15");
  const rosterLos = await losLabel(d).textContent();
  // both sides at full strength, offense first, nothing faded
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing both");
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

  // a position drags and steps as a play's player does, standing where it lands on the roster, and its tag is
  // the standard one, not a field to rename
  await d.foldOverlays();
  const s = d.player("S", "Defense");
  const sAt = await d.playerX("S", "Defense");
  await drag(page, s, 80, 0);
  await expect.poll(async () => (await storedSpots(page)).length).toBe(1);
  const dropped = (await storedSpots(page))[0]?.x ?? 0;
  expect(dropped).toBeGreaterThan(sAt + 1);
  await expect.poll(() => d.playerX("S", "Defense")).toBeCloseTo(dropped, 1);
  await s.press("ArrowLeft");
  await expect(s).toHaveAttribute("aria-pressed", "true");
  const sSpot: Spot = { team: "defense", tag: "S", x: dropped - 1, y: -11 };
  await expect.poll(() => storedSpots(page)).toEqual([sSpot]);
  await expect.poll(() => d.playerX("S", "Defense")).toBeCloseTo(sSpot.x, 1);
  await d.rosterPanel();
  await expect(panel(page).getByRole("heading", { name: "Who plays S" })).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "Player tag" })).toHaveCount(0);
  const chart = panel(page).getByRole("group", { name: "Depth chart at S" });
  await addNew(chart, "Jordan");
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");
  await expect(defense.getByRole("button", { name: "S: Jordan" })).toBeVisible();
  await expect.poll(() => storedLineups(page)).toEqual(spotted(main([{ team: "defense", tag: "S", depth: ["Jordan"] }], ["Jordan"]), [sSpot]));
  await d.foldOverlays();
  await d.field.screenshot({ path: `test-results/roster-${device}-formation.png` });
  // the keyboard's undo is the play's too, so it does nothing here
  await page.keyboard.press("Control+z");
  await expect(d.player("S", "Defense")).toBeVisible();

  // out of roster mode the call is back as it was drawn, its history whole, and its own S (now FS) is where the
  // call put it, whatever the roster's S did; with names on, FS is a position nobody is down for
  await d.roster(false);
  await d.showNames(true);
  await expect(d.player("FS", "Defense")).toBeVisible();
  await expect(d.caption("FS", "Defense")).toHaveCount(0);
  expect(await d.playerX("LC", "Defense")).toBeCloseTo(lcInPlay, 1);
  expect(await d.playerX("FS", "Defense")).toBeCloseTo(sAt, 1);
  await expect(losLabel(d)).toHaveText("LOS");
  await expect(d.undo).toBeEnabled();
  await d.undo.click();
  await d.undo.click();
  await d.undo.click();
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");

  // a device backup carries the roster and the choice to show it, and restoring it on a wiped device brings the names back
  await page.goto("/playbooks");
  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup" }).click(),
  ]);
  const backup = await downloadText(download);
  const parsed = JSON.parse(backup) as { lineups: Lineups };
  const backedUp = named(spotted(main([{ team: "defense", tag: "S", depth: ["Jordan"] }], ["Jordan"]), [sSpot]));
  expect(parsed.lineups).toEqual(backedUp);
  await page.evaluate(() => { localStorage.removeItem("ffpd.lineups.v1"); });
  await page.reload();
  await openSettings(page);
  await page.getByLabel("Restore a device backup").setInputFiles(jsonUpload("device-backup.json", backup));
  await page.getByRole("region", { name: "Restore preview" }).getByRole("button", { name: "Replace device data" }).click();
  await expect(page.getByRole("dialog", { name: "Team, theme & backup" }).getByRole("status")).toContainText("Replaced with backup");
  await expect.poll(() => storedLineups(page)).toEqual(backedUp);
  await d.goto();
  await d.newPlay("Defense");
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");
  await d.roster();
  expect(await d.playerX("S", "Defense")).toBeCloseTo(sSpot.x, 1);

  writeFileSync(`test-results/roster-${device}-defense.json`, `${JSON.stringify({ stored: await storedLineups(page), backup: parsed.lineups, rosterLos }, null, 2)}\n`);
});

test("a position dragged or stepped in roster mode stands there on every lineup and after a reload, held to its side of the line, never moving a play, until Reset spots puts its side home", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  await d.newPlay("Offense");
  // the play's own X, a yard in: the roster's X starts at home whatever the play does
  await d.foldOverlays();
  await d.player("X").press("ArrowRight");
  await expect.poll(() => d.playerX("X")).toBeCloseTo(4, 1);
  const steps: { step: string; stored: Lineups | null }[] = [];
  const note = async (step: string) => { steps.push({ step, stored: await storedLineups(page) }); };

  await d.roster();
  await d.foldOverlays();
  expect(await d.playerX("X")).toBeCloseTo(3, 1);
  // the play's X comes into roster mode picked; Escape lets it go
  await expect(d.player("X")).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(d.player("X")).toHaveAttribute("aria-pressed", "false");
  // X dragged right and up over the line: it lands right of home, held behind the line, and a drag picks nothing
  await drag(page, d.player("X"), 90, -300);
  await expect.poll(async () => (await storedSpots(page)).length).toBe(1);
  const xSpot: Spot = { team: "offense", tag: "X", x: (await storedSpots(page))[0]?.x ?? 0, y: 1 };
  expect(xSpot.x).toBeGreaterThan(4);
  expect(await storedLineups(page)).toEqual(spotted(main([]), [xSpot]));
  await expect.poll(() => d.playerX("X")).toBeCloseTo(xSpot.x, 1);
  await expect(d.player("X")).toHaveAttribute("aria-pressed", "false");
  await expect(d.caption("X")).toHaveText("Unassigned");
  // Z stepped two yards in with the arrow keys, then back out onto its home spot, where nothing is kept for it
  await d.player("Z").press("ArrowLeft");
  await d.player("Z").press("ArrowLeft");
  await expect.poll(() => storedLineups(page)).toEqual(spotted(main([]), [xSpot, { team: "offense", tag: "Z", x: 17, y: 5 }]));
  await expect.poll(() => d.playerX("Z")).toBeCloseTo(17, 1);
  await note("X dragged, Z stepped in");
  await d.player("Z").press("ArrowRight");
  await d.player("Z").press("ArrowRight");
  await expect.poll(() => storedLineups(page)).toEqual(spotted(main([]), [xSpot]));
  await expect.poll(() => d.playerX("Z")).toBeCloseTo(19, 1);

  // with both sides on the field, LB dragged down over the line is held on the defense's side of it
  await d.rosterView.click();
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing both");
  await d.foldOverlays();
  await drag(page, d.player("LB", "Defense"), 0, 300);
  const lbSpot: Spot = { team: "defense", tag: "LB", x: 11, y: -1 };
  await expect.poll(() => storedLineups(page)).toEqual(spotted(main([]), [xSpot, lbSpot]));
  await note("LB dragged over the line");
  await d.field.screenshot({ path: `test-results/roster-${device}-spots.png` });

  // a branch stands where its parent does: the spots are the team's, on every lineup
  await d.rosterPanel();
  await panel(page).getByRole("button", { name: "Branch lineup" }).click();
  await expect(lineupName(page)).toHaveValue("Lineup 3");
  expect(await d.playerX("X")).toBeCloseTo(xSpot.x, 1);
  await expect.poll(() => storedSpots(page)).toEqual([xSpot, lbSpot]);

  // the play is back as the coach left it, its own X a yard in and its history whole
  await d.roster(false);
  await d.foldOverlays();
  expect(await d.playerX("X")).toBeCloseTo(4, 1);
  expect(await d.playerX("Z")).toBeCloseTo(19, 1);
  await d.undo.click();
  await expect.poll(() => d.playerX("X")).toBeCloseTo(3, 1);

  // the spots outlast a reload
  await page.reload();
  await expect(d.field).toBeVisible();
  await d.roster();
  await d.foldOverlays();
  expect(await d.playerX("X")).toBeCloseTo(xSpot.x, 1);

  // Reset spots puts the sides on view back home, asking once: Keep changes nothing, Reset takes the offense
  // home and leaves the defense where it was
  await d.rosterPanel();
  await show(page, "Both");
  const spots = panel(page).getByRole("group", { name: "Spots" });
  const reset = spots.getByRole("button", { name: "Reset spots" });
  await reset.click();
  await expect(spots).toContainText("Put both sides back at their home spots?");
  await expect(spots.getByRole("button", { name: "Keep" })).toBeFocused();
  await spots.getByRole("button", { name: "Keep" }).click();
  await expect(reset).toBeFocused();
  expect(await storedSpots(page)).toEqual([xSpot, lbSpot]);
  await show(page, "Offense");
  await reset.click();
  await expect(spots).toContainText("Put the offense back at its home spots?");
  await panel(page).screenshot({ path: `test-results/roster-${device}-reset.png` });
  await spots.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(panel(page).getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: "Offense" })).toBeFocused();
  await expect(reset).toBeDisabled();
  await expect.poll(() => storedSpots(page)).toEqual([lbSpot]);
  await d.foldOverlays();
  await expect.poll(() => d.playerX("X")).toBeCloseTo(3, 1);
  await note("offense reset");
  // and the defense's own Reset spots leaves nothing moved, so nothing is stored for the spots at all
  await d.rosterPanel();
  await show(page, "Defense");
  await reset.click();
  await spots.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(reset).toBeDisabled();
  await expect.poll(async () => (await storedLineups(page))?.spots).toBeUndefined();
  await note("defense reset");

  writeFileSync(`test-results/roster-${device}-spots.json`, `${JSON.stringify({ steps }, null, 2)}\n`);
});

test("spots stored by hand are read as the field allows: held to their side and inside the sidelines, one per position, a tag off the formation or a spot that is no number dropped", async ({ page }, info) => {
  const device = info.project.name;
  const junk = [
    { team: "offense", tag: "X", x: -40, y: -6 },
    { team: "offense", tag: "X", x: 10, y: 3 },
    { team: "defense", tag: "S", x: 60, y: 4 },
    { team: "offense", tag: "Z", x: "far", y: 5 },
    { team: "offense", tag: "QB", x: null, y: 5 },
    { team: "defense", tag: "FS", x: 9, y: -9 },
    { team: "offense", tag: "C", x: 15, y: 1 },
  ];
  await seed(page, { team: OTTERS, lineups: { ...main([]), spots: junk } as unknown as Lineups });
  const d = new Designer(page);
  await d.goto();
  await d.roster();
  await d.rosterView.click();
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing both");
  await d.foldOverlays();
  // X's first spot, off the field and over the line, is held at the sideline behind it; its second is ignored
  expect(await d.playerX("X")).toBeCloseTo(1.2, 1);
  // S, past the far sideline and on the offense's side, is held at that sideline on its own side
  expect(await d.playerX("S", "Defense")).toBeCloseTo(28.8, 1);
  // Z and QB, whose spots are no numbers, stand at home, as does C, stored at home; FS has no token to move
  expect(await d.playerX("Z")).toBeCloseTo(19, 1);
  expect(await d.playerX("QB")).toBeCloseTo(15, 1);
  expect(await d.playerX("C")).toBeCloseTo(15, 1);
  await expect(d.player("FS", "Defense")).toHaveCount(0);
  await d.field.screenshot({ path: `test-results/roster-${device}-stored-spots.png` });

  // the next write stores them as they were read
  await d.player("Y").press("ArrowLeft");
  await expect.poll(() => storedSpots(page)).toEqual([
    { team: "offense", tag: "X", x: 1.2, y: 0.9 },
    { team: "defense", tag: "S", x: 28.8, y: -0.9 },
    { team: "offense", tag: "Y", x: 26, y: 1 },
  ]);
  writeFileSync(`test-results/roster-${device}-stored-spots.json`, `${JSON.stringify({ seeded: junk, stored: await storedLineups(page) }, null, 2)}\n`);
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
    lineups: named(main([{ team: "defense", tag: "FS", depth: ["Jordan", "Casey"] }], ["Jordan", "Casey"])),
  });
  const d = new Designer(page);
  await d.openSaved(fsCall.name);
  await expect(d.caption("FS", "Defense")).toHaveText("Jordan");

  // the field is the standard ten; FS (kept on the lineup and worn by the call) and H (worn by a saved play) are listed after them
  await d.roster();
  await expect(d.player("FS", "Defense")).toHaveCount(0);
  await expect(d.player("H")).toHaveCount(0);
  await d.rosterPanel();
  await show(page, "Both");
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
  const expected = named(main([
    { team: "defense", tag: "FS", depth: ["Casey", "Jordan"] },
    { team: "offense", tag: "H", depth: ["Riley"] },
  ], ["Jordan", "Casey", "Riley"]));
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
  await expect(players.locator("li").getByRole("button")).toHaveText([/^Aaliyah/, /^Devon/, /^Marcus Lee\s*Y starter, X 2nd$/, /^Priya\s*No position$/]);
  await players.getByRole("button", { name: "Devon", exact: true }).click();
  await expect(panel(page).getByRole("group", { name: "Devon's positions" }).locator("li").getByRole("button"))
    .toHaveText(["X · Starter", "LC · Starter", "Y · 2nd"]);
  await panel(page).getByRole("button", { name: "‹ Back", exact: true }).click();
  // the positions a player starts at come first, though X (where Marcus Lee is 2nd) is earlier on the roster
  await players.getByRole("button", { name: "Marcus Lee", exact: true }).click();
  const marcus = panel(page).getByRole("group", { name: "Marcus Lee's positions" }).locator("li").getByRole("button");
  await expect(marcus).toHaveText(["Y · Starter", "X · 2nd"]);
  const marcusPage = await marcus.allTextContents();
  await panel(page).screenshot({ path: `test-results/roster-${device}-starter-first.png` });
  await panel(page).getByRole("button", { name: "‹ Back", exact: true }).click();

  // "devon" at LC is Devon: across the ball, a name typed two ways is already down (both sides on view to reach LC)
  await show(page, "Both");
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
  writeFileSync(`test-results/roster-${device}-from-team.json`, `${JSON.stringify({ marcusPage, stored: await storedLineups(page) }, null, 2)}\n`);
});

test("lineups branch from the starting lineup or from each other, each with its own depth charts, and the field follows the one picked", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, {
    plays: [SLANT_LEFT], team: OTTERS,
    lineups: named(main([{ team: "offense", tag: "X", depth: ["Devon", "Marcus Lee"] }, { team: "offense", tag: "QB", depth: ["Aaliyah"] }])),
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
  await expectLineups(page, ["Starting Lineup", "Secondary Lineup"], "Starting Lineup");
  await expect(page.locator("#field-title")).toContainText("Starting Lineup");
  // the starting lineup can't be deleted: its menu has no Delete
  await lineupsButton(page).click();
  await expect(lineupMenu(page).getByRole("menuitem")).toHaveCount(0);
  await page.keyboard.press("Escape");

  // a branch is a copy of the lineup it comes from, named at once, and the field follows it
  await fork.click();
  await expect(lineupName(page)).toBeFocused();
  await expect(lineupName(page)).toHaveValue("Lineup 3");
  await expect(panel(page)).toContainText("Branched from Starting Lineup.");
  await lineupName(page).fill("No Devon");
  await expectLineups(page, ["Starting Lineup", "Secondary Lineup", "No Devon"], "No Devon");
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
  await expect(lineupName(page)).toHaveValue("Lineup 4");
  await expect(panel(page)).toContainText("Branched from No Devon.");
  await lineupName(page).fill("Rainy day");
  await expect(lines(chart)).toHaveText(["Marcus Lee"]);
  const stored = await storedLineups(page);
  if (!stored) throw new Error("no lineups stored");
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
  await expectLineups(page, ["Starting Lineup", "Secondary Lineup", "No Devon", "Rainy day"], "No Devon");
  await lineupsButton(page).click();
  await lineupMenu(page).getByRole("menuitem", { name: "Delete “No Devon”" }).click();
  await panel(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expectLineups(page, ["Starting Lineup", "Secondary Lineup", "Rainy day"], "Starting Lineup");
  await expect(lineupName(page)).toHaveValue("Starting Lineup");
  await expect(d.caption("X")).toHaveText("Devon");
  await pickLineup(page, "Rainy day");
  await expect(panel(page)).not.toContainText("Branched from");
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  const after = await storedLineups(page);
  expect(after?.lineups.map((l) => [l.name, l.from ?? null])).toEqual([["Starting Lineup", null], ["Rainy day", null]]);

  writeFileSync(`test-results/roster-${device}-lineups.json`, `${JSON.stringify({ stored, after }, null, 2)}\n`);
});

test("the Secondary Lineup is made from the starting lineup's depth charts: the next player up starts, nobody twice on a side, it follows every change there, never changes itself, and branches into one that can", async ({ page }, info) => {
  const device = info.project.name;
  // Priya is next up at X and at Y, and at S and FS (a tag the formation lacks) on the defense; nobody is behind
  // Aaliyah at QB; and a lineup stored under the Secondary Lineup's own id is not it (lineup.ts, S1–S6)
  const starting: Roster = [
    { team: "offense", tag: "X", depth: ["Devon", "Priya", "Jo"] },
    { team: "offense", tag: "Y", depth: ["Sam", "Priya"] },
    { team: "offense", tag: "QB", depth: ["Aaliyah"] },
    { team: "offense", tag: "C", depth: ["Marcus", "Lee"] },
    { team: "defense", tag: "S", depth: ["Ray", "Priya"] },
    { team: "defense", tag: "FS", depth: ["Ray", "Priya"] },
  ];
  const seeded = named(main(starting, ["Aaliyah", "Devon", "Jo", "Lee", "Marcus", "Priya", "Ray", "Sam"]));
  await seed(page, {
    plays: [SLANT_LEFT], team: OTTERS,
    lineups: { ...seeded, lineups: [...seeded.lineups, { id: "second", name: "Kept by hand", slots: [{ team: "offense", tag: "X", depth: ["Zed"] }] }] },
  });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await expect(d.caption("X")).toHaveText("Devon");

  // on a play it is picked beside the switch, straight after the starting lineup, and its starters show
  await d.tools();
  const picker = tools(page).getByRole("combobox", { name: "Lineup" });
  await expect(picker.getByRole("option")).toHaveText(["Starting Lineup", "Secondary Lineup"]);
  await picker.selectOption({ label: "Secondary Lineup" });
  await expect(tools(page)).toContainText("The starters on Secondary Lineup show");
  // Priya can't start at X and Y at once: Y, with nobody else behind its starter, gets her, and X goes on down to Jo;
  // nobody is behind Aaliyah, so she keeps QB
  await expect(d.caption("Y")).toHaveText("Priya");
  await expect(d.caption("X")).toHaveText("Jo");
  await expect(d.caption("QB")).toHaveText("Aaliyah");
  await expect(d.caption("C")).toHaveText("Lee");
  await expect(d.caption("Z")).toHaveCount(0);
  const onPlay = Object.fromEntries(await Promise.all(["X", "Y", "QB", "C"].map(async (tag) => [tag, await d.caption(tag).textContent()] as const)));

  // in roster mode it is shown, never changed: its name is not the coach's, the menu offers no Delete, and it says what it is made from
  await d.roster();
  await d.rosterPanel();
  await expect(lineupName(page)).toHaveValue("Secondary Lineup");
  await expect(lineupName(page)).not.toBeEditable();
  await expect(panel(page)).toContainText("Made from Starting Lineup's depth charts: at each position the next player up starts.");
  await expect(page.locator("#field-title")).toContainText("Secondary Lineup");
  await expectLineups(page, ["Starting Lineup", "Secondary Lineup"], "Secondary Lineup");
  await lineupsButton(page).click();
  await expect(lineupMenu(page).getByRole("menuitem")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(panel(page).getByRole("group", { name: "Players" })).not.toContainText("Zed");
  // every position, both sides: Priya starts on the offense and the defense, and at FS as well as S, since a tag the
  // formation lacks stands in for one of its positions on a play and is not held against it
  await show(page, "Both");
  const offense = panel(page).getByRole("group", { name: "Offense positions" });
  for (const line of ["X: Jo, 3 deep", "Y: Priya, 2 deep", "QB: Aaliyah", "C: Lee, 2 deep", "Z: Unassigned"]) {
    await expect(offense.getByRole("button", { name: line, exact: true })).toBeVisible();
  }
  const defense = panel(page).getByRole("group", { name: "Defense positions" });
  for (const line of ["S: Priya, 2 deep", "FS: Priya, 2 deep", "LC: Unassigned"]) {
    await expect(defense.getByRole("button", { name: line, exact: true })).toBeVisible();
  }
  await expect(d.caption("S", "Defense")).toHaveText("Priya");

  // a depth chart on it is the starting lineup's moved up, read only: no ▲, no ✕, nobody to add
  await show(page, "Offense");
  await d.select("X");
  const chart = panel(page).getByRole("group", { name: "Depth chart at X" });
  await expect(lines(chart)).toHaveText(["Jo", "Priya", "Devon"]);
  await expect(chart.getByRole("button", { name: /^Move .+ up$/ })).toHaveCount(0);
  await expect(chart.getByRole("button", { name: /^Remove / })).toHaveCount(0);
  await expect(chart.getByRole("button", { name: "+ Add a player" })).toHaveCount(0);
  await expect(chart).toContainText("Made from Starting Lineup's depth chart at X");
  await panel(page).screenshot({ path: `test-results/roster-${device}-secondary.png` });
  // a player's page on it lists where they play, starts first, with no positions to be put at
  await chart.getByRole("button", { name: "2nd at X: Priya" }).click();
  await expect(panel(page).getByRole("group", { name: "Priya's positions" }).locator("li").getByRole("button"))
    .toHaveText(["Y · Starter", "S · Starter", "FS · Starter", "X · 2nd"]);
  await expect(panel(page).getByRole("group", { name: "Put Priya at a position" })).toHaveCount(0);
  await panel(page).getByRole("button", { name: "‹ Back" }).click();

  // the way to change it is the starting lineup, and it follows every change there: Priya off Y leaves Sam alone
  // there, so he keeps it, and Priya, free again, starts at X
  await chart.getByRole("button", { name: "Change X on Starting Lineup" }).click();
  await expect(lineupName(page)).toHaveValue("Starting Lineup");
  await expect(lines(chart)).toHaveText(["Devon", "Priya", "Jo"]);
  await expect(d.caption("X")).toHaveText("Devon");
  await d.select("Y");
  await panel(page).getByRole("group", { name: "Depth chart at Y" }).getByRole("button", { name: "Remove Priya" }).click();
  await pickLineup(page, "Secondary Lineup");
  await expect(d.caption("Y")).toHaveText("Sam");
  await expect(d.caption("X")).toHaveText("Priya");
  // nothing of it is stored but the pick: the starting lineup alone, the lineup that claimed its id gone
  const followed = await storedLineups(page);
  expect(followed?.active).toBe("second");
  expect(followed?.lineups.map((l) => l.id)).toEqual(["main"]);
  expect(followed?.players).not.toContain("Zed");

  // a branch of it is a copy as made now, the coach's to change, and no longer follows the starting lineup
  await panel(page).getByRole("button", { name: "Branch lineup" }).click();
  await expect(lineupName(page)).toBeFocused();
  await expect(lineupName(page)).toHaveValue("Lineup 3");
  await expect(panel(page)).toContainText("Branched from Secondary Lineup.");
  await lineupName(page).fill("Second unit");
  await d.select("X");
  await expect(lines(chart)).toHaveText(["Priya", "Jo", "Devon"]);
  await chart.getByRole("button", { name: "Remove Devon" }).click();
  await expect(lines(chart)).toHaveText(["Priya", "Jo"]);
  await pickLineup(page, "Starting Lineup");
  await chart.getByRole("button", { name: "Move Jo up" }).click();
  await expect(lines(chart)).toHaveText(["Devon", "Jo", "Priya"]);
  await pickLineup(page, "Secondary Lineup");
  await expect(d.caption("X")).toHaveText("Jo");
  await pickLineup(page, "Second unit");
  await expect(d.caption("X")).toHaveText("Priya");
  const branchedOff = await storedLineups(page);
  expect(branchedOff?.lineups.map((l) => [l.name, l.from ?? null, l.slots.find((s) => s.tag === "X")?.depth])).toEqual([
    ["Starting Lineup", null, ["Devon", "Jo", "Priya"]],
    ["Second unit", "second", ["Priya", "Jo"]],
  ]);

  // the branch deleted, the field falls back to the Secondary Lineup it came from, and that pick outlasts a reload
  await lineupsButton(page).click();
  await lineupMenu(page).getByRole("menuitem", { name: "Delete “Second unit”" }).click();
  await panel(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expectLineups(page, ["Starting Lineup", "Secondary Lineup"], "Secondary Lineup");
  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(d.caption("X")).toHaveText("Jo");
  await expect(d.caption("Y")).toHaveText("Sam");
  const after = await storedLineups(page);
  expect(after?.active).toBe("second");
  expect(after?.lineups.map((l) => l.id)).toEqual(["main"]);

  writeFileSync(`test-results/roster-${device}-secondary.json`, `${JSON.stringify({ starting, onPlay, followed, branchedOff, after }, null, 2)}\n`);
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
  await expect(rows).toHaveText(["Starting Lineup", "Secondary Lineup", rotA, rotB]);
  expect(await cutOff()).toEqual({ words: [], sideways: false });
  // a name too long for one line wraps, and its row grows past the 44px a row starts at
  const one = await rows.first().boundingBox(), long = await rows.nth(3).boundingBox();
  expect(one && long).toBeTruthy();
  if (one && long) {
    expect(one.height).toBeGreaterThanOrEqual(44);
    expect(long.height).toBeGreaterThan(one.height);
  }
  await panel(page).screenshot({ path: `test-results/roster-${device}-long-lineup-names.png` });

  // the one picked by its whole name is the one on the field, and its Delete names it whole too
  await rows.nth(3).click();
  await expect(lineupName(page)).toHaveValue(rotB);
  await expect(page.locator("#field-title")).toContainText(rotB);
  await lineupsButton(page).click();
  await expect(lineupMenu(page).getByRole("menuitem")).toHaveText([`Delete “${rotB}”`]);
  expect(await cutOff()).toEqual({ words: [], sideways: false });
});

test("names stay off a play until turned on, follow the lineup picked in Play tools, and go off with the last name on the roster", async ({ page }, info) => {
  const device = info.project.name;
  const noDevon: Lineups["lineups"][number] = { id: "nodevon", name: "No Devon", from: "main", slots: [{ team: "offense", tag: "X", depth: ["Marcus Lee"] }] };
  const both = (names: boolean, active = "main"): Lineups => {
    const ls: Lineups = { active, lineups: [{ id: "main", name: "Starting Lineup", slots: [{ team: "offense", tag: "X", depth: ["Devon"] }] }, noDevon], players: ["Devon", "Marcus Lee"] };
    return names ? named(ls) : ls;
  };
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS, lineups: both(false) });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  // a roster on the device, and the play still shows no names until the coach says so
  await expect(d.player("X")).toBeVisible();
  await expect(d.caption("X")).toHaveCount(0);
  await d.tools();
  await expect(d.namesSwitch).toBeEnabled();
  await expect(d.namesSwitch).not.toBeChecked();
  await expect(tools(page)).toContainText("Names stay off every play until you turn them on.");
  await expect(tools(page).getByRole("combobox", { name: "Lineup" })).toHaveCount(0);

  // on: the starter shows, and the lineup to take it from is picked right here
  await d.showNames(true);
  await expect(d.caption("X")).toHaveText("Devon");
  const lineup = tools(page).getByRole("combobox", { name: "Lineup" });
  await expect(lineup).toHaveValue("main");
  await expect(lineup.getByRole("option")).toHaveText(["Starting Lineup", "Secondary Lineup", "No Devon"]);
  await expect(tools(page)).toContainText("The starters on Starting Lineup show under the tags on every play");
  await expect.poll(() => storedLineups(page)).toEqual(both(true));
  await lineup.selectOption({ label: "No Devon" });
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  await expect(tools(page)).toContainText("The starters on No Devon show");
  await expect.poll(() => storedLineups(page)).toEqual(both(true, "nodevon"));
  await tools(page).screenshot({ path: `test-results/roster-${device}-names.png` });

  // off again: the names leave the play, and the choice is stored as plainly as it was made
  await d.showNames(false);
  await expect(d.caption("X")).toHaveCount(0);
  await expect(tools(page).getByRole("combobox", { name: "Lineup" })).toHaveCount(0);
  await expect.poll(() => storedLineups(page)).toEqual(both(false, "nodevon"));
  await d.showNames(true);
  await expect(d.caption("X")).toHaveText("Marcus Lee");

  // the last name taken off every depth chart takes the names off the play with it: there is nothing left to show,
  // though both players stay on the team
  await d.roster();
  await d.rosterPanel();
  await d.select("X");
  await panel(page).getByRole("group", { name: "Depth chart at X" }).getByRole("button", { name: "Remove Marcus Lee" }).click();
  await expect(d.caption("X")).toHaveText("Unassigned");
  await pickLineup(page, "Starting Lineup");
  await expect(d.caption("X")).toHaveText("Devon");
  await panel(page).getByRole("group", { name: "Depth chart at X" }).getByRole("button", { name: "Remove Devon" }).click();
  await expect(d.caption("X")).toHaveText("Unassigned");
  const emptied = await storedLineups(page);
  expect(emptied?.names).toBeUndefined();
  expect(emptied?.lineups.map((l) => l.slots)).toEqual([[], []]);
  expect(emptied?.players).toEqual(["Devon", "Marcus Lee"]);
  await d.roster(false);
  await expect(d.caption("X")).toHaveCount(0);
  await d.tools();
  await expect(d.namesSwitch).toBeDisabled();
  await expect(tools(page)).toContainText("Build a roster first");

  writeFileSync(`test-results/roster-${device}-names.json`, `${JSON.stringify({ emptied }, null, 2)}\n`);
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
  await pickLineup(page, "Lineup 3");
  await expect(names).toHaveText([/^Josiah\s*No position$/, /^Noah/]);
  await expect(d.caption("X")).toHaveText("Unassigned");
  const after = await storedLineups(page);
  expect(after?.players).toEqual(["Josiah", "Noah"]);
  expect(after?.lineups.map((l) => [l.name, l.slots])).toEqual([
    ["Starting Lineup", [{ team: "offense", tag: "QB", depth: ["Josiah"] }]],
    ["Lineup 3", []],
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
    // names shown on plays, so the caption below is read on the play itself
    names: true,
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
    lineups: named(main([{ team: "offense", tag: "X", depth: ["Christopher"] }, { team: "offense", tag: "Y", depth: ["Christopher"] }])),
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

test("a position tapped far down the panel brings the panel back to its top and lights up the depth chart it is about to change", async ({ page }, info) => {
  const device = info.project.name;
  const team = ["Avery", "Blake", "Casey", "Dakota", "Emery", "Finley", "Harper", "Jules", "Kai", "Logan", "Marlow", "Noor"];
  const slots: Roster = [{ team: "defense", tag: "LC", depth: ["Avery"] }, { team: "defense", tag: "S", depth: ["Blake", "Casey"] }];
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS, lineups: main(slots, team) });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await d.roster();
  await d.rosterPanel();
  await show(page, "Defense");
  const scroller = panel(page).locator(":scope > div");
  const defense = panel(page).getByRole("group", { name: "Defense positions" });
  const spot = (tag: string) => panel(page).getByRole("group", { name: `Depth chart at ${tag}` }).locator(":scope > span[aria-hidden]");
  const lit = (tag: string) => spot(tag).evaluate((el) => Number(getComputedStyle(el).opacity));
  const top = () => scroller.evaluate((el) => el.scrollTop);
  const log: { tapped: string; scrolledFrom: number; scrolledTo: number; litAtPeak: number; litAtRest: number }[] = [];

  /** Scrolls the panel to its foot, taps a position in the list, and records what the coach saw. */
  async function tapFromTheFoot(button: string, tag: string): Promise<void> {
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const from = await top();
    expect(from).toBeGreaterThan(0);
    await expect(defense.getByRole("button", { name: button })).toBeInViewport();
    await defense.getByRole("button", { name: button }).click();
    let peak = 0;
    await expect.poll(async () => (peak = Math.max(peak, await lit(tag)))).toBeGreaterThan(0.5);
    await expect.poll(top).toBe(0);
    await expect(panel(page).getByRole("heading", { name: `Who plays ${tag}` })).toBeInViewport();
    await expect(panel(page).getByRole("group", { name: `Depth chart at ${tag}` })).toBeInViewport();
    await panel(page).screenshot({ path: `test-results/roster-${device}-picked-${tag}.png` });
    // the highlighter goes out again: it marks the pick, it is not a state
    await expect.poll(() => lit(tag), { timeout: 5_000 }).toBe(0);
    log.push({ tapped: button, scrolledFrom: from, scrolledTo: await top(), litAtPeak: peak, litAtRest: await lit(tag) });
  }

  // a starter already down: S, picked from the foot of the list
  await tapFromTheFoot("S: Blake, 2 deep", "S");
  await expect(panel(page).getByRole("group", { name: "Depth chart at S" }).locator("ol")).toContainText("Blake");
  // nobody down yet: LB, the chart that is about to be filled
  await tapFromTheFoot("LB: Unassigned", "LB");
  await expect(panel(page).getByRole("group", { name: "Depth chart at LB" })).toContainText("Nobody is down for LB yet.");
  // the same position tapped again, after scrolling away from it, comes back to it again
  await tapFromTheFoot("LB: Unassigned", "LB");
  // nothing was written by looking: the lineup is as seeded
  await expect.poll(() => storedLineups(page)).toEqual(main(slots, team));
  writeFileSync(`test-results/roster-${device}-picked.json`, `${JSON.stringify(log, null, 2)}\n`);
});

/**
 * Roster mode lays out a formation that stands still, 11 yards deep at the safety, so its card frames just
 * that: no room kept for routes, not stretched down a phone's tall pane, and never Deep field. How this could break, and the check for each:
 *  - roster mode shows as much field as a play                  → on every screen its card shows ROSTER_YARDS, never stretched down a tall pane
 *  - the ball on the 15 cuts the no-run band behind the safety → the card's top is the goal line, the band whole above him
 *  - framing it closer shrinks the card                         → the roster's card fills its pane across, or top to bottom
 *  - Deep field, on for the plays, opens the roster's card too  → with Deep field on the roster's card is the one it shows with it off
 *  - roster mode offers Deep field                              → no Deep field button in roster mode, with it on or off
 *  - zoomed in, a position falls off the card                   → with Both on view, every token sits inside the field
 *  - leaving roster mode loses the play's Deep field            → back on the play, Deep field is still on and the card as deep as before
 *  - a position dragged deep runs off the close card             → stepped toward the goal line, S stops 1.2 yards under the card's top, 13.8 deep, the card still 23 yards
 *  - a spot stored deeper than that is cut off                   → a spot stored 20 yards deep deepens the card to hold it
 * Leaves `roster-<device>-zoom.json` (each step's yards shown and card width) and pictures of the roster's card.
 */
const ROSTER_YARDS = 23;
test("roster mode is a closer card than a play's, and never the deep field", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  const deepButton = page.getByRole("button", { name: "Deep field", exact: true });
  /** The card as drawn: yards top to bottom, its width on screen, and how much of its pane it leaves either way. */
  const card = async () => {
    await d.foldOverlays();
    return d.field.evaluate((el) => {
      const pane = el.closest("main");
      if (!pane) throw new Error("no pane");
      const r = el.getBoundingClientRect(), p = pane.getBoundingClientRect();
      // the pane's 9px padding is the card's margin, not room it leaves
      return {
        yards: (el as SVGSVGElement).viewBox.baseVal.height / 22,
        width: Math.round(r.width),
        spareX: Math.round(p.width - 18 - r.width),
        spareY: Math.round(p.bottom - 9 - r.bottom),
      };
    });
  };
  const steps: Record<string, Awaited<ReturnType<typeof card>>> = {};

  steps.play = await card();
  await d.roster();
  await d.rosterView.click();
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing both");
  steps.roster = await card();
  // the no-run band before their goal line is on the card whole, its label clear of the safety
  const noRun = d.field.getByText("NO-RUN", { exact: true });
  await expect(noRun).toBeVisible();
  const label = await noRun.boundingBox();
  // the token's painted disc (r 23), not its 34-unit tap target
  const safety = await d.player("S", "Defense").locator("circle[r='23']").boundingBox();
  if (!label || !safety) throw new Error("no label or no safety");
  // capitals with no descenders: the text box runs a few pixels under the letters, which clear the disc
  expect(label.y + label.height / 2, "the band's label is above the safety, not behind him").toBeLessThan(safety.y);
  expect(steps.roster.yards, "the roster's card frames the formation").toBe(ROSTER_YARDS);
  expect(Math.min(steps.roster.spareX, steps.roster.spareY), "a closer card still fills its pane one way").toBeLessThanOrEqual(1);
  await expect(deepButton).toHaveCount(0);
  const field = await d.field.boundingBox();
  if (!field) throw new Error("the field has not laid out");
  for (const [tag, team] of [["C", "Offense"], ["QB", "Offense"], ["X", "Offense"], ["Y", "Offense"], ["Z", "Offense"], ["LC", "Defense"], ["LB", "Defense"], ["R", "Defense"], ["RC", "Defense"], ["S", "Defense"]] as const) {
    const box = await d.player(tag, team).boundingBox();
    if (!box) throw new Error(`no ${tag} on the field`);
    expect(box.y, `${tag} is under the card's top`).toBeGreaterThanOrEqual(field.y);
    expect(box.y + box.height, `${tag} is over the card's bottom`).toBeLessThanOrEqual(field.y + field.height);
  }
  await d.field.screenshot({ path: `test-results/roster-${device}-zoom.png` });
  // the safety stepped toward the goal line stops where the card's top allows, and the card stays put
  for (let i = 0; i < 8; i++) await d.player("S", "Defense").press("ArrowUp");
  await expect.poll(async () => (await storedLineups(page))?.spots?.find((q) => q.tag === "S")?.y).toBeCloseTo(-13.8, 1);
  steps.steppedDeep = await card();
  expect(steps.steppedDeep.yards, "a step never deepens the roster's card").toBe(ROSTER_YARDS);
  await d.roster(false);

  // Deep field on for the plays (from its own key, so a screen that never offers it is checked too)
  await page.evaluate((key) => { localStorage.setItem(key, "on"); }, DEEP_FIELD_KEY);
  await page.reload();
  steps.playDeep = await card();
  await d.roster();
  steps.rosterDeep = await card();
  expect(steps.rosterDeep, "Deep field never reaches the roster").toEqual(steps.roster);
  await expect(deepButton).toHaveCount(0);
  await d.field.screenshot({ path: `test-results/roster-${device}-zoom-deep.png` });
  await d.roster(false);
  expect((await card()).yards, "the play keeps its Deep field").toBe(steps.playDeep.yards);
  expect(await page.evaluate((key) => localStorage.getItem(key), DEEP_FIELD_KEY)).toBe("on");

  // a spot stored deeper than a drag can reach (from a backup, say) deepens the card to hold it: 8 + 20 + 1.2
  const stored = await storedLineups(page);
  const spots: Spot[] = [{ team: "defense", tag: "S", x: 15, y: -20 }];
  await page.evaluate(([key, ls]) => { localStorage.setItem(key, JSON.stringify(ls)); }, ["ffpd.lineups.v1", { ...stored, spots }] as const);
  await page.reload();
  await d.roster();
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing defense");
  steps.storedDeep = await card();
  expect(steps.storedDeep.yards).toBe(29.5);
  const deepS = await d.player("S", "Defense").boundingBox();
  const deepField = await d.field.boundingBox();
  if (!deepS || !deepField) throw new Error("the field has not laid out");
  expect(deepS.y, "the deep safety is on the card").toBeGreaterThanOrEqual(deepField.y);

  writeFileSync(`test-results/roster-${device}-zoom.json`, `${JSON.stringify(steps, null, 2)}\n`);
});

test("a starter's name reads at arm's length: at least 13px on every screen, clear of every token and every other name", async ({ page }, info) => {
  const device = info.project.name;
  // the whole standard formation named, both sides on view, as a coach holds it up on the sideline
  const starters: [Roster[number]["team"], string, string][] = [
    ["offense", "X", "Logan"], ["offense", "C", "Quinn"], ["offense", "Y", "Noah"], ["offense", "QB", "Josiah"], ["offense", "Z", "Yohann"],
    ["defense", "S", "Drew"], ["defense", "LC", "Desrael"], ["defense", "LB", "Yohann"], ["defense", "R", "Amelia"], ["defense", "RC", "Avari"],
  ];
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS, lineups: main(starters.map(([team, tag, name]) => ({ team, tag, depth: [name] }))) });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await d.roster();
  await d.rosterPanel();
  await show(page, "Both");
  await d.closeSidebars();

  type Box = { x: number; y: number; width: number; height: number };
  const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const names: { tag: string; text: string; px: number; box: Box }[] = [];
  const tokens: { tag: string; box: Box }[] = [];
  for (const [team, tag, name] of starters) {
    const side = team === "offense" ? "Offense" : "Defense";
    const caption = d.caption(tag, side);
    await expect(caption).toHaveText(name);
    // the size the name is drawn at on this screen, in CSS pixels (its font size through the field's scale), and
    // the box its letters ink, halo and all: the text's own box is the font's line, which runs past the letters
    const { px, box } = await caption.evaluate((el) => {
      const text = el as SVGTextElement;
      const size = Number(text.getAttribute("font-size")) * (text.getScreenCTM()?.a ?? 0);
      const ctx = document.createElement("canvas").getContext("2d");
      if (!ctx) throw new Error("no 2D context to measure with");
      ctx.font = `${String(size)}px ${getComputedStyle(text).fontFamily}`;
      const m = ctx.measureText(text.textContent ?? "");
      const r = text.getBoundingClientRect(), baseline = r.top + m.fontBoundingBoxAscent;
      const halo = (Number(text.getAttribute("stroke-width")) / 2) * (text.getScreenCTM()?.a ?? 0);
      const top = baseline - m.actualBoundingBoxAscent - halo, bottom = baseline + m.actualBoundingBoxDescent + halo;
      return { px: size, box: { x: r.x, y: top, width: r.width, height: bottom - top } };
    });
    const disc = await d.player(tag, side).locator("circle[r='23']").boundingBox();
    if (!disc) throw new Error(`${side} ${tag} has not laid out`);
    names.push({ tag: `${side} ${tag}`, text: name, px, box });
    tokens.push({ tag: `${side} ${tag}`, box: disc });
    expect(px, `${side} ${tag}'s name is drawn at least 13px`).toBeGreaterThanOrEqual(13);
  }
  for (const n of names) {
    for (const t of tokens) expect(overlap(n.box, t.box), `${n.tag}'s name is clear of ${t.tag}`).toBe(false);
    for (const m of names) if (m !== n) expect(overlap(n.box, m.box), `${n.tag}'s name is clear of ${m.tag}'s`).toBe(false);
  }
  await d.field.screenshot({ path: `test-results/roster-${device}-legible-names.png` });
  writeFileSync(`test-results/roster-${device}-legible-names.json`, `${JSON.stringify({ field: await d.field.boundingBox(), names, tokens }, null, 2)}\n`);
});

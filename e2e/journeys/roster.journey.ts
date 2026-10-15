import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Lineups, Roster } from "../../lib/play/types";
import { Designer, armSabotage, downloadText, sabotage } from "../support/designer";
import { OTTERS, SLANT_LEFT, jsonUpload, seed, storedLineups } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * The roster (docs/adr/008-roster-depth-chart.md): a mode that lays the positions out on the field with
 * nothing drawn on them, lists every position on both sides, and, for the one tapped, takes a depth chart
 * of names, starter first, with a way to move a player up and to take one off. The starter's name is
 * drawn under the tag, in roster mode and while drawing the play, is the device's (it outlasts a reload,
 * goes into a device backup and comes back from one), and never reaches a share link. A tag renamed is a
 * fresh position; undo brings the old one back with its names. A write the device refuses is said, and
 * stores nothing. Every name on the lineup has a page of its own: the positions they play and where they
 * sit at each. Lineups are versions of it all: the Starting Lineup is always there, any lineup branches
 * into a copy to change, the field follows the one picked, and a deleted lineup falls back to the one it
 * came from. Leaves `roster-<device>*.json` (what was stored at each step) and pictures of the panel and
 * the field in `test-results/`.
 */

const panel = (page: Page) => page.locator("#route-sidebar");
const openSettings = (page: Page) => page.getByRole("button", { name: /team, theme & backup settings/ }).click();
/** The starting lineup alone, holding these slots. */
const main = (slots: Roster): Lineups => ({ active: "main", lineups: [{ id: "main", name: "Starting Lineup", slots }] });
/** The lineup picker and the name of the active lineup, in the roster panel. */
const picker = (page: Page) => panel(page).getByRole("combobox", { name: "Lineup" });
const lineupName = (page: Page) => panel(page).getByRole("textbox", { name: "Lineup name" });

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
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  const starter = chart.getByRole("textbox", { name: "Starter at X" });
  await expect(starter).toBeFocused();
  await starter.fill("Marcus Lee");
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await chart.getByRole("textbox", { name: "2nd at X" }).fill("Devon");
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await chart.getByRole("textbox", { name: "3rd at X" }).fill("Priya");
  await expect(offense.getByRole("button", { name: "X: Marcus Lee, 3 deep" })).toBeVisible();
  await chart.getByRole("button", { name: "Move Devon up" }).click();
  await expect(chart.getByRole("textbox", { name: "Starter at X" })).toHaveValue("Devon");
  await expect(chart.getByRole("textbox", { name: "2nd at X" })).toHaveValue("Marcus Lee");
  await expect(d.caption("X")).toHaveText("Devon");
  await chart.getByRole("button", { name: "Remove Priya" }).click();
  await expect(chart.getByRole("textbox")).toHaveCount(2);
  await expect(offense.getByRole("button", { name: "X: Devon, 2 deep" })).toBeVisible();
  const afterX = await storedLineups(page);

  // the list is the way to the next position; a long name is shortened under the token, whole in the panel
  await offense.getByRole("button", { name: "QB: Unassigned" }).click();
  await expect(panel(page).getByRole("heading", { name: "Who plays QB" })).toBeVisible();
  const qb = panel(page).getByRole("group", { name: "Depth chart at QB" });
  await qb.getByRole("button", { name: "+ Add a player" }).click();
  await qb.getByRole("textbox", { name: "Starter at QB" }).fill("Aaliyah Brooks-Washington");
  await expect(d.caption("QB")).toHaveText("Aaliyah");
  await expect(offense.getByRole("button", { name: "QB: Aaliyah Brooks-Washington" })).toBeVisible();
  const expected = main([
    { team: "offense", tag: "X", depth: ["Devon", "Marcus Lee"] },
    { team: "offense", tag: "QB", depth: ["Aaliyah Brooks-Washington"] },
  ]);
  await expect.poll(() => storedLineups(page)).toEqual(expected);
  await panel(page).screenshot({ path: `test-results/roster-${device}-panel.png` });

  // a player's own page: every position they play and where they sit at each, across both sides
  await d.select("LC", "Defense");
  const lc = panel(page).getByRole("group", { name: "Depth chart at LC" });
  await lc.getByRole("button", { name: "+ Add a player" }).click();
  await lc.getByRole("textbox", { name: "Starter at LC" }).fill("Priya");
  await lc.getByRole("button", { name: "+ Add a player" }).click();
  await lc.getByRole("textbox", { name: "2nd at LC" }).fill("devon");
  const players = panel(page).getByRole("group", { name: "Players" });
  await expect(players.getByRole("button")).toHaveText([/^Aaliyah Brooks-Washington/, /^Devon/, /^Marcus Lee/, /^Priya/]);
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
  await panel(page).getByRole("button", { name: "‹ Back to routes" }).click();
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

test("a defensive call lists the defenders first, a renamed tag is a fresh position, undo brings the old one back, and a backup carries the roster", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  await d.newPlay("Defense");
  await d.roster();
  await d.rosterPanel();
  await expect(panel(page).getByRole("group", { name: /positions$/ }).first()).toHaveAttribute("aria-label", "Defense positions");
  const defense = panel(page).getByRole("group", { name: "Defense positions" });
  // left to right, as the wristbands count them
  expect(await defense.getByRole("button").evaluateAll((els) => els.map((el) => el.getAttribute("aria-label"))))
    .toEqual(["LC: Unassigned", "LB: Unassigned", "S: Unassigned", "R: Unassigned", "RC: Unassigned"]);

  await d.select("S", "Defense");
  const chart = panel(page).getByRole("group", { name: "Depth chart at S" });
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await chart.getByRole("textbox", { name: "Starter at S" }).fill("Jordan");
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");

  // the tag is the position: a new tag starts with nobody, and S keeps Jordan for whoever wears S next
  await panel(page).getByRole("textbox", { name: "Player tag" }).fill("FS");
  await expect(panel(page).getByRole("heading", { name: "Who plays FS" })).toBeVisible();
  await expect(d.caption("FS", "Defense")).toHaveText("Unassigned");
  await expect(defense.getByRole("button", { name: "FS: Unassigned" })).toBeVisible();
  await expect.poll(() => storedLineups(page)).toEqual(main([{ team: "defense", tag: "S", depth: ["Jordan"] }]));
  // undo deselects, as it does while drawing; the list still says who starts at S
  await d.undo.click();
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");
  await d.rosterPanel();
  await expect(defense.getByRole("button", { name: "S: Jordan" })).toBeVisible();

  // a device backup carries the roster, and restoring it on a wiped device brings the names back
  await page.goto("/playbooks");
  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup" }).click(),
  ]);
  const backup = await downloadText(download);
  const parsed = JSON.parse(backup) as { lineups: Lineups };
  expect(parsed.lineups).toEqual(main([{ team: "defense", tag: "S", depth: ["Jordan"] }]));
  await page.evaluate(() => { localStorage.removeItem("ffpd.lineups.v1"); });
  await page.reload();
  await openSettings(page);
  await page.getByLabel("Restore a device backup").setInputFiles(jsonUpload("device-backup.json", backup));
  await page.getByRole("region", { name: "Restore preview" }).getByRole("button", { name: "Replace device data" }).click();
  await expect(page.getByRole("dialog", { name: "Team, theme & backup" }).getByRole("status")).toContainText("Replaced with backup");
  await expect.poll(() => storedLineups(page)).toEqual(main([{ team: "defense", tag: "S", depth: ["Jordan"] }]));
  await d.goto();
  await d.newPlay("Defense");
  await expect(d.caption("S", "Defense")).toHaveText("Jordan");

  writeFileSync(`test-results/roster-${device}-defense.json`, `${JSON.stringify({ stored: await storedLineups(page), backup: parsed.lineups }, null, 2)}\n`);
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
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await expect(d.toast).toContainText("Couldn't save: this browser's storage is full.");
  await expect(chart).toContainText("Nobody is down for Z yet.");
  expect(await storedLineups(page)).toBeNull();
  await sabotage(page, "quota", false);
  await chart.getByRole("button", { name: "+ Add a player" }).click();
  await chart.getByRole("textbox", { name: "Starter at Z" }).fill("Sam");
  await expect(d.caption("Z")).toHaveText("Sam");
  await expect.poll(() => storedLineups(page)).toEqual(main([{ team: "offense", tag: "Z", depth: ["Sam"] }]));
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
  await expect(picker(page)).toHaveValue("main");
  await expect(picker(page).getByRole("option")).toHaveText(["Starting Lineup"]);
  await expect(page.locator("#field-title")).toContainText("Starting Lineup");
  await expect(panel(page).getByRole("button", { name: "Delete lineup" })).toHaveCount(0);

  // a branch is a copy of the lineup it comes from, named at once, and the field follows it
  await panel(page).getByRole("button", { name: "Branch lineup" }).click();
  await expect(lineupName(page)).toBeFocused();
  await expect(lineupName(page)).toHaveValue("Lineup 2");
  await expect(panel(page)).toContainText("Branched from Starting Lineup.");
  await lineupName(page).fill("No Devon");
  await expect(picker(page).getByRole("option")).toHaveText(["Starting Lineup", "No Devon"]);
  await expect(page.locator("#field-title")).toContainText("No Devon");
  await d.select("X");
  const chart = panel(page).getByRole("group", { name: "Depth chart at X" });
  await expect(chart.getByRole("textbox", { name: "Starter at X" })).toHaveValue("Devon");
  await chart.getByRole("button", { name: "Remove Devon" }).click();
  await expect(chart.getByRole("textbox", { name: "Starter at X" })).toHaveValue("Marcus Lee");
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  // the starting lineup is untouched: picking it back brings Devon back
  await picker(page).selectOption({ label: "Starting Lineup" });
  await expect(d.caption("X")).toHaveText("Devon");
  await expect(chart.getByRole("textbox", { name: "Starter at X" })).toHaveValue("Devon");
  await picker(page).selectOption({ label: "No Devon" });
  await expect(d.caption("X")).toHaveText("Marcus Lee");

  // a branch of a branch copies the branch
  await panel(page).getByRole("button", { name: "Branch lineup" }).click();
  await expect(lineupName(page)).toHaveValue("Lineup 3");
  await expect(panel(page)).toContainText("Branched from No Devon.");
  await lineupName(page).fill("Rainy day");
  await expect(chart.getByRole("textbox", { name: "Starter at X" })).toHaveValue("Marcus Lee");
  await expect(chart.getByRole("textbox")).toHaveCount(1);
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

  // deleting asks once in place; the field falls back to the lineup it was branched from, and its own branches forget it
  await picker(page).selectOption({ label: "No Devon" });
  await panel(page).getByRole("button", { name: "Delete lineup" }).click();
  await expect(panel(page)).toContainText("Delete No Devon?");
  await panel(page).getByRole("button", { name: "Keep" }).click();
  await expect(picker(page).getByRole("option")).toHaveCount(3);
  await panel(page).getByRole("button", { name: "Delete lineup" }).click();
  await panel(page).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(picker(page).getByRole("option")).toHaveText(["Starting Lineup", "Rainy day"]);
  await expect(lineupName(page)).toHaveValue("Starting Lineup");
  await expect(d.caption("X")).toHaveText("Devon");
  await picker(page).selectOption({ label: "Rainy day" });
  await expect(panel(page)).not.toContainText("Branched from");
  await expect(d.caption("X")).toHaveText("Marcus Lee");
  const after = await storedLineups(page);
  expect(after?.lineups.map((l) => [l.name, l.from ?? null])).toEqual([["Starting Lineup", null], ["Rainy day", null]]);

  writeFileSync(`test-results/roster-${device}-lineups.json`, `${JSON.stringify({ stored, after }, null, 2)}\n`);
});

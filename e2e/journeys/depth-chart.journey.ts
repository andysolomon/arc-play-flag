import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Download, type Page, type TestInfo } from "@playwright/test";
import { DIAGNOSTICS_KEY } from "../../lib/diagnostics";
import type { Lineups, Roster } from "../../lib/play/types";
import { Designer, armSabotage, downloadBytes, sabotage } from "../support/designer";
import { OTTERS, SLANT_LEFT, seed, storedLineups } from "../support/fixtures";
import { latin, pdfPageCount, pdfWords } from "../support/pdf";
import { PINNED, pngSize } from "../support/pptx";

/**
 * The roster's own picture and sheet (docs/adr/010-roster-exports.md): from roster mode's panel a coach saves
 * the side on view of the lineup on the field as a picture, and the whole roster as a sheet to print. How it
 * could break, and the check for each:
 *
 * - the button saves nothing, or another kind of file → one download named for the team, the lineup and the
 *   side, a PNG by its signature, its header and its last chunk, at the picture's own size
 * - a blank or half-drawn picture → over 40 KB, and every name on the side's charts in the page it was drawn from
 * - the picture shows the wrong side or lineup → each side its own words and names, and none of the other's
 * - the sheet keeps only the starters, or loses a player → every name at every depth, every player with where
 *   they play ("No position" too), and the gaps to fill, in the PDF's own words, on Letter pages
 * - exporting writes the roster → the stored lineups the same before and after
 * - the same roster twice is a different file → with the clock pinned, byte for byte the same
 * - a phone that refuses the canvas → said in the panel, recorded, no download, and the buttons back
 * - an empty roster → a picture that says so, and a sheet that is a blank depth chart to fill in by hand
 *
 * Each test leaves `depth-chart-<device>-*` in `test-results/`: the pictures, the sheet, a picture of every
 * sheet page as drawn, and a manifest, uploaded as `depth-chart`.
 */

const panel = (page: Page) => page.locator("#route-sidebar");
const exportGroup = (page: Page) => panel(page).getByRole("group", { name: "Export roster" });
const pictureButton = (page: Page) => exportGroup(page).getByRole("button", { name: "Save roster picture" });
const sheetButton = (page: Page) => exportGroup(page).getByRole("button", { name: "Download roster sheet PDF" });
const news = (page: Page) => exportGroup(page).getByRole("status");
const FAILED = "That export failed. Try again on a bigger screen.";

/** The SHOW pills in the roster panel: which side of the roster is on the field. */
const show = (page: Page, which: "Offense" | "Defense" | "Both") =>
  panel(page).getByRole("radiogroup", { name: "Show" }).getByRole("radio", { name: which }).check();

const ROSTER: Roster = [
  { team: "offense", tag: "C", depth: ["Marcus Lee", "Owen"] },
  { team: "offense", tag: "QB", depth: ["Aaliyah Brooks-Washington"] },
  { team: "offense", tag: "X", depth: ["Devon", "Priya", "Jo", "Mateo", "Kenji", "Zoe", "Elijah", "Nia"] },
  { team: "offense", tag: "Y", depth: ["Sam", "Priya"] },
  { team: "defense", tag: "LC", depth: ["Jordan", "Devon"] },
  { team: "defense", tag: "LB", depth: ["Mateo", "Sam", "Owen"] },
  { team: "defense", tag: "R", depth: ["Kenji"] },
  { team: "defense", tag: "RC", depth: ["Zoe", "Nia"] },
  { team: "defense", tag: "S", depth: ["Priya", "Elijah", "Jo"] },
  { team: "defense", tag: "FS", depth: ["Elijah"] },
];
/** Riley is on the team and on no chart; Z has nobody; FS is a tag the formation has no token for. */
const TEAM = ["Aaliyah Brooks-Washington", "Devon", "Elijah", "Jo", "Jordan", "Kenji", "Marcus Lee", "Mateo", "Nia", "Owen", "Priya", "Riley", "Sam", "Zoe"];
const lineups = (slots: Roster): Lineups => ({ active: "main", lineups: [{ id: "main", name: "Starting Lineup", slots }], players: TEAM });
const names = (side: "offense" | "defense"): string[] => [...new Set(ROSTER.filter((s) => s.team === side).flatMap((s) => s.depth))].sort();
/** Players on one side's charts only: one of them on the other side's picture would be the wrong side. */
const only = (side: "offense" | "defense"): string[] => names(side).filter((n) => !names(side === "offense" ? "defense" : "offense").includes(n));

/** Records the markup of every SVG page the app rasterises, exactly as it draws it (as wristbands.journey.ts does). */
async function recordPages(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __ffpdPages?: string[] };
    const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
    // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call below
    const set = src?.set;
    if (!src || !set) return;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      ...src,
      set(this: HTMLImageElement, v: string) {
        if (v.startsWith("data:image/svg+xml")) (w.__ffpdPages ??= []).push(decodeURIComponent(v.slice(v.indexOf(",") + 1)));
        set.call(this, v);
      },
    });
  });
}
const forgetPages = (page: Page) => page.evaluate(() => { (window as unknown as { __ffpdPages?: string[] }).__ffpdPages = []; });
const recorded = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __ffpdPages?: string[] }).__ffpdPages ?? []);

/** Every word a recorded page draws, in order, a name wrapped at its hyphen joined back up. */
const words = (svg: string): string =>
  [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => (m[1] ?? "").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'")).join(" ").replace(/- /g, "-");

const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const out = (info: TestInfo, name: string): string => `test-results/depth-chart-${info.project.name}-${name}`;

/** Taps an export button and waits for its file and the panel's "Saved". */
async function grab(page: Page, button: ReturnType<typeof pictureButton>): Promise<{ file: Download; bytes: Buffer }> {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), button.click()]);
  await expect(news(page)).toHaveText("Saved", { timeout: 60_000 });
  await expect(button).toBeEnabled();
  return { file, bytes: await downloadBytes(file) };
}

/** A PNG by its signature, its IHDR and its IEND trailer, at its size; the file is kept first, so a failing run still leaves it. */
function expectPng(bytes: Buffer, file: string, size: { w: number; h: number }): void {
  writeFileSync(file, bytes);
  expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(pngSize(bytes)).toEqual(size);
  expect(bytes.subarray(-12).toString("hex")).toBe("0000000049454e44ae426082");
  expect(bytes.length, "the picture was really drawn").toBeGreaterThan(40_000);
}

async function enterRoster(page: Page, ls: Lineups): Promise<Designer> {
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS, lineups: ls });
  const d = new Designer(page);
  await d.openSaved(SLANT_LEFT.name);
  await d.roster();
  await d.rosterPanel();
  return d;
}

// the PDF stamps its date from the clock (lib/export/pdf.ts); pinning it and the zone makes both files repeatable
test.use({ timezoneId: PINNED.timezone });

test("a coach saves each side of the lineup as a picture and the whole roster as a sheet to print, the same roster twice is the same files, and nothing is written", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  mkdirSync("test-results", { recursive: true });
  await page.clock.setFixedTime(new Date(PINNED.clock));
  await recordPages(page);
  await enterRoster(page, lineups(ROSTER));
  const before = await storedLineups(page);

  // the export sits in the panel with what each one is, and says that the names go with it
  await expect(exportGroup(page).getByText("EXPORT", { exact: true })).toBeVisible();
  await expect(exportGroup(page)).toContainText("The picture is the offense of Starting Lineup as on the field");
  await expect(exportGroup(page)).toContainText("Both carry your players' names, the one way they leave this device.");

  // the side on view, the open play's: the offense
  const pictures: Record<string, { file: string; bytes: number; sha256: string; size: { w: number; h: number }; words: number }> = {};
  const sides = [
    {
      view: "Offense", file: "riverside-otters-starting-lineup-offense.png", size: { w: 1080, h: 1350 }, heading: "OFFENSE DEPTH CHART", has: names("offense"), not: only("defense"),
      gaps: "Unassigned: Z · No backup: QB · No position: Riley",
    },
    {
      view: "Defense", file: "riverside-otters-starting-lineup-defense.png", size: { w: 1080, h: 1350 }, heading: "DEFENSE DEPTH CHART", has: names("defense"), not: only("offense"),
      gaps: "No backup: R, FS · No position: Riley",
    },
    {
      view: "Both", file: "riverside-otters-starting-lineup-both.png", size: { w: 1080, h: 1920 }, heading: "OFFENSE AND DEFENSE DEPTH CHART", has: [...names("offense"), ...names("defense")], not: [],
      gaps: "Unassigned: Z · No backup: QB, R, FS · No position: Riley",
    },
  ] as const;
  const pngs: Buffer[] = [];
  for (const s of sides) {
    if (s.view !== "Offense") await show(page, s.view);
    await expect(exportGroup(page)).toContainText(`The picture is ${s.view === "Both" ? "both sides" : `the ${s.view.toLowerCase()}`} of Starting Lineup`);
    await forgetPages(page);
    const { file, bytes } = await grab(page, pictureButton(page));
    expect(file.suggestedFilename()).toBe(s.file);
    expectPng(bytes, out(info, `picture-${s.view.toLowerCase()}.png`), s.size);
    const [svg] = await recorded(page);
    const said = words(svg ?? "");
    expect(said).toContain("Riverside Otters");
    expect(said).toContain(s.heading);
    expect(said).toContain("Starting Lineup");
    for (const n of s.has) expect(said, `${n} is on the ${s.view} picture`).toContain(n);
    for (const n of s.not) expect(said, `${n} plays only on the other side`).not.toContain(n);
    if (s.view !== "Defense") expect(said, "nobody is down at Z").toContain("Unassigned");
    if (s.view !== "Offense") expect(said, "FS has a chart and no spot in the formation").toContain("NOT IN THIS FORMATION Positions with a depth chart and no spot in the formation.");
    expect(said, "the gaps on view, said to whoever is sent it").toContain(s.gaps);
    expect(said, "the day it was made").toContain("Riverside Otters · Starting Lineup · Sep 1, 2026");
    pngs.push(bytes);
    pictures[s.view.toLowerCase()] = { file: s.file, bytes: bytes.length, sha256: sha256(bytes), size: pngSize(bytes), words: said.split(" ").length };
  }
  expect(new Set(pngs.map((b) => sha256(b))).size, "each side is its own picture").toBe(3);

  // the sheet: both sides' boards with every chart whole, then the team against every position
  await forgetPages(page);
  const sheet = await grab(page, sheetButton(page));
  expect(sheet.file.suggestedFilename()).toBe("riverside-otters-starting-lineup-roster-sheet.pdf");
  writeFileSync(out(info, "sheet.pdf"), sheet.bytes);
  expect(latin(sheet.bytes.subarray(0, 5))).toBe("%PDF-");
  expect(latin(sheet.bytes)).toContain("/Title (Riverside Otters - Starting Lineup - roster sheet)");
  expect(pdfPageCount(sheet.bytes)).toBe(2);
  const pdf = pdfWords(sheet.bytes);
  expect(pdf.pages.map((p) => p.box)).toEqual([[0, 0, 612, 792], [0, 0, 612, 792]]);
  for (const p of pdf.pages) {
    for (const r of p.runs) {
      expect(r.invisible, `"${r.s}" is under the picture, not over it`).toBe(true);
      expect(r.x >= 0 && r.y >= 0 && r.x <= 612 && r.y <= 792, `"${r.s}" is on its page`).toBe(true);
    }
  }
  const board = pdf.pages[0]?.runs.map((r) => r.s).join(" ").replace(/- /g, "-") ?? "";
  const team = pdf.pages[1]?.runs.map((r) => r.s).join(" ") ?? "";
  for (const s of ROSTER) for (const n of s.depth) expect(board, `${n} on ${s.tag}'s chart is printed`).toContain(n);
  expect(board).toContain("DEFENSE");
  expect(board).toContain("OFFENSE");
  expect(board, "Z has lines to pencil a starter and backups in").toContain("Starter 2nd 3rd Z");
  expect(board, "and QB lines to pencil a backup in").toContain("Starter Aaliyah Brooks-Washington 2nd 3rd QB");
  expect(board).toContain("NOT IN THIS FORMATION Positions with a depth chart and no spot in the formation.");
  expect(board, "the day it was made").toContain("Riverside Otters · Starting Lineup · Sep 1, 2026 · page 1 of 2");
  for (const n of TEAM) expect(team, `${n} is on the team page`).toContain(n);
  expect(team).toContain("Who plays where");
  expect(team).toMatch(/Riley No position/);
  expect(team).toMatch(/Devon X starter, LC 2nd/);
  expect(team).toMatch(/GAPS TO FILL Unassigned Z No backup QB, R, FS No position Riley/);

  // reading the roster never writes it
  expect(await storedLineups(page), "exporting reads the roster, never writes it").toEqual(before);

  // the same roster twice: the same files, byte for byte
  const again = await grab(page, sheetButton(page));
  expect(sha256(again.bytes), "the sheet is repeatable").toBe(sha256(sheet.bytes));
  const sheetPages = (await recorded(page)).slice(0, pdf.pages.length);
  const both = await grab(page, pictureButton(page));
  expect(sha256(both.bytes), "the picture is repeatable").toBe(pictures.both?.sha256);

  const manifest = {
    device: info.project.name,
    browser: browser.version(),
    clock: PINNED.clock,
    timezone: PINNED.timezone,
    pictures,
    sheet: { file: sheet.file.suggestedFilename(), bytes: sheet.bytes.length, sha256: sha256(sheet.bytes), pages: pdf.pages.length, words: pdf.pages.map((p) => p.runs.length) },
  };
  writeFileSync(out(info, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await info.attach("depth-chart manifest", { path: out(info, "manifest.json"), contentType: "application/json" });
  // last: setContent leaves the app
  for (const [i, svg] of sheetPages.entries()) {
    await page.setContent(`<body style="margin:0">${svg}</body>`);
    await page.locator("svg").first().screenshot({ path: out(info, `sheet-page-${String(i + 1)}.png`) });
  }
});

test("the Secondary Lineup is saved as the field shows it, made from the starting lineup's charts, and says so", async ({ page }, info) => {
  test.setTimeout(120_000);
  mkdirSync("test-results", { recursive: true });
  await recordPages(page);
  await enterRoster(page, { ...lineups(ROSTER), active: "second" });
  await expect(exportGroup(page)).toContainText("The picture is the offense of Secondary Lineup");
  await forgetPages(page);
  const { file, bytes } = await grab(page, pictureButton(page));
  expect(file.suggestedFilename()).toBe("riverside-otters-secondary-lineup-offense.png");
  expectPng(bytes, out(info, "secondary-offense.png"), { w: 1080, h: 1350 });
  const said = words((await recorded(page))[0] ?? "");
  expect(said).toContain("Secondary Lineup");
  expect(said).toContain("Made from Starting Lineup's depth charts: at each position the next player up starts.");
  // the next player up starts, each card its chart and then its token: Jo at X (Priya, next up at both X and Y,
  // starts at Y) with Devon at the foot, Owen at C, and Aaliyah, alone at QB, keeps it
  expect(said).toContain("Starter Jo 2nd Priya 3rd Mateo 4th Kenji 5th Zoe 6th Elijah 7th Nia 8th Devon X");
  expect(said).toContain("Starter Priya 2nd Sam Y");
  expect(said).toContain("Starter Owen 2nd Marcus Lee C");
  expect(said).toContain("Starter Aaliyah Brooks-Washington 2nd No backup QB");
  writeFileSync(out(info, "secondary.json"), `${JSON.stringify({ device: info.project.name, file: file.suggestedFilename(), bytes: bytes.length, words: said }, null, 2)}\n`);
});

test("a picture or sheet the phone cannot draw is said in the panel and recorded, saves nothing, and the buttons come back", async ({ page }) => {
  test.setTimeout(120_000);
  await armSabotage(page);
  await enterRoster(page, lineups(ROSTER));
  const downloads: Download[] = [];
  page.on("download", (dl) => { downloads.push(dl); });
  await sabotage(page, "noCanvas", true);
  for (const button of [pictureButton(page), sheetButton(page)]) {
    await button.click();
    await expect(news(page)).toHaveText(FAILED, { timeout: 60_000 });
    await expect(button).toBeEnabled();
  }
  expect(downloads).toHaveLength(0);
  const failures = await page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key) ?? "[]") as { kind: string; message: string }[]).filter((d) => d.kind === "export" && d.message === "No canvas.").length,
    DIAGNOSTICS_KEY,
  );
  expect(failures).toBe(2);
  // said once, in the panel, where a phone's drawer can't cover it as it can the toast
  await expect(page.getByText(FAILED)).toHaveCount(1);
  await sabotage(page, "noCanvas", false);
  await grab(page, pictureButton(page));
  expect(downloads).toHaveLength(1);
});

test("an empty roster waits for a name before its picture, and its sheet is a blank depth chart to fill in by hand; a side with nobody on it says so", async ({ page }, info) => {
  test.setTimeout(120_000);
  mkdirSync("test-results", { recursive: true });
  await recordPages(page);
  await enterRoster(page, lineups([]));
  await expect(pictureButton(page)).toBeDisabled();
  await expect(exportGroup(page)).toContainText("The picture waits for a player on a depth chart.");

  const sheet = await grab(page, sheetButton(page));
  writeFileSync(out(info, "empty-sheet.pdf"), sheet.bytes);
  const pdf = pdfWords(sheet.bytes);
  const board = pdf.pages[0]?.runs.map((r) => r.s) ?? [];
  expect(board.filter((s) => s === "Starter"), "all ten positions with a line for a starter").toHaveLength(10);
  expect(board.filter((s) => s === "2nd"), "and one for a backup").toHaveLength(10);
  const team = pdf.pages[1]?.runs.map((r) => r.s).join(" ") ?? "";
  expect(team).toContain("GAPS TO FILL Every position is open: fill in the depth chart in pencil.");
  for (const n of TEAM) expect(team, `${n} is on the team page`).toContain(`${n} No position`);

  // a defense on the charts and nobody on the offense: the offense's picture says so to whoever is sent it
  await enterRoster(page, lineups(ROSTER.filter((s) => s.team === "defense")));
  await forgetPages(page);
  const picture = await grab(page, pictureButton(page));
  expect(picture.file.suggestedFilename()).toBe("riverside-otters-starting-lineup-offense.png");
  expectPng(picture.bytes, out(info, "empty-offense.png"), { w: 1080, h: 1350 });
  const said = words((await recorded(page))[0] ?? "");
  expect(said).toContain("Nobody is on this depth chart yet.");
  expect(said, "no word about the app on a picture sent to someone").not.toContain("Tap");
});

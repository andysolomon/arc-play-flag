import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { binderPages } from "../../lib/export/binder";
import { flyerPage } from "../../lib/export/flyer";
import type { Numbered } from "../../lib/export/numbered";
import { postcardPages } from "../../lib/export/postcard";
import { slidePlans } from "../../lib/export/slides";
import { BAND_PRESETS, wristbandPages } from "../../lib/export/wristband";
import type { SavedPlay, TeamSettings } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { OTTERS, play, playbook, seed, storedDraft } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * A run called with the ball in a no-run zone (issue #105): the palette used to offer every run on
 * the 5 without a word, draw it through the NO-RUN band and store it, and nothing on the field, the
 * play card or the printouts said so. Now the palette marks its runs there, and a play whose call
 * is a run is flagged everywhere it is shown. How this could break, and the check that catches each:
 *  - the palette's runs look the same on the 5 as on the 40                   → every run tile is hatched (really painted) and described by the note, on the 5 only
 *  - the flag misses a way a play becomes a run from a no-run zone            → a run picked, the read moved onto the runner, the ball moved onto the 5, the zones turned back on, a reload
 *  - the flag outlives the run                                                → a receiver added (play-action), the ball moved to the 10, the zones turned off
 *  - a legal play is flagged                                                  → play-action and an option on the 5, a run from midfield, a defensive call's shadow offense
 *                                                                               (whose runs the palette leaves plain)
 *  - the flag is drawn but nobody is told                                     → a notice each time it goes up, the Play tools caption, the diagram's description
 *  - the flag hides the play or is hidden                                     → it sits behind the line of scrimmage, inside the field and clear of the ▶ button
 *  - the flag stays in the designer                                           → the play card, the playbook list, the export preview, the share snapshot and its page,
 *                                                                               and every printout: binder one-up and four-up, wristbands, postcards, flyer, slide faces,
 *                                                                               alt text and speaker notes
 *  - a league without no-run zones is flagged                                 → every printout drawn for such a team carries no flag
 * Leaves `no-run-flag-<device>-designer.json` (each step's spot, zones, stamp, caption and notice, and
 * the palette read on and off the 5), `no-run-flag-<device>-pictures.json` (what every surface and
 * printout drew, with the flagged binder page's sha256), that page as SVG and PNG, and pictures of
 * the marked palette, the flagged field, the play card and the share page in test-results/.
 */

const STAMP = "RUN IN NO-RUN ZONE";
const WORDS = "Run in a no-run zone";
const NOTICE = "Flagged · run in a no-run zone";
const PALETTE_NOTE = "The ball is in a no-run zone: a run from here is flagged. A handoff or pitch that ends in a throw is a pass.";
const DEFAULT_NOTE = "Saved with this play. Yards count down to their goal line: every drive starts on the 40, midfield is the 20.";
const NO_RUN_NOTE = "Saved with this play. The ball is in a no-run zone, so no runs from here.";
const FLAGGED_NOTE = "Saved with this play. The ball is in a no-run zone and this play is a run, so it is flagged: make it a pass or move the ball.";
const RUNS = ["Handoff", "Dive", "Stretch", "Counter", "Reverse", "Delay", "Pitch"];

const flag = (l: Locator): Locator => l.locator("[data-no-run-flag]");
const losSelect = (page: Page): Locator => page.locator("#play-sidebar").getByRole("combobox", { name: "Line of scrimmage" });
const caption = (page: Page): Locator => page.locator("#play-sidebar").getByText(/^Saved with this play\./);
const zonesBox = (page: Page): Locator => page.locator("#play-sidebar").getByRole("checkbox", { name: "No-run zones" });
const sha = (s: string): string => createHash("sha256").update(s).digest("hex");

interface PaletteRead {
  runs: { label: string; hatched: boolean; painted: boolean; note: string | null }[];
  /** pass routes marked like a run: never */
  markedRoutes: number;
}

/** The open palette's run tiles: marked, really painted with the band's hatching, and what they are described by. */
async function palette(page: Page): Promise<PaletteRead> {
  return page.locator("#route-sidebar").evaluate((aside) => {
    const tiles = (group: string) => [...aside.querySelectorAll<HTMLElement>(`[role='group'][aria-label='${group}'] button`)];
    return {
      runs: tiles("Runs").filter((b) => (b.textContent ?? "").trim() !== "Done").map((b) => {
        const id = b.getAttribute("aria-describedby");
        return {
          label: (b.textContent ?? "").trim(),
          hatched: b.dataset.hatched === "true",
          painted: getComputedStyle(b).backgroundImage.includes("repeating-linear-gradient"),
          note: id ? (document.getElementById(id)?.textContent ?? null) : null,
        };
      }),
      markedRoutes: tiles("Routes").filter((b) => b.dataset.hatched === "true" || getComputedStyle(b).backgroundImage !== "none").length,
    };
  });
}

interface FlagRead {
  text: string;
  /** below the line of scrimmage, in the backfield, so it never sits on the routes downfield */
  behindLos: boolean;
  inside: boolean;
  corner: "left" | "right";
  clearOfPlayButton: boolean;
}

/** The live field's flag, read off its markup and where it lands on screen; null with none. */
async function liveFlag(field: Locator): Promise<FlagRead | null> {
  return field.evaluate((svg) => {
    const g = svg.querySelector("[data-no-run-flag]");
    const rect = g?.querySelector("rect");
    if (!g || !rect) return null;
    const n = (a: string): number => Number(rect.getAttribute(a));
    const vh = Number((svg.getAttribute("viewBox") ?? "").split(" ")[3]);
    const los = [...svg.querySelectorAll('line[x1="0"][x2="660"]')].find((l) => l.getAttribute("stroke-width") === "4.5");
    const r = rect.getBoundingClientRect();
    const b = document.querySelector("button[aria-label='Run the play']")?.getBoundingClientRect();
    return {
      text: g.textContent ?? "",
      behindLos: n("y") > Number(los?.getAttribute("y1")),
      inside: n("x") >= 0 && n("y") >= 0 && n("x") + n("width") <= 660 && n("y") + n("height") <= vh,
      corner: n("x") + n("width") / 2 < 330 ? "left" : "right",
      clearOfPlayButton: !b || r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom,
    };
  });
}

test("a run picked with the ball on the 5 is flagged as it is drawn, and every way a play becomes one, or stops being one, moves the flag", async ({ page }, testInfo) => {
  const out = `test-results/no-run-flag-${testInfo.project.name}`;
  const d = new Designer(page);
  const steps: { step: string; los: string; zones: boolean; stamp: string | null; caption: string; notice: string | null }[] = [];
  /** What the coach sees now: the field's flag, the caption under the spot and, when one went up, the notice. */
  const look = async (step: string, notice: string | null, stamp: string | null, note: string): Promise<void> => {
    if (notice) await expect(d.toast).toHaveText(notice);
    if (stamp) await expect(flag(d.field)).toHaveText(stamp);
    else await expect(flag(d.field)).toHaveCount(0);
    await d.tools();
    await expect(caption(page)).toHaveText(note);
    steps.push({ step, los: await losSelect(page).inputValue(), zones: await zonesBox(page).isChecked(), stamp, caption: note, notice });
  };

  // the issue's repro: a new offensive play, the ball on the 5, Z on a stretch
  await d.goto();
  await d.newPlay("Offense");
  await look("new play on the 40", null, null, DEFAULT_NOTE);
  await losSelect(page).selectOption("35");
  await look("ball on the 5, nothing drawn", null, null, NO_RUN_NOTE);

  await d.select("Z");
  const onThe5 = await palette(page);
  expect(onThe5).toEqual({ runs: RUNS.map((label) => ({ label, hatched: true, painted: true, note: PALETTE_NOTE })), markedRoutes: 0 });
  await page.locator("#route-sidebar").screenshot({ path: `${out}-palette.png` });

  await d.pick("Stretch");
  await look("Z on a stretch", NOTICE, STAMP, FLAGGED_NOTE);
  // drawn and stored as the coach asked: the flag warns, it never refuses the run
  await expect.poll(async () => {
    const draft = await storedDraft(page);
    return { los: draft?.los, z: draft?.players.find((p) => p.id === "o5")?.route };
  }).toEqual({ los: 35, z: { type: "stretch" } });
  await expect(d.field.locator("desc")).toContainText(`${WORDS}: the ball is in a no-run zone and this play is a run.`);
  await d.closeSidebars();
  const onField = await liveFlag(d.field);
  expect(onField).toEqual({ text: STAMP, behindLos: true, inside: true, corner: "left", clearOfPlayButton: true });
  await d.field.screenshot({ path: `${out}-field.png` });

  // a receiver beside the runner makes it play-action: the ball is thrown, so no flag
  await d.select("X");
  await d.pick("Slant");
  await look("X on a slant: play-action", null, null, NO_RUN_NOTE);
  // the read moved onto the runner makes it a run again
  await d.select("Z");
  await d.primaryButton.click();
  await look("Z made the primary read: a run", NOTICE, STAMP, FLAGGED_NOTE);

  // the ball moved off the 5 and back onto it after the run was drawn
  await d.tools();
  await losSelect(page).selectOption("30");
  await look("ball moved to the 10", null, null, DEFAULT_NOTE);
  await losSelect(page).selectOption("35");
  await look("ball moved back onto the 5", NOTICE, STAMP, FLAGGED_NOTE);

  // a league without the zones: no flag and no marked runs, until they are back
  await zonesBox(page).uncheck();
  await look("no-run zones off", null, null, DEFAULT_NOTE);
  await d.select("Z");
  const zonesOff = await palette(page);
  expect(zonesOff).toEqual({ runs: RUNS.map((label) => ({ label, hatched: false, painted: false, note: null })), markedRoutes: 0 });
  await d.tools();
  await zonesBox(page).check();
  await look("no-run zones back on", NOTICE, STAMP, FLAGGED_NOTE);

  // a reload opens the draft flagged, and says so
  await page.reload();
  await expect(d.field).toBeVisible();
  await look("reloaded", NOTICE, STAMP, FLAGGED_NOTE);

  // off the zone the runs are plain again
  await losSelect(page).selectOption("0");
  await d.select("Z");
  const onThe40 = await palette(page);
  expect(onThe40).toEqual(zonesOff);

  const manifest = { project: testInfo.project.name, palette: { onThe5, zonesOff, onThe40 }, liveFlag: onField, steps };
  expect(steps.map((s) => [s.step, s.los, s.zones, s.stamp !== null, s.notice !== null])).toEqual([
    ["new play on the 40", "0", true, false, false],
    ["ball on the 5, nothing drawn", "35", true, false, false],
    ["Z on a stretch", "35", true, true, true],
    ["X on a slant: play-action", "35", true, false, false],
    ["Z made the primary read: a run", "35", true, true, true],
    ["ball moved to the 10", "30", true, false, false],
    ["ball moved back onto the 5", "35", true, true, true],
    ["no-run zones off", "35", false, false, false],
    ["no-run zones back on", "35", true, true, true],
    ["reloaded", "35", true, true, true],
  ]);
  writeFileSync(`${out}-designer.json`, `${JSON.stringify(manifest, null, 2)}\n`);
});

// the book: one run on the 5 (flagged) beside every play the rule must leave alone
const GOAL_LINE_STRETCH: SavedPlay = { ...play("fx-goal-line-stretch", "Otter Goal Line Stretch", { o5: { type: "stretch" } }, "Z follows the C."), los: 35 };
const GOAL_LINE_FAKE: SavedPlay = { ...play("fx-goal-line-fake", "Otter Goal Line Fake", { o5: { type: "dive" }, o3: { type: "post", primary: true }, o4: { type: "corner" } }), los: 35 };
const GOAL_LINE_OPTION: SavedPlay = { ...play("fx-goal-line-option", "Otter Goal Line Option", { o5: { type: "pitch" }, o4: { type: "corner" } }), los: 35 };
const GOAL_LINE_D: SavedPlay = {
  ...play("fx-goal-line-d", "Otter Goal Line D", { o5: { type: "handoff", primary: true }, d1: { type: "zoneDeep" }, d4: { type: "zoneDeep" } }, "", "defense"),
  los: 35,
  artShadow: true,
};
const MIDFIELD_STRETCH: SavedPlay = { ...play("fx-midfield-stretch", "Otter Midfield Stretch", { o5: { type: "stretch" } }), los: 20 };
const PLAYS = [GOAL_LINE_STRETCH, GOAL_LINE_FAKE, GOAL_LINE_OPTION, GOAL_LINE_D, MIDFIELD_STRETCH];
const BOOK = playbook("fx-goal-line-book", "Otter Goal Line Book", PLAYS);
const FLAGGED = [true, false, false, false, false];

/** The flags a printout drew, and where each sits in its field: inside the art and behind the line of scrimmage. */
function flags(svg: string): { count: number; placed: boolean[] } {
  const art = [...svg.matchAll(/viewBox="0 0 660 (\d+)"[^>]*>((?:(?!<\/svg>)[\s\S])*)<\/svg>/g)];
  const placed = art.flatMap(([, vh, body]) => {
    const m = /data-no-run-flag=""[^>]*><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/.exec(body ?? "");
    if (!m) return [];
    const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
    const losY = Number(/<line x1="0" y1="([\d.]+)" x2="660" y2="[\d.]+" stroke="#1b1a17" stroke-width="4.5"/.exec(body ?? "")?.[1]);
    return [x >= 0 && y > losY && x + w <= 660 && y + h <= Number(vh)];
  });
  return { count: svg.match(/data-no-run-flag=/g)?.length ?? 0, placed };
}

test("a flagged play carries its flag onto its card, the playbook, the share link and every printout, and no legal play ever does", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const out = `test-results/no-run-flag-${testInfo.project.name}`;
  await seed(page, { plays: PLAYS, playbooks: [BOOK], team: OTTERS });

  // the gallery: the card says it in words, the thumbnail wears the stamp, and its name says both
  await page.goto("/playbooks");
  const gallery: { name: string; chip: boolean; stamp: boolean; label: string }[] = [];
  for (const p of PLAYS) {
    const card = page.getByRole("link", { name: `Open ${p.name} in the designer` }).locator("xpath=..");
    const thumb = card.getByRole("img").first();
    await expect(thumb).toBeVisible();
    gallery.push({
      name: p.name,
      chip: (await card.getByText(WORDS, { exact: true }).count()) === 1,
      stamp: (await flag(thumb).count()) === 1,
      label: (await thumb.getAttribute("aria-label")) ?? "",
    });
  }
  expect(gallery.map((g) => [g.chip, g.stamp])).toEqual(FLAGGED.map((f) => [f, f]));
  expect(gallery[0]?.label).toBe(`${GOAL_LINE_STRETCH.name}, run in a no-run zone`);
  await page.getByRole("link", { name: `Open ${GOAL_LINE_STRETCH.name} in the designer` }).locator("xpath=..").screenshot({ path: `${out}-card.png` });

  // the playbook, where a coach checks the book before printing it, and its export preview (the first play)
  await page.goto(`/playbooks?book=${BOOK.id}`);
  const preview = page.getByRole("img", { name: "Playbook PDF preview" });
  await expect(preview).toBeVisible();
  const rows = page.locator("ol > li");
  await expect(rows).toHaveCount(PLAYS.length);
  const editor = await rows.evaluateAll((lis, words) => lis.map((li) => [...li.querySelectorAll("span")].some((s) => s.textContent === words)), WORDS);
  expect(editor).toEqual(FLAGGED);
  await expect(flag(preview)).toHaveText(STAMP);

  // every printout, drawn by the same code the export buttons run
  const items: Numbered[] = PLAYS.map((p, i) => ({ n: i + 1, play: p }));
  const base = { paper: "letter" as const, bookName: BOOK.name };
  const printouts = (team: TeamSettings) => {
    const deck = slidePlans(items, { bookName: BOOK.name, team });
    return {
      binder: binderPages(items, { ...base, team, layout: "one" }).map((p) => flags(p.svg)),
      binderFourUp: flags(binderPages(items, { ...base, team, layout: "four" }).map((p) => p.svg).join("")),
      wristbands: flags(wristbandPages(items, { ...base, team, size: BAND_PRESETS[0] ?? { w: 4.5, h: 2.25, rows: 2, cols: 3 } }).map((p) => p.svg).join("")),
      postcards: flags(postcardPages(items, { ...base, team, size: "twoUp" }).map((p) => p.svg).join("")),
      flyer: flags(flyerPage([...items, null], { ...base, team }).svg),
      // the title slide, the glance slide, then one per play
      slideFaces: deck.slides.map((s) => flags(s.page.svg).count),
      slideAlt: deck.slides.slice(2).map((s) => s.alt.split("\n").includes("Flagged: run in a no-run zone.")),
      slideNotes: deck.slides.slice(2).map((s) => s.notes.split("\n\n").includes("Flagged: run in a no-run zone.")),
    };
  };
  const printed = printouts(OTTERS);
  const placed = (n: number) => ({ count: n, placed: Array.from({ length: n }, () => true) });
  expect(printed).toEqual({
    binder: FLAGGED.map((f) => placed(f ? 1 : 0)),
    binderFourUp: placed(1),
    // one insert for each position (C, X, Y, Z) and one for everyone, each carrying the whole book
    wristbands: placed(5),
    postcards: placed(1),
    flyer: placed(1),
    slideFaces: [0, 1, 1, 0, 0, 0, 0],
    slideAlt: FLAGGED,
    slideNotes: FLAGGED,
  });
  // a league without the zones prints no flag anywhere
  const withoutZones = printouts({ ...OTTERS, noRunZones: false });
  expect(withoutZones).toEqual({
    binder: FLAGGED.map(() => placed(0)),
    binderFourUp: placed(0),
    wristbands: placed(0),
    postcards: placed(0),
    flyer: placed(0),
    slideFaces: [0, 0, 0, 0, 0, 0, 0],
    slideAlt: FLAGGED.map(() => false),
    slideNotes: FLAGGED.map(() => false),
  });
  // the flagged binder page as markup, and as the picture a printer gets; the same book drawn again is the same page
  const binderPage = binderPages(items.slice(0, 1), { ...base, team: OTTERS, layout: "one" })[0]?.svg ?? "";
  const stable = (svg: string): string => svg.replace(/\bc\d+\b/g, "c");
  const binderSha256 = sha(stable(binderPage));
  expect(sha(stable(binderPages(items.slice(0, 1), { ...base, team: OTTERS, layout: "one" })[0]?.svg ?? ""))).toBe(binderSha256);
  writeFileSync(`${out}-binder.svg`, binderPage);

  // the share snapshot and the page its link opens, from the designer
  const d = new Designer(page);
  await d.goto(`?open=${GOAL_LINE_STRETCH.id}`);
  await expect(d.toast).toHaveText(NOTICE);
  await expect(flag(d.field)).toHaveText(STAMP);
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(flag(dialog.getByRole("img", { name: "Offense snapshot preview" }))).toHaveText(STAMP);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  await page.goto(await page.evaluate(() => navigator.clipboard.readText()));
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared).toBeVisible();
  await expect(flag(shared)).toHaveText(STAMP);
  await expect(shared.locator("desc")).toContainText(WORDS);
  const sharePage = await liveFlag(shared);
  expect(sharePage).toEqual({ text: STAMP, behindLos: true, inside: true, corner: "left", clearOfPlayButton: true });
  await shared.screenshot({ path: `${out}-share.png` });

  // a defensive call on the 5, its shadow offense running, is never flagged in the designer either,
  // and its palette leaves the shadow offense's runs plain, since nothing on the call will be flagged
  await d.goto(`?open=${GOAL_LINE_D.id}`);
  await expect(page.getByRole("heading", { name: GOAL_LINE_D.name })).toBeVisible();
  await expect(flag(d.field)).toHaveCount(0);
  await d.select("Z");
  const defensePalette = await palette(page);
  expect(defensePalette).toEqual({ runs: RUNS.map((label) => ({ label, hatched: false, painted: false, note: null })), markedRoutes: 0 });

  await page.setContent(`<body style="margin:0">${binderPage}</body>`);
  await page.locator("svg").first().screenshot({ path: `${out}-binder.png` });

  const manifest = { project: testInfo.project.name, gallery, editor, printouts: printed, withoutZones, binderSha256, sharePage, defensePalette };
  writeFileSync(`${out}-pictures.json`, `${JSON.stringify(manifest, null, 2)}\n`);
});

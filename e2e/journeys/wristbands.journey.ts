import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { SavedPlay } from "../../lib/play/types";
import { Designer, downloadBytes } from "../support/designer";
import { COVER_ONE_D, OTTERS, SLANT_LEFT, WHEEL_RIGHT, ZONE_D, moved, playbook, seed, storedPlays } from "../support/fixtures";

/**
 * Wristbands follow each play's own side (issue #104). A defensive book prints one insert per
 * defender, titled with that defender's tag and with their coverage bold, never the offense's
 * C, X, Y and Z; a book with both sides bolds, on each play, the player of that play's side.
 * Every page the app hands the rasteriser is recorded as it goes into the PDF, and read back:
 * each insert's title, and in each of its cells who is ringed and which assignments are drawn
 * bold or faded. Each test leaves the PDF, a picture of every page and a manifest
 * (test-results/wristbands-*), asserted equal to the literal below before it is written.
 */

const toast = (page: Page) => page.locator("div[role='status']");
const blurb = (page: Page) => page.getByLabel("Export playbook").getByText(/^One insert per/);

/** Records the markup of every SVG page the app rasterises, exactly as it draws it. */
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

/** One play on an insert: who is ringed, and how many assignments (routes and man tags) are drawn full or faded. */
interface Cell {
  n: number;
  name: string;
  bold: string[];
  drawn: { offense: number; defense: number };
  full: number;
  faded: number;
}
interface Insert {
  caption: string;
  cells: Cell[];
}

/** Reads the recorded wristband pages back: every insert in order, and every cell on it. */
async function readInserts(page: Page): Promise<{ pages: string[]; inserts: Insert[] }> {
  return page.evaluate(() => {
    const MUTED = "#6f6c66", OFFENSE = "#e5675e", DEFENSE = "#4a8fe0", RING = "#f2b705";
    const pages = ((window as unknown as { __ffpdPages?: string[] }).__ffpdPages ?? []).filter((s) => s.includes(" · wristbands</text>"));
    const inserts: Insert[] = [];
    for (const markup of pages) {
      const root = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
      let card: Insert | null = null;
      let cell: Cell | null = null;
      for (const el of Array.from(root.children)) {
        if (el.tagName === "text" && el.getAttribute("fill") === MUTED && el.getAttribute("font-size") === "8") {
          card = { caption: el.textContent, cells: [] };
          inserts.push(card);
        } else if (card && el.tagName === "text" && el.getAttribute("dominant-baseline") === "central") {
          // the play's number badge starts a cell; its name follows
          cell = { n: Number(el.textContent), name: "", bold: [], drawn: { offense: 0, defense: 0 }, full: 0, faded: 0 };
          card.cells.push(cell);
        } else if (cell && el.tagName === "text" && !el.getAttribute("fill")) {
          cell.name = el.textContent;
        } else if (cell && el.tagName === "g" && el.hasAttribute("clip-path")) {
          const art = el.querySelector("svg");
          if (!art) continue;
          for (const token of Array.from(art.children).filter((g) => g.querySelector(':scope > circle[r="23"]'))) {
            const fill = token.querySelector(':scope > circle[r="23"]')?.getAttribute("fill");
            const team = fill === OFFENSE ? "offense" : fill === DEFENSE ? "defense" : "?";
            if (team !== "?") cell.drawn[team]++;
            if (token.querySelector(`:scope > circle[r="33"][stroke="${RING}"]`)) cell.bold.push(`${team} ${token.querySelector("text")?.textContent ?? "(no tag)"}`);
          }
          // a route sits in its own group, a man tag in one marked data-man-tag; either is faded by its opacity
          const marks = Array.from(art.children).filter((g) => g.querySelector(':scope > path[stroke-linecap="round"]') || g.hasAttribute("data-man-tag"));
          for (const g of marks) {
            if (Number(g.getAttribute("opacity") ?? "1") < 0.3) cell.faded++;
            else cell.full++;
          }
          cell = null;
        }
      }
    }
    return { pages, inserts };
  });
}

interface Printed {
  inserts: Insert[];
  pages: string[];
  pdf: Buffer;
  pdfPages: number;
}

/** Downloads the book's wristbands and reads back what was printed. */
async function downloadWristbands(page: Page, filename: string): Promise<Printed> {
  await page.evaluate(() => { (window as unknown as { __ffpdPages?: string[] }).__ffpdPages = []; });
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 60_000 }),
    page.getByRole("button", { name: "Download wristbands PDF" }).click(),
  ]);
  await expect(toast(page)).toHaveText("Saved", { timeout: 60_000 });
  expect(file.suggestedFilename()).toBe(filename);
  const pdf = await downloadBytes(file);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const count = /\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(pdf.toString("latin1"))?.[1];
  const { pages, inserts } = await readInserts(page);
  return { pages, inserts, pdf, pdfPages: Number(count) };
}

/** Keeps the PDF, a picture of each page and the manifest in test-results/. */
async function keep(page: Page, out: string, printed: Printed, extra: Record<string, unknown>): Promise<void> {
  writeFileSync(`${out}.pdf`, printed.pdf);
  for (const [i, svg] of printed.pages.entries()) {
    await page.setContent(`<body style="margin:0">${svg}</body>`);
    await page.locator("svg").first().screenshot({ path: `${out}-page-${String(i + 1)}.png` });
  }
  const manifest = {
    ...extra,
    pdf: { bytes: printed.pdf.length, sha256: createHash("sha256").update(printed.pdf).digest("hex"), pages: printed.pdfPages },
    inserts: printed.inserts,
  };
  writeFileSync(`${out}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
}

/** A cell as the literal expects it. */
const cell = (n: number, name: string, bold: string | null, full: number, faded: number, drawn: Cell["drawn"]): Cell =>
  ({ n, name, bold: bold ? [bold] : [], drawn, full, faded });
const DEFENSE_ONLY = { offense: 0, defense: 5 };
const OFFENSE_ONLY = { offense: 5, defense: 0 };
/** Three inserts to a letter page at the youth slim size. */
const pagesFor = (inserts: number) => Math.ceil(inserts / 3);

test("a defensive book drawn in the designer prints one insert per defender, each with that defender's coverage bold", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await recordPages(page);
  const d = new Designer(page);
  await d.goto();

  // two calls drawn the way the coach-workflow review drew them: New play, Defense, a job for every defender
  const calls = [
    { name: "Otter Two Deep Zone", jobs: [["LC", "Zone flat"], ["LB", "Curl-flat"], ["R", "Blitz"], ["RC", "Zone flat"], ["S", "Zone deep"]] },
    { name: "Otter Three Deep", jobs: [["LC", "Zone deep"], ["LB", "Mid-read"], ["R", "Spy"], ["RC", "Zone deep"], ["S", "Zone deep"]] },
  ] as const;
  for (const call of calls) {
    await d.newPlay("Defense");
    await d.setName(call.name);
    for (const [tag, job] of call.jobs) {
      // every defender comes with a tag, in the tag field like the offense's
      await d.select(tag, "Defense");
      await expect(page.getByRole("textbox", { name: "Player tag" })).toHaveValue(tag);
      await d.pick(job);
    }
    await d.save();
    await expect(d.toast).toHaveText("Saved");
  }
  const stored = Object.values(await storedPlays(page)).sort((a, b) => a.name.localeCompare(b.name));
  expect(stored.map((p) => [p.name, p.side, p.players.filter((q) => q.team === "defense").map((q) => q.label)])).toEqual([
    ["Otter Three Deep", "defense", ["LC", "LB", "R", "RC", "S"]],
    ["Otter Two Deep Zone", "defense", ["LC", "LB", "R", "RC", "S"]],
  ]);

  await page.goto("/playbooks");
  await page.getByRole("button", { name: "+ New playbook" }).click();
  await page.getByRole("textbox", { name: "Playbook name" }).fill("Otter Defense");
  await page.getByRole("button", { name: "+ Add plays" }).click();
  const picker = page.getByRole("dialog", { name: "Add plays to “Otter Defense”" });
  for (const call of calls) await picker.getByTitle(`Add ${call.name}`).click();
  await picker.getByRole("button", { name: "Done" }).click();
  await expect(picker).toBeHidden();

  await expect(blurb(page)).toHaveText("One insert per defender with their coverage bold, plus one for the coach.");
  await expect(page.getByText(/print only on the Everyone insert/)).toHaveCount(0);
  const printed = await downloadWristbands(page, "otter-defense-wristbands.pdf");

  // five defenders and the coach's insert, never the offense's C, X, Y and Z; on each, that defender's job alone at full strength
  const inserts = (["LC", "LB", "R", "RC", "S", null] as const).map((tag) => ({
    caption: `${tag ?? "Everyone"} · Otter Defense`,
    cells: calls.map((c, i) => (tag ? cell(i + 1, c.name, `defense ${tag}`, 1, 4, DEFENSE_ONLY) : cell(i + 1, c.name, null, 5, 0, DEFENSE_ONLY))),
  }));
  expect(printed.inserts).toEqual(inserts);
  expect(printed.pages).toHaveLength(pagesFor(inserts.length));
  expect(printed.pdfPages).toBe(printed.pages.length);
  await keep(page, `test-results/wristbands-${testInfo.project.name}-defense`, printed, { device: testInfo.project.name, book: "Otter Defense" });
});

test("an offensive book keeps its inserts, and a two-way book bolds each play's own player", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await recordPages(page);
  // the coach tags the left corner C, as the offense tags its centre
  const coverOneC: SavedPlay = { ...moved(COVER_ONE_D, { d1: { label: "C" } }), id: "fx-cover-one-c", name: "Otter Cover One C" };
  // a call saved before defenders came with tags
  const oldZone: SavedPlay = {
    ...ZONE_D, id: "fx-old-zone", name: "Otter Old Zone",
    players: ZONE_D.players.map((p) => (p.team === "defense" ? { ...p, label: "" } : p)),
  };
  const offense = playbook("fx-offense", "Otter Offense", [SLANT_LEFT, WHEEL_RIGHT]);
  const twoWay = playbook("fx-two-way", "Otter Two-Way", [SLANT_LEFT, coverOneC, oldZone]);
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, coverOneC, oldZone], playbooks: [offense, twoWay], team: OTTERS });

  // an offensive book prints as it always has: one insert per receiver and the centre, the quarterback on Everyone's
  await page.goto("/playbooks?book=fx-offense");
  await expect(blurb(page)).toHaveText("One insert per position with that route bold, plus one for the quarterback and coach.");
  await expect(page.getByText(/print only on the Everyone insert/)).toHaveCount(0);
  const offensive = await downloadWristbands(page, "otter-offense-wristbands.pdf");
  const slant = (bold: string | null, full: number, faded: number) => cell(1, "Otter Slant Left", bold, full, faded, OFFENSE_ONLY);
  const wheel = (bold: string | null, full: number, faded: number) => cell(2, "Otter Wheel Right", bold, full, faded, OFFENSE_ONLY);
  const offenseInserts: Insert[] = [
    { caption: "C · Otter Offense", cells: [slant("offense C", 0, 2), wheel("offense C", 0, 2)] },
    { caption: "X · Otter Offense", cells: [slant("offense X", 1, 1), wheel("offense X", 0, 2)] },
    { caption: "Y · Otter Offense", cells: [slant("offense Y", 1, 1), wheel("offense Y", 1, 1)] },
    { caption: "Z · Otter Offense", cells: [slant("offense Z", 0, 2), wheel("offense Z", 1, 1)] },
    { caption: "Everyone · Otter Offense", cells: [slant(null, 2, 0), wheel(null, 2, 0)] },
  ];
  expect(offensive.inserts).toEqual(offenseInserts);
  expect(offensive.pages).toHaveLength(pagesFor(offenseInserts.length));
  expect(offensive.pdfPages).toBe(offensive.pages.length);

  // a two-way book: each play bolds the player of its own side; a tag both sides use says whose it is;
  // the untagged call is plain on every insert, and the panel says how to give it inserts
  await page.goto("/playbooks?book=fx-two-way");
  await expect(blurb(page)).toHaveText("One insert per position with that route or coverage bold, plus one for the quarterback and coach.");
  await expect(page.getByText("Players without a tag on play 3 print only on the Everyone insert. Tap a player in the designer to tag them.")).toBeVisible();
  const twoWayPrinted = await downloadWristbands(page, "otter-two-way-wristbands.pdf");
  // Cover One: two routes (the safety's zone, the blitz) and three man tags ("on X", "on C", "on Y")
  const plainSlant = cell(1, "Otter Slant Left", null, 2, 0, OFFENSE_ONLY);
  const coverOne = (bold: string | null) => cell(2, "Otter Cover One C", bold, bold ? 1 : 5, bold ? 4 : 0, DEFENSE_ONLY);
  const old = cell(3, "Otter Old Zone", null, 5, 0, DEFENSE_ONLY);
  const receiver = (title: string, tag: string, full: number, faded: number): Insert => ({
    caption: `${title} · Otter Two-Way`, cells: [cell(1, "Otter Slant Left", `offense ${tag}`, full, faded, OFFENSE_ONLY), coverOne(null), old],
  });
  const defender = (title: string, tag: string): Insert => ({ caption: `${title} · Otter Two-Way`, cells: [plainSlant, coverOne(`defense ${tag}`), old] });
  const twoWayInserts: Insert[] = [
    receiver("C (offense)", "C", 0, 2),
    receiver("X", "X", 1, 1),
    receiver("Y", "Y", 1, 1),
    receiver("Z", "Z", 0, 2),
    defender("C (defense)", "C"),
    defender("LB", "LB"),
    defender("R", "R"),
    defender("RC", "RC"),
    defender("S", "S"),
    { caption: "Everyone · Otter Two-Way", cells: [plainSlant, coverOne(null), old] },
  ];
  expect(twoWayPrinted.inserts).toEqual(twoWayInserts);
  expect(twoWayPrinted.pages).toHaveLength(pagesFor(twoWayInserts.length));
  expect(twoWayPrinted.pdfPages).toBe(twoWayPrinted.pages.length);

  await keep(page, `test-results/wristbands-${testInfo.project.name}-offense`, offensive, { device: testInfo.project.name, book: "Otter Offense" });
  await keep(page, `test-results/wristbands-${testInfo.project.name}-two-way`, twoWayPrinted, { device: testInfo.project.name, book: "Otter Two-Way" });
});

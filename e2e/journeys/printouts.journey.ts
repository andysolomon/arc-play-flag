import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { downloadBytes } from "../support/designer";
import { COVER_TWO, FAKE_DIVE, OTTERS, SLANT_LEFT, WHEEL_RIGHT, ZONE_D, playbook, seed } from "../support/fixtures";
import { latin, pdfWords } from "../support/pdf";
import { forgetPages, recordPages, recorded } from "../support/record";

/**
 * What the binder, the postcards and the flyer say. Each printout is read back from the PDF a coach
 * downloads, with the independent reader in support/pdf.ts (the words under each page's picture),
 * and the read's star, which the PDF's words leave out, from the pages the app drew.
 * How a printout could go wrong, and the check that catches each:
 *  - a play deleted from the library leaves a gap or a blank page → one page per play left, numbered 1 to 5
 *  - pages come out of the book's order                         → each page names the next play, after its number
 *  - the one-up binder loses the call, the routes or the read   → the first page has "Play-action", Post, Curl, Dive and ★
 *  - a page draws the other team                                → a defensive call has its defenders' tags and no QB;
 *                                                                   an offensive call with defensive routes has no defender's
 *  - the four-up or the flyer turns detailed                    → no route name, call or ★ on them
 *  - postcard backs fall out of step with their fronts          → fronts then backs, the same two plays a sheet; each back
 *                                                                   has its play's coaching points and a line for the player
 *  - the flyer ignores the coach's picks                        → the plays in slot order, the emptied slot skipped
 *  - a printout drops the team, the book or the app's mark      → every page names them
 * Each test leaves its PDFs and the words read from them in test-results/printouts-<device>-*.
 */

const MARK = "Flag Football Play Designer · arc-play-flag.vercel.app";
const WHO = "Riverside Otters · Otter Print Book";
const ROUTES = ["Post", "Curl", "Dive", "Wheel", "Corner", "Slant", "Out", "Go", "Zone flat", "Curl-flat", "Mid-read", "Zone deep"];
const CALLS = ["Run", "Pass", "Play-action"];
const ORDER = [FAKE_DIVE, ZONE_D, WHEEL_RIGHT, SLANT_LEFT, COVER_TWO];
// the second play in the book was deleted from the library after it went in
const BOOK = { ...playbook("fx-print", "Otter Print Book", []), plays: [FAKE_DIVE.id, "fx-deleted", ...ORDER.slice(1).map((p) => p.id)] };

interface Printout { name: string; pages: string[][]; drawn: string[] }

async function open(page: Page): Promise<void> {
  await recordPages(page);
  await seed(page, { plays: ORDER, playbooks: [BOOK], team: OTTERS });
  await page.goto("/playbooks?book=fx-print");
  await page.getByRole("combobox", { name: "Paper size" }).selectOption("letter");
}

/** Downloads one printout, reads back every page's words, and keeps the PDF and its words in test-results/. */
async function grab(page: Page, button: string, file: string, device: string): Promise<Printout> {
  await forgetPages(page);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 90_000 }), page.getByRole("button", { name: button }).click()]);
  await expect(page.locator("div[role='status']")).toHaveText("Saved", { timeout: 90_000 });
  const bytes = await downloadBytes(dl);
  expect(latin(bytes.subarray(0, 5))).toBe("%PDF-");
  const pages = pdfWords(bytes).pages.map((p) => p.runs.map((r) => r.s));
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/printouts-${device}-${file}.pdf`, bytes);
  writeFileSync(`test-results/printouts-${device}-${file}.json`, `${JSON.stringify({ file: dl.suggestedFilename(), pages }, null, 2)}\n`);
  return { name: dl.suggestedFilename(), pages, drawn: await recorded(page) };
}

/** The plays a page names, each with the number printed before its name (a postcard puts the call between them). */
const numbered = (words: readonly string[]): string[] =>
  words.flatMap((w, i) => (ORDER.some((p) => p.name === w) ? [`${words.slice(0, i).findLast((x) => /^\d+$/.test(x)) ?? ""} ${w}`] : []));
const label = (n: number, p: { name: string }) => `${String(n)} ${p.name}`;
/** Whose players a page draws: the quarterback's tag is the offense's, the linebacker's the defense's. */
const sides = (words: readonly string[] = []) => ({ offense: words.includes("QB"), defense: words.includes("LB") });
const expectPlain = (words: readonly string[], drawn: string | undefined) => {
  expect(words.filter((w) => ROUTES.includes(w) || CALLS.includes(w)), "no route names and no call").toEqual([]);
  expect(drawn, "no read marked").not.toContain("★");
};

test("the binder prints every play left in the book in order, detailed one a page or plain four up, each on its own side", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const device = testInfo.project.name;
  await open(page);

  const one = await grab(page, "Download binder PDF", "binder", device);
  expect(one.name).toBe("otter-print-book-binder.pdf");
  expect(one.pages.map(numbered)).toEqual(ORDER.map((p, i) => [label(i + 1, p)]));
  for (const words of one.pages) {
    expect(words).toContain(WHO);
    expect(words).toContain(MARK);
  }
  const [dive, zone, wheel, , coverTwo] = one.pages;
  for (const w of ["Play-action", "Post", "Curl", "Dive"]) expect(dive, `the one-up page carries "${w}"`).toContain(w);
  expect(one.drawn[0], "the read is starred").toContain("★");
  expect(sides(dive)).toEqual({ offense: true, defense: false });
  // a defensive call: its defenders and their coverage, no call, no offense
  for (const w of ["LC", "Zone flat", "Curl-flat", "Mid-read", "Zone deep"]) expect(zone).toContain(w);
  expect((zone ?? []).filter((w) => CALLS.includes(w))).toEqual([]);
  expect(sides(zone)).toEqual({ offense: false, defense: true });
  expect(sides(wheel)).toEqual({ offense: true, defense: false });
  // an offensive call that also carries defensive routes still draws only the offense
  expect(sides(coverTwo)).toEqual({ offense: true, defense: false });

  await page.getByRole("combobox", { name: "Binder layout" }).selectOption("four");
  const four = await grab(page, "Download binder PDF", "binder-four-up", device);
  expect(four.name).toBe("otter-print-book-binder-four-up.pdf");
  expect(four.pages.map(numbered)).toEqual([ORDER.slice(0, 4).map((p, i) => label(i + 1, p)), [label(5, COVER_TWO)]]);
  four.pages.forEach((words, i) => {
    expectPlain(words, four.drawn[i]);
    expect(words).toContain(WHO);
    expect(words).toContain(MARK);
  });
});

test("postcards print fronts then their backs two a sheet, and the flyer prints the coach's picks in slot order", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const device = testInfo.project.name;
  await open(page);

  const cards = await grab(page, "Download postcards PDF", "postcards", device);
  expect(cards.name).toBe("otter-print-book-postcards.pdf");
  // five plays: three front sheets, each followed by the back sheet that pairs with it
  const sheets = [[0, 1], [2, 3], [4]].map((s) => s.map((i) => label(i + 1, ORDER[i] ?? { name: "" })));
  expect(cards.pages.map(numbered)).toEqual(sheets.flatMap((s) => [s, s]));
  cards.pages.forEach((words, i) => {
    const front = i % 2 === 0, count = (w: string) => words.filter((x) => x === w).length;
    const perSheet = sheets[Math.floor(i / 2)]?.length;
    expect(words).toContain(front ? "Fronts" : "Backs · flip on the long edge");
    expect(words).toContain(WHO);
    expect(words).toContain(MARK);
    expect(count("Riverside Otters"), "every card wears the team's name").toBe(perSheet);
    if (!front) expect([count("COACHING POINTS"), count("Player")], "every back has coaching points and a line for the player").toEqual([perSheet, perSheet]);
  });
  // the front is the picture card with the call; the slant's back carries its notes
  expect(cards.pages[0]).toContain("Play-action");
  expect(cards.pages[3]).toContain(SLANT_LEFT.notes);

  // the flyer starts on the book's order; the coach empties slot 2 and puts the zone in slot 6
  const slot = (n: number) => page.getByRole("combobox", { name: `Flyer slot ${String(n)}` });
  await expect(slot(2)).toHaveValue(ZONE_D.id);
  await expect(slot(6)).toHaveValue("");
  await slot(2).selectOption("");
  await slot(6).selectOption(ZONE_D.id);
  const flyer = await grab(page, "Download flyer PDF", "flyer", device);
  expect(flyer.name).toBe("otter-print-book-flyer.pdf");
  expect(flyer.pages).toHaveLength(1);
  const sheet = flyer.pages[0] ?? [];
  expect(numbered(sheet)).toEqual([label(1, FAKE_DIVE), label(3, WHEEL_RIGHT), label(4, SLANT_LEFT), label(5, COVER_TWO), label(2, ZONE_D)]);
  expectPlain(sheet, flyer.drawn[0]);
  for (const w of ["Riverside Otters", "Otter Print Book", "Routes only — ask your coach for the rest.", MARK]) expect(sheet).toContain(w);
});

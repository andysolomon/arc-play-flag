import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Designer } from "../support/designer";
import { COVER_ONE_D, OTTERS, RED_ZONE_FADE, SLANT_LEFT, WHEEL_RIGHT, play, playbook, seed } from "../support/fixtures";
import type { SavedPlay } from "../../lib/play/types";

/**
 * The game-day reader (issue #111): a coach opens a book on a sideline tablet, finds a call fast and
 * shows its diagram and notes, with nothing on screen that edits the play. How it could break, and
 * the test that catches each:
 *  - the book has no way into the reader, or it opens somewhere other than the first play      → "steps"
 *  - its numbers differ from the book's (and so the wristbands'), e.g. around a deleted play    → "steps"
 *  - Previous/Next don't move, run past either end, or are too small to hit with a thumb        → "steps"
 *  - something pinned over the controls (the offline badge sits at the bottom left of every
 *    screen) takes a tap meant for Previous or Next                                              → "steps"
 *  - the counter, the play shown and the address disagree after a step                          → every step reads all three
 *  - the arrow keys, Home and End don't step, or still step while the coach types a search       → "steps", "search"
 *  - the diagram can be edited (any control on it), the notes are missing or too small to read
 *    at arm's length, or a play without notes shows an empty notes panel                        → "steps"
 *  - a run called from a no-run zone isn't flagged as it is on the play card                     → "steps"
 *  - a call can't be found by its number, a code in its name or a word in its notes; Enter
 *    doesn't jump to it; or a search that finds nothing doesn't say so                          → "search"
 *  - Full screen doesn't clear the screen down to the play, or can't be left again              → "full screen"
 *  - opening the play in the designer and coming back loses the place, and reopening the
 *    reader from the book doesn't come back to the last play                                     → "position"
 *  - a number past the end, junk in the address, an empty book or a book not on this device
 *    breaks the page                                                                             → "edges"
 *  - with the network off the reader doesn't open, draw or step                                  → "offline"
 * Leaves `game-day-reader-<device>.json` (each step's address, counter, play, notes, the field's
 * share of the screen and the controls' sizes, and what each search found) and pictures of the
 * reader and of full screen in test-results/.
 */

const named = (p: SavedPlay, name: string, notes = p.notes): SavedPlay => ({ ...p, name, notes });
const MESH = play("fx-o01", "O01 Trips Mesh", { o3: { type: "cross", primary: true }, o4: { type: "cross", mirror: true }, o5: { type: "flat" } }, "Mesh at 6 yards.\nQB reads the flat.");
const DIVE: SavedPlay = { ...play("fx-o04", "O04 Goal Line Dive", { o5: { type: "dive", primary: true } }, "Hit the hole fast."), los: 35 };
const FADE = named(RED_ZONE_FADE, "O07 Red Zone Fade", "Back shoulder if pressed.");
const PLAYS = [MESH, WHEEL_RIGHT, COVER_ONE_D, DIVE, SLANT_LEFT, FADE];
// a play deleted from the library is skipped, so the reader numbers as the book and the wristbands do
const BOOK = { ...playbook("fx-gameday", "Otter Game Day", PLAYS), plays: [MESH.id, "fx-gone", WHEEL_RIGHT.id, COVER_ONE_D.id, DIVE.id, SLANT_LEFT.id, FADE.id] };
const ORDER = PLAYS.map((p) => p.name);

interface Step { step: string; read: string | null; counter: string; title: string; notes: string | null; fieldShare: number; fieldControls: number }
interface Manifest { device: string; viewport: { width: number; height: number } | null; steps: Step[]; nav?: Record<string, { width: number; height: number; hit: boolean }>; searches?: { query: string; found: string[] }[]; fullScreen?: Record<string, unknown>; position?: Record<string, unknown>; edges?: Record<string, unknown> }

const readerUrl = (n?: number | string): string => `/playbooks?book=${BOOK.id}${n === undefined ? "" : `&read=${String(n)}`}`;
const field = (page: Page): Locator => page.getByRole("img", { name: "Play diagram" });
const title = (page: Page): Locator => page.getByRole("heading", { level: 2 });
const notes = (page: Page): Locator => page.getByRole("region", { name: "Coaching notes" });
const next = (page: Page): Locator => page.getByRole("button", { name: "Next play", exact: true });
const prev = (page: Page): Locator => page.getByRole("button", { name: "Previous play", exact: true });
const search = (page: Page): Locator => page.getByRole("searchbox", { name: "Find a call" });
const matches = (page: Page): Locator => page.getByRole("list", { name: "Matching calls" }).getByRole("button");

async function seedBook(page: Page): Promise<void> {
  await seed(page, { plays: PLAYS, playbooks: [BOOK, playbook("fx-empty", "Otter Empty", [])], team: OTTERS });
}

/** Waits for the reader to show play `n`, then records what the counter, the address and the screen say. */
async function at(page: Page, steps: Step[], step: string, n: number): Promise<void> {
  const name = ORDER[n - 1] ?? "";
  await expect(page.getByText(`Play ${String(n)} of ${String(ORDER.length)}`, { exact: true }), step).toBeVisible();
  await expect(title(page), step).toHaveText(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  await expect.poll(() => new URL(page.url()).searchParams.get("read"), { message: step }).toBe(String(n));
  await expect(field(page), step).toBeVisible();
  const box = await field(page).boundingBox();
  const vh = page.viewportSize()?.height ?? 1;
  steps.push({
    step,
    read: new URL(page.url()).searchParams.get("read"),
    counter: `Play ${String(n)} of ${String(ORDER.length)}`,
    title: (await title(page).innerText()).trim(),
    notes: (await notes(page).count()) ? (await notes(page).innerText()).replace(/\s+/g, " ").trim() : null,
    fieldShare: Math.round(((box?.height ?? 0) / vh) * 100) / 100,
    fieldControls: await field(page).getByRole("button").count(),
  });
}

/** A control's size, and whether a tap lands on it at its centre and at each corner a thumb might catch. */
async function target(control: Locator): Promise<{ width: number; height: number; hit: boolean }> {
  const box = await control.boundingBox();
  if (!box) throw new Error("control not laid out");
  const inset = 10;
  const points = [
    [box.x + box.width / 2, box.y + box.height / 2],
    [box.x + inset + 6, box.y + box.height - inset], [box.x + box.width - inset - 6, box.y + box.height - inset],
    [box.x + inset + 6, box.y + inset], [box.x + box.width - inset - 6, box.y + inset],
  ] as const;
  const hit = await control.evaluate((el, pts) => pts.every(([x, y]) => { const top = document.elementFromPoint(x, y); return !!top && (el === top || el.contains(top)); }), points);
  return { width: Math.round(box.width), height: Math.round(box.height), hit };
}

function save(name: string, data: Manifest): void {
  writeFileSync(`test-results/game-day-reader-${name}.json`, `${JSON.stringify(data, null, 2)}\n`);
}

test("the reader opens from the book on its first play, steps by button and key, numbers as the book does, and draws each play read-only with its notes", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  await seedBook(page);
  await page.goto(`/playbooks?book=${BOOK.id}`);
  // the book's own numbers, as its rows and the wristbands give them
  await expect(page.getByLabel("Play 4", { exact: true })).toBeVisible();
  const bookNumbers = await page.locator("ol > li").evaluateAll((rows) => rows.map((r) => (r.querySelector("[title]")?.getAttribute("title") ?? "")));
  expect(bookNumbers).toEqual(ORDER);

  await page.getByRole("link", { name: /Game-day reader/ }).click();
  await at(page, steps, "opened from the book", 1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(BOOK.name);
  await expect(notes(page)).toContainText("Mesh at 6 yards.");
  await expect(notes(page)).toContainText("QB reads the flat.");
  // read-only: nothing on the diagram is a control, and nothing on the page edits the play
  expect(await field(page).getByRole("button").count()).toBe(0);
  await expect(page.getByRole("textbox", { name: "Play name" })).toHaveCount(0);
  await expect(prev(page)).toBeDisabled();
  // the notes are big enough to read at arm's length
  const notesSize = await notes(page).locator("p").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(notesSize).toBeGreaterThanOrEqual(18);
  // the play takes up the screen on a tablet, and a good share of it on a phone
  const vw = page.viewportSize()?.width ?? 0;
  expect(steps[0]?.fieldShare ?? 0).toBeGreaterThanOrEqual(vw >= 700 ? 0.45 : 0.3);
  const nav = { previous: await target(prev(page)), next: await target(next(page)) };
  for (const [which, t] of Object.entries(nav)) {
    expect(t.height, `${which} height`).toBeGreaterThanOrEqual(56);
    expect(t.width, `${which} width`).toBeGreaterThanOrEqual(120);
  }
  // the offline badge is pinned to the bottom left on every screen: a tap anywhere on either control is that control
  await expect(page.getByText(/Offline (ready|updating…|unavailable)/)).toBeVisible();
  expect(nav.previous.hit, "a tap anywhere on Previous lands on it").toBe(true);
  expect(nav.next.hit, "a tap anywhere on Next lands on it").toBe(true);
  await page.screenshot({ path: `test-results/game-day-reader-${testInfo.project.name}.png` });

  await next(page).click();
  await at(page, steps, "Next", 2);
  // a play without notes shows no notes panel
  await expect(notes(page)).toHaveCount(0);
  await page.keyboard.press("ArrowRight");
  await at(page, steps, "ArrowRight", 3);
  await expect(page.getByText("Defense", { exact: true }).first()).toBeVisible();
  await next(page).click();
  await at(page, steps, "Next onto the no-run play", 4);
  await expect(page.getByText("Run in a no-run zone", { exact: true })).toBeVisible();
  await page.keyboard.press("End");
  await at(page, steps, "End", 6);
  await expect(next(page)).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await at(page, steps, "ArrowRight at the end stays", 6);
  await prev(page).click();
  await at(page, steps, "Previous", 5);
  await expect(notes(page)).toContainText("X wins inside.");
  await page.keyboard.press("ArrowLeft");
  await at(page, steps, "ArrowLeft", 4);
  await page.keyboard.press("Home");
  await at(page, steps, "Home", 1);
  await page.keyboard.press("ArrowLeft");
  await at(page, steps, "ArrowLeft at the start stays", 1);

  save(testInfo.project.name, { device: testInfo.project.name, viewport: page.viewportSize(), steps, nav });
});

test("a call is found by its number, a code in its name or a word in its notes, and a search that finds nothing says so", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  const searches: { query: string; found: string[] }[] = [];
  await seedBook(page);
  await page.goto(readerUrl(1));
  await at(page, steps, "opened", 1);
  const find = async (query: string): Promise<string[]> => {
    await search(page).fill(query);
    const found = query.trim() ? await matches(page).allInnerTexts() : [];
    searches.push({ query, found: found.map((t) => t.replace(/\s+/g, " ").trim()) });
    return found;
  };

  // the number a coach reads off a wristband, then Enter
  await find("4");
  await expect(matches(page).first()).toHaveText(/^4\b.*O04 Goal Line Dive/);
  await search(page).press("Enter");
  await at(page, steps, "number 4, Enter", 4);
  await expect(search(page)).toHaveValue("");

  // a word in the name, picked from the list
  await find("wheel");
  await expect(matches(page)).toHaveCount(1);
  await matches(page).first().click();
  await at(page, steps, "name 'wheel', picked", 2);

  // a code in the name, in any case
  await find("o07");
  await expect(matches(page).first()).toHaveText(/O07 Red Zone Fade/);
  await search(page).press("Enter");
  await at(page, steps, "code 'o07', Enter", 6);

  // a word in the notes
  await find("inside");
  await expect(matches(page).first()).toHaveText(/Otter Slant Left/);

  // the arrow keys move the caret while typing, not the play
  await search(page).press("ArrowLeft");
  await search(page).press("ArrowRight");
  await at(page, steps, "arrows while typing stay", 6);

  // nothing found: said, and Enter goes nowhere
  await find("zzz");
  await expect(matches(page)).toHaveCount(0);
  await expect(page.getByText("No call matches “zzz”.", { exact: true })).toBeVisible();
  await search(page).press("Enter");
  await at(page, steps, "no match, Enter stays", 6);

  save(`${testInfo.project.name}-search`, { device: testInfo.project.name, viewport: page.viewportSize(), steps, searches });
});

test("Full screen clears the screen down to the play and its controls, and the coach can leave it again", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  await seedBook(page);
  await page.goto(readerUrl(1));
  await at(page, steps, "opened", 1);
  const share = (): number => steps[steps.length - 1]?.fieldShare ?? 0;
  const before = share();

  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeHidden();
  await expect(search(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Exit full screen", exact: true })).toBeVisible();
  await at(page, steps, "full screen", 1);
  expect(share()).toBeGreaterThanOrEqual(before);
  const browserFullScreen = await page.evaluate(() => document.fullscreenElement !== null);
  await page.screenshot({ path: `test-results/game-day-reader-${testInfo.project.name}-full-screen.png` });
  await next(page).click();
  await at(page, steps, "Next in full screen", 2);

  await page.getByRole("button", { name: "Exit full screen", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(BOOK.name);
  await expect(search(page)).toBeVisible();
  await at(page, steps, "left full screen", 2);

  // Escape leaves it too
  await page.getByRole("button", { name: "Full screen", exact: true }).click();
  await expect(search(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(search(page)).toBeVisible();

  save(`${testInfo.project.name}-full-screen`, { device: testInfo.project.name, viewport: page.viewportSize(), steps, fullScreen: { browserFullScreen, shareBefore: before } });
});

test("the reader keeps its place through a trip to the designer, a reload and a return from the book", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  await seedBook(page);
  await page.goto(readerUrl(1));
  await next(page).click();
  await next(page).click();
  await at(page, steps, "stepped to 3", 3);

  await page.getByRole("link", { name: "Open in designer", exact: true }).click();
  const d = new Designer(page);
  await expect(d.field).toBeVisible();
  await d.tools();
  await expect(d.nameInput).toHaveValue(COVER_ONE_D.name);
  await page.goBack();
  await at(page, steps, "back from the designer", 3);

  await page.reload();
  await at(page, steps, "reloaded", 3);

  await page.getByRole("link", { name: "‹ Book", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Playbook name" })).toHaveValue(BOOK.name);
  await page.getByRole("link", { name: /Game-day reader/ }).click();
  await at(page, steps, "reopened from the book", 3);

  save(`${testInfo.project.name}-position`, { device: testInfo.project.name, viewport: page.viewportSize(), steps });
});

test("a number past the end, junk in the address, an empty book and a book not on this device each read sensibly", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  await seedBook(page);
  await page.goto(readerUrl(99));
  await at(page, steps, "read=99 lands on the last play", 6);
  await page.goto(readerUrl("abc"));
  await at(page, steps, "read=abc lands on the first", 1);
  await page.goto(readerUrl(0));
  await at(page, steps, "read=0 lands on the first", 1);

  await page.goto("/playbooks?book=fx-empty");
  await expect(page.getByRole("textbox", { name: "Playbook name" })).toHaveValue("Otter Empty");
  await expect(page.getByRole("link", { name: /Game-day reader/ })).toHaveCount(0);
  await page.goto("/playbooks?book=fx-empty&read=1");
  await expect(page.getByText("This playbook has no plays yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "‹ Book", exact: true })).toBeVisible();

  await page.goto("/playbooks?book=fx-nowhere&read=1");
  await expect(page.getByText("That playbook isn't on this device.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "‹ All playbooks", exact: true })).toBeVisible();

  save(`${testInfo.project.name}-edges`, { device: testInfo.project.name, viewport: page.viewportSize(), steps });
});

test("with the network off the reader opens the local book, draws its plays and steps through them", async ({ context, page }, testInfo) => {
  const steps: Step[] = [];
  await seedBook(page);
  await page.goto(readerUrl(1));
  await at(page, steps, "online", 1);
  await expect(page.getByText("Offline ready", { exact: true })).toBeVisible({ timeout: 30_000 });

  await context.setOffline(true);
  await page.goto(readerUrl(4));
  await at(page, steps, "offline, opened on 4", 4);
  await expect(field(page).locator("circle").first()).toBeVisible();
  await next(page).click();
  await at(page, steps, "offline, Next", 5);
  await page.reload();
  await at(page, steps, "offline, reloaded", 5);

  save(`${testInfo.project.name}-offline`, { device: testInfo.project.name, viewport: page.viewportSize(), steps });
});

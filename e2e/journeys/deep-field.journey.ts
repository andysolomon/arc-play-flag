import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { DEEP_FIELD_KEY } from "../../lib/deepfield";
import { encodeShare } from "../../lib/play/share";
import type { SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { OTTERS, play, playbook, seed, storedDraft } from "../support/fixtures";

/**
 * On a laptop or desktop the designer once showed only 16 yards past the line of scrimmage, so a
 * coach could not draw a deep route (a waypoint stopped 14.8 yards on) or see one drawn on a phone
 * (issue #106). How this could break, and the check that catches each:
 *  - drawing on a wide screen still stops short                                   → while a custom route is drawn the card reaches 37 yards on (the deepest card), and a tap 24 yards on is stored at 24
 *  - drawing pre-snap motion (always behind the line) resizes the card for nothing → while motion is drawn the card stays the 16-yard one, with no Deep field offered
 *  - the card deepens but a tap lands on the wrong yard (a stale top or size)    → every tapped waypoint is stored exactly where it was tapped
 *  - once drawn, the card snaps back to 16 yards and cuts the route off          → after Finish the card's top is past the deepest waypoint and every route and arrowhead lies on the card
 *  - the card stops so close to a waypoint that a nudge pulls it back            → the deepest waypoint sits at least 1.2 yards under the top, and an arrow key moves it the way it points
 *  - the deeper card runs off the screen, or the page has to scroll to reach it  → the card sits inside the pane and the window, and the page does not scroll
 *  - a short play loses its big field on a laptop                                 → the default play, and a short route once drawn, keep the 16-yard card
 *  - Deep field does nothing, or does it without saying so                        → pressed, the card shows 37 yards and the button says aria-pressed="true"
 *  - with Deep field on a waypoint still can't go past the short card's top      → a waypoint moves by keyboard to 32 yards on
 *  - Deep field is forgotten on reload, or leaks into the play                    → a reload keeps it, from its own key, and the stored draft never mentions it
 *  - turning Deep field off hides the deep route                                 → the card fits the route again, every route on it
 *  - from the 10 the end line is still off the card                               → with Deep field on the card ends at the end line, the end zone whole
 *  - the button offers a change that changes nothing, or sits in the way         → hidden while a route is drawn, on a screen already as deep as the card goes and from the 5; a 44px target over no player
 *  - a route drawn deep on a phone is cut off on a laptop or in its pictures     → a play with a waypoint 30 yards on is whole in the designer, the gallery thumbnail, the printout preview and the share page
 * The laptop sizes are the issue's (1280×720, 1440×900, 1920×1080), run on the desktop project; the
 * drawing and the pictures are also checked on every device's own screen. Leaves
 * `deep-field-<device>[-<size>].json` (each step's card, pane, yards shown, stored waypoints, route
 * boxes and the button) and a picture of each step in test-results/, uploaded as `deep-field`.
 */

/** The deepest card, 45 yards: 8 behind the line of scrimmage and 37 on. */
const DEEPEST = 37;
/** The laptop card for a play that fits: the 24-yard card, 16 yards on. */
const SHORT = 16;
/** Where a player (and so a waypoint) may stand under the card's top edge. */
const MARGIN = 1.2;
const LAPTOPS = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

interface Box { x: number; y: number; width: number; height: number }
/** A route or arrowhead as drawn, in yards from the line of scrimmage (negative is downfield). */
interface Drawn { top: number; bottom: number; left: number; right: number; inside: boolean }
interface Reading {
  viewBox: string;
  /** yards past the line of scrimmage the card reaches: its top edge is at -downfield */
  downfield: number;
  card: Box;
  pane: Box;
  window: { width: number; height: number };
  /** the page scrolls, or the card's own pane does */
  scrolls: boolean;
  routes: Drawn[];
  toggle: { box: Box; pressed: string | null; title: string | null; over: string[] } | null;
}

/** The field as a coach sees it, read back in yards, with the Deep field button and anything it covers. */
async function read(page: Page): Promise<Reading> {
  return page.evaluate(() => {
    const round = (n: number): number => Math.round(n * 100) / 100 + 0;
    const box = (r: DOMRect) => ({ x: round(r.x), y: round(r.y), width: round(r.width), height: round(r.height) });
    const svg = document.querySelector<SVGSVGElement>("svg[aria-label='Play diagram']");
    if (!svg) throw new Error("no field");
    const vb = svg.viewBox.baseVal;
    const top = 8 - vb.height / 22;
    const routes = [...svg.querySelectorAll<SVGGraphicsElement>("path[stroke-linecap='round'], polygon")].map((el) => {
      const b = el.getBBox();
      return {
        top: round(top + b.y / 22), bottom: round(top + (b.y + b.height) / 22), left: round(b.x / 22), right: round((b.x + b.width) / 22),
        inside: b.y >= -0.5 && b.y + b.height <= vb.height + 0.5 && b.x >= -0.5 && b.x + b.width <= vb.width + 0.5,
      };
    });
    const main = svg.closest("main");
    if (!main) throw new Error("no pane");
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Deep field" && b.checkVisibility());
    const at = button?.getBoundingClientRect();
    const hits = (a: DOMRect, b: DOMRect): boolean => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const over = at
      ? [...svg.querySelectorAll("g[role='button'][aria-label]")].filter((t) => hits(t.getBoundingClientRect(), at)).map((t) => t.getAttribute("aria-label") ?? "")
      : [];
    const scroller = document.scrollingElement ?? document.documentElement;
    return {
      viewBox: svg.getAttribute("viewBox") ?? "",
      downfield: round(-top),
      card: box(svg.getBoundingClientRect()),
      pane: box(main.getBoundingClientRect()),
      window: { width: innerWidth, height: innerHeight },
      scrolls: scroller.scrollHeight > innerHeight + 1 || scroller.scrollWidth > innerWidth + 1 || main.scrollHeight > main.clientHeight + 1,
      routes,
      toggle: button && at
        ? { box: box(at), pressed: button.getAttribute("aria-pressed"), title: button.getAttribute("title"), over }
        : null,
    };
  });
}

/** The card is on screen, inside its pane, and nothing had to scroll to get it there. */
function expectFits(m: Reading, step: string): void {
  expect(m.scrolls, `${step}: nothing scrolls`).toBe(false);
  expect(m.card.y, `${step}: the card's top is inside the pane`).toBeGreaterThanOrEqual(m.pane.y - 0.5);
  expect(m.card.y + m.card.height, `${step}: the card's bottom is inside the pane`).toBeLessThanOrEqual(m.pane.y + m.pane.height + 0.5);
  expect(m.card.y + m.card.height, `${step}: the card's bottom is on screen`).toBeLessThanOrEqual(m.window.height + 0.5);
  expect(m.card.x, `${step}: the card's left is on screen`).toBeGreaterThanOrEqual(-0.5);
  expect(m.card.x + m.card.width, `${step}: the card's right is on screen`).toBeLessThanOrEqual(m.window.width + 0.5);
}

/** Every route and arrowhead lies on the card. */
function expectWhole(m: Reading, step: string): void {
  expect(m.routes.length, `${step}: routes are drawn`).toBeGreaterThan(0);
  expect(m.routes.filter((r) => !r.inside), `${step}: every route is on the card`).toEqual([]);
}

/** The Deep field button, when offered: a 44px target over no player. */
function expectToggle(m: Reading, pressed: boolean, step: string): void {
  expect(m.toggle, `${step}: Deep field is offered`).not.toBeNull();
  expect(m.toggle?.pressed, step).toBe(String(pressed));
  expect(m.toggle?.box.height ?? 0, `${step}: a 44px target`).toBeGreaterThanOrEqual(44);
  expect(m.toggle?.over, `${step}: the button covers no player`).toEqual([]);
}

const deepToggle = (page: Page): Locator => page.getByRole("button", { name: "Deep field", exact: true });
const finish = (page: Page): Locator => page.getByRole("button", { name: "Finish", exact: true });
const losSelect = (page: Page): Locator => page.locator("#play-sidebar").getByRole("combobox", { name: "Line of scrimmage" });
const routeOf = async (page: Page, id = "o3") => (await storedDraft(page))?.players.find((p) => p.id === id)?.route;

async function keep(testInfo: TestInfo, name: string, data: unknown): Promise<void> {
  const file = `test-results/${name}.json`;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  await testInfo.attach(name, { path: file, contentType: "application/json" });
}

/** Waits until the card shows `yards` past the line of scrimmage, then reads it. */
async function showing(page: Page, d: Designer, yards: number): Promise<Reading> {
  await expect.poll(async () => (await read(page)).downfield).toBe(yards);
  await d.settle();
  return read(page);
}

/**
 * X draws a 25-yard post as a coach does: Custom, a stem 8 yards on, the break 24 yards on, Finish.
 * Returns the field while it was being drawn and once it was.
 */
async function drawPost(page: Page, d: Designer): Promise<{ drawing: Reading; drawn: Reading }> {
  await d.select("X");
  await d.pick("Custom");
  await d.closeSidebars();
  const drawing = await showing(page, d, DEEPEST);
  // nothing to toggle while the field is already as deep as it goes
  await expect(deepToggle(page)).toHaveCount(0);
  await d.tapField(3, -8);
  await d.tapField(9, -24);
  await finish(page).click();
  await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[3, -8], [9, -24]] });
  await d.settle();
  return { drawing, drawn: await read(page) };
}

for (const size of LAPTOPS) {
  const at = `${String(size.width)}x${String(size.height)}`;
  test(`on a ${String(size.width)}×${String(size.height)} screen a coach draws a 25-yard post, sees it whole and opens the deep field`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "the issue's laptop and desktop screens; every device draws on its own screen below");
    await page.setViewportSize(size);
    const shot = (step: string) => page.screenshot({ path: `test-results/deep-field-${testInfo.project.name}-${at}-${step}.png` });
    const d = new Designer(page);
    await d.goto();
    await d.closeSidebars();

    // a play that fits keeps the big 16-yard card, with Deep field offered and off
    const short = await showing(page, d, SHORT);
    expectFits(short, "short");
    expectToggle(short, false, "short");
    await expect(deepToggle(page)).toHaveAttribute("title", `Show ${String(DEEPEST)} yards downfield`);
    await shot("short");

    // pre-snap motion stays behind the line of scrimmage: drawing it leaves the short card as it is
    await d.select("Z");
    await d.palette();
    await page.getByRole("button", { name: "Draw pre-snap motion", exact: true }).click();
    await expect(finish(page)).toBeDisabled();
    await d.closeSidebars();
    await d.settle();
    const motion = await read(page);
    expect(motion.downfield, "drawing motion leaves the card as it was").toBe(SHORT);
    expect(motion.toggle, "no Deep field while anything is drawn").toBeNull();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await showing(page, d, SHORT);

    // drawing a route opens the deepest card, and the post is stored where it was tapped
    const { drawing, drawn } = await drawPost(page, d);
    expectFits(drawing, "drawing");
    expect(drawing.toggle, "no Deep field while a route is drawn").toBeNull();
    // once drawn, the card reaches past the break, a margin clear of it, and the post is whole
    expect(drawn.downfield, "the card reaches past the break").toBeGreaterThanOrEqual(24 + MARGIN);
    expect(drawn.downfield, "and no deeper than the play needs").toBeLessThan(DEEPEST);
    expectFits(drawn, "drawn");
    expectWhole(drawn, "drawn");
    expect(Math.min(...drawn.routes.map((r) => r.top)), "the arrow reaches the break").toBeLessThanOrEqual(-23.9);
    expectToggle(drawn, false, "drawn");
    await shot("drawn");

    // a nudge to the side leaves the break where it is: the card's top never pulls it back
    await d.select("X");
    const second = page.getByRole("button", { name: /^Waypoint 2 of 2 for Offense X/ });
    await second.focus();
    await second.press("ArrowRight");
    await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[3, -8], [9.5, -24]] });
    await second.press("ArrowLeft");
    await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[3, -8], [9, -24]] });

    // Deep field shows the deepest card, and says so
    await deepToggle(page).click();
    await expect(deepToggle(page)).toHaveAttribute("aria-pressed", "true");
    const deep = await showing(page, d, DEEPEST);
    expectFits(deep, "deep");
    expectWhole(deep, "deep");
    expectToggle(deep, true, "deep");
    await expect(deepToggle(page)).toHaveAttribute("title", "Fit the field to the play");
    await shot("deep");

    // with it on, the break goes deeper than the short card's top allowed, by keyboard
    await d.select("X");
    await second.focus();
    for (let i = 0; i < 8; i++) await second.press("Shift+ArrowUp");
    await expect.poll(() => routeOf(page)).toEqual({ type: "custom", pts: [[3, -8], [9, -32]] });

    // a reload keeps Deep field, from its own key; the play never carries it
    await page.reload();
    await expect(d.field).toBeVisible();
    await d.closeSidebars();
    await expect(deepToggle(page)).toHaveAttribute("aria-pressed", "true");
    const reloaded = await showing(page, d, DEEPEST);
    expectWhole(reloaded, "reloaded");
    expect(await page.evaluate((k) => localStorage.getItem(k), DEEP_FIELD_KEY)).toBe("on");
    expect(JSON.stringify(await storedDraft(page))).not.toMatch(/deep/i);

    // off again, the card fits the route: past the break, and every route whole
    await deepToggle(page).click();
    await expect(deepToggle(page)).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await read(page)).downfield).toBeLessThan(DEEPEST);
    await d.settle();
    const fitted = await read(page);
    expect(fitted.downfield, "the card reaches past the moved break").toBeGreaterThanOrEqual(32 + MARGIN);
    expectFits(fitted, "fitted");
    expectWhole(fitted, "fitted");
    expect(await page.evaluate((k) => localStorage.getItem(k), DEEP_FIELD_KEY)).toBeNull();
    await shot("fitted");

    // from the 10, a new play: the short card cuts the end zone; Deep field ends the card at the end line
    await d.newPlay("Offense");
    await d.tools();
    await losSelect(page).selectOption("30");
    await d.closeSidebars();
    const tenShort = await showing(page, d, SHORT);
    await expect(deepToggle(page)).toHaveAttribute("title", "Show the field to the end line");
    await deepToggle(page).click();
    const tenDeep = await showing(page, d, 20);
    expectFits(tenDeep, "from the 10");
    expectToggle(tenDeep, true, "from the 10");
    const endZone = await d.field.locator('rect[fill="#a7e5a7"]').evaluate((r) => {
      const y = Number(r.getAttribute("y")), h = Number(r.getAttribute("height"));
      return { top: y / 22, bottom: (y + h) / 22 };
    });
    // the card's top edge is the end line: the whole 10-yard end zone is on it
    expect(endZone, "the end zone runs from the top of the card, 10 yards down to the goal line").toEqual({ top: 0, bottom: 10 });
    await shot("from-the-10");

    // from the 5 the card already ends at the end line: nothing to offer
    await d.tools();
    await losSelect(page).selectOption("35");
    await d.closeSidebars();
    const fiveDeep = await showing(page, d, 15);
    expect(fiveDeep.toggle, "from the 5 the short card is already the whole field").toBeNull();
    await deepToggle(page).waitFor({ state: "detached" });
    // back on the 10 the choice is still on
    await d.tools();
    await losSelect(page).selectOption("30");
    await d.closeSidebars();
    await showing(page, d, 20);
    await expect(deepToggle(page)).toHaveAttribute("aria-pressed", "true");

    await keep(testInfo, `deep-field-${testInfo.project.name}-${at}`, {
      project: testInfo.project.name,
      viewport: size,
      steps: { short, motion, drawing, drawn, deep, reloaded, fitted, tenShort, tenDeep, fiveDeep },
    });
  });
}

test("on this device's own screen a coach draws a 25-yard post and sees it whole", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const d = new Designer(page);
  await d.goto();
  await d.closeSidebars();
  await d.settle();
  const before = await read(page);
  expectFits(before, "before");
  // Deep field is offered only where it would show more
  if (before.downfield < DEEPEST) expectToggle(before, false, "before");
  else expect(before.toggle, "the screen already shows the deepest card").toBeNull();

  const { drawing, drawn } = await drawPost(page, d);
  expectFits(drawing, "drawing");
  expect(drawn.downfield, "the card reaches past the break").toBeGreaterThanOrEqual(24 + MARGIN);
  expectFits(drawn, "drawn");
  expectWhole(drawn, "drawn");
  if (drawn.downfield < DEEPEST) expectToggle(drawn, false, "drawn");
  else expect(drawn.toggle).toBeNull();
  await page.screenshot({ path: `test-results/deep-field-${project}-drawn.png` });

  // a short route leaves the card as it was before
  await d.select("Y");
  await d.pick("Custom");
  await d.tapField(24, -5);
  await finish(page).click();
  await expect.poll(() => routeOf(page, "o4")).toEqual({ type: "custom", pts: [[24, -5]] });
  await d.select("X");
  await d.pick("Go");
  await d.closeSidebars();
  const back = await showing(page, d, before.downfield);
  expectWhole(back, "back");

  await keep(testInfo, `deep-field-${project}`, { project, viewport: page.viewportSize(), steps: { before, drawing, drawn, back } });
});

/** X's post as a coach drew it on a phone, where the card reaches 37 yards: the break 30 yards on. */
const DEEP_SHOT: SavedPlay = play("fx-deep-shot", "Otter Deep Shot", { o3: { type: "custom", primary: true, pts: [[3, -10], [12, -30]] }, o4: { type: "out" } });

/** A picture of a play, read back in yards: where its card's top is and whether every route lies on it. */
async function readArt(target: Locator): Promise<{ viewBox: string; downfield: number; routes: Drawn[] }> {
  return target.evaluate((el) => {
    const svg = el instanceof SVGSVGElement ? el : el.querySelector("svg");
    if (!svg) throw new Error("no picture here");
    const [, , w = 0, h = 0] = (svg.getAttribute("viewBox") ?? "").split(" ").map(Number);
    const top = 8 - h / 22;
    const round = (n: number): number => Math.round(n * 100) / 100 + 0;
    return {
      viewBox: svg.getAttribute("viewBox") ?? "",
      downfield: round(-top),
      routes: [...svg.querySelectorAll<SVGGraphicsElement>("path[stroke-linecap='round'], polygon")].map((p) => {
        const b = p.getBBox();
        return {
          top: round(top + b.y / 22), bottom: round(top + (b.y + b.height) / 22), left: round(b.x / 22), right: round((b.x + b.width) / 22),
          inside: b.y >= -0.5 && b.y + b.height <= h + 0.5 && b.x >= -0.5 && b.x + b.width <= w + 0.5,
        };
      }),
    };
  });
}

test("a route drawn deep on a phone is whole in the designer, the gallery, the printout preview and the share page", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const book = playbook("fx-deep-book", "Otter Deep Book", [DEEP_SHOT]);
  await seed(page, { plays: [DEEP_SHOT], playbooks: [book], team: OTTERS });
  const d = new Designer(page);
  const seen: Record<string, { downfield: number; routes: Drawn[] }> = {};
  const expectArt = (a: { downfield: number; routes: Drawn[] }, where: string) => {
    expect(a.downfield, `${where}: the card reaches past the break`).toBeGreaterThanOrEqual(30 + MARGIN);
    expect(a.routes.length, `${where}: routes are drawn`).toBeGreaterThan(0);
    expect(a.routes.filter((r) => !r.inside), `${where}: every route is on the card`).toEqual([]);
    expect(Math.min(...a.routes.map((r) => r.top)), `${where}: the arrow reaches the break`).toBeLessThanOrEqual(-29.9);
  };

  await d.goto(`?open=${DEEP_SHOT.id}`);
  await d.closeSidebars();
  await d.settle();
  const designer = await read(page);
  expectArt(designer, "designer");
  expectFits(designer, "designer");
  seen.designer = designer;
  await page.screenshot({ path: `test-results/deep-field-${project}-designer.png` });

  await page.goto("/playbooks");
  const thumb = page.getByRole("img", { name: DEEP_SHOT.name }).first();
  await expect(thumb).toBeVisible();
  seen.thumbnail = await readArt(thumb);
  expectArt(seen.thumbnail, "thumbnail");

  await page.goto(`/playbooks?book=${book.id}`);
  const preview = page.getByRole("img", { name: "Playbook PDF preview" });
  await expect(preview).toBeVisible();
  seen.printout = await readArt(preview);
  expectArt(seen.printout, "printout");
  await preview.screenshot({ path: `test-results/deep-field-${project}-printout.png` });

  await page.goto(`/p/${encodeShare({ name: DEEP_SHOT.name, players: DEEP_SHOT.players })}`);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared).toBeVisible();
  seen.share = await readArt(shared);
  expectArt(seen.share, "share page");
  // the share page draws only; Deep field is the designer's
  await expect(deepToggle(page)).toHaveCount(0);
  await shared.screenshot({ path: `test-results/deep-field-${project}-share.png` });

  await keep(testInfo, `deep-field-${project}-pictures`, { project, viewport: page.viewportSize(), play: DEEP_SHOT.name, seen });
});

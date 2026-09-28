import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { END_ZONES, ENDZONE_KEY, TOUCHDOWNS_KEY } from "../../lib/endzone";
import { buildMotion, simulationPlayback } from "../../lib/play/motion";
import { touchdownAt } from "../../lib/play/touchdown";
import type { SavedPlay } from "../../lib/play/types";
import { Designer, armSabotage, sabotage } from "../support/designer";
import { KEYS, OTTERS, play, playbook, seed } from "../support/fixtures";

/*
 * End zones: a coach picks the end zone's look (Play tools, or playbook settings), and every
 * touchdown pass thrown on ▶ celebrates in it and opens the next locked one. What could go wrong,
 * and the test (by the start of its title) that catches each:
 *
 * Picking and drawing
 *  - a fresh device draws something other than the classic band: a design, route lanes, or no
 *    plain END ZONE lettering                                   → "a fresh device"
 *  - the picker opens the wrong end zones, lets a locked one be picked (by tap or keyboard), or
 *    miscounts its locks and hint                               → "a fresh device", "an end zone in use", "playbook settings"
 *  - a pick doesn't paint the field, leaves the plain lettering showing under the design, or
 *    draws outside the band                                     → "picking", "every end zone"
 *  - the pick is lost on reload, never reaches another open tab, or Classic leaves a key behind → "picking"
 *  - a design borrows what the app and its tests find the field by: an <image> (the football), a
 *    round-capped path (a route), or an id the field and a swatch both use → "picking", "every end zone"
 *  - a route's turf lane is missing under a design, drawn under Classic, or not clipped to the
 *    band                                                       → "picking", "every end zone"
 *  - an end zone in use goes back to classic, or can't be kept, once its count is lost → "an end zone in use"
 *  - junk in storage opens end zones, draws a design, or poisons the next count → "junk in storage"
 * The team's name
 *  - a design spells out END ZONE, or letters something other than the team's name; the name is
 *    missing from a design, or drawn past the band's edges, short or long; with no name a design
 *    still letters something (Home Team's HOME aside), or the hint doesn't say where to give one
 *                                                               → "the team's name"
 *  - the name can't be given from Play tools, a new name doesn't repaint the field or the swatches,
 *    isn't kept, or doesn't reach playbook settings          → "the team's name"
 * Touchdowns
 *  - a pass carried over the goal line isn't a touchdown, or the party starts before the ball
 *    crosses                                                    → "a pass carried over", "touchdowns ... in turn"
 *  - a catch inside the end zone isn't a touchdown              → "touchdowns ... in turn"
 *  - with the ball spotted near their goal, the goal line is still taken to be the 5's, so a
 *    short pass into the end zone doesn't count; or the deeper end zone isn't the design's band,
 *    or the goal line's 40 sits on the design                    → "with the ball near their goal"
 *  - a catch out the back of the end zone (a route drawn deep from the 5, the ball then spotted
 *    nearer their goal) counts, or moving the ball mid-play celebrates at the old goal line
 *                                                               → "a catch out the back"
 *  - on a defensive call the shadow offense scoring is celebrated as the coach's own touchdown and
 *    opens end zones                                            → "on a defensive call"
 *  - a completion short of the goal line, a throw to someone else while the primary runs into the
 *    end zone, or a play stopped early counts                   → "a completion short"
 *  - the count isn't kept, opens the wrong end zone or skips one, or a touchdown claims a new end
 *    zone once all are open                                     → "a pass carried over", "touchdowns ... in turn"
 *  - the celebration wears another end zone's colours or motion, has no banner, isn't announced,
 *    or never goes away: every piece's colour and keyframes and the banner's fill are read against
 *    the end zone's own, in Synthwave, Classic, 8-Bit and Event Horizon → "a pass carried over", "touchdowns ... in turn"
 *  - with storage blocked a touchdown throws, isn't celebrated, or what it opened can't be picked
 *    for the rest of the visit                                  → "with storage blocked"
 *  - confetti stands still with motion allowed (a fall, a drift, a rain or a burst), or shows under
 *    reduced motion; a swatch, or a design under reduced motion, animates when it must hold still
 *                                                               → "confetti moves", "every other way", "a pass carried over"
 * What must not change
 *  - printing shows the design or the lanes, hides the plain END ZONE, or changes the band's green → "printing"
 *  - thumbnails, the export preview or the share snapshot wear the device's end zone → "playbook settings"
 *  - playbook settings lack the picker, or a pick there doesn't reach the designer → "playbook settings"
 *
 * Artifacts, in test-results/: end-zones-<device>.json (every end zone, whether it drew on the
 * field and the name it lettered, and the touchdown timeline: when each celebration started against when the app's own
 * simulation says the ball crosses, where the ball was, the count stored before and after, what it
 * opened and the colours it wore, each section with the window it ran in; asserted against the
 * literal below before it is written), a picture of the top of the
 * field in each end zone (end-zones-<device>-<id>.png, sha256 in the manifest) and one mid-
 * celebration (end-zones-<device>-touchdown.png, every animation held at the same moment).
 */

/** The goal line with the ball on the 5, in yards from the line of scrimmage (every play here but RED_ZONE and OUT_THE_BACK, which work out their own). */
const GOAL = -35;
/** A phone-shaped window: with the ball on the 5, the only shape deep enough to show the end zone (the desktop and iPad cards stop short of it). */
const PHONE = { width: 412, height: 915 };
const STANDARD_ENDZONE = "rgb(167, 229, 167)";

// X (o3) runs a custom route straight up the left side: caught around the 36, carried over the goal line
const CARRY = play("fx-td-carry", "Otter End Zone", { o3: { type: "custom", primary: true, pts: [[3, -35.6]] } });
// X gets to the end zone first and drags across it: the ball is caught inside the end zone
const DRAG = play("fx-td-drag", "Otter Back Line", { o3: { type: "custom", primary: true, pts: [[3, -35.6], [25, -35.6]] } });
// the same run, pulled up two yards short of the goal line
const SHORT = play("fx-td-short", "Otter Two Short", { o3: { type: "custom", primary: true, pts: [[3, -33]] } });
// X still runs into the end zone, but a check-down out to Y is there for the other 20%
const CHECKDOWN = play("fx-td-checkdown", "Otter Check Down", { o3: { type: "custom", primary: true, pts: [[3, -35.6]] }, o4: { type: "out" } });
// the ball on their 10 (the 30): the goal line is ten yards on, and X runs two yards into the end zone
const RED_ZONE: SavedPlay = { ...play("fx-td-red-zone", "Otter Red Zone", { o3: { type: "custom", primary: true, pts: [[3, -12]] } }), los: 30 };
// X's route drawn deep from the 5, with the ball then spotted on the 20: the end line is now 30 yards
// on and X runs past it, so the catch is out the back of the end zone
const OUT_THE_BACK: SavedPlay = { ...play("fx-td-out-the-back", "Otter Out The Back", { o3: { type: "custom", primary: true, pts: [[3, -35.6]] } }), los: 20 };
// a defensive call whose shadow offense throws X a touchdown: the coach being scored on
const SCORED_ON = play("fx-td-scored-on", "Otter Goal Line D", { o3: { type: "custom", primary: true, pts: [[3, -35.6]] }, d1: { type: "zoneDeep" } }, "", "defense");
// two routes into the end zone, for the pictures: the lanes show where each one crosses the design
const GALLERY = play("fx-ez-gallery", "Otter Showcase", {
  o3: { type: "custom", primary: true, pts: [[3, -35.6]] },
  o4: { type: "custom", pts: [[27, -24], [21, -35.8]] },
});

/** What the app's own simulation says a playback does, the receiver pinned as the page pins it. */
function expected(p: SavedPlay, random = 0.1) {
  const m = buildMotion(p.players, -37, simulationPlayback(() => random));
  const td = touchdownAt(m, p.players);
  return { receiver: p.players.find((q) => q.id === m.receiver)?.label ?? null, td, catchAt: m.catchAt, dur: m.dur };
}

const picker = (scope: Page | Locator) => scope.getByRole("radiogroup", { name: "End zone" });
const swatch = (scope: Page | Locator, name: string) => picker(scope).getByRole("radio", { name, exact: true });
/** The swatch's frame, which carries its title. */
const swatchFrame = (scope: Locator, name: string) =>
  picker(scope).locator("label").filter({ has: scope.page().getByRole("radio", { name, exact: true }) });
const hint = (scope: Page | Locator) => scope.getByText(/\d of 8 open\.|All 8 open\./);
const art = (field: Locator) => field.locator("[data-ez-art]");
/** The field's own END ZONE words, not a design's lettering. */
const plainLabel = (field: Locator) => field.locator("text:not([data-ez-art] text)", { hasText: "END ZONE" });
/** A design's lettering of the team's name; it carries the text as drawn. */
const lettering = (scope: Locator) => scope.locator("[data-ez-name]");
/** The team's name as the designs letter it. */
const painted = (name: string) => name.trim().replace(/\s+/g, " ").toUpperCase();
/** The name the app stored for the team. */
const storedTeamName = (page: Page): Promise<string | null> =>
  page.evaluate((k) => (JSON.parse(localStorage.getItem(k) ?? "null") as { name?: string } | null)?.name ?? null, KEYS.team);
const lanes = (field: Locator) => field.locator("[data-lane]");
/** The classic band: the field's first rect in the end zone's green. */
const band = (field: Locator) => field.locator("rect[fill='#a7e5a7']").first();
const celebration = (page: Page) => page.locator("[data-celebration]");
const announcement = (page: Page) => page.locator("[aria-live='polite']", { hasText: "Touchdown!" });

interface Stored { zone: string | null; touchdowns: string | null }
const stored = (page: Page): Promise<Stored> =>
  page.evaluate(([z, t]) => ({ zone: localStorage.getItem(z), touchdowns: localStorage.getItem(t) }), [ENDZONE_KEY, TOUCHDOWNS_KEY] as const);

/** Writes the raw end zone keys (null removes one, undefined leaves it), as a device could hold them. */
async function store(page: Page, v: Partial<Stored>): Promise<void> {
  await page.evaluate(([keys, val]) => {
    const put = (k: string, x: string | null | undefined) => {
      if (x === null) localStorage.removeItem(k);
      else if (x !== undefined) localStorage.setItem(k, x);
    };
    put(keys[0], val.zone);
    put(keys[1], val.touchdowns);
  }, [[ENDZONE_KEY, TOUCHDOWNS_KEY], v] as const);
}

/** With the ball on the 5 the desktop and iPad cards stop short of the end zone; anything that must see it gets a phone's window. */
async function showEndZone(page: Page): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) > 500) await page.setViewportSize(PHONE);
}

/** ▶ throws to the primary read when Math.random() < 0.8; 0.1 until a test sets window.__ezRandom. */
async function pinRandom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __ezRandom?: number };
    Math.random = () => w.__ezRandom ?? 0.1;
  });
}

interface Seen {
  kind: "run" | "celebrate" | "clear";
  t: number;
  zone?: string | null;
  motion?: string | null;
  unlocked?: string | null;
  /** where the ball was, in yards, on the frame the celebration appeared and on the frame before */
  ballY?: number | null;
  ballYBefore?: number | null;
  stored?: string | null;
}

/**
 * Watches every playback from inside the page: when ▶ was pressed, the frame the celebration
 * appeared (with where the ball was then, and a frame earlier), when it went away, and the deepest
 * the ball got. The ball's spot is read off the football sticker, lift and all, in field yards.
 */
async function watchTouchdowns(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __ez: { events: Seen[]; deepest: number | null } };
    w.__ez = { events: [], deepest: null };
    const ballY = (): number | null => {
      const svg = document.querySelector("svg[aria-label='Play diagram']");
      const ball = svg?.querySelector("image");
      const vh = Number(svg?.getAttribute("viewBox")?.split(" ")[3]);
      const m = /translate\(([-\d.]+),([-\d.]+)\) scale\(([\d.]+)\)/.exec(ball?.getAttribute("transform") ?? "");
      if (!m || !vh) return null;
      // Football draws at (x, y - lift × 16) scaled 1 + lift × 0.6; the field's top is 8 - vh / 22 yards
      const lift = (Number(m[3]) - 1) / 0.6;
      return 8 - vh / 22 + (Number(m[2]) + lift * 16) / 22;
    };
    let shown: Element | null = null;
    let last: number | null = null;
    document.addEventListener("click", (e) => {
      if (!(e.target instanceof Element) || !e.target.closest("button[aria-label='Run the play']")) return;
      w.__ez.events.push({ kind: "run", t: performance.now() });
      w.__ez.deepest = null;
    }, true);
    const seen = () => {
      const c = document.querySelector("[data-celebration]");
      const y = ballY();
      if (c && c !== shown) {
        w.__ez.events.push({
          kind: "celebrate", t: performance.now(), zone: c.getAttribute("data-celebration"), motion: c.getAttribute("data-motion"),
          unlocked: c.querySelector("[data-unlocked]")?.getAttribute("data-unlocked") ?? null, ballY: y, ballYBefore: last,
          stored: localStorage.getItem("ffpd.touchdowns.v1"),
        });
      } else if (!c && shown) {
        w.__ez.events.push({ kind: "clear", t: performance.now() });
      }
      shown = c;
      if (y !== null) {
        last = y;
        w.__ez.deepest = Math.min(w.__ez.deepest ?? y, y);
      }
    };
    new MutationObserver(seen).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["transform"] });
  });
}

interface Run {
  /** seconds from ▶ to the celebration, and how long it stayed */
  celebratedAt: number | null;
  lasted: number | null;
  party: Seen | null;
  deepest: number | null;
}

/** The last playback as the page saw it. */
async function lastRun(page: Page): Promise<Run> {
  const { events, deepest } = await page.evaluate(() => (window as unknown as { __ez: { events: Seen[]; deepest: number | null } }).__ez);
  const start = events.map((e) => e.kind).lastIndexOf("run");
  const run = events[start];
  if (!run) throw new Error("▶ was never pressed");
  const after = events.slice(start + 1);
  const party = after.find((e) => e.kind === "celebrate") ?? null;
  const clear = party ? after.slice(after.indexOf(party) + 1).find((e) => e.kind === "clear") : undefined;
  return {
    celebratedAt: party ? (party.t - run.t) / 1000 : null,
    lasted: party && clear ? (clear.t - party.t) / 1000 : null,
    party,
    deepest,
  };
}

/** Presses ▶ (again if the first tap beat hydration) and waits for the play to start. */
async function runPlay(page: Page, d: Designer): Promise<void> {
  await d.foldOverlays();
  const run = page.getByRole("button", { name: "Run the play" });
  const stop = page.getByRole("button", { name: "Stop the play" });
  await expect(async () => {
    if (await run.isVisible()) await run.click();
    await expect(stop).toBeVisible({ timeout: 1_000 });
  }).toPass();
}
const playEnds = (page: Page) => expect(page.getByRole("button", { name: "Run the play" })).toBeVisible({ timeout: 15_000 });

/** Running CSS animations whose element matches (or sits inside) a selector. */
const animationsIn = (page: Page, selector: string) =>
  page.evaluate((sel) => document.getAnimations().flatMap((a) => {
    const target = a.effect instanceof KeyframeEffect ? a.effect.target : null;
    return target?.closest(sel) ? [a instanceof CSSAnimation ? a.animationName : "script"] : [];
  }), selector);

/** Ids used more than once on the page: the field and every swatch draw a design at the same time. */
const duplicateIds = (page: Page) => page.evaluate(() => {
  const ids = Array.from(document.querySelectorAll("[id]"), (e) => e.id);
  return [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
});

/**
 * Paints the whole page afresh before a picture. At one device pixel (the desktop project) a tile
 * last painted mid-animation, by a drawer sliding or a play running, can keep slightly different
 * antialiasing from run to run; after a full repaint a picture is the same pixels every time.
 */
const repaint = (page: Page) => page.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  document.body.style.visibility = "hidden";
  await frame();
  await frame();
  document.body.style.visibility = "";
  await frame();
  await frame();
});

/** A #rrggbb colour as the browser reports it. */
const rgb = (hex: string): string => {
  const n = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${n.join(", ")})`;
};

/**
 * What a celebration wears, read off the page: its pieces' colours and keyframes (resolved even
 * where reduced motion hides the pieces) and the banner's fill.
 */
const partyLook = (page: Page) => celebration(page).evaluate((c) => ({
  colors: [...new Set(Array.from(c.querySelectorAll(".ez-piece"), (p) => getComputedStyle(p).color))].sort(),
  keyframes: [...new Set(Array.from(c.querySelectorAll(".ez-piece"), (p) => getComputedStyle(p).animationName))],
  banner: getComputedStyle(c.querySelector("[data-touchdown]") ?? c).backgroundColor,
}));

/** What a celebration in `zone` must wear: its confetti colours and motion, its banner's fill. */
function lookOf(zone: string) {
  const z = END_ZONES.find((e) => e.id === zone);
  if (!z) throw new Error(`no end zone ${zone}`);
  const paint = (c: string) => rgb(c === "team" ? OTTERS.color : c);
  return { colors: z.confetti.colors.map(paint), keyframes: [`ez-${z.confetti.motion}`], banner: paint(z.banner.fill) };
}

/** Checks a celebration wears its own end zone's colours, motion and banner, and says what it wore. */
async function expectLook(page: Page, zone: string) {
  const look = await partyLook(page);
  const want = lookOf(zone);
  for (const c of look.colors) expect(want.colors, `${zone} confetti colour ${c}`).toContain(c);
  expect(look.keyframes, `${zone} confetti motion`).toEqual(want.keyframes);
  expect(look.banner, `${zone} banner`).toBe(want.banner);
  return look;
}

const round = (n: number, places = 2): number => Math.round(n * 10 ** places) / 10 ** places;
const sha = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex");

test("a fresh device keeps the classic end zone, and the picker says what is open and how to open the rest", async ({ page }) => {
  await showEndZone(page);
  await seed(page, { plays: [CARRY], team: OTTERS });
  const d = new Designer(page);
  await d.goto("?open=fx-td-carry");

  // the field as it has always been: the green band, its plain words, no design, no lanes
  await expect(band(d.field)).toHaveCSS("fill", STANDARD_ENDZONE);
  await expect(plainLabel(d.field)).toBeVisible();
  await expect(art(d.field)).toHaveCount(0);
  await expect(lanes(d.field)).toHaveCount(0);
  await expect(d.routes).toHaveCount(1);

  await d.tools();
  const tools = page.locator("#play-sidebar");
  await expect(picker(tools).getByRole("radio")).toHaveCount(END_ZONES.length);
  await expect(swatch(tools, "Classic")).toBeChecked();
  for (const z of END_ZONES) {
    const r = swatch(tools, z.name);
    const label = swatchFrame(tools, z.name);
    if (z.unlock === 0) {
      await expect(r, `${z.name} is open from the start`).toBeEnabled();
      await expect(label).toHaveAttribute("title", z.blurb);
    } else {
      await expect(r, `${z.name} waits for ${String(z.unlock)} touchdowns`).toBeDisabled();
      await expect(label).toHaveAttribute("title", `${z.blurb}. Opens at ${z.unlock === 1 ? "1 touchdown pass" : `${String(z.unlock)} touchdown passes`}.`);
      // the lock's count, on the preview (not the design's own lettering, which can hold digits too)
      await expect(label.locator("[data-lock]"), `${z.name}'s lock shows ${String(z.unlock)}`).toHaveText(String(z.unlock));
      // a screen reader hears what this one needs, then the picker's hint
      await expect(r).toHaveAccessibleDescription(
        new RegExp(
          `^Opens at ${z.unlock === 1 ? "1 touchdown pass" : `${String(z.unlock)} touchdown passes`}\\. 3 of 8 open\\. ` +
            "Throw a touchdown pass on ▶ to open Sakura: a catch in the end zone, or one carried in\\. Each design paints your team name across it\\. It comes into view",
        ),
      );
    }
  }
  await expect(hint(tools)).toHaveText(
    "3 of 8 open. Throw a touchdown pass on ▶ to open Sakura: a catch in the end zone, or one carried in. Each design paints your team name across it. " +
      "It comes into view with the ball near their goal (Line of scrimmage), or from the 5 on a tall screen. Printed pages and exports keep the classic green.",
  );
  // a locked swatch can't be picked, by a tap or by the keyboard: arrowing on from the last open
  // one wraps round to Classic, past every locked one
  await swatch(tools, "Sakura").click({ force: true });
  await expect(swatch(tools, "Classic")).toBeChecked();
  await swatch(tools, "Synthwave '84").check();
  await expect(swatch(tools, "Synthwave '84")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(swatch(tools, "Classic")).toBeChecked();
  await expect(swatch(tools, "Sakura")).not.toBeChecked();
  expect(await stored(page)).toEqual({ zone: null, touchdowns: null });
});

test("picking an open end zone paints the field on screen, outlasts a reload and reaches another tab; Classic puts the plain band back", async ({ page, context }) => {
  await showEndZone(page);
  await seed(page, { plays: [GALLERY], team: OTTERS });
  const d = new Designer(page);
  await d.goto("?open=fx-ez-gallery");
  await expect(d.routes).toHaveCount(2);
  await expect(d.primaryRoutes).toHaveCount(1);
  await expect(lanes(d.field)).toHaveCount(0);

  // a second tab on the same device, already running
  const other = await context.newPage();
  await showEndZone(other);
  const d2 = new Designer(other);
  await d2.goto("?open=fx-ez-gallery");
  await d2.tools();
  await d2.closeSidebars();
  await expect(art(d2.field)).toHaveCount(0);

  await d.tools();
  const tools = page.locator("#play-sidebar");
  await swatch(tools, "Synthwave '84").check();
  await expect(swatch(tools, "Synthwave '84")).toBeChecked();
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "synthwave");
  await expect(art(d.field)).toBeVisible();
  // the design letters itself: the plain words stay in the DOM for print, hidden on screen
  await expect(plainLabel(d.field)).toHaveCount(1);
  await expect(plainLabel(d.field)).toBeHidden();
  // every route gets a turf lane through the design, clipped to the band, and is still found as one route
  await expect(lanes(d.field)).toHaveCount(2);
  await expect(d.routes).toHaveCount(2);
  await expect(d.primaryRoutes).toHaveCount(1);
  const clip = /^url\(#(.+)\)$/.exec((await lanes(d.field).first().getAttribute("clip-path")) ?? "")?.[1] ?? "none";
  const clipRect = d.field.locator(`[id='${clip}'] rect`);
  await expect(clipRect).toHaveAttribute("y", (await band(d.field).getAttribute("y")) ?? "");
  await expect(clipRect).toHaveAttribute("height", (await band(d.field).getAttribute("height")) ?? "");
  // the football is the field's only picture, and only while a play runs
  await expect(d.field.locator("image")).toHaveCount(0);
  expect(await stored(page)).toEqual({ zone: "synthwave", touchdowns: null });

  // the other tab follows without a reload
  await expect(art(d2.field)).toHaveAttribute("data-ez-art", "synthwave");
  await expect(plainLabel(d2.field)).toBeHidden();

  await page.reload();
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "synthwave");
  await d.tools();
  await expect(swatch(tools, "Synthwave '84")).toBeChecked();

  await swatch(tools, "Home Team").check();
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "home");
  await expect(art(d2.field)).toHaveAttribute("data-ez-art", "home");

  // Classic forgets the choice and gives back the field as it was, in both tabs
  await swatch(tools, "Classic").check();
  await expect(art(d.field)).toHaveCount(0);
  await expect(lanes(d.field)).toHaveCount(0);
  await expect(plainLabel(d.field)).toBeVisible();
  expect(await stored(page)).toEqual({ zone: null, touchdowns: null });
  await expect(art(d2.field)).toHaveCount(0);
  await expect(plainLabel(d2.field)).toBeVisible();
});

test("the team's name is painted across every design and none says END ZONE; it is given in Play tools, repaints at once, is kept, and reaches playbook settings", async ({ page }) => {
  test.slow();
  await showEndZone(page);
  await seed(page, { plays: [GALLERY], team: OTTERS });
  await store(page, { touchdowns: String(Math.max(...END_ZONES.map((z) => z.unlock))) });
  const d = new Designer(page);
  await d.goto("?open=fx-ez-gallery");
  const tools = page.locator("#play-sidebar");
  const designed = END_ZONES.filter((z) => z.id !== "classic");
  // a 39-character name, the longest a coach can nearly type, for the second pass
  const long = "Riverside Otters U12 Flag Football Club";

  /** The lettering sits inside the band: never past its sides, and centred on a line within it. */
  const insideTheBand = async (zone: string) => {
    const word = lettering(art(d.field));
    await expect(word, zone).toHaveCount(1);
    const [name, box] = [await word.boundingBox(), await art(d.field).locator("xpath=..").boundingBox()];
    if (!name || !box) throw new Error(`${zone}: the lettering has no box`);
    expect(name.x, `${zone} left edge`).toBeGreaterThanOrEqual(box.x - 1);
    expect(name.x + name.width, `${zone} right edge`).toBeLessThanOrEqual(box.x + box.width + 1);
    expect(name.y + name.height / 2, `${zone} middle`).toBeGreaterThan(box.y);
    expect(name.y + name.height / 2, `${zone} middle`).toBeLessThan(box.y + box.height);
  };

  for (const teamName of [OTTERS.name, long]) {
    if (teamName !== OTTERS.name) {
      await d.tools();
      await tools.getByRole("textbox", { name: "Team name" }).fill(teamName);
    }
    for (const z of designed) {
      await d.tools();
      await swatch(tools, z.name).check();
      await expect(swatch(tools, z.name)).toBeChecked();
      await d.closeSidebars();
      await expect(art(d.field)).toHaveAttribute("data-ez-art", z.id);
      // the design letters the name, whole (8-Bit and Matrix cut only a name their band has no columns for; this one fits), and never END ZONE
      await expect(lettering(art(d.field)), z.id).toHaveAttribute("data-ez-name", painted(teamName));
      await expect(art(d.field).locator("text", { hasText: "END ZONE" }), z.id).toHaveCount(0);
      expect(await art(d.field).textContent(), z.id).not.toContain("END ZONE");
      await insideTheBand(z.id);
      // the plain words stay for print only
      await expect(plainLabel(d.field)).toBeHidden();
    }
  }
  expect(await storedTeamName(page)).toBe(long);

  // a shorter name, typed in Play tools: the field and every swatch repaint as it is typed
  await d.tools();
  const field = tools.getByRole("textbox", { name: "Team name" });
  await field.fill("Delta Force 7");
  await expect(lettering(art(d.field))).toHaveAttribute("data-ez-name", "DELTA FORCE 7");
  for (const z of designed) await expect(lettering(picker(tools).locator(`[data-ez-art='${z.id}']`)), z.id).toHaveAttribute("data-ez-name", "DELTA FORCE 7");
  await expect(hint(tools)).toContainText("Each design paints your team name across it.");
  expect(await storedTeamName(page)).toBe("Delta Force 7");

  // no name: nothing is lettered but the design (Home Team keeps its HOME), and the hint says where to give one
  await field.fill("");
  await expect(lettering(art(d.field))).toHaveCount(0);
  await expect(art(d.field).locator("text", { hasText: "END ZONE" })).toHaveCount(0);
  for (const z of designed) {
    const word = lettering(picker(tools).locator(`[data-ez-art='${z.id}']`));
    if (z.id === "home") await expect(word).toHaveAttribute("data-ez-name", "HOME");
    else await expect(word, z.id).toHaveCount(0);
  }
  await expect(hint(tools)).toContainText("Give your team a name (under Team) and each design paints it across.");
  expect(await storedTeamName(page)).toBe("");

  // the name given here is the team's everywhere: it outlasts a reload and is what playbook settings show
  await field.fill("Delta Force 7");
  await expect(lettering(art(d.field))).toHaveAttribute("data-ez-name", "DELTA FORCE 7");
  await page.reload();
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "event-horizon");
  await expect(lettering(art(d.field))).toHaveAttribute("data-ez-name", "DELTA FORCE 7");
  await page.goto("/playbooks");
  const settings = page.getByRole("button", { name: /Delta Force 7 · team, theme & backup settings/ });
  const dialog = page.getByRole("dialog", { name: "Team, theme & backup" });
  await expect(async () => {
    await settings.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(dialog.getByRole("textbox", { name: "Team name" })).toHaveValue("Delta Force 7");
  await expect(lettering(picker(dialog).locator("[data-ez-art='synthwave']"))).toHaveAttribute("data-ez-name", "DELTA FORCE 7");
});

test("a pass carried over the goal line is a touchdown: the chosen end zone celebrates, the count is kept, and Sakura opens", async ({ page }) => {
  await pinRandom(page);
  await watchTouchdowns(page);
  await seed(page, { plays: [CARRY], team: OTTERS });
  await store(page, { zone: "synthwave" });
  const d = new Designer(page);
  // on the desktop and iPad the end zone is off the top of the field: a touchdown still counts
  await d.goto("?open=fx-td-carry");
  await runPlay(page, d);

  const party = celebration(page);
  await expect(party).toHaveAttribute("data-celebration", "synthwave", { timeout: 10_000 });
  await expect(party).toHaveAttribute("data-motion", "burst");
  await expect(party.locator("[data-touchdown]")).toBeVisible();
  await expect(party.locator("[data-touchdown] > span").first()).toHaveText("TOUCHDOWN!");
  await expect(party.locator("[data-unlocked]")).toHaveText("New end zone: Sakura");
  await expect(party.locator("[data-unlocked]")).toHaveAttribute("data-unlocked", "sakura");
  await expect(announcement(page)).toHaveText("Touchdown! The Sakura end zone is open.");
  // in Synthwave's own neon and burst, under its own banner
  await expectLook(page, "synthwave");
  // reduced motion: the banner simply shows; the confetti and every design hold still
  expect(await party.locator("[data-confetti]").count()).toBeGreaterThan(0);
  await expect(party.locator("[data-confetti]:visible")).toHaveCount(0);
  expect(await animationsIn(page, "[data-celebration]")).toEqual([]);
  expect(await animationsIn(page, "[data-ez-art]")).toEqual([]);
  expect(await stored(page)).toEqual({ zone: "synthwave", touchdowns: "1" });

  await playEnds(page);
  await expect(party).toHaveCount(0, { timeout: 6_000 });
  await expect(announcement(page)).toHaveCount(0);
  const r = await lastRun(page);
  const want = expected(CARRY);
  expect(want).toMatchObject({ receiver: "X", td: expect.closeTo(5.54, 1) });
  if (want.td === null) throw new Error("the fixture no longer scores");
  // it starts on the frame the ball crosses, not before; X caught it short and carried it in
  expect(r.celebratedAt).toBeGreaterThanOrEqual(want.td - 0.02);
  expect(r.celebratedAt).toBeLessThan(want.td + 1);
  expect(r.party?.ballY).toBeLessThanOrEqual(GOAL);
  expect(r.party?.ballYBefore).toBeGreaterThan(GOAL);
  expect(r.lasted).toBeGreaterThan(3.3);
  expect(r.lasted).toBeLessThan(5);

  // the next time Play tools opens, Sakura can be picked and Matrix is next
  await d.tools();
  const tools = page.locator("#play-sidebar");
  await expect(swatch(tools, "Sakura")).toBeEnabled();
  await expect(swatch(tools, "Matrix")).toBeDisabled();
  await expect(hint(tools)).toContainText("4 of 8 open. Throw a touchdown pass on ▶ to open Matrix: a catch in the end zone, or one carried in. 1 touchdown pass on this device.");
});

test("with the ball near their goal the end zone is on every screen: the design fills its deeper band, and a short pass into it scores", async ({ page }) => {
  await pinRandom(page);
  await watchTouchdowns(page);
  await seed(page, { plays: [RED_ZONE], team: OTTERS });
  await store(page, { zone: "synthwave" });
  const d = new Designer(page);
  // no phone's window: the goal line is ten yards off, inside even the shallowest card, so the end zone is in view on every device
  await d.goto(`?open=${RED_ZONE.id}`);
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "synthwave");
  await expect(art(d.field)).toBeVisible();
  const box = art(d.field).locator("xpath=..");
  for (const k of ["y", "height"] as const) expect(await box.getAttribute(k)).toBe(await band(d.field).getAttribute(k));
  // deeper than the two yards the 5 ever shows, and never more than the ten-yard end zone
  const tall = Number(await box.getAttribute("height"));
  expect(tall).toBeGreaterThan(44);
  expect(tall).toBeLessThanOrEqual(220);
  await expect(plainLabel(d.field)).toBeHidden();
  // the goal line's number would sit on the design; it stays in the page for print
  await expect(d.field.locator("text", { hasText: /^40$/ })).toHaveCount(1);
  await expect(d.field.locator("text", { hasText: /^40$/ })).toBeHidden();
  await expect(d.field.locator("text", { hasText: "LOS 30" })).toBeVisible();
  await expect(lanes(d.field)).toHaveCount(1);

  await runPlay(page, d);
  await expect(celebration(page)).toHaveAttribute("data-celebration", "synthwave", { timeout: 10_000 });
  await expect(celebration(page).locator("[data-unlocked]")).toHaveText("New end zone: Sakura");
  expect(await stored(page)).toEqual({ zone: "synthwave", touchdowns: "1" });
  await playEnds(page);
  const r = await lastRun(page);
  // the goal line is the play's own: ten yards on from the 30, not the 5's thirty-five
  const goal = (RED_ZONE.los ?? 5) - 40;
  const td = touchdownAt(buildMotion(RED_ZONE.players, -20, simulationPlayback(() => 0.1)), RED_ZONE.players, RED_ZONE.los);
  if (td === null) throw new Error("the fixture no longer scores");
  expect(touchdownAt(buildMotion(RED_ZONE.players, -20, simulationPlayback(() => 0.1)), RED_ZONE.players)).toBeNull();
  expect(r.celebratedAt).toBeGreaterThanOrEqual(td - 0.02);
  expect(r.celebratedAt).toBeLessThan(td + 1);
  expect(r.party?.ballY).toBeLessThanOrEqual(goal);
  expect(r.deepest).toBeGreaterThan(goal - 2.5);
});

test("a completion short of the goal line, a throw to someone else while the primary runs in, and a play stopped early are not touchdowns", async ({ page }) => {
  test.slow();
  await pinRandom(page);
  await watchTouchdowns(page);
  await seed(page, { plays: [SHORT, CHECKDOWN, CARRY], team: OTTERS });
  const d = new Designer(page);

  // X catches it and runs on to the 38: two yards short
  expect(expected(SHORT)).toMatchObject({ receiver: "X", td: null });
  await d.goto("?open=fx-td-short");
  await runPlay(page, d);
  await playEnds(page);
  let r = await lastRun(page);
  expect(r.party).toBeNull();
  expect(r.deepest).toBeCloseTo(-33, 1);

  // the other 20%: Y gets the ball on the out while X runs into the end zone without it
  expect(expected(CHECKDOWN, 0.95)).toMatchObject({ receiver: "Y", td: null });
  await d.goto("?open=fx-td-checkdown");
  await page.evaluate(() => { (window as unknown as { __ezRandom: number }).__ezRandom = 0.95; });
  await runPlay(page, d);
  await playEnds(page);
  r = await lastRun(page);
  expect(r.party).toBeNull();
  expect(r.deepest).toBeGreaterThan(-3);

  // the touchdown play, stopped before the throw: nothing more happens once the whiteboard is back
  await d.goto("?open=fx-td-carry");
  await runPlay(page, d);
  await page.waitForTimeout(1_500);
  await page.getByRole("button", { name: "Stop the play" }).click();
  await playEnds(page);
  await page.waitForTimeout(Math.max(0, ((expected(CARRY).td ?? 0) - 1.5) * 1000 + 500));
  r = await lastRun(page);
  expect(r.party).toBeNull();

  await expect(celebration(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ zone: null, touchdowns: null });
});

test("a catch out the back of the end zone isn't a touchdown, and moving the ball mid-play ends the play before it can score", async ({ page }) => {
  test.slow();
  await pinRandom(page);
  await watchTouchdowns(page);
  await seed(page, { plays: [OUT_THE_BACK, CARRY], team: OTTERS });
  const d = new Designer(page);

  // X caught it near the 31 of this field, beyond the end line at -30 and off the top of the card
  const endLine = (OUT_THE_BACK.los ?? 5) - 50;
  expect(touchdownAt(buildMotion(OUT_THE_BACK.players, endLine, simulationPlayback(() => 0.1)), OUT_THE_BACK.players, OUT_THE_BACK.los)).toBeNull();
  await d.goto(`?open=${OUT_THE_BACK.id}`);
  await runPlay(page, d);
  await playEnds(page);
  const r = await lastRun(page);
  expect(r.party).toBeNull();
  expect(r.deepest).toBeLessThan(endLine);

  // the carry-in touchdown, but the ball is moved up to the 10 while X is still running, long before
  // he would cross: the play it was watching ends, and nothing is scored at a goal line that has moved
  await d.goto("?open=fx-td-carry");
  await runPlay(page, d);
  await d.tools();
  await expect(page.getByRole("button", { name: "Stop the play" })).toBeVisible();
  await page.locator("#play-sidebar").getByRole("combobox", { name: "Line of scrimmage" }).selectOption("10");
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible();
  await page.waitForTimeout(Math.max(0, (expected(CARRY).td ?? 0) * 1000) + 500);
  expect((await lastRun(page)).party).toBeNull();
  await expect(celebration(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ zone: null, touchdowns: null });
});

test("on a defensive call the shadow offense scoring is being scored on: no celebration, no count, nothing opened", async ({ page }) => {
  await pinRandom(page);
  await watchTouchdowns(page);
  await seed(page, { plays: [SCORED_ON], team: OTTERS });
  await store(page, { zone: "synthwave" });
  const d = new Designer(page);
  await d.goto(`?open=${SCORED_ON.id}`);
  // the same pass would score for the offense
  expect(expected(SCORED_ON).td).not.toBeNull();
  await runPlay(page, d);
  await playEnds(page);
  const r = await lastRun(page);
  expect(r.deepest, "the ball crossed the goal line").toBeLessThanOrEqual(GOAL);
  expect(r.party).toBeNull();
  await expect(celebration(page)).toHaveCount(0);
  await expect(announcement(page)).toHaveCount(0);
  expect(await stored(page)).toEqual({ zone: "synthwave", touchdowns: null });
});

test("an end zone in use stays drawn and checked after its touchdowns are lost, while the rest stay locked", async ({ page }) => {
  await showEndZone(page);
  await seed(page, { plays: [CARRY], team: OTTERS });
  // picked back when this device had touchdowns; the count has since been cleared
  await store(page, { zone: "matrix", touchdowns: null });
  const d = new Designer(page);
  await d.goto("?open=fx-td-carry");
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "matrix");
  await expect(plainLabel(d.field)).toBeHidden();

  await d.tools();
  const tools = page.locator("#play-sidebar");
  await expect(swatch(tools, "Matrix")).toBeChecked();
  await expect(swatch(tools, "Matrix")).toBeEnabled();
  await expect(swatchFrame(tools, "Matrix")).toHaveAttribute("title", "Green code raining down a black end zone");
  for (const name of ["Sakura", "Great Wave", "8-Bit", "Event Horizon"]) await expect(swatch(tools, name)).toBeDisabled();
  await expect(hint(tools)).toContainText("3 of 8 open. Throw a touchdown pass on ▶ to open Sakura");

  // leaving it locks it again, as its count says
  await swatch(tools, "Home Team").check();
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "home");
  await expect(swatch(tools, "Matrix")).toBeDisabled();
  expect(await stored(page)).toEqual({ zone: "home", touchdowns: null });
});

test("junk in storage falls back to the classic end zone and no touchdowns, and the next touchdown counts from one", async ({ page }) => {
  test.slow();
  await showEndZone(page);
  await pinRandom(page);
  await seed(page, { plays: [CARRY], team: OTTERS });
  const d = new Designer(page);
  const tools = page.locator("#play-sidebar");
  const junk: Stored[] = [
    { zone: "aurora", touchdowns: "-2" },
    { zone: "Synthwave", touchdowns: "2.5" },
    { zone: '"sakura"', touchdowns: "1e3" },
    { zone: "", touchdowns: "12345678901" },
    { zone: " matrix", touchdowns: "five" },
  ];
  for (const j of junk) {
    await store(page, j);
    await d.goto("?open=fx-td-carry");
    await d.tools();
    await expect(swatch(tools, "Classic"), JSON.stringify(j)).toBeChecked();
    await expect(swatch(tools, "Sakura"), JSON.stringify(j)).toBeDisabled();
    await expect(hint(tools)).toContainText("3 of 8 open.");
    await expect(hint(tools)).not.toContainText("on this device");
    await d.closeSidebars();
    await expect(art(d.field)).toHaveCount(0);
    await expect(plainLabel(d.field)).toBeVisible();
  }

  await runPlay(page, d);
  await expect(celebration(page).locator("[data-unlocked]")).toHaveAttribute("data-unlocked", "sakura", { timeout: 10_000 });
  expect(await stored(page)).toEqual({ zone: " matrix", touchdowns: "1" });
});

test("with storage blocked a touchdown still celebrates, and what it opened can be picked until the page closes", async ({ page }) => {
  await showEndZone(page);
  await armSabotage(page);
  await pinRandom(page);
  await seed(page, { plays: [CARRY], team: OTTERS });
  const d = new Designer(page);
  await d.goto("?open=fx-td-carry");
  await sabotage(page, "quota", true);

  await runPlay(page, d);
  await expect(celebration(page)).toHaveAttribute("data-celebration", "classic", { timeout: 10_000 });
  await expect(celebration(page).locator("[data-unlocked]")).toHaveText("New end zone: Sakura");
  await expect(announcement(page)).toHaveText("Touchdown! The Sakura end zone is open.");
  expect(await stored(page)).toEqual({ zone: null, touchdowns: null });
  await playEnds(page);

  await d.tools();
  const tools = page.locator("#play-sidebar");
  await expect(hint(tools)).toContainText("4 of 8 open. Throw a touchdown pass on ▶ to open Matrix");
  await expect(hint(tools)).toContainText("1 touchdown pass on this device.");
  await swatch(tools, "Sakura").check();
  await expect(swatch(tools, "Sakura")).toBeChecked();
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "sakura");
  expect(await stored(page)).toEqual({ zone: null, touchdowns: null });

  // nothing was kept, so a new visit starts over
  await page.reload();
  await expect(d.field).toBeVisible();
  await d.tools();
  await expect(swatch(tools, "Classic")).toBeChecked();
  await expect(swatch(tools, "Sakura")).toBeDisabled();
  await expect(art(d.field)).toHaveCount(0);
});

test("printing keeps the classic end zone: no design, no lanes, the plain words and the standard green", async ({ page }) => {
  await showEndZone(page);
  await seed(page, { plays: [GALLERY], team: OTTERS });
  await store(page, { zone: "synthwave" });
  const d = new Designer(page);
  await d.goto("?open=fx-ez-gallery");
  await expect(art(d.field)).toBeVisible();
  await expect(lanes(d.field).first()).toBeVisible();
  await expect(plainLabel(d.field)).toBeHidden();

  await page.emulateMedia({ media: "print" });
  await expect(art(d.field)).toBeHidden();
  for (const lane of await lanes(d.field).all()) await expect(lane).toBeHidden();
  await expect(plainLabel(d.field)).toBeVisible();
  await expect(band(d.field)).toHaveCSS("fill", STANDARD_ENDZONE);
  await expect(d.routes).toHaveCount(2);

  await page.emulateMedia({ media: "screen" });
  await expect(art(d.field)).toBeVisible();
});

test("playbook settings have the same picker, and pictures made from plays never wear the device's end zone", async ({ page }) => {
  await showEndZone(page);
  const book = playbook("fx-ez-book", "Otter Red Zone", [CARRY]);
  await seed(page, { plays: [CARRY], playbooks: [book], team: OTTERS });
  await store(page, { zone: "synthwave", touchdowns: "2" });

  await page.goto("/playbooks");
  const thumb = page.getByRole("img", { name: CARRY.name }).first();
  await expect(thumb).toBeVisible();
  await expect(art(thumb)).toHaveCount(0);
  await expect(lanes(thumb)).toHaveCount(0);

  const settings = page.getByRole("button", { name: /team, theme & backup settings/ });
  const dialog = page.getByRole("dialog", { name: "Team, theme & backup" });
  // the first tap after a navigation can land before React has hydrated; tap again if it did
  await expect(async () => {
    await settings.click();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass();
  await expect(picker(dialog).getByRole("radio")).toHaveCount(END_ZONES.length);
  await expect(swatch(dialog, "Synthwave '84")).toBeChecked();
  for (const z of END_ZONES) {
    if (z.unlock <= 2) await expect(swatch(dialog, z.name), z.name).toBeEnabled();
    else await expect(swatch(dialog, z.name), z.name).toBeDisabled();
  }
  await expect(hint(dialog)).toContainText("5 of 8 open. Throw a touchdown pass on ▶ to open Great Wave: a catch in the end zone, or one carried in. 2 touchdown passes on this device.");
  await swatch(dialog, "Matrix").check();
  await expect(swatch(dialog, "Matrix")).toBeChecked();
  expect(await stored(page)).toEqual({ zone: "matrix", touchdowns: "2" });
  await expect(art(thumb)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await page.goto(`/playbooks?book=${book.id}`);
  const preview = page.getByRole("img", { name: "Playbook PDF preview" });
  await expect(preview).toBeVisible();
  await expect(art(preview)).toHaveCount(0);
  await expect(lanes(preview)).toHaveCount(0);

  // the designer wears what settings picked; the snapshot a coach shares does not
  const d = new Designer(page);
  await d.goto("?open=fx-td-carry");
  await expect(art(d.field)).toHaveAttribute("data-ez-art", "matrix");
  await d.clickTool("Copy share link");
  const snapshot = page.getByRole("dialog", { name: "Share snapshot" }).getByRole("img", { name: /snapshot preview/ });
  await expect(snapshot).toBeVisible();
  await expect(art(snapshot)).toHaveCount(0);
  await expect(lanes(snapshot)).toHaveCount(0);
});

test.describe("with motion allowed", () => {
  test.use({ reducedMotion: "no-preference" });

  test("confetti moves in the end zone's own way while the swatches hold still, with a picture mid-celebration", async ({ page }, testInfo) => {
    await showEndZone(page);
    await pinRandom(page);
    await seed(page, { plays: [CARRY], team: OTTERS });
    await store(page, { zone: "sakura", touchdowns: "1" });
    const d = new Designer(page);
    await d.goto("?open=fx-td-carry");
    await expect(art(d.field)).toHaveAttribute("data-ez-art", "sakura");
    // a swatch previews its design standing still, even with motion allowed
    await d.tools();
    await expect(picker(page.locator("#play-sidebar"))).toBeVisible();
    expect(await animationsIn(page, "[role='radiogroup'][aria-label='End zone']")).toEqual([]);

    await runPlay(page, d);
    const party = celebration(page);
    await expect(party).toHaveAttribute("data-celebration", "sakura", { timeout: 10_000 });
    await expect(party).toHaveAttribute("data-motion", "drift");
    await expect(party.locator("[data-unlocked]")).toHaveText("New end zone: Matrix");
    const pieces = party.locator("[data-confetti]");
    const count = await pieces.count();
    expect(count).toBeGreaterThan(20);
    await expect(party.locator("[data-confetti]:not([data-confetti='petal'])")).toHaveCount(0);
    await expect(party.locator("[data-confetti]:visible")).toHaveCount(count);
    // every piece runs the petals' drift, and the banner pops in
    const names = await animationsIn(page, "[data-celebration]");
    expect(names.filter((n) => n === "ez-drift")).toHaveLength(count);
    expect(names).toContain("ez-banner");
    // and they really move
    const spots = () => pieces.evaluateAll((els) => els.map((el) => getComputedStyle(el).transform));
    const before = await spots();
    // longer than any piece waits to start
    await page.waitForTimeout(700);
    const after = await spots();
    expect(before.filter((t, i) => t !== after[i]).length).toBeGreaterThan(count * 0.8);

    // once the play is back on the whiteboard, hold every animation at the same moment for the picture
    await playEnds(page);
    await expect(party).toBeVisible();
    await page.evaluate(() => {
      for (const a of document.getAnimations()) {
        a.pause();
        a.currentTime = 1500;
      }
    });
    await repaint(page);
    await party.screenshot({ path: `test-results/end-zones-${testInfo.project.name}-touchdown.png` });
    await expect(party).toHaveCount(0, { timeout: 6_000 });
  });
});

test.describe("with motion allowed, every other way", () => {
  test.use({ reducedMotion: "no-preference" });

  test("confetti falls, rains and bursts in the end zone's own way: every piece runs its motion and really moves", async ({ page }) => {
    test.slow();
    await showEndZone(page);
    await pinRandom(page);
    await seed(page, { plays: [CARRY], team: OTTERS });
    const d = new Designer(page);
    // Sakura's drift has its own test above
    for (const zone of ["classic", "matrix", "synthwave"]) {
      await store(page, { zone: zone === "classic" ? null : zone, touchdowns: "5" });
      await d.goto("?open=fx-td-carry");
      await runPlay(page, d);
      const party = celebration(page);
      await expect(party).toHaveAttribute("data-celebration", zone, { timeout: 12_000 });
      const want = lookOf(zone);
      await expectLook(page, zone);
      const pieces = party.locator("[data-confetti]");
      const count = await pieces.count();
      expect(count, zone).toBeGreaterThan(20);
      const names = await animationsIn(page, "[data-celebration]");
      expect(names.filter((n) => n === want.keyframes[0]), zone).toHaveLength(count);
      const spots = () => pieces.evaluateAll((els) => els.map((el) => getComputedStyle(el).transform));
      const before = await spots();
      await page.waitForTimeout(700);
      const after = await spots();
      // a rain starts its drops over more than a second, so fewer are under way this early
      expect(before.filter((t, i) => t !== after[i]).length, zone).toBeGreaterThan(count * (zone === "matrix" ? 0.4 : 0.8));
      await playEnds(page);
      await expect(party).toHaveCount(0, { timeout: 6_000 });
    }
  });
});

test.describe("the end zones manifest", () => {
  test.describe.configure({ mode: "serial" });

  type Size = { width: number; height: number } | null;
  const manifest: { project: string; zonesViewport: Size; touchdownsViewport: Size; zones: unknown[]; touchdowns: unknown[] } = {
    project: "", zonesViewport: null, touchdownsViewport: null, zones: [], touchdowns: [],
  };

  test("every end zone draws its own design in the band on screen, with a picture of each", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    await showEndZone(page);
    await seed(page, { plays: [GALLERY], team: OTTERS });
    // enough touchdowns to open every one
    await store(page, { touchdowns: String(Math.max(...END_ZONES.map((z) => z.unlock))) });
    const d = new Designer(page);
    await d.goto("?open=fx-ez-gallery");
    const tools = page.locator("#play-sidebar");
    manifest.project = project;
    manifest.zonesViewport = page.viewportSize();
    const bandHeight = Number(await band(d.field).getAttribute("height"));
    // the field letters the end zone when there is room, and so does a design
    const lettered = bandHeight > 30;

    for (const z of END_ZONES) {
      await d.tools();
      await expect(swatch(tools, z.name)).toBeEnabled();
      await swatch(tools, z.name).check();
      await expect(swatch(tools, z.name)).toBeChecked();
      expect((await stored(page)).zone).toBe(z.id === "classic" ? null : z.id);
      await d.closeSidebars();

      const designed = z.id !== "classic";
      if (designed) {
        await expect(art(d.field)).toHaveAttribute("data-ez-art", z.id);
        await expect(art(d.field)).toBeVisible();
        // drawn in a box that is exactly the band, which clips it (a design may reach past it, as a
        // scrolling pattern does, so what counts is the box, not the bounds of what is drawn in it)
        const box = art(d.field).locator("xpath=..");
        await expect(box).toHaveAttribute("overflow", "hidden");
        for (const k of ["x", "y", "width", "height"] as const) {
          expect(await box.getAttribute(k), `${z.id} ${k}`).toBe(await band(d.field).getAttribute(k));
        }
        await expect(plainLabel(d.field)).toBeHidden();
      } else {
        await expect(art(d.field)).toHaveCount(0);
        if (lettered) await expect(plainLabel(d.field)).toBeVisible();
      }
      await expect(lanes(d.field)).toHaveCount(designed ? 2 : 0);
      await expect(d.routes).toHaveCount(2);
      await expect(d.field.locator("image")).toHaveCount(0);
      expect(await duplicateIds(page), z.id).toEqual([]);

      // the band and a few yards of turf under it
      const field = await d.field.boundingBox();
      const b = await band(d.field).boundingBox();
      const vh = Number((await d.field.getAttribute("viewBox"))?.split(" ")[3]);
      if (!field || !b || !vh) throw new Error("the field has not laid out");
      const yard = (field.height * 22) / vh;
      const picture = `end-zones-${project}-${z.id}.png`;
      await repaint(page);
      await page.screenshot({ path: `test-results/${picture}`, clip: { x: field.x, y: field.y, width: field.width, height: b.y + b.height - field.y + 4 * yard } });

      manifest.zones.push({
        id: z.id, name: z.name, opensAt: z.unlock,
        drawn: (await art(d.field).count()) === 1 && (await art(d.field).isVisible()),
        plainLabelOnScreen: await plainLabel(d.field).isVisible(),
        lettered: (await lettering(d.field).count()) === 1 ? await lettering(d.field).getAttribute("data-ez-name") : null,
        lanes: await lanes(d.field).count(),
        routes: await d.routes.count(),
        picture, sha256: sha(`test-results/${picture}`),
      });
    }

    expect(manifest.zones).toEqual(END_ZONES.map((z) => ({
      id: z.id, name: z.name, opensAt: z.unlock,
      drawn: z.id !== "classic",
      plainLabelOnScreen: z.id === "classic" && lettered,
      // a design letters the team's name where the field would letter END ZONE
      lettered: z.id !== "classic" && lettered ? painted(OTTERS.name) : null,
      lanes: z.id === "classic" ? 0 : 2,
      routes: 2,
      picture: `end-zones-${project}-${z.id}.png`,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })));
  });

  test("touchdowns carried in or caught in the end zone open each end zone in turn, and once all are open one just celebrates", async ({ page }, testInfo) => {
    test.slow();
    const project = testInfo.project.name;
    // the device's own window: on the desktop and iPad the end zone is off the card, and a touchdown still counts
    manifest.touchdownsViewport = page.viewportSize();
    await pinRandom(page);
    await watchTouchdowns(page);
    await seed(page, { plays: [CARRY, DRAG], team: OTTERS });
    const d = new Designer(page);
    const tools = page.locator("#play-sidebar");

    // the first touchdown on a device; then one when 4 are already thrown (in the 8-Bit end zone it
    // opened), which opens the last; then one in that last end zone, with nothing left to open
    const steps = [
      { play: CARRY, how: "carried in", before: null as string | null, pick: null as string | null },
      { play: DRAG, how: "caught in the end zone", before: "4", pick: "8-Bit" },
      { play: CARRY, how: "carried in", before: null, pick: "Event Horizon" },
    ];
    for (const s of steps) {
      if (s.before !== null) await store(page, { touchdowns: s.before });
      await d.goto(`?open=${s.play.id}`);
      if (s.pick) {
        await d.tools();
        await swatch(tools, s.pick).check();
        await expect(swatch(tools, s.pick)).toBeChecked();
      }
      const before = await stored(page);
      await runPlay(page, d);
      const party = celebration(page);
      await expect(party).toHaveAttribute("data-celebration", before.zone ?? "classic", { timeout: 12_000 });
      const unlocked = party.locator("[data-unlocked]");
      const bannerLine = (await unlocked.count()) ? await unlocked.textContent() : null;
      const announced = await announcement(page).textContent();
      const look = await expectLook(page, before.zone ?? "classic");
      const after = await stored(page);
      await playEnds(page);
      const r = await lastRun(page);
      const want = expected(s.play);
      if (want.td === null || r.celebratedAt === null || !r.party) throw new Error(`${s.play.name} did not score`);
      // on the frame the ball is first on or over the goal line, and not before
      expect(r.celebratedAt, s.play.name).toBeGreaterThanOrEqual(want.td - 0.02);
      expect(r.celebratedAt, s.play.name).toBeLessThan(want.td + 1);
      expect(r.party.ballY, s.play.name).toBeLessThanOrEqual(GOAL);
      if (s.how === "carried in") expect(r.party.ballYBefore, s.play.name).toBeGreaterThan(GOAL);
      // a catch in the end zone scores on the catch itself
      else expect(want.td).toBe(want.catchAt);
      manifest.touchdowns.push({
        play: s.play.name, how: s.how, receiver: want.receiver, zone: r.party.zone, motion: r.party.motion,
        expectedAt: round(want.td), celebrationAt: round(r.celebratedAt), ballYards: round(r.party.ballY ?? NaN),
        storedBefore: before.touchdowns, storedAfter: after.touchdowns, storedAtCelebration: r.party.stored,
        opened: r.party.unlocked, bannerLine, announced, colors: look.colors.length, banner: look.banner,
      });
    }

    await d.tools();
    for (const z of END_ZONES) await expect(swatch(tools, z.name), z.name).toBeEnabled();
    await expect(hint(tools)).toContainText("All 8 open. 6 touchdown passes on this device.");

    expect(manifest.zones, "the pictures of every end zone come first in this group").toHaveLength(END_ZONES.length);
    const at = expect.any(Number);
    expect(manifest).toEqual({
      project,
      zonesViewport: { width: expect.any(Number), height: expect.any(Number) },
      touchdownsViewport: { width: expect.any(Number), height: expect.any(Number) },
      zones: expect.any(Array),
      touchdowns: [
        {
          play: "Otter End Zone", how: "carried in", receiver: "X", zone: "classic", motion: "fall", expectedAt: 5.54, celebrationAt: at, ballYards: at,
          storedBefore: null, storedAfter: "1", storedAtCelebration: "1", opened: "sakura", bannerLine: "New end zone: Sakura",
          announced: "Touchdown! The Sakura end zone is open.", colors: at, banner: rgb("#f2b705"),
        },
        {
          play: "Otter Back Line", how: "caught in the end zone", receiver: "X", zone: "eight-bit", motion: "fall", expectedAt: 6.1, celebrationAt: at,
          ballYards: -35.6, storedBefore: "4", storedAfter: "5", storedAtCelebration: "5", opened: "event-horizon",
          bannerLine: "New end zone: Event Horizon", announced: "Touchdown! The Event Horizon end zone is open.", colors: at, banner: rgb("#000000"),
        },
        {
          play: "Otter End Zone", how: "carried in", receiver: "X", zone: "event-horizon", motion: "burst", expectedAt: 5.54, celebrationAt: at, ballYards: at,
          storedBefore: "5", storedAfter: "6", storedAtCelebration: "6", opened: null, bannerLine: null, announced: "Touchdown!", colors: at,
          banner: rgb("#0b0a1a"),
        },
      ],
    });
    const file = `test-results/end-zones-${project}.json`;
    writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
    await testInfo.attach("end zones manifest", { path: file, contentType: "application/json" });
  });
});

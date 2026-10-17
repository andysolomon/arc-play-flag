import { writeFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import { BACKFIELD_REACH } from "../../lib/play/blitz";
import { INK } from "../../lib/play/routes";
import { PLAYS_KEY } from "../../lib/play/storage";
import type { Route, SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * Who a blitz comes for (lib/play/blitz.ts). Every blitz comes for the quarterback unless the coach aims
 * it: at the backfield, where it comes for the nearest back lined up near the ball and for the quarterback
 * when nobody is back there, or at one red player, tapped on the field or picked by keyboard the way a
 * man target is. The arrow on the field turns to whoever it comes for, the palette says who that is, undo
 * and redo carry the aim, the saved play stores nothing for the quarterback, `aim` for the backfield and
 * `target` for a player, and the arrow reads the same on the reopened play and the share page. Leaves
 * `blitz-target-<device>.json` (each step's pills, caption, stored route and the arrow's heading beside the
 * heading to its target) and pictures of the palette and the field in `test-results/`.
 */

const PLAY = "Otter Fire Zone";
/** The heading of a blitz arrow, measured in the picture, is within this many degrees of the line to its target. */
const TOLERANCE = 2;

interface Arrow {
  /** where the arrow starts, in the picture's units */
  from: [number, number];
  /** the way it points, in degrees */
  heading: number;
}

/** The centre of a player's token in the picture, from its transform. */
async function tokenAt(svg: Locator, name: string): Promise<[number, number]> {
  const t = await svg.locator(`[aria-label="${name}"]`).first().getAttribute("transform");
  const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(t ?? "");
  if (!m?.[1] || !m[2]) throw new Error(`no token for ${name}`);
  return [Number(m[1]), Number(m[2])];
}

const degrees = (dx: number, dy: number): number => (Math.atan2(dy, dx) * 180) / Math.PI;
/** The smallest angle between two headings. */
const apart = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);

/** The blitz arrow drawn from a defender: the blitz-ink path that starts nearest their token. */
async function blitzArrow(svg: Locator, blitzer: string): Promise<Arrow> {
  const [cx, cy] = await tokenAt(svg, `Defense ${blitzer}`);
  const ds = await svg.locator(`path[stroke="${INK.blitz}"]`).evaluateAll((els) => els.map((el) => el.getAttribute("d") ?? ""));
  const arrows = ds.flatMap((d) => {
    const nums = d.match(/[-\d.]+/g)?.map(Number) ?? [];
    const x0 = nums[0], y0 = nums[1], x1 = nums[nums.length - 2], y1 = nums[nums.length - 1];
    if (nums.length < 4 || x0 === undefined || y0 === undefined || x1 === undefined || y1 === undefined) return [];
    return [{ from: [x0, y0] as [number, number], heading: degrees(x1 - x0, y1 - y0), gap: Math.hypot(x0 - cx, y0 - cy) }];
  });
  const mine = arrows.sort((a, b) => a.gap - b.gap)[0];
  if (!mine) throw new Error(`no blitz arrow from ${blitzer}`);
  return { from: mine.from, heading: mine.heading };
}

/** The heading from a defender's token to another player's token. */
async function lineTo(svg: Locator, blitzer: string, target: string): Promise<number> {
  const [ax, ay] = await tokenAt(svg, `Defense ${blitzer}`);
  const [bx, by] = await tokenAt(svg, target);
  return degrees(bx - ax, by - ay);
}

interface Step {
  step: string;
  /** which pill was pressed, and what the last one (Pick a player) said */
  pills?: { qb: boolean; backfield: boolean; contain: boolean; player: boolean; playerText: string };
  caption?: string;
  arrow: { blitzer: string; target: string; heading: number; toTarget: number; apart: number };
  stored?: Route | null;
}

test("a blitz comes for the quarterback, the backfield or the player the coach picks, on the field, in the saved play and in the share link", async ({ page }, testInfo) => {
  const d = new Designer(page);
  const steps: Step[] = [];
  const device = testInfo.project.name;
  const group = page.locator("#route-sidebar").getByRole("group", { name: "Blitz target" });
  const pill = (name: string | RegExp) => group.getByRole("button", { name, exact: typeof name === "string" });
  const caption = group.getByText(/Comes for/);

  /** The palette's BLITZ pills as they read, with the palette open. */
  async function pills(): Promise<NonNullable<Step["pills"]>> {
    await d.palette();
    await expect(group).toBeVisible();
    const pressed = async (l: Locator) => (await l.getAttribute("aria-pressed")) === "true";
    const player = pill(/^(Pick a player|On )/);
    return {
      qb: await pressed(pill("QB")), backfield: await pressed(pill("Backfield")), contain: await pressed(pill("Contain")), player: await pressed(player),
      playerText: (await player.textContent()) ?? "",
    };
  }

  /** The arrow from a blitzer points at a target: measured in the picture, within TOLERANCE degrees. */
  async function aimedAt(svg: Locator, blitzer: string, target: string, step: string, extra: Partial<Step> = {}): Promise<void> {
    let last: Step["arrow"] | null = null;
    await expect(async () => {
      const arrow = await blitzArrow(svg, blitzer);
      const toTarget = await lineTo(svg, blitzer, target);
      last = { blitzer, target, heading: arrow.heading, toTarget, apart: apart(arrow.heading, toTarget) };
      expect(last.apart).toBeLessThanOrEqual(TOLERANCE);
    }).toPass();
    if (last) steps.push({ step, arrow: last, ...extra });
  }

  /** Steps a red player across the field by keyboard, a yard a press. */
  async function nudge(label: string, key: "ArrowLeft" | "ArrowRight", yards: number): Promise<void> {
    await d.foldOverlays();
    const token = d.player(label);
    await token.focus();
    for (let i = 0; i < yards; i++) await page.keyboard.press(key);
  }

  const stored = async (): Promise<Record<string, Route | null>> =>
    page.evaluate((key) => {
      const lib = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, SavedPlay>;
      const play = Object.values(lib).find((p) => p.name === "Otter Fire Zone");
      return Object.fromEntries((play?.players ?? []).filter((p) => p.team === "defense").map((p) => [p.label, p.route]));
    }, PLAYS_KEY);

  await d.goto();
  await d.newPlay("Defense");

  // the default: a blitz comes for the quarterback, and says so
  await d.select("R", "Defense");
  await d.pick("Blitz");
  let read = await pills();
  expect(read).toEqual({ qb: true, backfield: false, contain: false, player: false, playerText: "Pick a player" });
  await expect(caption).toHaveText(/Comes for the quarterback/);
  await aimedAt(d.field, "R", "Offense QB", "picked Blitz: the quarterback by default", { pills: read, caption: await caption.textContent() ?? "" });

  // aimed at the backfield: Z lines up 4 yards off the quarterback, so it comes for Z
  await pill("Backfield").click();
  read = await pills();
  expect(read).toEqual({ qb: false, backfield: true, contain: false, player: false, playerText: "Pick a player" });
  await expect(caption).toHaveText(/nearest back lined up near the ball: Z now/);
  await aimedAt(d.field, "R", "Offense Z", "Backfield: comes for Z, the back beside the quarterback", { pills: read, caption: await caption.textContent() ?? "" });
  await page.locator("#route-sidebar").screenshot({ path: `test-results/blitz-target-${device}-palette.png` });

  // with Z split out wide, past reach of the ball, nobody is in the backfield: the quarterback again
  await nudge("Z", "ArrowRight", BACKFIELD_REACH + 1);
  await aimedAt(d.field, "R", "Offense QB", "Z moved wide: nobody in the backfield, so the quarterback");
  await d.select("R", "Defense");
  read = await pills();
  expect(read.backfield).toBe(true);
  await expect(caption).toHaveText(/Nobody is back there now, so it comes for the quarterback/);
  const wide = steps.pop();
  if (wide) steps.push({ ...wide, pills: read, caption: await caption.textContent() ?? "" });
  // and back beside the quarterback, Z is the back again
  await nudge("Z", "ArrowLeft", BACKFIELD_REACH + 1);
  await aimedAt(d.field, "R", "Offense Z", "Z moved back: comes for Z again");

  // aimed at one player: Pick a player asks for a red player, like Man, and X is tapped on the field
  await d.select("R", "Defense");
  await d.palette();
  await pill("Pick a player").click();
  await expect(d.toast).toHaveText("Blitz who? Tap a red player.");
  const x = page.getByRole("button", { name: "Offense X, blitz target", exact: true });
  await expect(x).toBeVisible();
  await d.foldOverlays();
  await x.click();
  await expect(d.toast).toBeHidden();
  read = await pills();
  expect(read).toEqual({ qb: false, backfield: false, contain: false, player: true, playerText: "On X" });
  await expect(caption).toHaveText("Comes for X, wherever they line up.");
  await aimedAt(d.field, "R", "Offense X", "Pick a player, X tapped: comes for X", { pills: read, caption: await caption.textContent() ?? "" });
  await d.closeSidebars();
  await d.field.screenshot({ path: `test-results/blitz-target-${device}-field.png` });

  // undo and redo carry the aim
  await d.undo.click();
  await aimedAt(d.field, "R", "Offense Z", "Undo: the backfield again");
  await d.redo.click();
  await aimedAt(d.field, "R", "Offense X", "Redo: X again");

  // by keyboard: Pick a player moves focus to the first red player, and Enter picks them; Escape cancels a pick
  await d.select("LB", "Defense");
  await d.pick("Blitz");
  await aimedAt(d.field, "LB", "Offense QB", "LB picked Blitz: the quarterback by default");
  await d.palette();
  await pill("Pick a player").click();
  await expect(page.getByRole("button", { name: "Offense C, blitz target", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  read = await pills();
  expect(read).toEqual({ qb: false, backfield: false, contain: false, player: true, playerText: "On C" });
  await aimedAt(d.field, "LB", "Offense C", "Pick a player, Enter on C: LB comes for C", { pills: read });
  await pill("On C").click();
  await expect(d.toast).toHaveText("Blitz who? Tap a red player.");
  await page.keyboard.press("Escape");
  await expect(d.toast).toBeHidden();
  await aimedAt(d.field, "LB", "Offense C", "Escape: the pick is cancelled and LB still comes for C");

  // saved: a player's blitz stores its target, the backfield's its aim, and the quarterback's nothing at all
  await d.setName(PLAY);
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  let routes = await stored();
  expect(routes.R).toEqual({ type: "blitz", target: "o3" });
  expect(routes.LB).toEqual({ type: "blitz", target: "o1" });
  /** The last arrow measured, for the steps that only read storage. */
  const lastArrow = (): Step["arrow"] => steps[steps.length - 1]?.arrow ?? { blitzer: "R", target: "", heading: 0, toTarget: 0, apart: 0 };
  steps.push({ step: "saved with R on X and LB on C", arrow: lastArrow(), stored: routes.R });
  await d.select("R", "Defense");
  await d.palette();
  await pill("Backfield").click();
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  routes = await stored();
  expect(routes.R).toEqual({ type: "blitz", aim: "backfield" });
  steps.push({ step: "saved aimed at the backfield", arrow: lastArrow(), stored: routes.R });
  await d.palette();
  await pill("QB").click();
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  routes = await stored();
  expect(routes.R).toEqual({ type: "blitz" });
  expect(Object.keys(routes.R ?? {})).toEqual(["type"]);
  steps.push({ step: "saved aimed at the quarterback: nothing but the blitz is stored", arrow: lastArrow(), stored: routes.R });
  // back on X for the reopen and the share
  await d.palette();
  await pill("Pick a player").click();
  await d.foldOverlays();
  await x.click();
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  routes = await stored();
  expect(routes.R).toEqual({ type: "blitz", target: "o3" });

  // reopened: both arrows point where they did, and the palette says so
  await d.openSaved(PLAY);
  await aimedAt(d.field, "R", "Offense X", "reopened: R comes for X", { stored: routes.R });
  await aimedAt(d.field, "LB", "Offense C", "reopened: LB comes for C", { stored: routes.LB });
  await d.select("R", "Defense");
  read = await pills();
  expect(read).toEqual({ qb: false, backfield: false, contain: false, player: true, playerText: "On X" });

  // the share link: the snapshot draws the defense and its blitzes still turn to the players they come for
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]+$/);
  // the arrows' headings from the designer: the share page draws the defense alone, so its targets' tokens are not there to measure against
  const toX = await lineTo(d.field, "R", "Offense X");
  const toC = await lineTo(d.field, "LB", "Offense C");
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared.getByRole("img", { name: /^Defense / })).toHaveCount(5);
  await expect(shared.getByRole("img", { name: /^Offense / })).toHaveCount(0);
  for (const [blitzer, target, toTarget] of [["R", "Offense X", toX], ["LB", "Offense C", toC]] as const) {
    const arrow = await blitzArrow(shared, blitzer);
    const away = apart(arrow.heading, toTarget);
    expect(away).toBeLessThanOrEqual(TOLERANCE);
    steps.push({ step: `share page: ${blitzer} comes for ${target.replace("Offense ", "")}`, arrow: { blitzer, target, heading: arrow.heading, toTarget, apart: away } });
  }

  writeFileSync(`test-results/blitz-target-${device}.json`, `${JSON.stringify({ play: PLAY, tolerance: TOLERANCE, steps }, null, 2)}\n`);
});

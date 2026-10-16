import { writeFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import { binderPages } from "../../lib/export/binder";
import { slidePlans } from "../../lib/export/slides";
import { BLITZ_STOP, CONTAIN_LEAD, CONTAIN_WIDTH } from "../../lib/play/blitz";
import { S } from "../../lib/play/geometry";
import { INK, X_MIN } from "../../lib/play/routes";
import { PLAYS_KEY } from "../../lib/play/storage";
import type { Route, SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { OTTERS } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * A contain blitz (lib/play/blitz.ts, C1–C9): the palette's BLITZ pills gain **Contain**, and the rusher
 * goes up the edge on their own side of the quarterback to a landmark CONTAIN_WIDTH outside and
 * CONTAIN_LEAD in front of them, then turns in, the arrow stopping BLITZ_STOP short of them. Every path is
 * measured in the picture against the quarterback's token: R on the right contains the right edge, LB on
 * the left the left; R moved across the quarterback contains the other edge, and right over them (dead
 * centre) the left. A quarterback near the sideline pulls the landmark inside it, and one against it
 * leaves no edge, so the blitz comes straight and the palette says so. Undo and redo carry the aim, the
 * saved play stores `aim: "contain"` (and QB stores nothing but the blitz), the reopened play and the
 * share page draw the same paths, and the printouts name it "Contain" with the job "Contain blitz".
 * Leaves `contain-blitz-<device>.json` (every step's pills, caption, measured path in yards from the
 * quarterback and stored route) and pictures of the palette, the field and a printed binder page in
 * `test-results/`.
 */

const PLAY = "Otter Contain";
/** Measured positions are within this many yards of where the design puts them (the path is drawn to a tenth of a unit). */
const YARDS = 0.1;
/** The turn in heads at the quarterback within this many degrees. */
const TOLERANCE = 2;

type XY = [number, number];

/** The centre of a player's token in the picture, from its transform. */
async function tokenAt(svg: Locator, name: string): Promise<XY> {
  const t = await svg.locator(`[aria-label="${name}"]`).first().getAttribute("transform");
  const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(t ?? "");
  if (!m?.[1] || !m[2]) throw new Error(`no token for ${name}`);
  return [Number(m[1]), Number(m[2])];
}

const degrees = (dx: number, dy: number): number => (Math.atan2(dy, dx) * 180) / Math.PI;
const apart = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);
const pairs = (s: string): XY[] => {
  const nums = s.match(/-?[\d.]+/g)?.map(Number) ?? [];
  const out: XY[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) out.push([nums[i] ?? 0, nums[i + 1] ?? 0]);
  return out;
};

/** A blitz drawn from a defender: the blitz-ink path that starts nearest their token, and the arrowhead nearest its end. */
interface Drawn { points: XY[]; tip: XY }
async function blitzPath(svg: Locator, blitzer: string): Promise<Drawn> {
  const [cx, cy] = await tokenAt(svg, `Defense ${blitzer}`);
  const ds = await svg.locator(`path[stroke="${INK.blitz}"]`).evaluateAll((els) => els.map((el) => el.getAttribute("d") ?? ""));
  const gap = (p: XY[]): number => (p[0] ? Math.hypot(p[0][0] - cx, p[0][1] - cy) : Infinity);
  const mine = ds.map(pairs).filter((p) => p.length >= 2).sort((a, b) => gap(a) - gap(b))[0];
  const end = mine?.at(-1);
  if (!mine || !end) throw new Error(`no blitz from ${blitzer}`);
  const heads = await svg.locator(`polygon[fill="${INK.blitz}"]`).evaluateAll((els) => els.map((el) => el.getAttribute("points") ?? ""));
  const tip = heads.map((h) => pairs(h)[0]).filter((p): p is XY => !!p).sort((a, b) => Math.hypot(a[0] - end[0], a[1] - end[1]) - Math.hypot(b[0] - end[0], b[1] - end[1]))[0];
  if (!tip) throw new Error(`no arrowhead on ${blitzer}'s blitz`);
  return { points: mine, tip };
}

/** What a step measured: the path's corner and tip in yards from the quarterback's token (+x right, +y toward the offense's backfield). */
interface Measured {
  blitzer: string;
  legs: number;
  corner: XY | null;
  tip: XY;
  /** the turn in's heading against the line from the corner to the quarterback, in degrees */
  turnApart: number | null;
  /** how far short of the quarterback the arrow's tip stops, in yards */
  short: number;
}

interface Step {
  step: string;
  pills?: Record<string, boolean>;
  caption?: string;
  path?: Measured;
  stored?: Route | null;
}

test("a contain blitz rushes the edge outside the quarterback and turns in, on the field, in the saved play, the share link and the printouts", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const d = new Designer(page);
  const steps: Step[] = [];
  const device = testInfo.project.name;
  const group = page.locator("#route-sidebar").getByRole("group", { name: "Blitz target" });
  const pill = (name: string | RegExp) => group.getByRole("button", { name, exact: typeof name === "string" });
  const caption = group.locator("span").last();

  async function pills(): Promise<Record<string, boolean>> {
    await d.palette();
    await expect(group).toBeVisible();
    const pressed = async (l: Locator) => (await l.getAttribute("aria-pressed")) === "true";
    return {
      QB: await pressed(pill("QB")), Backfield: await pressed(pill("Backfield")), Contain: await pressed(pill("Contain")),
      player: await pressed(pill(/^(Pick a player|On )/)),
    };
  }

  /** The blitzer's path measured against the quarterback's token, in yards. */
  async function measure(svg: Locator, blitzer: string): Promise<Measured> {
    const [qx, qy] = await tokenAt(svg, "Offense QB");
    const { points, tip } = await blitzPath(svg, blitzer);
    const rel = (p: XY): XY => [(p[0] - qx) / S, (p[1] - qy) / S];
    const corner = points.length === 3 ? points[1] ?? null : null;
    const end = points.at(-1) ?? tip;
    return {
      blitzer,
      legs: points.length - 1,
      corner: corner ? rel(corner) : null,
      tip: rel(tip),
      turnApart: corner ? apart(degrees(end[0] - corner[0], end[1] - corner[1]), degrees(qx - corner[0], qy - corner[1])) : null,
      short: Math.hypot(tip[0] - qx, tip[1] - qy) / S,
    };
  }

  /** The blitzer contains `edge` (-1 left, +1 right): one bend, the landmark CONTAIN_WIDTH outside (or at the sideline) and CONTAIN_LEAD in front, turning in at the quarterback. */
  async function contains(svg: Locator, blitzer: string, edge: -1 | 1, step: string, extra: Partial<Step> = {}, landmarkX = edge * CONTAIN_WIDTH): Promise<Measured> {
    let m: Measured | null = null;
    await expect(async () => {
      m = await measure(svg, blitzer);
      expect(m.legs).toBe(2);
      expect(Math.abs((m.corner?.[0] ?? NaN) - landmarkX)).toBeLessThanOrEqual(YARDS);
      expect(Math.abs((m.corner?.[1] ?? NaN) + CONTAIN_LEAD)).toBeLessThanOrEqual(YARDS);
      expect(m.turnApart).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(m.short - BLITZ_STOP)).toBeLessThanOrEqual(YARDS);
      // the tip stays on the blitzer's side of the quarterback: the rusher never crosses in front of them
      expect(Math.sign(m.tip[0])).toBe(edge);
    }).toPass({ timeout: 10_000 });
    if (!m) throw new Error("unmeasured");
    steps.push({ step, path: m, ...extra });
    return m;
  }

  /** The blitzer comes straight for the quarterback: one leg, ending BLITZ_STOP short of them. */
  async function straight(svg: Locator, blitzer: string, step: string, extra: Partial<Step> = {}): Promise<void> {
    let m: Measured | null = null;
    await expect(async () => {
      m = await measure(svg, blitzer);
      expect(m.legs).toBe(1);
      expect(Math.abs(m.short - BLITZ_STOP)).toBeLessThanOrEqual(YARDS);
    }).toPass({ timeout: 10_000 });
    if (m) steps.push({ step, path: m, ...extra });
  }

  /** Steps a player across the field by keyboard, a yard a press. */
  async function nudge(label: string, team: "Offense" | "Defense", key: "ArrowLeft" | "ArrowRight", yards: number): Promise<void> {
    await d.foldOverlays();
    await d.player(label, team).focus();
    for (let i = 0; i < yards; i++) await page.keyboard.press(key);
  }

  /** Adds what the palette said to the step just measured. */
  function capture(step: string, extra: Partial<Step> = {}): void {
    const last = steps[steps.length - 1];
    if (last?.step === step) Object.assign(last, extra);
  }

  const stored = async (): Promise<Record<string, Route | null>> =>
    page.evaluate(([key, name]) => {
      const lib = JSON.parse(localStorage.getItem(key ?? "") ?? "{}") as Record<string, SavedPlay>;
      const play = Object.values(lib).find((p) => p.name === name);
      return Object.fromEntries((play?.players ?? []).filter((p) => p.team === "defense").map((p) => [p.label, p.route]));
    }, [PLAYS_KEY, PLAY]);

  await d.goto();
  await d.newPlay("Defense");

  // a blitz still comes straight for the quarterback until the coach picks Contain
  await d.select("R", "Defense");
  await d.pick("Blitz");
  let read = await pills();
  expect(read).toEqual({ QB: true, Backfield: false, Contain: false, player: false });
  await expect(caption).toHaveText(/contain an edge/);
  await straight(d.field, "R", "picked Blitz: straight at the quarterback", { pills: read, caption: (await caption.textContent()) ?? "" });

  // Contain: R lines up right of the quarterback, so it rushes the right edge and turns in
  await pill("Contain").click();
  read = await pills();
  expect(read).toEqual({ QB: false, Backfield: false, Contain: true, player: false });
  await expect(caption).toHaveText("Rushes the right edge outside the quarterback, then turns in, so they can't escape that way. To contain the left edge, line up on the other side of the quarterback.");
  const right = await contains(d.field, "R", 1, "Contain: R rushes the right edge, then turns in", { pills: read, caption: (await caption.textContent()) ?? "" });
  // the landmark sits in front of Z, who lines up level with the quarterback, not under Z's token (C6)
  const [zx, zy] = await tokenAt(d.field, "Offense Z");
  const [qx, qy] = await tokenAt(d.field, "Offense QB");
  const corner = right.corner ?? [0, 0];
  expect(Math.hypot(qx / S + corner[0] - zx / S, qy / S + corner[1] - zy / S)).toBeGreaterThanOrEqual(CONTAIN_LEAD - YARDS);
  await page.locator("#route-sidebar").screenshot({ path: `test-results/contain-blitz-${device}-palette.png` });

  // LB lines up left of the quarterback: the left edge
  await d.select("LB", "Defense");
  await d.pick("Blitz");
  await d.palette();
  await pill("Contain").click();
  await expect(caption).toHaveText(/^Rushes the left edge .* To contain the right edge/);
  await contains(d.field, "LB", -1, "LB contains the left edge", { pills: await pills(), caption: (await caption.textContent()) ?? "" });
  await d.closeSidebars();
  await d.field.screenshot({ path: `test-results/contain-blitz-${device}-field.png` });

  // undo takes LB's contain back to a straight blitz, and redo brings it back
  await d.undo.click();
  await straight(d.field, "LB", "Undo: LB comes straight again");
  await d.redo.click();
  await contains(d.field, "LB", -1, "Redo: LB contains the left edge again");

  // the edge follows the rusher (C8): R moved left of the quarterback contains the left edge
  await nudge("R", "Defense", "ArrowLeft", 4);
  await contains(d.field, "R", -1, "R moved to the quarterback's left: the left edge");
  // right over the quarterback, dead centre: the left (C2)
  await nudge("R", "Defense", "ArrowRight", 1);
  await expect(async () => { expect(await d.playerX("R", "Defense")).toBe(await d.playerX("QB")); }).toPass();
  await contains(d.field, "R", -1, "R right over the quarterback, dead centre: the left edge");
  await nudge("R", "Defense", "ArrowRight", 3);
  await contains(d.field, "R", 1, "R back on the right: the right edge");

  // the sideline: LC contains, then the quarterback slides toward LC's sideline
  await d.select("LC", "Defense");
  await d.pick("Blitz");
  await d.palette();
  await pill("Contain").click();
  await nudge("LC", "Defense", "ArrowLeft", 1);
  // the quarterback 4 yards off X_MIN-side: the landmark is pulled inside the sideline (C3)
  await nudge("QB", "Offense", "ArrowLeft", 11);
  const qbX = await d.playerX("QB");
  expect(qbX).toBe(4);
  await contains(d.field, "LC", -1, "the quarterback on the 4-yard mark: LC's landmark pulled inside the sideline", {}, X_MIN - qbX);
  // against the sideline there is no edge outside them: straight, and the palette says so (C4)
  await nudge("QB", "Offense", "ArrowLeft", 1);
  await straight(d.field, "LC", "the quarterback on the 3-yard mark: no edge, so LC comes straight");
  await d.select("LC", "Defense");
  read = await pills();
  expect(read.Contain).toBe(true);
  await expect(caption).toHaveText("Contains the quarterback, but the sideline leaves no room outside them, so it comes straight for them.");
  capture("the quarterback on the 3-yard mark: no edge, so LC comes straight", { pills: read, caption: (await caption.textContent()) ?? "" });
  // back in the middle, LC contains its edge again; then QB takes LC back to a plain blitz
  await nudge("QB", "Offense", "ArrowRight", 12);
  await contains(d.field, "LC", -1, "the quarterback back in the middle: LC contains the left edge");
  await d.select("LC", "Defense");
  await d.palette();
  await pill("QB").click();
  await straight(d.field, "LC", "QB pressed: LC comes straight again", { pills: await pills() });

  // saved: the contain blitzes store their aim, and the quarterback's nothing but the blitz
  await d.setName(PLAY);
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  const routes = await stored();
  expect(routes.R).toEqual({ type: "blitz", aim: "contain" });
  expect(routes.LB).toEqual({ type: "blitz", aim: "contain" });
  expect(routes.LC).toEqual({ type: "blitz" });
  expect(Object.keys(routes.LC ?? {})).toEqual(["type"]);
  steps.push({ step: "saved: R and LB contain", stored: routes.R }, { step: "saved: LC's plain blitz is nothing but the blitz", stored: routes.LC });
  // LC's blitz picked again is taken away, so the printouts carry the two contain rushers alone
  await d.select("LC", "Defense");
  await d.pick("Blitz");
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  expect((await stored()).LC).toBeNull();

  // reopened: the same paths, and the palette says Contain
  await d.openSaved(PLAY);
  const reopenedR = await contains(d.field, "R", 1, "reopened: R contains the right edge", { stored: routes.R });
  const reopenedLB = await contains(d.field, "LB", -1, "reopened: LB contains the left edge", { stored: routes.LB });
  await d.select("R", "Defense");
  read = await pills();
  expect(read).toEqual({ QB: false, Backfield: false, Contain: true, player: false });

  // the printouts: the job reads "Contain blitz" and the picture names the rush "Contain"
  const play = await page.evaluate(([key, name]) => {
    const lib = JSON.parse(localStorage.getItem(key ?? "") ?? "{}") as Record<string, SavedPlay>;
    return Object.values(lib).find((p) => p.name === name) ?? null;
  }, [PLAYS_KEY, PLAY]);
  if (!play) throw new Error("the saved play is gone");
  const deck = slidePlans([{ n: 1, play }], { bookName: "Otter Pressure", team: OTTERS });
  const alt = deck.slides[deck.slides.length - 1]?.alt ?? "";
  expect(alt).toContain("LB: Contain blitz");
  expect(alt).toContain("R: Contain blitz");
  expect(alt).toContain("LC: No assignment;");
  const [binder] = binderPages([{ n: 1, play }], { layout: "one", paper: "letter", bookName: "Otter Pressure", team: OTTERS });
  if (!binder) throw new Error("no binder page");
  expect(binder.svg.match(/>Contain<\/text>/g)?.length).toBe(2);
  expect(binder.svg).not.toContain(">Blitz</text>");
  steps.push({ step: `printouts: ${alt.split("\n").find((l) => l.startsWith("Left to right")) ?? ""}` });

  // the share link: the snapshot draws the same bends, measured from each blitzer's own token
  const own = async (svg: Locator, blitzer: string): Promise<XY[]> => {
    const [bx, by] = await tokenAt(svg, `Defense ${blitzer}`);
    return (await blitzPath(svg, blitzer)).points.slice(1).map((p) => [(p[0] - bx) / S, (p[1] - by) / S]);
  };
  const designer = { R: await own(d.field, "R"), LB: await own(d.field, "LB") };
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]+$/);
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared.getByRole("img", { name: /^Defense / })).toHaveCount(5);
  for (const blitzer of ["R", "LB"] as const) {
    const there = await own(shared, blitzer);
    expect(there).toHaveLength(2);
    // the corner exactly; the inset end within the arrowhead's rounding
    there.forEach((p, i) => {
      const want = designer[blitzer][i] ?? [NaN, NaN];
      expect(Math.hypot(p[0] - want[0], p[1] - want[1])).toBeLessThanOrEqual(YARDS);
    });
    steps.push({ step: `share page: ${blitzer}'s path from their token, yards`, path: { ...(blitzer === "R" ? reopenedR : reopenedLB), legs: there.length } });
  }

  // the printed binder page, as markup and as the picture a printer gets
  writeFileSync(`test-results/contain-blitz-${device}-binder.svg`, binder.svg);
  await page.setContent(`<body style="margin:0">${binder.svg}</body>`);
  await page.locator("svg").first().screenshot({ path: `test-results/contain-blitz-${device}-binder.png` });

  writeFileSync(
    `test-results/contain-blitz-${device}.json`,
    `${JSON.stringify({ play: PLAY, design: { CONTAIN_WIDTH, CONTAIN_LEAD, BLITZ_STOP }, tolerance: { yards: YARDS, degrees: TOLERANCE }, steps }, null, 2)}\n`,
  );
});

import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { ROUTES } from "../../lib/play/routes";
import type { OffenseRouteType, Pair } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { OTTERS, SIDELINE_OUT, formation, playbook, seed, storedDraft } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * Preset routes from a wide split (issue #103). X and Y line up 3 yards from the sideline, so every
 * route that breaks toward it runs out of field. Such a route used to be shrunk whole until it fit: a
 * 5-yard Out drawn as a 1.5-yard nub, a Corner that never climbed, on the field and on every picture of
 * the play. Now every point keeps its depth, the route stops across the field at the sideline, and the
 * coach is told when that cuts it short. How this could break, and the check that catches each:
 *  - the whole route still shrinks, so the stem and the depth come out short       → every bend and the arrow's tip at its designed depth
 *  - the route runs past the sideline, off the field                                → nothing drawn closer than 1.2 yards to either sideline
 *  - a route with room is cut or moved anyway                                       → Go, Slant, Post and In from X and Y, X's Cross, Z's Out and Wheel drawn in full
 *  - Mirror toward the sideline makes a stub (a Cross turned outward)                → the mirrored Cross keeps its 4-yard stem and 7-yard depth
 *  - a player moved to the sideline shrinks the route, or it vanishes there        → Z dragged wide keeps its Out's stem; on the sideline the Out is its stem, drawn
 *  - the cut is drawn without a word                                                → a toast on the pick, the mirror and the move that cut it, and a note in the palette saying by how much
 *  - a route that fits is announced anyway                                          → no toast and no note for a route with room
 *  - the field, the snapshot, the share page, the thumbnail and the printout disagree → the saved play read back from each, point for point
 * Leaves `route-fit-<device>-<test>.json` (every route read back in yards beside its design: bends,
 * tip, depth, length and yards across, and what the coach was told) and pictures of the field and of
 * each picture of the saved play in test-results/.
 */

/** Across the field a route stops where a player may stand: 1.2 yards inside either sideline. */
const INSIDE = [1.2, 28.8] as const;
/** Yards to the hundredth, without a negative zero. */
const r2 = (v: number): number => Math.round(v * 100) / 100 + 0;

interface Spot { x: number; y: number }
/** The default formation's offense, by label: X and Y 3 yards off the sidelines, Z in the slot. */
const SPOTS = Object.fromEntries(formation().filter((p) => p.team === "offense").map((p) => [p.label, { x: p.x, y: p.y }])) as Record<string, Spot>;
const spot = (label: string): Spot => {
  const s = SPOTS[label];
  if (!s) throw new Error(`no ${label} in the formation`);
  return s;
};

/** A preset as designed from this spot: handed toward the player's near sideline, or away from it once mirrored. */
function design(at: Spot, type: OffenseRouteType, mirror = false): Pair[] {
  const sign = (at.x < 15 ? -1 : 1) * (mirror ? -1 : 1);
  return (ROUTES[type].pts ?? []).map(([dx, dy]) => [r2(at.x + sign * dx), r2(at.y + dy)]);
}

/**
 * The route a coach should see: the design with every point at its depth, and across the field no
 * further than the sideline. Points the sideline puts on the same spot are one point.
 */
function expected(at: Spot, type: OffenseRouteType, mirror = false): Pair[] {
  const lo = Math.min(INSIDE[0], at.x), hi = Math.max(INSIDE[1], at.x);
  const out: Pair[] = [];
  for (const [x, y] of design(at, type, mirror)) {
    const q: Pair = [r2(Math.min(hi, Math.max(lo, x))), y];
    const last = out.at(-1);
    if (!last || last[0] !== q[0] || last[1] !== q[1]) out.push(q);
  }
  return out;
}

/** A route as drawn, in yards: where its line starts (a little way out from the player), each bend, and the arrow's tip. */
interface Drawn { start: Pair; bends: Pair[]; tip: Pair | null }

/** Every route on a field, a snapshot preview or a thumbnail (the svg itself or the element holding it), read back in yards. */
async function readRoutes(target: Locator): Promise<Drawn[]> {
  return target.evaluate((el) => {
    const svg = el instanceof SVGSVGElement ? el : el.querySelector("svg");
    if (!svg) throw new Error("no field here");
    const top = 8 - Number((svg.getAttribute("viewBox") ?? "").split(" ")[3]) / 22;
    const yd = (x: number, y: number): [number, number] => [Math.round((x / 22) * 100) / 100 + 0, Math.round((top + y / 22) * 100) / 100 + 0];
    const pairs = (s: string): [number, number][] => {
      const n = (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
      const out: [number, number][] = [];
      for (let i = 0; i + 1 < n.length; i += 2) out.push(yd(n[i] ?? NaN, n[i + 1] ?? NaN));
      return out;
    };
    // a route is a round-capped path, its arrowhead the polygon after it; the turf lanes under routes are not routes
    return [...svg.querySelectorAll("path[stroke-linecap='round']")]
      .filter((path) => !path.closest("[data-lane]"))
      .map((path) => {
        const pts = pairs(path.getAttribute("d") ?? "");
        const next = path.nextElementSibling;
        const tip = next?.tagName.toLowerCase() === "polygon" ? (pairs(next.getAttribute("points") ?? "")[0] ?? null) : null;
        return { start: pts[0] ?? [NaN, NaN], bends: pts.slice(1, -1), tip };
      });
  });
}

/** The route drawn from this spot: its line starts within a token's reach of the player. */
function routeFrom(routes: readonly Drawn[], at: Spot): Drawn | undefined {
  return routes.find((r) => Math.hypot(r.start[0] - at.x, r.start[1] - at.y) < 1.3);
}

/** A route as drawn against what the coach should see: the same bends and tip (to the drawing's rounding), and all of it on the field. */
function expectRoute(drawn: Drawn | undefined, want: readonly Pair[], what: string): Drawn {
  expect(drawn, `${what} is drawn`).toBeDefined();
  if (!drawn) throw new Error(`${what} is not drawn`);
  const near = (got: Pair | null | undefined, to: Pair | undefined, which: string): void => {
    expect(got, `${what}: ${which}`).toBeTruthy();
    expect(to, `${what}: ${which} is designed`).toBeTruthy();
    expect(got?.[0], `${what}: ${which} across`).toBeCloseTo(to?.[0] ?? NaN, 1);
    expect(got?.[1], `${what}: ${which} deep`).toBeCloseTo(to?.[1] ?? NaN, 1);
  };
  near(drawn.tip, want.at(-1), "the arrow's tip");
  expect(drawn.bends, `${what}: its bends`).toHaveLength(Math.max(0, want.length - 2));
  drawn.bends.forEach((b, i) => { near(b, want[i + 1], `bend ${String(i + 1)}`); });
  for (const q of [drawn.start, ...drawn.bends, ...(drawn.tip ? [drawn.tip] : [])]) {
    expect(q[0], `${what} stays inside the sideline`).toBeGreaterThanOrEqual(INSIDE[0] - 0.05);
    expect(q[0], `${what} stays inside the sideline`).toBeLessThanOrEqual(INSIDE[1] + 0.05);
  }
  return drawn;
}

/** Waits for the route from this spot to be drawn as the coach should see it, and returns it as drawn. */
async function expectDrawn(field: Locator, at: Spot, want: readonly Pair[], what: string): Promise<Drawn> {
  await expect(async () => { expectRoute(routeFrom(await readRoutes(field), at), want, what); }).toPass();
  return expectRoute(routeFrom(await readRoutes(field), at), want, what);
}

const length = (pts: readonly Pair[]): number => pts.reduce((s, q, i) => {
  const p = pts[i - 1];
  return p ? s + Math.hypot(q[0] - p[0], q[1] - p[1]) : s;
}, 0);
/** A route's depth, yards across and length, as designed and as drawn from the player's own spot, as in the issue's table. */
function measure(at: Spot, drawn: Drawn, designed: readonly Pair[]) {
  const path: Pair[] = [[at.x, at.y], ...drawn.bends, ...(drawn.tip ? [drawn.tip] : [])];
  const depth = (ps: readonly Pair[]) => r2(at.y - Math.min(...ps.map((q) => q[1])));
  const across = (ps: readonly Pair[]) => r2(Math.max(...ps.map((q) => Math.abs(q[0] - at.x))));
  return {
    depth: { designed: depth(designed), drawn: depth(path) },
    across: { designed: across(designed), drawn: across(path) },
    length: { designed: r2(length(designed)), drawn: r2(length(path)) },
  };
}

const label = (type: OffenseRouteType): string => ROUTES[type].label;
/** Yards as the palette says them, to the half yard. */
const yards = (v: number): string => String(Math.round(v * 2) / 2);
/** The palette's note on a route the sideline cuts short, naming the player to move. */
const cutNote = (type: OffenseRouteType, reach: number, room: number, who: string): string =>
  `The sideline cuts this ${label(type)}: ${yards(room)} of its ${yards(reach)} yards across fit. Move ${who} inside to run all of it.`;
const note = (page: Page): Locator => page.locator("#route-sidebar").getByText(/^The sideline cuts this /);
const cutToast = (what: string): string => `${what} · cut short at the sideline`;

/** Leaves a JSON record in test-results/ and on the report, with no timestamps, so a rerun reproduces it. */
async function keep(testInfo: TestInfo, name: string, data: unknown): Promise<void> {
  const file = `test-results/route-fit-${testInfo.project.name}-${name}.json`;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  await testInfo.attach(`route-fit-${name}`, { path: file, contentType: "application/json" });
}

/** Routes that break away from the near sideline, or run straight up it: room to spare from any split. */
const HAS_ROOM: readonly OffenseRouteType[] = ["go", "slant", "post", "in"];
/** Routes that break toward the near sideline: from 3 yards off it, each needs more room than there is. */
const TO_THE_SIDELINE: readonly OffenseRouteType[] = ["out", "corner", "wheel", "flat"];

for (const who of ["X", "Y"] as const) {
  test(`${who}'s routes toward the sideline keep their stem and depth and stop at it, and the coach is told`, async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const at = spot(who);
    const room = at.x < 15 ? at.x - INSIDE[0] : INSIDE[1] - at.x;
    const d = new Designer(page);
    await d.goto();
    await d.select(who);

    // the words of the issue, before the general rule: the Out breaks at 5 yards and runs to the
    // sideline; the Corner climbs 8 yards before it breaks, and still reaches 14
    const side = at.x < 15 ? INSIDE[0] : INSIDE[1];
    expect(expected(at, "out")).toEqual([[at.x, 1], [at.x, -4], [side, -4]]);
    expect(expected(at, "corner")).toEqual([[at.x, 1], [at.x, -7], [side, -13]]);

    const rows: unknown[] = [];
    for (const type of [...HAS_ROOM, ...TO_THE_SIDELINE]) {
      const cut = TO_THE_SIDELINE.includes(type);
      await d.pick(label(type));
      const want = expected(at, type);
      const drawn = await expectDrawn(d.field, at, want, `${who}'s ${label(type)}`);
      const m = measure(at, drawn, design(at, type));
      // the depth is the design's, cut or not; only a cut route runs short across the field
      expect(m.depth.drawn, `${who}'s ${label(type)} runs as deep as designed`).toBeCloseTo(m.depth.designed, 1);
      if (cut) expect(m.across.drawn, `${who}'s ${label(type)} runs to the sideline`).toBeCloseTo(room, 1);
      else expect(m.length.drawn, `${who}'s ${label(type)} runs in full`).toBeCloseTo(m.length.designed, 1);

      if (cut) await expect(d.toast).toHaveText(cutToast(label(type)));
      if (type === "out") await d.field.screenshot({ path: `test-results/route-fit-${project}-${who}-out.png` });
      await d.palette();
      if (cut) await expect(note(page)).toHaveText(cutNote(type, m.across.designed, room, who));
      else await expect(note(page)).toHaveCount(0);
      // a route with room is not announced
      if (!cut) await expect(d.toast).toBeHidden();
      if (type === "out") await page.screenshot({ path: `test-results/route-fit-${project}-${who}-out-palette.png` });
      rows.push({
        route: type,
        design: design(at, type),
        expected: want,
        drawn: { bends: drawn.bends, tip: drawn.tip },
        ...m,
        told: cut ? { toast: cutToast(label(type)), note: cutNote(type, m.across.designed, room, who) } : null,
      });
    }

    // the last route picked is what autosaved: a preset, stored as the preset, never as its drawing
    await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.label === who)?.route).toEqual({ type: "flat" });
    await keep(testInfo, who, { project, player: who, spot: at, roomToTheSideline: r2(room), routes: rows });
  });
}

/** Drags a player's token from one spot to another with the mouse, as a coach does. */
async function drag(d: Designer, from: Spot, to: Spot): Promise<void> {
  await d.closeSidebars();
  const a = await d.yardPoint(from.x, from.y);
  const b = await d.yardPoint(to.x, to.y);
  await d.page.mouse.move(a.x, a.y);
  await d.page.mouse.down();
  await d.page.mouse.move(b.x, b.y, { steps: 10 });
  await d.page.mouse.up();
}

test("a route mirrored toward the sideline, or a player moved to it, keeps its stem and depth, and the coach is told", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const d = new Designer(page);
  await d.goto();
  const x = spot("X"), z = spot("Z");
  const told: string[] = [];

  // X's Cross breaks for the middle: the whole field to run across, nothing to say
  await d.select("X");
  await d.pick("Cross");
  const cross = await expectDrawn(d.field, x, expected(x, "cross"), "X's Cross");
  await d.palette();
  await expect(note(page)).toHaveCount(0);
  await expect(d.toast).toBeHidden();

  // mirrored, it heads for the sideline instead: still a 4-yard stem and 7 yards deep, stopped at the sideline
  await d.mirrorButton.click();
  const mirrored = await expectDrawn(d.field, x, expected(x, "cross", true), "X's mirrored Cross");
  expect(mirrored.bends).toEqual([[x.x, x.y - 4]]);
  expect(mirrored.tip).toEqual([INSIDE[0], x.y - 7]);
  await expect(d.toast).toHaveText(cutToast("Mirrored"));
  told.push(cutToast("Mirrored"));
  await expect(note(page)).toHaveText(cutNote("cross", 13, x.x - INSIDE[0], "X"));
  await page.screenshot({ path: `test-results/route-fit-${project}-mirrored-cross.png` });

  // mirrored back, it runs in full again, and nothing more is said
  await expect(d.toast).toBeHidden();
  await d.mirrorButton.click();
  await expectDrawn(d.field, x, expected(x, "cross"), "X's Cross, mirrored back");
  await expect(note(page)).toHaveCount(0);
  await expect(d.toast).toBeHidden();

  // Z's Out has room from the slot
  await d.select("Z");
  await d.pick("Out");
  const slot = await expectDrawn(d.field, z, expected(z, "out"), "Z's Out from the slot");
  await d.palette();
  await expect(note(page)).toHaveCount(0);
  await expect(d.toast).toBeHidden();

  // dragged out to Y's split, it keeps its 5-yard stem and stops at the sideline
  const wide = { x: 27, y: z.y };
  await drag(d, z, wide);
  const dragged = await expectDrawn(d.field, wide, expected(wide, "out"), "Z's Out, dragged wide");
  expect(dragged.bends).toEqual([[wide.x, wide.y - 5]]);
  await expect(d.toast).toHaveText(cutToast("Out"));
  told.push(cutToast("Out"));
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o5")).toMatchObject({ x: 27, y: z.y, route: { type: "out" } });

  // stepped onto the sideline with the arrow keys, there is no room across at all: the Out is its stem, still drawn and still 5 yards
  await d.closeSidebars();
  await d.player("Z").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  const edge = { x: INSIDE[1], y: z.y };
  const stem = await expectDrawn(d.field, edge, expected(edge, "out"), "Z's Out on the sideline");
  expect(stem.bends).toEqual([]);
  expect(stem.tip).toEqual([edge.x, edge.y - 5]);
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o5")).toMatchObject({ x: INSIDE[1], route: { type: "out" } });
  await d.palette();
  await expect(note(page)).toHaveText(cutNote("out", 6, 0, "Z"));
  await page.screenshot({ path: `test-results/route-fit-${project}-sideline-out.png` });

  await keep(testInfo, "mirror-and-move", {
    project,
    cross: { spot: x, drawn: cross, mirrored, design: design(x, "cross", true), ...measure(x, mirrored, design(x, "cross", true)) },
    out: {
      slot: { spot: z, drawn: slot, ...measure(z, slot, design(z, "out")) },
      dragged: { spot: wide, drawn: dragged, ...measure(wide, dragged, design(wide, "out")) },
      onTheSideline: { spot: edge, drawn: stem, ...measure(edge, stem, design(edge, "out")) },
    },
    told,
    note: cutNote("out", 6, 0, "Z"),
  });
});

test("the saved play draws the same routes on the field, the snapshot, the share page, the thumbnail and the printout", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const book = playbook("fx-sideline-book", "Otter Sideline Book", [SIDELINE_OUT]);
  await seed(page, { plays: [SIDELINE_OUT], playbooks: [book], team: OTTERS });
  const routed = SIDELINE_OUT.players.flatMap((p) => (p.route && p.route.type !== "custom" && p.team === "offense"
    ? [{ who: p.label, at: { x: p.x, y: p.y }, type: p.route.type as OffenseRouteType }]
    : []));
  expect(routed.map((r) => `${r.who} ${r.type}`)).toEqual(["X out", "Y corner", "Z wheel"]);
  const surfaces: Record<string, unknown> = {};
  const check = (surface: string, routes: readonly Drawn[]): void => {
    expect(routes, `${surface}: one route a receiver`).toHaveLength(routed.length);
    surfaces[surface] = routed.map((r) => {
      const drawn = expectRoute(routeFrom(routes, r.at), expected(r.at, r.type), `${surface}: ${r.who}'s ${label(r.type)}`);
      return { player: r.who, route: r.type, drawn, ...measure(r.at, drawn, design(r.at, r.type)) };
    });
  };

  // the designer
  const d = new Designer(page);
  await d.goto(`?open=${SIDELINE_OUT.id}`);
  await expect(page.getByRole("heading", { name: SIDELINE_OUT.name })).toBeVisible();
  await d.closeSidebars();
  await expect(async () => { check("designer", await readRoutes(d.field)); }).toPass();
  // opening a play says nothing: the coach is told when an edit cuts a route, and the palette says it for the one selected
  await expect(d.toast).toBeHidden();
  await d.field.screenshot({ path: `test-results/route-fit-${project}-designer.png` });

  // the snapshot preview, and the page its link opens
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  const preview = dialog.getByRole("img", { name: "Offense snapshot preview" });
  await expect(preview).toBeVisible();
  check("snapshot preview", await readRoutes(preview));
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared).toBeVisible();
  await expect(async () => { check("share page", await readRoutes(shared)); }).toPass();
  await shared.screenshot({ path: `test-results/route-fit-${project}-share-page.png` });

  // the gallery's thumbnail
  await page.goto("/playbooks");
  const thumb = page.getByRole("img", { name: SIDELINE_OUT.name }).first();
  await expect(thumb).toBeVisible();
  check("thumbnail", await readRoutes(thumb));
  await thumb.screenshot({ path: `test-results/route-fit-${project}-thumbnail.png` });

  // the printout's preview
  await page.goto(`/playbooks?book=${book.id}`);
  const pdf = page.getByRole("img", { name: "Playbook PDF preview" });
  await expect(pdf).toBeVisible();
  check("printout preview", await readRoutes(pdf));
  await pdf.screenshot({ path: `test-results/route-fit-${project}-printout.png` });

  await keep(testInfo, "pictures", { project, play: SIDELINE_OUT.name, surfaces });
});

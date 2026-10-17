import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { S } from "../../lib/play/geometry";
import { PLAYER_SPACING, UNDER_CENTRE } from "../../lib/play/spacing";
import type { Spot } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { OTTERS, moved, play, seed, storedDraft, storedLineups, storedPlays } from "../support/fixtures";

/**
 * Spacing (lib/play/spacing.ts): a player is never put on top of a teammate. Dragged onto one, the token is
 * held at the edge of the teammate's disc while the pointer is over it, slides round it, and jumps to the far
 * side once the pointer is past the teammate's centre; let go, it lands 2 yards off (PLAYER_SPACING, centre
 * to centre, where two discs just touch), on the half yard, and a note says why. Let go right on the
 * teammate's centre, it lands on the side it came from. Let go in a pocket between two teammates, it lands on
 * the one spot clear of both. An arrow press onto a teammate goes on past them to the first clear spot, or,
 * with the edge of the field first, nowhere, and says which; a key held down walks the player up beside a
 * teammate and stops, shaking, until a fresh press steps past. The other side is never
 * in the way: the line of scrimmage keeps them apart already, so a defender steps to the line opposite the C.
 * A blitzer backed off to the blitz line onto a teammate standing there takes the nearest clear spot on it.
 * Roster mode's positions keep the same spacing, on the roster. A play stored with two players on top of
 * each other opens as stored, and either can still be stepped off. Dragged along a tight line onto the C,
 * a player stays in the notch it was drawn in; dragged back onto a teammate from beside them it stays put
 * and writes nothing, so Redo is kept. A step past a teammate that cuts the route short at the sideline
 * says both in one note. The quarterback alone may stand closer, under centre: UNDER_CENTRE straight behind
 * the C, stepped or dropped there (a drop beside the C is told how), the C coming back in front of him, a
 * centre off the half yard included, each still picked by a tap on his own label. After every step each
 * side's closest pair on the field is measured, never under 2 yards but where a stored play put them, or the
 * quarterback under centre. Leaves
 * `collisions-<device>-<test>.json` (every step's spots, each side's closest pair and the note shown) and a
 * picture of the field after each test in `test-results/`.
 */

interface Spotted { team: "offense" | "defense"; label: string; x: number; y: number }
interface Step { step: string; spots: Spotted[]; closest: { offense: number | null; defense: number | null }; underCentre: boolean; note: string | null }

/** Where each player on the field is drawn, in yards, read from its token's transform and the field's viewBox. */
async function spots(d: Designer): Promise<Spotted[]> {
  return d.field.evaluate((svg, units) => {
    const vh = Number(svg.getAttribute("viewBox")?.split(" ")[3]);
    const top = 8 - vh / units;
    return [...svg.querySelectorAll("g[role='button'][aria-label]")].flatMap((g) => {
      const who = /^(Offense|Defense) (\S+)$/.exec(g.getAttribute("aria-label") ?? "");
      const at = /^translate\(([-\d.]+),([-\d.]+)\)$/.exec(g.getAttribute("transform") ?? "");
      if (!who?.[1] || !who[2] || !at?.[1] || !at[2]) return [];
      return [{ team: who[1].toLowerCase() as "offense" | "defense", label: who[2], x: Number(at[1]) / units, y: Number(at[2]) / units + top }];
    });
  }, S);
}
async function spotOf(d: Designer, label: string, team: "Offense" | "Defense" = "Offense"): Promise<{ x: number; y: number }> {
  const p = (await spots(d)).find((q) => q.label === label && q.team === team.toLowerCase());
  if (!p) throw new Error(`${team} ${label} is not on the field`);
  return p;
}
/** The token's drawn spot is rounded to a tenth of a unit, a 220th of a yard. */
const DRAWN = 0.01;
/** The quarterback and the C when the QB stands under centre, UNDER_CENTRE straight behind him, else null. */
function underCentre(all: readonly Spotted[]): readonly [Spotted, Spotted] | null {
  const qb = all.find((p) => p.team === "offense" && p.label === "QB"), c = all.find((p) => p.team === "offense" && p.label === "C");
  return qb && c && Math.abs(qb.x - c.x) < DRAWN && Math.abs(qb.y - c.y - UNDER_CENTRE) < DRAWN ? [qb, c] : null;
}
/** Each side's closest pair of teammates on the field, centre to centre, in yards, but the quarterback under centre. */
function closest(all: readonly Spotted[]): Step["closest"] {
  const under = underCentre(all);
  const side = (team: Spotted["team"]): number | null => {
    const mates = all.filter((p) => p.team === team);
    let near: number | null = null;
    mates.forEach((a, i) => {
      for (const b of mates.slice(i + 1)) {
        if (under?.includes(a) && under.includes(b)) continue;
        const g = Math.hypot(a.x - b.x, a.y - b.y);
        if (near === null || g < near) near = g;
      }
    });
    return near;
  };
  return { offense: side("offense"), defense: side("defense") };
}

/** Waits for a player to be drawn at a spot (to the half yard's tenth). */
async function expectAt(d: Designer, label: string, team: "Offense" | "Defense", x: number, y: number): Promise<void> {
  await expect.poll(async () => { const p = await spotOf(d, label, team); return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]; }).toEqual([x, y]);
}

/**
 * Presses a player where it stands and drags it to a yard point, by way of another if given, as a coach's
 * finger or mouse does; `held` runs with the button still down.
 */
async function dragTo(
  d: Designer, label: string, team: "Offense" | "Defense", to: { x: number; y: number }, held?: () => Promise<void>, via?: { x: number; y: number },
): Promise<void> {
  await d.foldOverlays();
  await d.settle();
  const from = await spotOf(d, label, team);
  const a = await d.yardPoint(from.x, from.y), b = await d.yardPoint(to.x, to.y);
  await d.page.mouse.move(a.x, a.y);
  await d.page.mouse.down();
  if (via) {
    const v = await d.yardPoint(via.x, via.y);
    await d.page.mouse.move(v.x, v.y, { steps: 12 });
  }
  await d.page.mouse.move(b.x, b.y, { steps: 12 });
  if (held) await held();
  await d.page.mouse.up();
}

/** The positions stored as moved off their home spots in roster mode. */
const storedSpots = async (page: Page): Promise<Spot[]> => (await storedLineups(page))?.spots ?? [];

/** A note-taker for one test: each step's spots, measured and kept, then written out as `collisions-<device>-<name>.json`. */
function journal(d: Designer, device: string, name: string) {
  const steps: Step[] = [];
  const note = async (step: string, opts: { note?: string; spaced?: boolean; underCentre?: boolean } = {}): Promise<void> => {
    if (opts.note) await expect(d.toast).toContainText(opts.note);
    const all = await spots(d);
    const near = closest(all);
    const under = underCentre(all) !== null;
    if (opts.underCentre !== undefined) expect(under, `${step}: the QB under centre`).toBe(opts.underCentre);
    // never two teammates on top of each other, but where a stored play put them
    if (opts.spaced !== false) {
      for (const g of [near.offense, near.defense]) if (g !== null) expect(g).toBeGreaterThanOrEqual(PLAYER_SPACING - DRAWN);
    }
    steps.push({ step, spots: all, closest: near, underCentre: under, note: opts.note ?? null });
  };
  const done = async (): Promise<void> => {
    await d.foldOverlays();
    await d.field.screenshot({ path: `test-results/collisions-${device}-${name}.png` });
    writeFileSync(`test-results/collisions-${device}-${name}.json`, `${JSON.stringify({ spacing: PLAYER_SPACING, underCentre: UNDER_CENTRE, steps }, null, 2)}\n`);
  };
  return { note, done };
}

test("a player dragged onto a teammate is held off them and lands 2 yards away, a pocket takes the one clear spot, and an arrow step goes past a teammate or nowhere", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  await d.newPlay("Offense");
  const { note, done } = journal(d, device, "drag");
  await d.foldOverlays();
  await note("the default formation");

  // Z dragged right onto the QB's centre: held at the edge of his disc while the button is down, on the side Z
  // came from, however the finger jitters there, and landed 2 yards off
  await dragTo(d, "Z", "Offense", { x: 15, y: 5 }, async () => {
    await expect.poll(async () => { const z = await spotOf(d, "Z", "Offense"); return Math.hypot(z.x - 15, z.y - 5); }).toBeGreaterThanOrEqual(PLAYER_SPACING - DRAWN);
    await note("Z held off the QB, the button still down", { note: "Players can't stand on top of each other. Kept Z 2 yards off QB." });
  });
  await expectAt(d, "Z", "Offense", 17, 5);
  await expectAt(d, "QB", "Offense", 15, 5);
  await note("Z let go on the QB lands beside him", { note: "Kept Z 2 yards off QB." });

  // dragged on through the QB, past his centre: Z is held on the far side, and lands there
  await dragTo(d, "Z", "Offense", { x: 13.4, y: 5 });
  await expectAt(d, "Z", "Offense", 13, 5);
  await note("Z dragged through the QB lands on his far side");

  // X let go between the C and the QB, too close to the C: the one spot 2 yards from both
  await dragTo(d, "X", "Offense", { x: 15, y: 2.6 });
  await expectAt(d, "X", "Offense", 15, 3);
  await note("X let go in the pocket between the C and the QB", { note: "Kept X 2 yards off C." });

  // the QB stepped up: X and the C stand between him and the line, so he stays where he is, and says so
  await d.player("QB").press("ArrowUp");
  await expect(d.toast).toContainText("No room for QB past X.");
  await expectAt(d, "QB", "Offense", 15, 5);
  await note("the QB stepped up into X, with the line behind the C", { note: "No room for QB past X." });
  // stepped left into Z: on past him, to the first spot clear of him
  await d.player("QB").press("ArrowLeft");
  await expectAt(d, "QB", "Offense", 11, 5);
  await note("the QB stepped left past Z", { note: "Stepped QB past Z." });
  // and back: past Z again to his old spot, 2 yards from Z and from X
  await d.player("QB").press("ArrowRight");
  await expectAt(d, "QB", "Offense", 15, 5);
  await note("the QB stepped back right past Z", { note: "Stepped QB past Z." });
  // a step that is clear is a yard, as ever
  await d.player("Y").press("ArrowLeft");
  await expectAt(d, "Y", "Offense", 26, 1);
  await note("Y stepped a yard in");

  // the play stores what the field shows, and Undo takes the last step back
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o5")).toMatchObject({ x: 13, y: 5 });
  await d.undo.click();
  await expectAt(d, "Y", "Offense", 27, 1);

  // Z, beside the QB, dragged back onto his centre: held where he stands, so nothing moves, nothing is
  // written and Redo is kept
  await expect(d.redo).toBeEnabled();
  await dragTo(d, "Z", "Offense", { x: 15, y: 5 });
  await expectAt(d, "Z", "Offense", 13, 5);
  await expect(d.redo).toBeEnabled();
  await note("Z dragged onto the QB from beside him stays put, Redo kept", { note: "Kept Z 2 yards off QB." });

  // the arrow key held down walks Y in along the line and stops him beside the C, shaking as it repeats,
  // never carrying him on past; a fresh press then steps him past
  await d.player("Y").focus();
  for (let i = 0; i < 14; i++) await page.keyboard.down("ArrowLeft");
  await expect(d.player("Y").locator(".animate-shake")).toHaveCount(1);
  await page.keyboard.up("ArrowLeft");
  await expectAt(d, "Y", "Offense", 17, 1);
  await note("Y walked in by a held key, stopped beside the C", { note: "Players can't stand on top of each other. Kept Y 2 yards off C." });
  await page.keyboard.press("ArrowLeft");
  await expectAt(d, "Y", "Offense", 13, 1);
  await note("a fresh press steps Y past the C", { note: "Stepped Y past C." });
  await done();
});

test("the other side is never in the way, and a blitzer backed off onto a teammate takes the nearest clear spot on the blitz line", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  // a defensive call opens with the offense on the field, faded
  await d.newPlay("Defense");
  const { note, done } = journal(d, device, "blitz");
  await d.foldOverlays();
  await expectAt(d, "C", "Offense", 15, 1);

  // LB dragged to the line opposite the C, and stepped right up to it: the C, on the other side, doesn't hold him off
  await dragTo(d, "LB", "Defense", { x: 15, y: -0.4 });
  await expectAt(d, "LB", "Defense", 15, -1);
  await d.player("LB", "Defense").press("ArrowDown");
  await expectAt(d, "LB", "Defense", 15, -0.9);
  await expectAt(d, "C", "Offense", 15, 1);
  await note("LB on the line opposite the C, 1.9 yards from him across it");

  // the S stood on the blitz line behind R; R's blitz backs him onto it, so he takes the nearest clear spot
  // on it, the nearer the line first and then the left one of the three 2 yards off
  await dragTo(d, "S", "Defense", { x: 18, y: -7 });
  await expectAt(d, "S", "Defense", 18, -7);
  await d.select("R", "Defense");
  await d.pick("Blitz");
  await expectAt(d, "R", "Defense", 16, -7);
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "d3")).toMatchObject({ x: 16, y: -7, route: { type: "blitz" } });
  await note("R blitzes from beside the S on the blitz line");

  // Undo puts R back where he stood, without his blitz
  await d.undo.click();
  await expectAt(d, "R", "Defense", 18, -4);
  await note("Undo: R back without the blitz");
  await done();
});

test("roster mode's positions keep the same spacing, and where they land is the roster's", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  await d.roster();
  const { note, done } = journal(d, device, "roster");
  await d.foldOverlays();

  // Z dragged onto the QB stands beside him, on the roster
  await dragTo(d, "Z", "Offense", { x: 15.6, y: 5 });
  await expectAt(d, "Z", "Offense", 17, 5);
  await expect.poll(() => storedSpots(page)).toEqual([{ team: "offense", tag: "Z", x: 17, y: 5 }]);
  await note("Z let go on the QB in roster mode", { note: "Kept Z 2 yards off QB." });
  // the QB stepped right into Z goes on past him
  await d.player("QB").press("ArrowRight");
  await expectAt(d, "QB", "Offense", 19, 5);
  await expect.poll(() => storedSpots(page)).toEqual([{ team: "offense", tag: "Z", x: 17, y: 5 }, { team: "offense", tag: "QB", x: 19, y: 5 }]);
  await note("the QB stepped past Z in roster mode", { note: "Stepped QB past Z." });

  // on the defense, the S brought up from behind the LB and let go right on his centre stands behind him,
  // the side he came from
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing defense");
  await dragTo(d, "S", "Defense", { x: 11, y: -4 }, undefined, { x: 11, y: -8 });
  await expectAt(d, "S", "Defense", 11, -6);
  await expect.poll(async () => (await storedSpots(page)).find((s) => s.tag === "S")).toEqual({ team: "defense", tag: "S", x: 11, y: -6 });
  await note("S let go on the LB in roster mode", { note: "Kept S 2 yards off LB." });
  await done();
});

test("a play stored with two players on top of each other opens as stored, and either can still be stepped off", async ({ page }, info) => {
  const device = info.project.name;
  // Z stood on the QB's spot, as a play from before spacing, or one written by hand, could have him
  const stacked = moved(play("fx-stacked", "Otter Stack"), { o5: { x: 15, y: 5 } });
  await seed(page, { team: OTTERS, plays: [stacked] });
  const d = new Designer(page);
  await d.goto();
  await d.openSaved("Otter Stack");
  const { note, done } = journal(d, device, "stack");
  await d.foldOverlays();
  await expectAt(d, "Z", "Offense", 15, 5);
  await expectAt(d, "QB", "Offense", 15, 5);
  await note("opened as stored: Z on top of the QB", { spaced: false });

  // Z stepped back: never held by the QB he stands on, he goes on past him to the first clear spot
  await d.player("Z").press("ArrowDown");
  await expectAt(d, "Z", "Offense", 15, 7);
  await expectAt(d, "QB", "Offense", 15, 5);
  await note("Z stepped off the QB", { note: "Stepped Z past QB." });
  // the stored play is untouched until it is saved
  expect((await storedPlays(page))["fx-stacked"]?.players.find((p) => p.id === "o5")).toMatchObject({ x: 15, y: 5 });
  await done();
});

test("let go on the C from a pocket beside him, a player stays in the pocket it was drawn in, the side it came from", async ({ page }, info) => {
  const device = info.project.name;
  // X, the C and Y shoulder to shoulder on the line, the QB three yards behind the C, Z out to the left
  const line = moved(play("fx-line", "Otter Tight Line"), {
    o1: { x: 15, y: 1 }, o2: { x: 15, y: 4 }, o3: { x: 13, y: 1 }, o4: { x: 17, y: 1 }, o5: { x: 9, y: 1 },
  });
  await seed(page, { team: OTTERS, plays: [line] });
  const d = new Designer(page);
  await d.goto();
  await d.openSaved("Otter Tight Line");
  const { note, done } = journal(d, device, "pocket");
  await d.foldOverlays();
  await note("the tight line");

  // Z dragged along the line, past X and on to the C's centre: held behind X, then in the notch between X and
  // the QB, and kept there while the finger is on the C, never swung across to his far side
  await dragTo(d, "Z", "Offense", { x: 15, y: 1 }, async () => {
    await expect.poll(async () => { const z = await spotOf(d, "Z", "Offense"); return z.x < 15; }).toBe(true);
    await note("Z held in the notch between X and the QB, the button still down");
  });
  await expectAt(d, "Z", "Offense", 13, 3);
  await note("Z let go on the C lands in the pocket, 2 yards off X", { note: "Players can't stand on top of each other." });
  await done();
});

test("a step past a teammate that cuts the route short at the sideline says both in one note", async ({ page }, info) => {
  const device = info.project.name;
  // Z on an Out, Y 2 yards outside him: stepped right past Y, Z's Out no longer has room before the sideline
  const wide = moved(play("fx-out-wide", "Otter Out Wide", { o5: { type: "out" } }), { o5: { x: 20, y: 5 }, o4: { x: 22, y: 5 } });
  await seed(page, { team: OTTERS, plays: [wide] });
  const d = new Designer(page);
  await d.goto();
  await d.openSaved("Otter Out Wide");
  const { note, done } = journal(d, device, "cut");
  await d.foldOverlays();
  await d.player("Z").press("ArrowRight");
  await expectAt(d, "Z", "Offense", 24, 5);
  await expect(d.toast).toHaveText("Players can't stand on top of each other. Stepped Z past Y. Out · cut short at the sideline");
  await note("Z stepped past Y, his Out cut short", { note: "Stepped Z past Y. Out · cut short at the sideline" });
  await done();
});

test("the quarterback lines up under centre, a yard and a half behind the C, stepped or dropped there, and nobody else does", async ({ page }, info) => {
  const device = info.project.name;
  await seed(page, { team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  await d.newPlay("Offense");
  const { note, done } = journal(d, device, "under-centre");
  await d.foldOverlays();
  await note("a fresh play: the C on the 1, the QB 5 behind the line", { underCentre: false });
  const keptQb = page.getByText(/Kept QB/);
  const qbStored = async () => (await storedDraft(page))?.players.find((p) => p.id === "o2");

  // U5: the spot is the quarterback's alone: Z let go there is kept 2 yards off the C, as anyone is
  await dragTo(d, "Z", "Offense", { x: 15, y: 2.5 });
  await expectAt(d, "Z", "Offense", 15, 3);
  await note("Z let go right behind the C is kept 2 yards off him", { note: "Kept Z 2 yards off C.", underCentre: false });
  await expect(d.toast).not.toContainText("under centre");
  await dragTo(d, "Z", "Offense", { x: 19, y: 5 });
  await expectAt(d, "Z", "Offense", 19, 5);

  // U4: the QB stepped up a yard at a time: 4, 3, then the step that would end inside the C's disc stops under centre
  for (const y of [4, 3, 2.5]) {
    await d.player("QB").press("ArrowUp");
    await expectAt(d, "QB", "Offense", 15, y);
  }
  await expect(keptQb).toHaveCount(0);
  await expect.poll(qbStored).toMatchObject({ x: 15, y: 2.5 });
  await note("the QB stepped up under centre", { underCentre: true });
  await d.player("QB").press("ArrowUp");
  await expect(d.toast).toContainText("No room for QB past C.");
  await expectAt(d, "QB", "Offense", 15, 2.5);
  await note("a step on from under centre: no room past the C", { note: "No room for QB past C.", underCentre: true });
  // held down, the key says the same, never that he was kept 2 yards off the C
  await d.player("QB").focus();
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("ArrowUp");
  await page.keyboard.up("ArrowUp");
  await expectAt(d, "QB", "Offense", 15, 2.5);
  await expect(keptQb).toHaveCount(0);
  await note("the key held down under centre: no room past the C", { note: "No room for QB past C.", underCentre: true });
  await d.player("QB").press("ArrowDown");
  await expectAt(d, "QB", "Offense", 15, 3.5);
  await note("a step back leaves it", { underCentre: false });

  // U1, U8: let go in the back of the C's disc, short of the spot, the QB lines up under centre, and is told nothing
  await dragTo(d, "QB", "Offense", { x: 15, y: 2.1 });
  await expectAt(d, "QB", "Offense", 15, 2.5);
  await expect(keptQb).toHaveCount(0);
  await note("the QB let go in the back of the C's disc lines up under centre", { underCentre: true });

  // U5, U8: let go beside the C, the QB is kept 2 yards off him, and told where to go to line up under centre
  await dragTo(d, "QB", "Offense", { x: 16.5, y: 1.5 });
  await expectAt(d, "QB", "Offense", 17, 1.5);
  await note("the QB let go beside the C is kept off him, and told how to line up under centre", {
    note: "Kept QB 2 yards off C. Drop QB right behind C to line up under centre.", underCentre: false,
  });
  await dragTo(d, "QB", "Offense", { x: 15, y: 2.4 });
  await expectAt(d, "QB", "Offense", 15, 2.5);
  await note("the QB dragged back under centre from beside the C", { underCentre: true });

  // U2: the discs overlap, and each player is still picked by a tap on his own label
  await d.select("C");
  await d.select("QB");
  await d.closeSidebars();

  // U7: the C dragged out from in front of the QB, and back: he stands in front of him again
  await dragTo(d, "C", "Offense", { x: 11, y: 1 });
  await expectAt(d, "C", "Offense", 11, 1);
  await note("the C dragged out from in front of the QB", { underCentre: false });
  await dragTo(d, "C", "Offense", { x: 15, y: 1 });
  await expectAt(d, "C", "Offense", 15, 1);
  await expect(page.getByText(/Kept C/)).toHaveCount(0);
  await note("the C dragged back in front of the QB", { underCentre: true });

  // U11: the draft keeps him there
  await page.reload();
  await d.foldOverlays();
  await expectAt(d, "QB", "Offense", 15, 2.5);
  await expectAt(d, "C", "Offense", 15, 1);
  await note("reloaded: still under centre", { underCentre: true });
  await done();
});

test("a centre lined up off the half yard still has the quarterback right behind him, off the grid with him", async ({ page }, info) => {
  const device = info.project.name;
  // U3: the C a little left and deep of the half-yard grid, as a play from a file or written by hand may have him
  const odd = moved(play("fx-odd-centre", "Otter Odd Centre"), { o1: { x: 14.3, y: 1.2 } });
  await seed(page, { team: OTTERS, plays: [odd] });
  const d = new Designer(page);
  await d.goto();
  await d.openSaved("Otter Odd Centre");
  const { note, done } = journal(d, device, "under-centre-off-grid");
  await d.foldOverlays();
  await note("the C off the half yard", { underCentre: false });
  await dragTo(d, "QB", "Offense", { x: 14.3, y: 2.6 });
  await expectAt(d, "QB", "Offense", 14.3, 2.7);
  const qb = (await storedDraft(page))?.players.find((p) => p.id === "o2");
  expect(qb?.x).toBeCloseTo(14.3, 6);
  expect(qb?.y).toBeCloseTo(1.2 + UNDER_CENTRE, 6);
  await note("the QB lines up under the C, off the grid with him", { underCentre: true });
  await done();
});

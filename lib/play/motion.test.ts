import { describe, expect, test } from "bun:test";
import { DELAY, PRIMARY_ODDS, SHADOW, SPEED, ballAt, buildMotion, positionsAt, simulationPlayback } from "./motion";
import { defaults } from "./routes";
import type { Player, Route } from "./types";

const TOP = -30;
const withRoute = (id: string, route: Route): ((p: Player) => Player) => (p) => (p.id === id ? { ...p, route } : p);
/** a fixed sequence of coin flips */
const flips = (...vs: number[]): (() => number) => { let i = 0; return () => vs[i++] ?? 0.5; };
const at = (pos: Record<string, { x: number; y: number }>, id: string) => {
  const p = pos[id];
  if (!p) throw new Error("missing " + id);
  return p;
};

describe("tracks", () => {
  test("a play with no routes still runs for a second, and nobody moves", () => {
    const m = buildMotion(defaults(), TOP);
    expect(m.kind).toBe("hold");
    expect(m.dur).toBeGreaterThanOrEqual(1);
    const pos = positionsAt(m, defaults(), 0.5);
    for (const p of defaults()) expect(pos[p.id]).toEqual({ x: p.x, y: p.y });
  });
  test("a routed player runs the route at a steady speed and stops at the end", () => {
    const ps = defaults().map(withRoute("o3", { type: "go" }));
    const m = buildMotion(ps, TOP);
    expect(at(positionsAt(m, ps, 0), "o3")).toEqual({ x: 3, y: 1 });
    const p1 = at(positionsAt(m, ps, 1), "o3");
    expect(p1.x).toBe(3);
    expect(p1.y).toBeCloseTo(1 - SPEED, 5);
    expect(at(positionsAt(m, ps, 99), "o3").y).toBeCloseTo(-14, 5);
    expect(m.dur).toBeGreaterThan(15 / SPEED);
  });
  test("a man defender ends up shadowing the receiver", () => {
    const ps = defaults()
      .map(withRoute("o3", { type: "go" }))
      .map(withRoute("d1", { type: "man", target: "o3" }));
    const pos = positionsAt(buildMotion(ps, TOP), ps, 99);
    const o3 = at(pos, "o3"), d1 = at(pos, "d1");
    expect(Math.hypot(o3.x - d1.x, o3.y - d1.y)).toBeCloseTo(SHADOW, 5);
  });
  test("a zone defender drops to the middle of the bubble", () => {
    const ps = defaults().map(withRoute("d5", { type: "zoneDeep" }));
    expect(positionsAt(buildMotion(ps, TOP), ps, 99).d5).toEqual({ x: 15, y: -15 });
  });
  test("a delay runner waits at the snap, then goes", () => {
    const ps = defaults().map(withRoute("o5", { type: "delay" }));
    const m = buildMotion(ps, TOP);
    expect(at(positionsAt(m, ps, DELAY / 2), "o5")).toEqual({ x: 19, y: 5 });
    expect(at(positionsAt(m, ps, DELAY + 0.5), "o5")).not.toEqual({ x: 19, y: 5 });
  });
});

describe("the snap", () => {
  test("under centre the exchange is quick and on the ground", () => {
    const ps = defaults().map((p) => (p.id === "o2" ? { ...p, y: 2 } : p));
    const m = buildMotion(ps, TOP);
    expect(m.shotgun).toBe(false);
    expect(m.snapAt).toBe(0.12);
    expect(ballAt(m, positionsAt(m, ps, 0), 0)).toEqual({ x: 15, y: 1, lift: 0 });
  });
  test("a shotgun snap flies back to the quarterback", () => {
    const ps = defaults();
    const m = buildMotion(ps, TOP);
    expect(m.shotgun).toBe(true);
    const pos = positionsAt(m, ps, 0);
    const mid = ballAt(m, pos, m.snapAt / 2);
    expect(mid?.y).toBeCloseTo(3, 5);
    expect(mid?.lift).toBeGreaterThan(0);
    expect(ballAt(m, pos, m.snapAt + 1)).toEqual({ x: 15, y: 5, lift: 0 });
  });
});

describe("the call", () => {
  test("a run route alone makes it a run: the ball is handed off at the mesh and rides with the runner", () => {
    const ps = defaults().map(withRoute("o5", { type: "dive" }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("run");
    expect(m.runner).toBe("o5");
    expect(m.handAt).toBeGreaterThanOrEqual(m.snapAt);
    const before = positionsAt(m, ps, m.handAt - 0.05);
    expect(ballAt(m, before, m.handAt - 0.05)).toEqual({ ...at(before, "o2"), lift: 0 });
    const late = positionsAt(m, ps, m.dur);
    expect(ballAt(m, late, m.dur)).toEqual({ ...at(late, "o5"), lift: 0 });
    expect(at(late, "o5").y).toBeCloseTo(-5, 5);
  });
  test("a quarterback keeper needs no handoff", () => {
    const ps = defaults().map(withRoute("o2", { type: "dive" }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("run");
    expect(m.runner).toBe("o2");
    expect(m.handAt).toBe(m.snapAt);
  });
  test("a receiver's route is a pass, led so the ball lands on them", () => {
    const ps = defaults().map(withRoute("o4", { type: "out", primary: true }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("pass");
    expect(m.receiver).toBe("o4");
    expect(m.catchAt).toBeGreaterThan(m.throwAt);
    const mid = (m.throwAt + m.catchAt) / 2;
    expect(ballAt(m, positionsAt(m, ps, mid), mid)?.lift).toBeCloseTo(1, 5);
    const late = positionsAt(m, ps, m.dur);
    expect(ballAt(m, late, m.dur)).toEqual({ ...at(late, "o4"), lift: 0 });
  });
  test("repeated teaching playback always throws to the primary among multiple receivers", () => {
    const ps = defaults()
      .map(withRoute("o3", { type: "go", primary: true }))
      .map(withRoute("o4", { type: "slant" }))
      .map(withRoute("o5", { type: "out" }));
    for (let i = 0; i < 20; i++) expect(buildMotion(ps, TOP).receiver).toBe("o3");
  });
  test("explicit simulation playback can explore receivers other than the primary", () => {
    const ps = defaults()
      .map(withRoute("o3", { type: "go", primary: true }))
      .map(withRoute("o4", { type: "slant" }))
      .map(withRoute("o5", { type: "out" }));
    expect(buildMotion(ps, TOP, simulationPlayback(flips(PRIMARY_ODDS - 0.01))).receiver).toBe("o3");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(PRIMARY_ODDS + 0.01, 0.1))).receiver).toBe("o4");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(PRIMARY_ODDS + 0.01, 0.9))).receiver).toBe("o5");
  });
  test("with nothing marked, teaching uses the first drawn receiver and simulation may vary it", () => {
    const ps = defaults().map(withRoute("o4", { type: "slant" })).map(withRoute("o5", { type: "out" }));
    expect(buildMotion(ps, TOP).receiver).toBe("o4");
    expect(buildMotion(ps, TOP)).toEqual(buildMotion(ps, TOP));
    expect(buildMotion(ps, TOP, simulationPlayback(flips(0.1))).receiver).toBe("o4");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(0.9))).receiver).toBe("o5");
  });
  test("a primary runner beside receivers is still a run", () => {
    const ps = defaults()
      .map(withRoute("o5", { type: "stretch", primary: true }))
      .map(withRoute("o3", { type: "go" }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("run");
    expect(m.runner).toBe("o5");
  });
  test("a primary receiver beside a runner is play-action: fake, then throw", () => {
    const ps = defaults()
      .map(withRoute("o5", { type: "dive" }))
      .map(withRoute("o3", { type: "go", primary: true }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("pass");
    expect(m.runner).toBe("o5");
    expect(m.receiver).toBe("o3");
    expect(m.throwAt).toBeGreaterThan(m.handAt);
    // mid-fake the ball has left the quarterback's hands but not the backfield
    const pos = positionsAt(m, ps, m.handAt);
    const b = ballAt(m, pos, m.handAt);
    const qb = at(pos, "o2"), r = at(pos, "o5");
    expect(b?.lift).toBe(0);
    expect(Math.hypot((b?.x ?? 0) - qb.x, (b?.y ?? 0) - qb.y)).toBeLessThan(Math.hypot(r.x - qb.x, r.y - qb.y));
    expect(b).not.toEqual({ ...qb, lift: 0 });
    // and comes back before the throw
    const pre = positionsAt(m, ps, m.throwAt - 0.01);
    expect(ballAt(m, pre, m.throwAt - 0.01)).toEqual({ ...at(pre, "o2"), lift: 0 });
  });
  test("a pitch with nobody to throw to is a toss and a run", () => {
    const ps = defaults().map(withRoute("o5", { type: "pitch" }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("run");
    expect(m.runner).toBe("o5");
    expect(m.passer).toBe("o2");
    // the toss is in the air
    const mid = m.handAt + m.handFor / 2;
    expect(ballAt(m, positionsAt(m, ps, mid), mid)?.lift).toBeGreaterThan(0);
    const late = positionsAt(m, ps, m.dur);
    expect(ballAt(m, late, m.dur)).toEqual({ ...at(late, "o5"), lift: 0 });
    expect(at(late, "o5").y).toBeCloseTo(-5, 5);
  });
  test("a pitch beside a primary receiver: the runner takes the toss, sets up behind the line and throws", () => {
    const ps = defaults().map(withRoute("o5", { type: "pitch" })).map(withRoute("o3", { type: "go", primary: true }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("pass");
    expect(m.runner).toBe("o5");
    expect(m.passer).toBe("o5");
    expect(m.receiver).toBe("o3");
    // the ball rides with the runner between the toss and the throw
    const held = m.handAt + m.handFor + 0.05;
    const pos = positionsAt(m, ps, held);
    expect(ballAt(m, pos, held)).toEqual({ ...at(pos, "o5"), lift: 0 });
    // and leaves from their set point, still behind the line
    const pre = positionsAt(m, ps, m.throwAt);
    const o5 = at(pre, "o5");
    expect(o5.y).toBeGreaterThan(0.9);
    expect(ballAt(m, pre, m.throwAt)).toEqual({ ...o5, lift: 0 });
    expect(m.throwAt).toBeGreaterThan(m.handAt + m.handFor);
    const late = positionsAt(m, ps, m.dur);
    expect(at(late, "o5")).toEqual(o5);
    expect(ballAt(m, late, m.dur)).toEqual({ ...at(late, "o3"), lift: 0 });
  });
  test("a primary pitch runner keeps it", () => {
    const ps = defaults().map(withRoute("o5", { type: "pitch", primary: true })).map(withRoute("o3", { type: "go" }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("run");
    expect(m.passer).toBe("o2");
    expect(at(positionsAt(m, ps, m.dur), "o5").y).toBeCloseTo(-5, 5);
  });
  test("a quarterback on a pitch route rolls out and throws from the edge", () => {
    const ps = defaults().map(withRoute("o2", { type: "pitch" })).map(withRoute("o3", { type: "go", primary: true }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("pass");
    expect(m.passer).toBe("o2");
    expect(m.handAt).toBe(m.snapAt);
    const pre = positionsAt(m, ps, m.throwAt);
    expect(at(pre, "o2").x).not.toBe(15);
    expect(at(pre, "o2").y).toBeGreaterThan(0.9);
    expect(ballAt(m, pre, m.throwAt)).toEqual({ ...at(pre, "o2"), lift: 0 });
  });
  test("an unmarked mixed call is teaching play-action, while simulation may choose the run", () => {
    const ps = defaults().map(withRoute("o5", { type: "counter" })).map(withRoute("o3", { type: "go" }));
    expect(buildMotion(ps, TOP).kind).toBe("pass");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(0.2, 0.1))).kind).toBe("run");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(0.8, 0.1, 0.1))).kind).toBe("pass");
  });
});

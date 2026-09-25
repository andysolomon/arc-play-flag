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
  test("explicit simulation playback can explore receivers other than the primary", () => {
    const ps = defaults()
      .map(withRoute("o3", { type: "go", primary: true }))
      .map(withRoute("o4", { type: "slant" }))
      .map(withRoute("o5", { type: "out" }));
    expect(buildMotion(ps, TOP, simulationPlayback(flips(PRIMARY_ODDS - 0.01))).receiver).toBe("o3");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(PRIMARY_ODDS + 0.01, 0.1))).receiver).toBe("o4");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(PRIMARY_ODDS + 0.01, 0.9))).receiver).toBe("o5");
  });
  test("live playback throws to the primary read 80% of the time and never turns it into a run", () => {
    // a runner in the mix must not steal the call away from the marked receiver
    const ps = defaults()
      .map(withRoute("o3", { type: "go", primary: true }))
      .map(withRoute("o4", { type: "slant" }))
      .map(withRoute("o5", { type: "dive" }));
    // a small linear congruential generator: a fixed seed keeps the tally reproducible
    let seed = 12345;
    const lcg = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const runs = 2000;
    let primary = 0;
    for (let i = 0; i < runs; i++) {
      const m = buildMotion(ps, TOP, simulationPlayback(lcg));
      expect(m.kind).toBe("pass");
      if (m.receiver === "o3") primary++;
      else expect(m.receiver).toBe("o4");
    }
    expect(primary / runs).toBeGreaterThan(PRIMARY_ODDS - 0.04);
    expect(primary / runs).toBeLessThan(PRIMARY_ODDS + 0.04);
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

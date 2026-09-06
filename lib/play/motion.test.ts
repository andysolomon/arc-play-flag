import { describe, expect, test } from "bun:test";
import { SHADOW, SNAP, SPEED, ballAt, buildMotion, positionsAt } from "./motion";
import { defaults } from "./routes";
import type { Player, Route } from "./types";

const TOP = -30;
const withRoute = (id: string, route: Route): ((p: Player) => Player) => (p) => (p.id === id ? { ...p, route } : p);

describe("buildMotion", () => {
  test("a play with no routes still runs for a second, and nobody moves", () => {
    const m = buildMotion(defaults(), TOP);
    expect(m.dur).toBeGreaterThanOrEqual(1);
    const pos = positionsAt(m, defaults(), 0.5);
    for (const p of defaults()) expect(pos[p.id]).toEqual({ x: p.x, y: p.y });
  });
  test("a routed player runs the route at a steady speed and stops at the end", () => {
    const ps = defaults().map(withRoute("o3", { type: "go" }));
    const m = buildMotion(ps, TOP);
    const p0 = positionsAt(m, ps, 0).o3, p1 = positionsAt(m, ps, 1).o3, pEnd = positionsAt(m, ps, 99).o3;
    expect(p0).toEqual({ x: 3, y: 1 });
    expect(p1?.x).toBe(3);
    expect(p1?.y).toBeCloseTo(1 - SPEED, 5);
    expect(pEnd?.y).toBeCloseTo(-14, 5);
    expect(m.dur).toBeGreaterThan(15 / SPEED);
  });
  test("the ball is snapped from the centre to the quarterback", () => {
    const ps = defaults();
    const m = buildMotion(ps, TOP);
    const pos = positionsAt(m, ps, 0);
    expect(ballAt(m, pos, 0)).toEqual({ x: 15, y: 1, lift: 0 });
    expect(ballAt(m, pos, SNAP / 2)?.y).toBeCloseTo(3, 5);
    expect(ballAt(m, pos, SNAP + 1)).toEqual({ x: 15, y: 5, lift: 0 });
  });
  test("the ball is thrown to the primary receiver and arrives where they are", () => {
    const ps = defaults().map(withRoute("o4", { type: "out", primary: true }));
    const m = buildMotion(ps, TOP);
    expect(m.receiver).toBe("o4");
    expect(m.throwAt).toBeGreaterThan(SNAP);
    expect(m.catchAt).toBeGreaterThan(m.throwAt);
    const mid = (m.throwAt + m.catchAt) / 2;
    expect(ballAt(m, positionsAt(m, ps, mid), mid)?.lift).toBeCloseTo(1, 5);
    const late = positionsAt(m, ps, m.dur);
    const o4 = late.o4;
    if (!o4) throw new Error("missing");
    expect(ballAt(m, late, m.dur)).toEqual({ x: o4.x, y: o4.y, lift: 0 });
  });
  test("a man defender ends up shadowing the receiver", () => {
    const ps = defaults()
      .map(withRoute("o3", { type: "go" }))
      .map(withRoute("d1", { type: "man", target: "o3" }));
    const m = buildMotion(ps, TOP);
    const pos = positionsAt(m, ps, 99);
    const o3 = pos.o3, d1 = pos.d1;
    if (!o3 || !d1) throw new Error("missing");
    expect(Math.hypot(o3.x - d1.x, o3.y - d1.y)).toBeCloseTo(SHADOW, 5);
  });
  test("a zone defender drops to the middle of the bubble", () => {
    const ps = defaults().map(withRoute("d5", { type: "zoneDeep" }));
    const m = buildMotion(ps, TOP);
    expect(positionsAt(m, ps, 99).d5).toEqual({ x: 15, y: -15 });
  });
});

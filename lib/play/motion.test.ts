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
  test("a quarterback on a throw route rolls out and throws from the edge", () => {
    const ps = defaults().map(withRoute("o2", { type: "throw" })).map(withRoute("o3", { type: "go", primary: true }));
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("pass");
    expect(m.passer).toBe("o2");
    const pre = positionsAt(m, ps, m.throwAt);
    expect(at(pre, "o2").x).toBeCloseTo(16.5, 5);
    expect(at(pre, "o2").y).toBeCloseTo(2.6, 5);
    expect(ballAt(m, pre, m.throwAt)).toEqual({ ...at(pre, "o2"), lift: 0 });
  });
  test("an unmarked mixed call is teaching play-action, while simulation may choose the run", () => {
    const ps = defaults().map(withRoute("o5", { type: "counter" })).map(withRoute("o3", { type: "go" }));
    expect(buildMotion(ps, TOP).kind).toBe("pass");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(0.2, 0.1))).kind).toBe("run");
    expect(buildMotion(ps, TOP, simulationPlayback(flips(0.8, 0.1, 0.1))).kind).toBe("pass");
  });
});

describe("lateral chains", () => {
  /** The default formation with routes, and the quarterback's laterals: each a target, or a target and its catch. */
  const chain = (hops: readonly (string | readonly [string, readonly [number, number]])[], r: Record<string, Route>): Player[] =>
    defaults().map((p) => {
      const q = r[p.id] ? { ...p, route: r[p.id] ?? null } : p;
      return p.id === "o2" ? { ...q, laterals: hops.map((h) => (typeof h === "string" ? { to: h } : { to: h[0], catch: h[1] })) } : q;
    });
  const DOUBLE = chain([["o5", [22, 6]]], { o5: { type: "throw" }, o4: { type: "go", primary: true }, o3: { type: "go" } });
  const ball = (m: ReturnType<typeof buildMotion>, ps: readonly Player[], t: number) => {
    const b = ballAt(m, positionsAt(m, ps, t), t);
    if (!b) throw new Error("no ball at " + String(t));
    return b;
  };

  test("a double pass: the ball goes back to the catch as the receiver gets there, then they set up and throw to the read", () => {
    const ps = DOUBLE;
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("pass");
    const [toss, ...more] = m.laterals;
    expect(more).toHaveLength(0);
    expect(toss).toMatchObject({ from: "o2", to: "o5" });
    if (!toss) return;
    expect(toss.at).toBeGreaterThan(m.snapAt);
    // held by the quarterback from the snap to the toss
    expect(ball(m, ps, (m.snapAt + toss.at) / 2)).toEqual({ x: 15, y: 5, lift: 0 });
    // never forward: level with or behind where it was let go, the whole flight, and low
    for (let t = toss.at; t <= toss.land; t += 0.01) {
      const b = ball(m, ps, t);
      expect(b.y).toBeGreaterThanOrEqual(5 - 1e-9);
      expect(b.lift).toBeLessThan(0.5);
    }
    // Z is at the catch when it lands, and it lands in Z's hands
    const landed = positionsAt(m, ps, toss.land);
    expect(at(landed, "o5").x).toBeCloseTo(22, 5);
    expect(at(landed, "o5").y).toBeCloseTo(6, 5);
    expect(ball(m, ps, toss.land + 0.01)).toEqual({ ...at(positionsAt(m, ps, toss.land + 0.01), "o5"), lift: 0 });
    // then Z sets up behind the line and throws to the read
    expect(m.passer).toBe("o5");
    expect(m.receiver).toBe("o4");
    expect(m.throwAt).toBeGreaterThan(toss.land);
    const pre = positionsAt(m, ps, m.throwAt);
    expect(at(pre, "o5").x).toBeCloseTo(23.5, 5);
    expect(at(pre, "o5").y).toBeCloseTo(2.6, 5);
    expect(ball(m, ps, m.throwAt)).toEqual({ ...at(pre, "o5"), lift: 0 });
    expect(ball(m, ps, m.dur)).toEqual({ ...at(positionsAt(m, ps, m.dur), "o4"), lift: 0 });
    // X runs the Go from the snap, the whole time
    expect(at(positionsAt(m, ps, 1), "o3").y).toBeCloseTo(1 - SPEED, 5);
    // simulation never throws to a carrier
    for (const r of [0.05, 0.5, 0.95]) {
      const sim = buildMotion(ps, TOP, simulationPlayback(flips(0.99, r)));
      expect(["o3", "o4"]).toContain(sim.receiver ?? "");
    }
  });
  test("two laterals go in order, the second from where the first was caught", () => {
    const ps = chain([["o5", [22, 6]], ["o3", [9, 6.8]]], { o3: { type: "throw" }, o4: { type: "go", primary: true } });
    const m = buildMotion(ps, TOP);
    const [first, second] = m.laterals;
    expect(second).toMatchObject({ from: "o5", to: "o3" });
    if (!first || !second) return;
    expect(second.at).toBeGreaterThan(first.land);
    // Z holds it at the catch until the second toss
    const held = positionsAt(m, ps, second.at);
    expect(at(held, "o5").x).toBeCloseTo(22, 5);
    expect(ball(m, ps, second.at)).toEqual({ ...at(held, "o5"), lift: 0 });
    for (let t = second.at; t <= second.land; t += 0.01) expect(ball(m, ps, t).y).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(m.passer).toBe("o3");
    expect(m.receiver).toBe("o4");
    expect(m.throwAt).toBeGreaterThan(second.land);
  });
  test("back to the QB and on: the QB holds their spot until they let it go, then drifts back to take it again (R11)", () => {
    const ps = chain([["o5", [22, 6]], ["o2", [12, 7]], ["o3", [4, 7.4]]], { o3: { type: "throw" }, o4: { type: "go", primary: true } });
    const m = buildMotion(ps, TOP);
    expect(m.laterals.map((l) => [l.from, l.to])).toEqual([["o2", "o5"], ["o5", "o2"], ["o2", "o3"]]);
    const [first, back, on] = m.laterals;
    if (!first || !back || !on) return;
    // the QB is still on their spot when the first toss leaves, and at their second catch when it comes back
    expect(at(positionsAt(m, ps, first.at), "o2")).toEqual({ x: 15, y: 5 });
    const caught = at(positionsAt(m, ps, back.land), "o2");
    expect(caught.x).toBeCloseTo(12, 5);
    expect(caught.y).toBeCloseTo(7, 5);
    // each toss leaves after the one before it lands, and none goes forward
    expect(back.at).toBeGreaterThan(first.land);
    expect(on.at).toBeGreaterThan(back.land);
    for (const [l, from] of [[first, 5], [back, 6], [on, 7]] as const) {
      for (let t = l.at; t <= l.land; t += 0.01) expect(ball(m, ps, t).y).toBeGreaterThanOrEqual(from - 1e-9);
    }
    // between the tosses the QB has it, at their second catch
    const between = (back.land + on.at) / 2;
    expect(ball(m, ps, between)).toEqual({ ...at(positionsAt(m, ps, between), "o2"), lift: 0 });
    expect(m.passer).toBe("o3");
    expect(m.receiver).toBe("o4");
  });
  test("a lateral run: the last carrier keeps it and runs from the catch", () => {
    const ps = chain([["o5", [22, 6]]], { o5: { type: "reverse" }, o4: { type: "go" } });
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("run");
    expect(m.runner).toBe("o5");
    const late = positionsAt(m, ps, m.dur);
    expect(at(late, "o5").y).toBeCloseTo(-5, 5);
    expect(ball(m, ps, m.dur)).toEqual({ ...at(late, "o5"), lift: 0 });
  });
  test("an unfinished chain ends with the ball in the last carrier's hands", () => {
    const ps = chain(["o5"], { o4: { type: "go", primary: true } });
    const m = buildMotion(ps, TOP);
    expect(m.kind).toBe("hold");
    expect(m.receiver).toBeNull();
    expect(ball(m, ps, m.dur)).toEqual({ ...at(positionsAt(m, ps, m.dur), "o5"), lift: 0 });
  });
  test("pre-snap motion holds the laterals back with the snap", () => {
    const still = DOUBLE;
    const moving = still.map((p) => (p.id === "o3" ? { ...p, preSnap: { pts: [[8, 1]] as [number, number][] } } : p));
    const a = buildMotion(still, TOP), b = buildMotion(moving, TOP);
    const shift = b.preSnapFor ?? 0;
    expect(shift).toBeGreaterThan(0);
    expect(b.laterals[0]?.at).toBeCloseTo((a.laterals[0]?.at ?? 0) + shift, 5);
    expect(b.laterals[0]?.land).toBeCloseTo((a.laterals[0]?.land ?? 0) + shift, 5);
  });
});


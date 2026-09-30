import { describe, expect, test } from "bun:test";
import { catchClamp, catchPoint, chainOf, clampCatch, defaultCatch, releasePoint, settleChain, startOf } from "./lateral";
import { LOS_GAP, PITCH_SET, X_MAX, X_MIN, Y_MAX, defaults } from "./routes";
import type { Pair, Player, Route } from "./types";

/** The default formation (C 15,1 · QB 15,5 · X 3,1 · Y 27,1 · Z 19,5) with routes on the named players. */
const withRoutes = (r: Record<string, Route>): Player[] => defaults().map((p) => (r[p.id] ? { ...p, route: r[p.id] ?? null } : p));
const ids = (ps: readonly Player[]): string[] => ps.map((p) => p.id);
const find = (ps: readonly Player[], id: string): Player => {
  const p = ps.find((q) => q.id === id);
  if (!p) throw new Error("missing " + id);
  return p;
};

describe("chainOf", () => {
  test("with no lateral the chain is the quarterback alone (C6)", () => {
    expect(ids(chainOf(defaults()))).toEqual(["o2"]);
    expect(ids(chainOf(withRoutes({ o2: { type: "dive" }, o3: { type: "go" } })))).toEqual(["o2"]);
  });
  test("follows every lateral from the quarterback: a three-hop chain", () => {
    const ps = withRoutes({
      o2: { type: "lateral", target: "o5" },
      o5: { type: "lateral", target: "o3" },
      o3: { type: "lateral", target: "o4" },
      o4: { type: "throw" },
    });
    expect(ids(chainOf(ps))).toEqual(["o2", "o5", "o3", "o4"]);
  });
  test("a lateral back to a player already holding it ends the chain there (C3)", () => {
    const ps = withRoutes({ o2: { type: "lateral", target: "o5" }, o5: { type: "lateral", target: "o2" } });
    expect(ids(chainOf(ps))).toEqual(["o2", "o5"]);
    // a lateral to yourself is the same loop
    expect(ids(chainOf(withRoutes({ o2: { type: "lateral", target: "o2" } })))).toEqual(["o2"]);
  });
  test("a lateral to nobody on the field, or to a defender, is not a hop (C2, C4)", () => {
    expect(ids(chainOf(withRoutes({ o2: { type: "lateral", target: "gone" } })))).toEqual(["o2"]);
    expect(ids(chainOf(withRoutes({ o2: { type: "lateral", target: "d1" } })))).toEqual(["o2"]);
    expect(ids(chainOf(withRoutes({ o2: { type: "lateral" } })))).toEqual(["o2"]);
  });
  test("a lateral the chain never reaches is not part of it (C5)", () => {
    const ps = withRoutes({ o5: { type: "lateral", target: "o3" }, o3: { type: "throw" } });
    expect(ids(chainOf(ps))).toEqual(["o2"]);
  });
  test("no quarterback, no chain (C1)", () => {
    const ps = defaults().filter((p) => p.id !== "o2");
    expect(chainOf(ps)).toEqual([]);
  });
});

describe("clampCatch", () => {
  test("a catch in front of the release snaps level with it (K1)", () => {
    expect(clampCatch([20, 3], [15, 5])).toEqual([20, 5]);
  });
  test("a catch past the line of scrimmage snaps back to it (K2)", () => {
    expect(clampCatch([20, -3], [15, 0.2])).toEqual([20, LOS_GAP]);
    // the release is further back: that wins
    expect(clampCatch([20, -3], [15, 5])).toEqual([20, 5]);
  });
  test("a catch behind the release is left where it is", () => {
    expect(clampCatch([20, 6.5], [15, 5])).toEqual([20, 6.5]);
    expect(clampCatch([20, 5], [15, 5])).toEqual([20, 5]);
  });
  test("a catch off the field comes back inside it (K3)", () => {
    expect(clampCatch([-4, 9], [15, 5])).toEqual([X_MIN, Y_MAX]);
    expect(clampCatch([40, 6], [15, 5])).toEqual([X_MAX, 6]);
  });
});

describe("the catch point", () => {
  test("with none stored, 3 yards past the target and at least a yard behind the release (K6)", () => {
    const target = find(defaults(), "o5");
    expect(defaultCatch([15, 5], target)).toEqual([22, 6]);
    // across the field toward X, pulled in at the sideline
    expect(defaultCatch([22, 6], find(defaults(), "o3"))).toEqual([X_MIN, 7]);
    // never shallower than the set depth
    expect(defaultCatch([15, 0.9], find(defaults(), "o4"))[1]).toBe(PITCH_SET);
  });
  test("a stored catch is read back clamped against its release", () => {
    const ps = withRoutes({ o2: { type: "lateral", target: "o5", catch: [22, -3] } });
    expect(catchPoint(find(ps, "o2"), ps)).toEqual([22, 5]);
  });
  test("the quarterback lets it go where they stand at the snap (K7)", () => {
    const ps = withRoutes({ o2: { type: "lateral", target: "o5" } }).map((p) => (p.id === "o2" ? { ...p, preSnap: { pts: [[10, 3]] as Pair[] } } : p));
    expect(releasePoint(find(ps, "o2"), ps)).toEqual([10, 3]);
  });
  test("each later carrier lets it go where they caught it", () => {
    const ps = withRoutes({ o2: { type: "lateral", target: "o5", catch: [22, 6] }, o5: { type: "lateral", target: "o3" } });
    expect(releasePoint(find(ps, "o2"), ps)).toEqual([15, 5]);
    expect(releasePoint(find(ps, "o5"), ps)).toEqual([22, 6]);
    // their route starts there too, not where they lined up
    expect(startOf(find(ps, "o5"), ps)).toMatchObject({ x: 22, y: 6 });
    expect(startOf(find(ps, "o2"), ps)).toMatchObject({ x: 15, y: 5 });
    // a player off the chain lets nothing go: their own spot
    expect(releasePoint(find(ps, "o4"), ps)).toEqual([27, 1]);
  });
  test("says which rule the catch landed on when it snapped", () => {
    expect(catchClamp([20, 3], [15, 5])).toBe("forward");
    // past the line, but let go 5 yards deep: it lands level with the release, so that is the rule
    expect(catchClamp([20, -2], [15, 5])).toBe("forward");
    // let go on the line: it lands on the line
    expect(catchClamp([20, 0.5], [15, LOS_GAP])).toBe("line");
    expect(catchClamp([20, -3], [15, 0.2])).toBe("line");
    expect(catchClamp([20, 6], [15, 5])).toBeNull();
    expect(catchClamp([20, 5], [15, 5])).toBeNull();
  });
});

describe("settleChain", () => {
  test("clamps the whole chain in order: a downstream catch follows the upstream one (K4)", () => {
    const ps = withRoutes({
      o2: { type: "lateral", target: "o5", catch: [22, 3] },
      o5: { type: "lateral", target: "o3", catch: [9, 4] },
      o3: { type: "throw" },
    });
    const out = settleChain(ps);
    expect(find(out, "o2").route?.catch).toEqual([22, 5]);
    // released at 5 (after its own clamp), not at the stale 3
    expect(find(out, "o5").route?.catch).toEqual([9, 5]);
  });
  test("never pulls a catch forward when its release moves up (K5)", () => {
    const ps = withRoutes({ o2: { type: "lateral", target: "o5", catch: [22, 7] } }).map((p) => (p.id === "o2" ? { ...p, y: 2 } : p));
    expect(find(settleChain(ps), "o2").route?.catch).toEqual([22, 7]);
  });
  test("a carrier after the quarterback runs no pass route and is never the read (S1, S2)", () => {
    const ps = withRoutes({ o2: { type: "lateral", target: "o5" }, o5: { type: "go", primary: true } });
    expect(find(settleChain(ps), "o5").route).toBeNull();
    const keep = withRoutes({ o2: { type: "lateral", target: "o5" }, o5: { type: "reverse", primary: true } });
    expect(find(settleChain(keep), "o5").route).toEqual({ type: "reverse" });
  });
  test("a lateral or throw nobody reaches, or a lateral that goes nowhere, is taken off (S3)", () => {
    const ps = withRoutes({ o3: { type: "throw" }, o4: { type: "lateral", target: "o3" }, o2: { type: "lateral", target: "gone" } });
    const out = settleChain(ps);
    expect(find(out, "o3").route).toBeNull();
    expect(find(out, "o4").route).toBeNull();
    expect(find(out, "o2").route).toBeNull();
    const loop = settleChain(withRoutes({ o2: { type: "lateral", target: "o5" }, o5: { type: "lateral", target: "o2" } }));
    expect(find(loop, "o5").route).toBeNull();
    expect(find(loop, "o2").route).toEqual({ type: "lateral", target: "o5" });
  });
  test("leaves a settled play, and a quarterback with no lateral, exactly as they were (S4, S5)", () => {
    const ps = withRoutes({ o2: { type: "dive", primary: true }, o3: { type: "go" } });
    expect(settleChain(ps)).toBe(ps);
    const chain = withRoutes({ o2: { type: "lateral", target: "o5", catch: [22, 6] }, o5: { type: "throw" }, o4: { type: "go", primary: true } });
    expect(settleChain(chain)).toBe(chain);
  });
});

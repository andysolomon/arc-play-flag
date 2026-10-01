import { describe, expect, test } from "bun:test";
import {
  MAX_LATERALS, catchClamp, chainLinks, chainOf, clampCatch, defaultCatch, releasePoint, settleChain, startOf,
} from "./lateral";
import { LOS_GAP, PITCH_SET, X_MAX, X_MIN, Y_MAX, defaults } from "./routes";
import type { Hop, Pair, Player, Route } from "./types";

/** The default formation (C 15,1 · QB 15,5 · X 3,1 · Y 27,1 · Z 19,5) with routes on the named players. */
const withRoutes = (r: Record<string, Route>): Player[] => defaults().map((p) => (r[p.id] ? { ...p, route: r[p.id] ?? null } : p));
/** The same, with the quarterback's laterals: each hop a target id, or a target and its stored catch. */
const play = (hops: readonly (string | readonly [string, Pair])[], r: Record<string, Route> = {}): Player[] =>
  withRoutes(r).map((p) => (p.id === "o2" ? { ...p, laterals: hops.map((h): Hop => (typeof h === "string" ? { to: h } : { to: h[0], catch: h[1] })) } : p));
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
    expect(ids(chainOf(play(["o5", "o3", "o4"])))).toEqual(["o2", "o5", "o3", "o4"]);
  });
  test("a player can take it again: QB → Z → QB → X (R2)", () => {
    expect(ids(chainOf(play(["o5", "o2", "o3"])))).toEqual(["o2", "o5", "o2", "o3"]);
    expect(ids(chainOf(play(["o5", "o2", "o5", "o2"])))).toEqual(["o2", "o5", "o2", "o5", "o2"]);
  });
  test("a lateral to the player who has it is no toss: the chain ends there (R1)", () => {
    expect(ids(chainOf(play(["o2"])))).toEqual(["o2"]);
    expect(ids(chainOf(play(["o5", "o5", "o3"])))).toEqual(["o2", "o5"]);
  });
  test("a lateral to nobody on the field, or to a defender, ends the chain at the thrower (R3)", () => {
    expect(ids(chainOf(play(["gone", "o5"])))).toEqual(["o2"]);
    expect(ids(chainOf(play(["o5", "d1", "o3"])))).toEqual(["o2", "o5"]);
  });
  test("laterals on anyone but the quarterback are no chain (R7)", () => {
    const ps = withRoutes({}).map((p) => (p.id === "o5" ? { ...p, laterals: [{ to: "o3" }] } : p));
    expect(ids(chainOf(ps))).toEqual(["o2"]);
  });
  test("no quarterback, no chain (C1)", () => {
    expect(chainOf(defaults().filter((p) => p.id !== "o2"))).toEqual([]);
  });
  test("as long as storage keeps: a back-and-forth past the cap is cut at it (R4)", () => {
    const hops = Array.from({ length: MAX_LATERALS + 10 }, (_, i) => (i % 2 === 0 ? "o5" : "o2"));
    expect(chainOf(play(hops))).toHaveLength(MAX_LATERALS + 1);
  });
});

describe("clampCatch", () => {
  test("a catch in front of the release snaps level with it (K1)", () => {
    expect(clampCatch([20, 3], [15, 5])).toEqual([20, 5]);
  });
  test("a catch past the line of scrimmage snaps back to it (K2)", () => {
    expect(clampCatch([20, -3], [15, 0.2])).toEqual([20, LOS_GAP]);
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
  test("says which rule the catch landed on when it snapped", () => {
    expect(catchClamp([20, 3], [15, 5])).toBe("forward");
    expect(catchClamp([20, -2], [15, 5])).toBe("forward");
    expect(catchClamp([20, 0.5], [15, LOS_GAP])).toBe("line");
    expect(catchClamp([20, -3], [15, 0.2])).toBe("line");
    expect(catchClamp([20, 6], [15, 5])).toBeNull();
    expect(catchClamp([20, 5], [15, 5])).toBeNull();
  });
});

describe("the catch point", () => {
  const catches = (ps: readonly Player[]): Pair[] => chainLinks(ps).map((l) => l.catch);
  test("with none stored, 3 yards past where the target is and at least a yard behind the release (K6)", () => {
    expect(defaultCatch([15, 5], [19, 5])).toEqual([22, 6]);
    expect(defaultCatch([22, 6], [3, 1])).toEqual([X_MIN, 7]);
    expect(defaultCatch([15, 0.9], [27, 1])[1]).toBe(PITCH_SET);
  });
  test("a target who carried it before is caught from where they let it go, not where they lined up (R10)", () => {
    // QB → Z at 22,6, back to the QB, who is still on their spot; then on to Z, who is at their catch
    expect(catches(play([["o5", [22, 6]], "o2", "o5"]))).toEqual([[22, 6], [12, 7], [25, Y_MAX]]);
  });
  test("a stored catch is read back clamped against its release", () => {
    expect(catches(play([["o5", [22, -3]]]))).toEqual([[22, 5]]);
  });
  test("the quarterback lets it go where they stand at the snap (K7)", () => {
    const ps = play(["o5"]).map((p) => (p.id === "o2" ? { ...p, preSnap: { pts: [[10, 3]] as Pair[] } } : p));
    expect(chainLinks(ps)[0]?.release).toEqual([10, 3]);
  });
  test("each toss is let go where the one before it was caught", () => {
    const ps = play([["o5", [22, 6]], "o2", "o3"]);
    expect(releasePoint(ps, 0)).toEqual([15, 5]);
    expect(releasePoint(ps, 1)).toEqual([22, 6]);
    expect(releasePoint(ps, 2)).toEqual([12, 7]);
    expect(releasePoint(ps, 3)).toBeNull();
  });
  test("only the last carrier's job starts at their catch; anyone else starts where they stand", () => {
    const ps = play([["o5", [22, 6]], ["o2", [12, 7]], "o3"], { o3: { type: "throw" } });
    expect(startOf(find(ps, "o3"), ps)).toMatchObject({ x: X_MIN, y: Y_MAX });
    expect(startOf(find(ps, "o5"), ps)).toMatchObject({ x: 19, y: 5 });
    // the quarterback taking it back last throws from their second catch
    const back = play([["o5", [22, 6]], ["o2", [12, 7]]], { o2: { type: "throw" } });
    expect(startOf(find(back, "o2"), back)).toMatchObject({ x: 12, y: 7 });
  });
});

describe("settleChain", () => {
  const hops = (ps: readonly Player[]): readonly Hop[] | undefined => find(ps, "o2").laterals;
  test("clamps the whole chain in order: a downstream catch follows the upstream one (K4)", () => {
    const out = settleChain(play([["o5", [22, 3]], ["o3", [9, 4]]], { o3: { type: "throw" } }));
    expect(hops(out)).toEqual([{ to: "o5", catch: [22, 5] }, { to: "o3", catch: [9, 5] }]);
  });
  test("never pulls a catch forward when its release moves up (K5)", () => {
    const ps = play([["o5", [22, 7]]]).map((p) => (p.id === "o2" ? { ...p, y: 2 } : p));
    expect(hops(settleChain(ps))).toEqual([{ to: "o5", catch: [22, 7] }]);
  });
  test("the last carrier throws or keeps it and is never the read; a pass route goes (S1, S2)", () => {
    expect(find(settleChain(play(["o5"], { o5: { type: "go", primary: true } })), "o5").route).toBeNull();
    expect(find(settleChain(play(["o5"], { o5: { type: "reverse", primary: true } })), "o5").route).toEqual({ type: "reverse" });
  });
  test("a carrier the ball goes on from has no job of their own: it is their lateral (R5)", () => {
    const out = settleChain(play(["o5", "o3"], { o2: { type: "dive" }, o5: { type: "throw" }, o3: { type: "throw" } }));
    expect(find(out, "o2").route).toBeNull();
    expect(find(out, "o5").route).toBeNull();
    expect(find(out, "o3").route).toEqual({ type: "throw" });
    // the quarterback taking it back last keeps their throw
    const back = settleChain(play(["o5", "o2"], { o2: { type: "throw" } }));
    expect(find(back, "o2").route).toEqual({ type: "throw" });
  });
  test("a throw nobody reaches, laterals off the quarterback and hops past a broken one are taken off (S3, R7)", () => {
    const ps = play(["o5", "o5", "o3"], { o4: { type: "throw" } }).map((p) => (p.id === "o3" ? { ...p, laterals: [{ to: "o4" }] } : p));
    const out = settleChain(ps);
    expect(find(out, "o4").route).toBeNull();
    expect(find(out, "o3").laterals).toBeUndefined();
    expect(hops(out)).toEqual([{ to: "o5" }]);
    expect(hops(settleChain(play(["gone"])))).toBeUndefined();
  });
  test("keeps no more laterals than storage holds (R4)", () => {
    const out = settleChain(play(Array.from({ length: MAX_LATERALS + 4 }, (_, i) => (i % 2 === 0 ? "o5" : "o2"))));
    expect(hops(out)).toHaveLength(MAX_LATERALS);
  });
  test("leaves a settled play, and a quarterback with no lateral, exactly as they were (S4, S5)", () => {
    const ps = withRoutes({ o2: { type: "dive", primary: true }, o3: { type: "go" } });
    expect(settleChain(ps)).toBe(ps);
    const chain = play([["o5", [22, 6]], ["o2", [12, 7]], "o3"], { o3: { type: "throw" }, o4: { type: "go", primary: true } });
    expect(settleChain(chain)).toBe(chain);
  });
});

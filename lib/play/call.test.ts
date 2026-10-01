import { describe, expect, test } from "bun:test";
import { callOf, runInNoRunZone } from "./call";
import { defaults } from "./routes";
import type { Route } from "./types";

const withRoutes = (r: Record<string, Route>) => defaults().map((p) => (r[p.id] ? { ...p, route: r[p.id] ?? null } : p));
/** The same, with the quarterback's laterals to each id in turn. */
const withChain = (hops: readonly string[], r: Record<string, Route> = {}) =>
  withRoutes(r).map((p) => (p.id === "o2" ? { ...p, laterals: hops.map((to) => ({ to })) } : p));

describe("callOf", () => {
  test("nothing routed is no call", () => {
    expect(callOf(defaults())).toBeNull();
    expect(callOf(withRoutes({ d1: { type: "blitz" } }))).toBeNull();
  });
  test("routes alone are a pass", () => {
    expect(callOf(withRoutes({ o3: { type: "go" }, o4: { type: "slant", primary: true } }))).toBe("pass");
  });
  test("a runner beside receivers is play-action unless the runner is the read", () => {
    expect(callOf(withRoutes({ o3: { type: "go" }, o5: { type: "dive" } }))).toBe("play-action");
    expect(callOf(withRoutes({ o3: { type: "go" }, o5: { type: "dive", primary: true } }))).toBe("run");
  });
  test("a lateral chain is called by how it ends", () => {
    expect(callOf(withChain(["o5"], { o5: { type: "throw" }, o4: { type: "go", primary: true } }))).toBe("double-pass");
    expect(callOf(withChain(["o5", "o3"], { o3: { type: "throw" } }))).toBe("lateral-pass");
    expect(callOf(withChain(["o5"], { o5: { type: "reverse" }, o4: { type: "go" } }))).toBe("lateral-run");
    expect(callOf(withChain(["o5"], { o4: { type: "go" } }))).toBe("lateral-unfinished");
    // back to the quarterback, who throws or keeps it
    expect(callOf(withChain(["o5", "o2"], { o2: { type: "throw" } }))).toBe("lateral-pass");
    expect(callOf(withChain(["o5", "o2"], { o2: { type: "dive" } }))).toBe("lateral-run");
    // laterals on anyone but the quarterback change nothing
    const stray = withRoutes({ o4: { type: "go" } }).map((p) => (p.id === "o5" ? { ...p, laterals: [{ to: "o3" }] } : p));
    expect(callOf(stray)).toBe("pass");
  });
  test("a runner with nobody to throw to is a run", () => {
    expect(callOf(withRoutes({ o5: { type: "stretch" } }))).toBe("run");
  });
});

describe("a lateral chain in a no-run zone (W4)", () => {
  // the ball on their 5, in a league that plays with no-run zones
  const at5 = (hops: readonly string[], r: Record<string, Route>) => ({ side: "offense" as const, los: 35, players: withChain(hops, r) });
  test("a chain that ends in a throw is a pass, and never flagged", () => {
    expect(runInNoRunZone(at5(["o5"], { o5: { type: "throw" }, o4: { type: "corner" } }), true)).toBe(false);
    expect(runInNoRunZone(at5(["o5", "o3"], { o3: { type: "throw" } }), true)).toBe(false);
    expect(runInNoRunZone(at5(["o5", "o2"], { o2: { type: "throw" } }), true)).toBe(false);
  });
  test("a chain that ends in a keep is a run, and flagged like one", () => {
    expect(runInNoRunZone(at5(["o5"], { o5: { type: "reverse" }, o4: { type: "corner" } }), true)).toBe(true);
    expect(runInNoRunZone(at5(["o5", "o2"], { o2: { type: "dive" } }), true)).toBe(true);
    // not where the league plays without the zones, or from the 40
    expect(runInNoRunZone(at5(["o5"], { o5: { type: "reverse" } }), false)).toBe(false);
    expect(runInNoRunZone({ ...at5(["o5"], { o5: { type: "reverse" } }), los: 0 }, true)).toBe(false);
  });
  test("an unfinished chain is not a run yet", () => {
    expect(runInNoRunZone(at5(["o5"], {}), true)).toBe(false);
  });
});

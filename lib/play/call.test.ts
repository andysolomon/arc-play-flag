import { describe, expect, test } from "bun:test";
import { callOf, runInNoRunZone } from "./call";
import { defaults } from "./routes";
import type { Route } from "./types";

const withRoutes = (r: Record<string, Route>) => defaults().map((p) => (r[p.id] ? { ...p, route: r[p.id] ?? null } : p));

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
    const lateral = { o2: { type: "lateral", target: "o5" } } as const;
    expect(callOf(withRoutes({ ...lateral, o5: { type: "throw" }, o4: { type: "go", primary: true } }))).toBe("double-pass");
    expect(callOf(withRoutes({ ...lateral, o5: { type: "lateral", target: "o3" }, o3: { type: "throw" } }))).toBe("lateral-pass");
    expect(callOf(withRoutes({ ...lateral, o5: { type: "reverse" }, o4: { type: "go" } }))).toBe("lateral-run");
    expect(callOf(withRoutes({ ...lateral, o4: { type: "go" } }))).toBe("lateral-unfinished");
    // a lateral the chain never reaches changes nothing
    expect(callOf(withRoutes({ o5: { type: "lateral", target: "o3" }, o4: { type: "go" } }))).toBe("pass");
  });
  test("a runner with nobody to throw to is a run", () => {
    expect(callOf(withRoutes({ o5: { type: "stretch" } }))).toBe("run");
  });
});

describe("a lateral chain in a no-run zone (W4)", () => {
  // the ball on their 5, in a league that plays with no-run zones
  const at5 = (r: Record<string, Route>) => ({ side: "offense" as const, los: 35, players: withRoutes(r) });
  const lateral = { o2: { type: "lateral", target: "o5" } } as const;
  test("a chain that ends in a throw is a pass, and never flagged", () => {
    expect(runInNoRunZone(at5({ ...lateral, o5: { type: "throw" }, o4: { type: "corner" } }), true)).toBe(false);
    expect(runInNoRunZone(at5({ ...lateral, o5: { type: "lateral", target: "o3" }, o3: { type: "throw" } }), true)).toBe(false);
  });
  test("a chain that ends in a keep is a run, and flagged like one", () => {
    expect(runInNoRunZone(at5({ ...lateral, o5: { type: "reverse" }, o4: { type: "corner" } }), true)).toBe(true);
    // not where the league plays without the zones, or from the 40
    expect(runInNoRunZone(at5({ ...lateral, o5: { type: "reverse" } }), false)).toBe(false);
    expect(runInNoRunZone({ ...at5({ ...lateral, o5: { type: "reverse" } }), los: 0 }, true)).toBe(false);
  });
  test("an unfinished chain is not a run yet", () => {
    expect(runInNoRunZone(at5({ ...lateral }), true)).toBe(false);
  });
});

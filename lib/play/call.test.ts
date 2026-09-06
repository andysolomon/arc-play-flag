import { describe, expect, test } from "bun:test";
import { callOf } from "./call";
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
  test("a runner with nobody to throw to is a run", () => {
    expect(callOf(withRoutes({ o5: { type: "stretch" } }))).toBe("run");
  });
});

import { describe, expect, test } from "bun:test";
import { defaults } from "./routes";
import type { Player, RouteType } from "./types";
import { zoneLayout } from "./zones";

const TOP = -30;
const withRoutes = (m: Record<string, RouteType>): Player[] =>
  defaults().map((p) => (m[p.id] ? { ...p, route: { type: m[p.id] as RouteType } } : p));

describe("zoneLayout", () => {
  test("cover 1: a single deep zone owns the whole field", () => {
    const z = zoneLayout(withRoutes({ d5: "zoneDeep" }), TOP);
    expect(z.d5).toEqual({ cx: 15, cy: -15, rx: 7.4, ry: 2.3 });
  });
  test("cover 2: two deep zones split into halves, ordered left to right", () => {
    const z = zoneLayout(withRoutes({ d4: "zoneDeep", d1: "zoneDeep" }), TOP);
    expect(z.d1).toEqual({ cx: 7.5, cy: -12, rx: 7.15, ry: 2.3 });
    expect(z.d4).toEqual({ cx: 22.5, cy: -12, rx: 7.15, ry: 2.3 });
  });
  test("cover 3: thirds, anchored 4 yards behind the deepest defender", () => {
    const z = zoneLayout(withRoutes({ d1: "zoneDeep", d5: "zoneDeep", d4: "zoneDeep" }), TOP);
    expect(z.d1?.cx).toBe(5);
    expect(z.d5?.cx).toBe(15);
    expect(z.d4?.cx).toBe(25);
    expect(z.d5?.rx).toBeCloseTo(4.65);
    expect(z.d5?.cy).toBe(-15);
  });
  test("a shallow card pulls the deep shell in", () => {
    const z = zoneLayout(withRoutes({ d5: "zoneDeep" }), -16);
    expect(z.d5?.cy).toBeCloseTo(-13.1);
  });
  test("flats sit outside their defender and never stack", () => {
    const z = zoneLayout(withRoutes({ d2: "zoneFlat", d3: "zoneFlat" }), TOP);
    expect(z.d2).toEqual({ cx: 8.4, cy: -7.4, rx: 4.6, ry: 1.9 });
    expect(z.d3?.cx).toBe(20.6);
    const stacked = zoneLayout(
      defaults().map((p) =>
        p.id === "d2" || p.id === "d3" ? { ...p, x: 16, route: { type: "zoneFlat" as const } } : p,
      ),
      TOP,
    );
    // both want cx 18.6; the second is pushed right until the sideline stops it
    expect(stacked.d2?.cx).toBeCloseTo(18.6);
    expect(stacked.d3?.cx).toBe(25);
  });
  test("curl-flat, mid-read and spy bubbles", () => {
    const z = zoneLayout(withRoutes({ d1: "curlFlat", d3: "midRead", d2: "spy" }), TOP);
    expect(z.d1?.cx).toBeCloseTo(5.3);
    expect(z.d1).toMatchObject({ cy: -8.5, rx: 4.9, ry: 2.1 });
    expect(z.d3).toEqual({ cx: 15, cy: -7.5, rx: 5.4, ry: 2.1 });
    expect(z.d2).toEqual({ cx: 11, cy: -1.6, rx: 2.1, ry: 1.9 });
  });
  test("ignores offense and non-zone routes", () => {
    expect(zoneLayout(withRoutes({ o3: "zoneDeep", d1: "blitz" }), TOP)).toEqual({});
  });
});

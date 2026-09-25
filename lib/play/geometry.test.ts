import { describe, expect, test } from "bun:test";
import { clamp, depth, fieldLayout, geom, routeYards, ybv } from "./geometry";
import { PITCH_SET, defaults } from "./routes";
import type { Player } from "./types";
import { zoneLayout } from "./zones";

const TOP = -30;

describe("clamp", () => {
  test("offense cannot cross the LOS", () => {
    expect(clamp(15, -3, "offense", TOP).y).toBe(0.9);
  });
  test("defense cannot cross the LOS", () => {
    expect(clamp(15, 3, "defense", TOP).y).toBe(-0.9);
  });
  test("a blitzer stays at least 7 yards off the LOS", () => {
    expect(clamp(15, -3, "defense", TOP, 7).y).toBe(-7);
    expect(clamp(15, -9, "defense", TOP, 7).y).toBe(-9);
  });
  test("keeps players inside the sidelines and the card", () => {
    expect(clamp(-4, 40, null, TOP)).toEqual({ x: 1.2, y: 7.4 });
    expect(clamp(40, -99, null, TOP)).toEqual({ x: 28.8, y: TOP + 1.2 });
  });
});

describe("depth", () => {
  test("never below 24 or above 45 yards", () => {
    expect(depth(defaults(), { pw: 1000, ph: 300 })).toBe(24);
    expect(depth(defaults(), { pw: 300, ph: 1000 })).toBe(45);
  });
  test("grows to fit the deepest player", () => {
    const deep = defaults().map((p) => (p.id === "d5" ? { ...p, y: -20 } : p));
    expect(depth(deep, { pw: 1000, ph: 300 })).toBe(29);
  });
});

describe("fieldLayout", () => {
  test("clips bands and lines to the card", () => {
    const f = fieldLayout(24);
    expect(f.top).toBe(-16);
    expect(f.viewBox).toBe("0 0 660 528");
    expect(f.bands).toHaveLength(1);
    expect(f.endZone).toBeNull();
    expect(f.lines.map((l) => l.y)).toEqual([462, 352, 242, 132, 22]);
    expect(f.texts.map((t) => t.t)).toEqual(["LOS", "10", "15", "20", "NO-RUN"]);
    // at 19 yards the band is clipped to 1 yard, too short for its label
    const g = fieldLayout(19);
    expect(g.bands).toHaveLength(1);
    expect(g.texts.map((t) => t.t)).not.toContain("NO-RUN");
  });
  test("shows the end zone at full depth", () => {
    const f = fieldLayout(45);
    expect(f.endZone).toEqual({ y: 0, h: 44 });
    expect(f.texts.at(-1)?.t).toBe("END ZONE");
  });
});

describe("geom", () => {
  const players = defaults();
  const at = (id: string, route: Player["route"], xy?: { x: number; y: number }): Player => {
    const p = players.find((q) => q.id === id);
    if (!p) throw new Error(id);
    return { ...p, ...xy, route };
  };

  test("draws a go route straight up the field", () => {
    const g = geom(at("o3", { type: "go" }), players, TOP, {});
    expect(g).not.toBeNull();
    expect(g?.d).toBe("M66.0 655.0L66.0 365.6");
    expect(g?.arrow).toBe("66.0,352.0 74.5,369.0 57.5,369.0");
    expect(g?.draw).toBe(true);
    expect(g?.color).toBe("#4a3728");
  });
  test("shrinks to fit when the route would leave the card", () => {
    const top = ybv(24); // -16
    const g = geom(at("o3", { type: "go" }), players, top, {});
    // 15 yards of route must fit into 1 - (-16 + 0.6) - 0.6 = 15.8 → k = 15.8/15 → clipped to 1
    expect(g?.d).toBe("M66.0 347.0L66.0 57.6");
    // a right-side player's out route heads for the near sideline: k = (29.4 - 0.6 - 27)/6 = 0.3
    const out = geom(at("o4", { type: "out" }), players, TOP, {});
    expect(out?.d).toBe("M594.0 668.1L594.0 649.0L620.0 649.0");
    // handedness: a left-side player's cross breaks toward the middle, nothing to shrink
    const cross = geom(at("o3", { type: "cross" }, { x: 2, y: 1 }), players, TOP, {});
    expect(cross?.d).toBe("M44.0 655.0L44.0 594.0L316.7 531.1");
  });
  test("honours mirror and the near sideline", () => {
    const left = geom(at("o3", { type: "out" }), players, TOP, {});
    const mirrored = geom(at("o3", { type: "out", mirror: true }), players, TOP, {});
    expect(left?.d).toBe("M66.0 668.1L66.0 649.0L40.0 649.0");
    expect(mirrored?.d).toBe("M66.0 655.0L66.0 572.0L184.4 572.0");
  });
  test("a pitch runs wide of the quarterback, sets up behind the line, then turns upfield", () => {
    const pts = routeYards(at("o5", { type: "pitch" }), players, TOP);
    expect(pts).toEqual([[19, 5], [18.5, 6.2], [22, PITCH_SET], [23, -5]]);
    const mirrored = routeYards(at("o5", { type: "pitch", mirror: true }), players, TOP);
    expect(mirrored).toEqual([[19, 5], [11.5, 6.2], [8, PITCH_SET], [7, -5]]);
    // a quarterback's pitch route is a rollout from their own spot
    expect(routeYards(at("o2", { type: "pitch" }), players, TOP)).toEqual([[15, 5], [18.5, 6.2], [22, PITCH_SET], [23, -5]]);
  });
  test("blitz drives at the quarterback", () => {
    const g = geom(at("d5", { type: "blitz" }), players, TOP, {});
    // d5 (15,-11) → QB (15,5): L=16, reach 14.2 → ends at y=3.2
    expect(g?.d).toBe("M330.0 445.0L330.0 716.8");
    expect(g?.color).toBe("#b3261e");
  });
  test("man stops short of its target and is dashed", () => {
    const g = geom(at("d1", { type: "man", target: "o3" }), players, TOP, {});
    expect(g?.d).toBe("M66.0 574.0L66.0 643.1");
    expect(g?.dash).toBe("10 8");
    expect(g?.draw).toBe(false);
    expect(geom(at("d1", { type: "man", target: "nope" }), players, TOP, {})).toBeNull();
  });
  test("zone routes end in a bubble from the shared layout", () => {
    const shell = players.map((p) => (p.id === "d5" ? { ...p, route: { type: "zoneDeep" as const } } : p));
    const zones = zoneLayout(shell, TOP);
    const g = geom(shell[9] as Player, shell, TOP, zones);
    expect(g?.zone?.cx).toBe(330);
    expect(g?.zone?.cy).toBe(330);
    expect(g?.zone?.rx).toBeCloseTo(162.8);
    expect(g?.zone?.ry).toBeCloseTo(50.6);
    expect(g?.zone?.fill).toBe("#1d4fbe2e");
    expect(g?.d).toBe("M330.0 391.0L330.0 357.8");
  });
  test("custom routes follow their waypoints", () => {
    const g = geom(at("o5", { type: "custom", pts: [[19, 2], [24, -3]] }), players, TOP, {});
    expect(g?.d).toBe("M418.0 743.0L418.0 704.0L518.4 603.6");
  });
});

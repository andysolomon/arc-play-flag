import type { DefenseRouteType, OffenseRouteType, Pair, Player, RouteDef, RouteType, Team } from "./types";

export const OFF = "#e5675e";
export const DEF = "#4a8fe0";

/** ink colours chosen for contrast on the #c1f0c1 field (all ≥4.5:1) */
export const INK = {
  deep: "#1d4fbe",
  mid: "#7a5a07",
  curl: "#6a34b8",
  flat: "#0e7175",
  blitz: "#b3261e",
  man: "#1d4fbe",
  route: "#7a5a07",
  primary: "#c2261a",
} as const;

export const ROUTES: Record<OffenseRouteType, RouteDef> = {
  go:      { label: "Go",      pts: [[0, 0], [0, -15]],                       end: "arrow" },
  out:     { label: "Out",     pts: [[0, 0], [0, -5], [6, -5]],               end: "arrow" },
  in:      { label: "In",      pts: [[0, 0], [0, -5], [-6, -5]],              end: "arrow" },
  slant:   { label: "Slant",   pts: [[0, 0], [0, -2], [-6, -8]],              end: "arrow" },
  corner:  { label: "Corner",  pts: [[0, 0], [0, -8], [5, -14]],              end: "arrow" },
  post:    { label: "Post",    pts: [[0, 0], [0, -8], [-5, -14]],             end: "arrow" },
  curl:    { label: "Curl",    pts: [[0, 0], [0, -9], [-1.4, -6.6]],          end: "arrow" },
  flat:    { label: "Flat",    pts: [[0, 0], [1, -1], [6, -2]],               end: "arrow" },
  cross:   { label: "Cross",   pts: [[0, 0], [0, -4], [-13, -7]],             end: "arrow" },
  wheel:   { label: "Wheel",   pts: [[0, 0], [5, -1], [7, -5], [7, -15]],     end: "arrow" },
  block:   { label: "Block",   pts: [[0, 0], [0, -2.8]],                      end: "bar" },
  custom:  { label: "Custom",  pts: null,                                     end: "arrow" },
  handoff: { label: "Handoff", pts: [[0, 0], [-3, 1.4], [-3.4, -1], [-2, -5]], end: "arrow", run: true },
  dive:    { label: "Dive",    pts: null, end: "arrow", run: true },
  stretch: { label: "Stretch", pts: null, end: "arrow", run: true },
  counter: { label: "Counter", pts: null, end: "arrow", run: true },
  reverse: { label: "Reverse", pts: null, end: "arrow", run: true },
  delay:   { label: "Delay",   pts: null, end: "arrow", run: true, dash: "7 6" },
};

/**
 * Run-route legs after the player's own spot, relative to the mesh point beside the
 * quarterback (qx, qy). `side` is +1 when the runner lines up to the QB's right.
 * Every leg ends 5 yards past the line of scrimmage.
 */
export function runLegs(type: RouteType, qx: number, qy: number, side: number): Pair[] {
  switch (type) {
    case "stretch": return [[qx + side * 1, qy - 0.2], [qx + side * 8, qy - 2.5], [qx + side * 11, -5]];
    case "counter": return [[qx - side * 1.6, qy + 0.2], [qx + side * 3.5, qy - 2.5], [qx + side * 4.5, -5]];
    case "reverse": return [[qx + side * 0.4, qy + 1], [qx - side * 9, qy - 0.5], [qx - side * 12, -5]];
    default:        return [[qx + side * 1, qy - 0.3], [qx + side * 1.6, -5]];
  }
}

export const DROUTES: Record<DefenseRouteType, RouteDef> = {
  man:      { label: "Man",       pts: null,                 end: "arrow", dash: "10 8" },
  zoneDeep: { label: "Zone deep", pts: [[0, 0], [0, -8.5]],  end: "zone",  dash: "14 8" },
  zoneFlat: { label: "Zone flat", pts: [[0, 0], [3.6, -4.5]], end: "zone", dash: "14 8" },
  curlFlat: { label: "Curl-flat", pts: [[0, 0], [2.6, -5]],  end: "zone",  dash: "14 8" },
  midRead:  { label: "Mid-read",  pts: [[0, 0], [0, -6]],    end: "zone",  dash: "14 8" },
  blitz:    { label: "Blitz",     pts: [[0, 0], [0, 4.5]],   end: "arrow", free: true },
  spy:      { label: "Spy",       pts: [[0, 0], [0, 2.6]],   end: "zone",  dash: "7 6" },
  custom:   { label: "Custom",    pts: null,                 end: "arrow" },
};

export const OFFENSE_KEYS = Object.keys(ROUTES) as OffenseRouteType[];
export const RUN_KEYS = OFFENSE_KEYS.filter((k) => ROUTES[k].run);
export const PASS_KEYS = OFFENSE_KEYS.filter((k) => !ROUTES[k].run);

/** True for a route that carries the ball on the ground. */
export function isRun(type: RouteType): boolean {
  return ROUTES[type as OffenseRouteType]?.run === true;
}
export const DEFENSE_KEYS = Object.keys(DROUTES) as DefenseRouteType[];

export function tableFor(team: Team): Record<string, RouteDef> {
  return team === "offense" ? ROUTES : DROUTES;
}

export function routeDef(team: Team, type: RouteType): RouteDef | null {
  return tableFor(team)[type] ?? null;
}

export function defaults(): Player[] {
  return [
    { id: "o1", team: "offense", label: "C",  x: 15, y: 1,   route: null },
    { id: "o2", team: "offense", label: "QB", x: 15, y: 5,   route: null },
    { id: "o3", team: "offense", label: "X",  x: 3,  y: 1,   route: null },
    { id: "o4", team: "offense", label: "Y",  x: 27, y: 1,   route: null },
    { id: "o5", team: "offense", label: "Z",  x: 19, y: 5,   route: null },
    { id: "d1", team: "defense", label: "",   x: 3,  y: -5,  route: null },
    { id: "d2", team: "defense", label: "",   x: 11, y: -4,  route: null },
    { id: "d3", team: "defense", label: "",   x: 18, y: -4,  route: null },
    { id: "d4", team: "defense", label: "",   x: 27, y: -5,  route: null },
    { id: "d5", team: "defense", label: "",   x: 15, y: -11, route: null },
  ];
}

const DEF_INK: Partial<Record<RouteType, string>> = {
  zoneDeep: INK.deep, zoneFlat: INK.flat, curlFlat: INK.curl,
  midRead: INK.mid, spy: INK.mid, blitz: INK.blitz, man: INK.man,
};

export function inkFor(p: Player, type: RouteType): string {
  if (p.team === "offense") return p.route?.primary ? INK.primary : INK.route;
  return DEF_INK[type] ?? DEF;
}

/**
 * Only routes whose geometry is actually handed can be flipped: zone bubbles are
 * laid out by slice/side, and man/blitz track a target.
 */
export function mirrorable(p: Player | null): boolean {
  if (!p?.route) return false;
  const t = p.route.type;
  if (t === "custom") return (p.route.pts ?? []).length > 0;
  const def = routeDef(p.team, t);
  if (def?.run) return true;
  if (!def?.pts || def.end === "zone") return false;
  return def.pts.some((q) => Math.abs(q[0]) > 0.01);
}

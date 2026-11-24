import { LOS_GAP, clampPoint, clampX, sideY } from "./bounds";
import { DEEP_NAME, deepSplit } from "./deep";
import type { DefenseRouteType, Hop, OffenseRouteType, Pair, Player, Route, RouteDef, RouteType, Team } from "./types";

// the journeys in e2e/journeys still import these from here
export { LOS_GAP, X_MIN } from "./bounds";

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
  route: "#4a3728",
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
  drag:    { label: "Drag",    pts: [[0, 0], [0, -2], [-12, -3]],             end: "arrow" },
  wheel:   { label: "Wheel",   pts: [[0, 0], [5, -1], [7, -5], [7, -15]],     end: "arrow" },
  custom:  { label: "Custom",  pts: null,                                     end: "arrow" },
  handoff: { label: "Handoff", pts: null, end: "arrow", run: true },
  dive:    { label: "Dive",    pts: null, end: "arrow", run: true },
  stretch: { label: "Stretch", pts: null, end: "arrow", run: true },
  counter: { label: "Counter", pts: null, end: "arrow", run: true },
  reverse: { label: "Reverse", pts: null, end: "arrow", run: true },
  delay:   { label: "Delay",   pts: null, end: "arrow", run: true, dash: "7 6" },
  jet:     { label: "Jet sweep", pts: null, end: "arrow", run: true },
  throw:   { label: "Throw",   pts: null, end: "set",   ball: "throw" },
  rollout: { label: "Rollout", pts: null, end: "set",   ball: "throw", qb: true },
  boot:    { label: "Boot",    pts: null, end: "set",   ball: "throw", qb: true },
};

/** Yards per second a player covers during playback — brisk, but slow enough to read. */
export const SPEED = 6.5;
/** How long a delay runner waits at the snap before going. */
export const DELAY = 0.8;

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
    // the plain handoff bends off the quarterback's hip and out, so it reads apart from the dive
    case "handoff": return [[qx + side * 1, qy - 0.2], [qx + side * 3.6, qy - 2.4], [qx + side * 5, -5]];
    default:        return [[qx + side * 1, qy - 0.3], [qx + side * 1.6, -5]];
  }
}

/** How far in front of (or behind) the quarterback the jet-sweep runner crosses, in yards. */
// eslint-disable-next-line no-restricted-syntax -- a lane offset from the quarterback, not a field bound
export const JET_GAP = 1.2;

/**
 * The lane a jet sweep crosses on (docs/adr/006-jet-sweep.md, rule 3): in front of a shotgun
 * quarterback, or behind one under centre when the lane in front would sit on the line. Either way
 * it is at least half a yard behind the closest anyone may stand to the line (J5).
 */
export function jetLane(qy: number): number {
  const ahead = qy - JET_GAP;
  return ahead >= LOS_GAP + 0.5 ? ahead : qy + JET_GAP;
}

/**
 * The jet sweep's legs after the runner's own spot (x = px): into the lane on the near side of the
 * quarterback (qx, qy), or at their own x when they already stand within 3 yards (J6), across the lane
 * past the quarterback, who hands it off as they go by, on toward the far sideline and up past the line
 * 5 yards, like every run. `across` is +1 when the sweep goes to the quarterback's right.
 */
export function jetLegs(px: number, qx: number, qy: number, across: number): Pair[] {
  const ly = jetLane(qy);
  const entry = across > 0 ? Math.max(px, qx - 3) : Math.min(px, qx + 3);
  return [[entry, ly], [qx + across * 1, ly], [qx + across * 8, ly - 1.5], [qx + across * 11, -5]];
}

/**
 * The quarterback's rollout and boot are measured from their depth or this deep, whichever is deeper, so a
 * quarterback under centre drops before rolling (docs/adr/011-qb-rollout-and-boot.md, Q10).
 */
export const ROLL_DEPTH = 4;
/** How far across the field a rollout or boot takes the quarterback to the launch point, in yards. */
export const ROLL_ACROSS = 8;

/** A point of the quarterback's path, held on the field and behind the line (rule 6, Q8, Q9). */
const qbPoint = (x: number, y: number): Pair => [clampX(x), sideY("offense", y)];
/** The launch point: as a path's point, and at least PITCH_SET behind the line, so the throw is always legal. */
const launchPoint = (x: number, y: number): Pair => qbPoint(x, Math.max(PITCH_SET, y));

/**
 * The rollout's legs after the quarterback's spot (qx, qy): open and gain depth, run flat across, and turn
 * up to the launch point 8 yards over. `side` is +1 for a rollout to the right.
 */
export function rolloutLegs(qx: number, qy: number, side: number): Pair[] {
  const base = Math.max(qy, ROLL_DEPTH);
  // eslint-disable-next-line no-restricted-syntax -- the rollout's depth gain, like the boot's, not a field bound
  return [qbPoint(qx + side * 2, base + 1.2), qbPoint(qx + side * 5.5, base + 1.2), launchPoint(qx + side * ROLL_ACROSS, base - 0.8)];
}

/**
 * The boot's legs after the quarterback's spot, where they fake: pivot back on the fake's side, bend behind
 * the spot to the other, run out, and turn up to the launch point 8 yards over. `side` is the way the boot
 * goes, +1 to the right, so the fake is on the other side.
 */
export function bootLegs(qx: number, qy: number, side: number): Pair[] {
  const base = Math.max(qy, ROLL_DEPTH);
  return [
    qbPoint(qx - side * 1, base + 1.6), qbPoint(qx + side * 3, base + 2), qbPoint(qx + side * 6, base + 1.4),
    launchPoint(qx + side * ROLL_ACROSS, base - 0.8),
  ];
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
/** The runs: the keeps a ball carrier can take too. */
export const RUN_KEYS = OFFENSE_KEYS.filter((k) => ROUTES[k].run);
/** The passing tree. A carrier after the quarterback gets none of it. */
export const PASS_KEYS = OFFENSE_KEYS.filter((k) => !ROUTES[k].run && !ROUTES[k].ball);
/** The quarterback's own actions at the snap: the rollout and the boot (docs/adr/011-qb-rollout-and-boot.md). */
export const QB_KEYS = OFFENSE_KEYS.filter((k) => ROUTES[k].qb);

/** How far behind the line of scrimmage a carrier sets up to throw (it was the pitch runner's set point). */
export const PITCH_SET = 2.6;

/** True for a job that sets up and throws: the last carrier's throw, or the quarterback's rollout or boot. */
export function isBallJob(type: RouteType): boolean {
  return ROUTES[type as OffenseRouteType]?.ball !== undefined;
}

/** True for the quarterback's own action at the snap: a rollout or a boot. */
export function isQbAction(type: RouteType): boolean {
  return ROUTES[type as OffenseRouteType]?.qb === true;
}

/** True for a route that carries the ball on the ground. */
export function isRun(type: RouteType): boolean {
  return ROUTES[type as OffenseRouteType]?.run === true;
}
export const DEFENSE_KEYS = Object.keys(DROUTES) as DefenseRouteType[];

/** A blitzer must line up at least this many yards off the line of scrimmage. */
export const BLITZ_DEPTH = 7;

/** The closest a player may sit to the line of scrimmage, in yards, given their route. */
export function losGap(route: Route | null | undefined): number {
  return route?.type === "blitz" ? BLITZ_DEPTH : LOS_GAP;
}

/** The player's spot, pushed back to the blitz line when a blitz would start too close to it. */
export function legalSpot(p: Player): Player {
  if (p.team !== "defense" || p.route?.type !== "blitz" || p.y <= -BLITZ_DEPTH) return p;
  return { ...p, y: -BLITZ_DEPTH };
}

export function tableFor(team: Team): Record<string, RouteDef> {
  return team === "offense" ? ROUTES : DROUTES;
}

export function routeDef(team: Team, type: RouteType): RouteDef | null {
  return tableFor(team)[type] ?? null;
}

/** A route's name as pictures and words give it: its tile's label, or a deep zone's half or third. */
export function routeName(team: Team, route: Route): string | null {
  const split = deepSplit(route);
  return split ? DEEP_NAME[split] : routeDef(team, route.type)?.label ?? null;
}

/**
 * A fresh play's players. Both sides come tagged, each tag once per side, so every player can
 * be named on slides and given a wristband insert of their own: the offense's centre, quarterback
 * and receivers, and on defense the left and right corners, a linebacker, the rusher and the safety.
 */
export function defaults(): Player[] {
  return [
    { id: "o1", team: "offense", label: "C",  x: 15, y: 1,   route: null },
    { id: "o2", team: "offense", label: "QB", x: 15, y: 5,   route: null },
    { id: "o3", team: "offense", label: "X",  x: 3,  y: 1,   route: null },
    { id: "o4", team: "offense", label: "Y",  x: 27, y: 1,   route: null },
    { id: "o5", team: "offense", label: "Z",  x: 19, y: 5,   route: null },
    { id: "d1", team: "defense", label: "LC", x: 3,  y: -5,  route: null },
    { id: "d2", team: "defense", label: "LB", x: 11, y: -4,  route: null },
    { id: "d3", team: "defense", label: "R",  x: 18, y: -4,  route: null },
    { id: "d4", team: "defense", label: "RC", x: 27, y: -5,  route: null },
    { id: "d5", team: "defense", label: "S",  x: 15, y: -11, route: null },
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

/** Waypoints a custom route may carry: more than a coach could tap out in one drawing. */
export const MAX_ROUTE_POINTS = 60;

/** A finite waypoint pulled back onto the field; anything else (a string, 1e400, a lone number) is dropped. */
export function toPair(v: unknown): Pair | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x: unknown = v[0], y: unknown = v[1];
  if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  return clampPoint([x, y]);
}

type Reader<V> = (stored: Readonly<Record<string, unknown>>) => V | undefined;
/**
 * How one stored field reads, fixed by its type. A flag is stored only when it is on. A point, or a
 * list of points, is a spot on the field: clamped onto it as it reads, and turned with the field
 * when a route is mirrored or the play flipped. Any other field names its own reader, which gives
 * undefined when the field is not stored.
 */
export type FieldRule<V> =
  [V] extends [boolean] ? "flag" : [V] extends [Pair] ? "point" : [V] extends [readonly Pair[]] ? "points" : Reader<V>;
/**
 * A rule for every field of T. Storage, share links, mirror and flip all walk one of these, so a
 * field added to the record does not compile until its table says how it reads.
 */
export type Fields<T> = { [K in keyof T]-?: FieldRule<NonNullable<T[K]>> };

export const ROUTE_FIELDS: Fields<Omit<Route, "type">> = {
  pts: "points",
  target: (v) => (typeof v.target === "string" ? v.target.slice(0, 40) : undefined),
  // a blitz aimed at a player keeps only the player
  aim: (v) => (typeof v.target !== "string" && (v.aim === "backfield" || v.aim === "contain") ? v.aim : undefined),
  // on any other route, or as anything else, nothing (D1)
  split: (v) => (v.type === "zoneDeep" && (v.split === "half" || v.split === "third") ? v.split : undefined),
  mirror: "flag",
  primary: "flag",
};

export const HOP_FIELDS: Fields<Omit<Hop, "to">> = { catch: "point", release: "point" };

type Table = Readonly<Record<string, "flag" | "point" | "points" | Reader<unknown>>>;

/** The fields a table keeps from a stored record, in the table's order, each only when it is stored. */
export function readFields<T>(table: Fields<T>, stored: object): Partial<T> {
  const v = stored as Readonly<Record<string, unknown>>;
  const out: Partial<Record<keyof T, unknown>> = {};
  for (const [key, rule] of Object.entries(table as Table)) {
    const raw = v[key];
    const x = rule === "flag" ? (raw === true ? true : undefined)
      : rule === "point" ? toPair(raw) ?? undefined
      : rule === "points" ? (Array.isArray(raw) ? raw.slice(0, MAX_ROUTE_POINTS).map(toPair).filter((q): q is Pair => q !== null) : undefined)
      : rule(v);
    if (x !== undefined) out[key as keyof T] = x;
  }
  return out as Partial<T>;
}

/** A route's stored fields, for a type already known to be one. */
export function readRoute<T extends string>(stored: object, type: T): Omit<Route, "type"> & { type: T } {
  return { type, ...readFields(ROUTE_FIELDS, stored) };
}

/**
 * The route as storage reads it back. Storage reads `mirror: false` and `primary: false` as nothing,
 * so a play stored with either would not read back byte for byte, and the strict reader behind
 * Create link and the file import called it repaired (#113): a preset mirrored back, or a read
 * unmarked, could not be shared until the route was toggled off and on.
 */
export const asStored = (route: Route): Route => readRoute(route, route.type);

/**
 * The record mirrored left/right about x: every point its table names turned, and every other field
 * kept. A point that would land off the field is pulled back to its edge, and `clamped` says whether
 * any was.
 */
export function reflect<T extends object>(table: Table, rec: T, x: number): { value: T; clamped: boolean } {
  let clamped = false;
  const turn = (q: Pair): Pair => {
    const raw: Pair = [2 * x - q[0], q[1]];
    const c = clampPoint(raw);
    if (c[0] !== raw[0]) clamped = true;
    return c;
  };
  const value = { ...rec } as Record<string, unknown>;
  for (const [key, rule] of Object.entries(table)) {
    const q = value[key];
    if (rule === "point" && q) value[key] = turn(q as Pair);
    if (rule === "points" && q) value[key] = (q as readonly Pair[]).map(turn);
  }
  return { value: value as T, clamped };
}

/**
 * The route mirrored left/right about x, keeping everything but its geometry: the primary read, a
 * man target, the mirror flag. Custom waypoints that would land off the field are pulled back to
 * its edge, and `clamped` says whether any were.
 */
export function mirrorRoute(route: Route, x: number): { route: Route; clamped: boolean } {
  if (route.type !== "custom") return { route: asStored({ ...route, mirror: !route.mirror }), clamped: false };
  const { value, clamped } = reflect(ROUTE_FIELDS, route, x);
  return { route: value, clamped };
}

/**
 * A route replacing another on the same player keeps that player's primary read: changing what X
 * runs never changes who the quarterback looks to first (#109). Only taking the route away takes
 * the read with it.
 */
export function keepRead(prev: Route | null | undefined, next: Route): Route {
  return prev?.primary ? { ...next, primary: true } : next;
}

/**
 * The route as it reads after the whole play is flipped (x → 30 - x), keeping every
 * flag. Handed presets need nothing: their side is read from the player's new spot. A rollout's side
 * is never read off the spot (a quarterback at x = 15 would never flip), so it turns its mirror (Q11).
 */
export function flipRoute(route: Route): Route {
  if (route.type === "rollout") return asStored({ ...route, mirror: !route.mirror });
  return reflect(ROUTE_FIELDS, route, FIELD_W / 2).value;
}

export const flipHop = (hop: Hop): Hop => reflect(HOP_FIELDS, hop, FIELD_W / 2).value;
const FIELD_W = 30;

/**
 * Only routes whose geometry is actually handed can be flipped: zone bubbles are
 * laid out by slice/side, and man/blitz track a target.
 */
export function mirrorable(p: Player | null): boolean {
  if (!p?.route) return false;
  const t = p.route.type;
  if (t === "custom") return (p.route.pts ?? []).length > 0;
  // a rollout goes right unless mirrored; a boot follows its fake, so turning the fake turns it (ADR 011)
  if (t === "rollout") return p.team === "offense";
  if (t === "boot") return false;
  const def = routeDef(p.team, t);
  // a jet sweep always crosses toward the far side; to sweep the other way, line the runner up on the other side
  if (def?.run) return t !== "jet";
  if (!def?.pts || def.end === "zone") return false;
  return def.pts.some((q) => Math.abs(q[0]) > 0.01);
}

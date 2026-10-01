export type Team = "offense" | "defense";
export type Vis = "both" | Team;
export type SnapMode = "half" | "one" | "free";

export interface Pt {
  x: number;
  y: number;
}
/** A yard offset or absolute yard point as [x, y]. */
export type Pair = readonly [number, number];
/** A player's id, as another player's route names them. */
export type PlayerId = string;

export type OffenseRouteType =
  | "go" | "out" | "in" | "slant" | "corner" | "post" | "curl" | "flat"
  | "cross" | "wheel" | "custom"
  | "handoff" | "dive" | "stretch" | "counter" | "reverse" | "delay"
  /** the last ball carrier of a lateral chain sets up and throws it forward */
  | "throw";
export type DefenseRouteType =
  | "man" | "zoneDeep" | "zoneFlat" | "curlFlat" | "midRead" | "blitz" | "spy" | "custom";
export type RouteType = OffenseRouteType | DefenseRouteType;

export interface Route {
  type: RouteType;
  /** custom routes: absolute yard waypoints after the player's spot */
  pts?: Pair[];
  /** man coverage: id of the offensive player being covered */
  target?: PlayerId;
  mirror?: boolean;
  primary?: boolean;
}

/** A carrier sets up at the pitch set depth and throws forward to the read. */
export interface ThrowRoute extends Route {
  type: "throw";
}

export const isThrow = (r: Route | null | undefined): r is ThrowRoute => r?.type === "throw";

/**
 * One lateral in the quarterback's chain: who takes it, and where they catch it (absolute yards),
 * level with or behind where it is let go and behind the line of scrimmage (see lib/play/lateral.ts).
 * With no catch stored, one is worked out from where the target is.
 */
export interface Hop {
  to: PlayerId;
  catch?: Pair;
}

export interface Player {
  id: string;
  team: Team;
  label: string;
  x: number;
  y: number;
  route: Route | null;
  /** Absolute yard waypoints before the snap; independent of the post-snap route. */
  preSnap?: { pts: Pair[] };
  /**
   * The quarterback only: the ball's laterals after the snap, in order. Anyone may take it, again and
   * again, but never from themself; the last to take it does their own route's job with it.
   */
  laterals?: Hop[];
}

/** How a route ends: an arrowhead, a zone bubble, or a ring where a carrier sets up to throw. */
export type RouteEnd = "arrow" | "zone" | "set";

export interface RouteDef {
  label: string;
  /** relative yard offsets from the player, or null when geometry is handed/targeted */
  pts: Pair[] | null;
  end: RouteEnd;
  dash?: string;
  free?: boolean;
  /** the ball carrier's path on a run: laid out through the mesh point beside the QB */
  run?: boolean;
  /** a job only the player holding the ball can take: set up and throw */
  ball?: "throw";
}

/** Measured size of the centre pane, minus its padding. */
export interface Pane {
  pw: number;
  ph: number;
}

export interface Draft {
  id: string;
  pts: Pair[];
  kind?: "motion";
}

/** A play in the on-device library. Keyed by a generated id, so it can be renamed freely. */
export interface SavedPlay {
  id: string;
  name: string;
  players: Player[];
  /** the coach's notes, shown on detailed exports */
  notes: string;
  /** which side of the ball this play is drawn for: an offensive play or a defensive call */
  side: Team;
  /**
   * The other team is drawn, faded, on this play's pictures: thumbnails, the share snapshot and
   * every printout. Stored only when true, so a play from before the choice reads and writes the same.
   */
  artShadow?: true;
  /**
   * The yard line the ball is on for this play, counted from the offense's own goal line:
   * 20 is midfield, 30 their 10 and 35 their 5 (see lib/play/field.ts). Stored only when it
   * is not the own goal line, where every drive starts; any other yard line reads as the
   * nearest of those spots.
   */
  los?: number;
}

/** A named, ordered list of plays. Numbers on exports are positions in this list. */
export interface Playbook {
  id: string;
  name: string;
  plays: string[];
}

export interface TeamSettings {
  name: string;
  /** an accent colour for exports, as #rrggbb */
  color: string;
  /**
   * false for a league that plays without no-run zones: the field and every export leave
   * the hatched bands off. Stored only when false, so a team from before the choice reads the same.
   */
  noRunZones?: boolean;
}

/** How much an export shows: simple is diagram only, detailed adds names, the read and notes. */
export type Level = "simple" | "detailed";

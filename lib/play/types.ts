export type Team = "offense" | "defense";
export type Vis = "both" | Team;
export type SnapMode = "half" | "one" | "free";

export interface Pt {
  x: number;
  y: number;
}
/** A yard offset or absolute yard point as [x, y]. */
export type Pair = readonly [number, number];

export type OffenseRouteType =
  | "go" | "out" | "in" | "slant" | "corner" | "post" | "curl" | "flat"
  | "cross" | "wheel" | "custom"
  | "handoff" | "dive" | "stretch" | "counter" | "reverse" | "delay";
export type DefenseRouteType =
  | "man" | "zoneDeep" | "zoneFlat" | "curlFlat" | "midRead" | "blitz" | "spy" | "custom";
export type RouteType = OffenseRouteType | DefenseRouteType;

export interface Route {
  type: RouteType;
  /** custom routes: absolute yard waypoints after the player's spot */
  pts?: Pair[];
  /** man coverage: id of the offensive player being covered */
  target?: string;
  mirror?: boolean;
  primary?: boolean;
}

export interface Player {
  id: string;
  team: Team;
  label: string;
  x: number;
  y: number;
  route: Route | null;
}

export type RouteEnd = "arrow" | "zone";

export interface RouteDef {
  label: string;
  /** relative yard offsets from the player, or null when geometry is handed/targeted */
  pts: Pair[] | null;
  end: RouteEnd;
  dash?: string;
  free?: boolean;
  /** the ball carrier's path on a run: laid out through the mesh point beside the QB */
  run?: boolean;
}

/** Measured size of the centre pane, minus its padding. */
export interface Pane {
  pw: number;
  ph: number;
}

export interface Draft {
  id: string;
  pts: Pair[];
}

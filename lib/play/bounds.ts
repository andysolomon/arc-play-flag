import type { Pair, Team } from "./types";

/**
 * Where a point may sit on the field, in yards: x across the 30-yard width, y from the line of
 * scrimmage (0), positive into the backfield. Every bound lives here; lint rejects a retyped one.
 */

/** How far inside a card edge, either sideline or the card's top, a player stands. */
export const EDGE_MARGIN = 1.2;
/** The sidelines a player or waypoint keeps inside: EDGE_MARGIN in from either edge. */
export const X_MIN = EDGE_MARGIN, X_MAX = 28.8;
/**
 * The deepest a waypoint or defender may stand. The deepest card is Deep field's from the drive
 * start, to the end line 50 yards on, and a player keeps EDGE_MARGIN under its top, so 48.8 yards on.
 */
export const Y_MIN = -48.8;
/** The back of the backfield. */
export const Y_MAX = 7.4;
/** The closest anyone may sit to the line of scrimmage, and the shallowest a lateral may be caught. */
export const LOS_GAP = 0.9;

export const clampX = (x: number): number => Math.max(X_MIN, Math.min(X_MAX, x));

/** A depth on the player's own side: the backfield for the offense, past LOS_GAP to Y_MIN for the defense. */
export const sideY = (team: Team, y: number): number =>
  team === "offense" ? Math.max(LOS_GAP, Math.min(Y_MAX, y)) : Math.min(-LOS_GAP, Math.max(Y_MIN, y));

/** Where a custom waypoint may sit: inside the sidelines, from Y_MIN to the back of the backfield. */
export const clampPoint = (q: Pair): Pair => [clampX(q[0]), Math.max(Y_MIN, Math.min(Y_MAX, q[1]))];

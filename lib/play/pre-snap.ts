import { MAX_ROUTE_POINTS, X_MAX, X_MIN } from "./routes";
import type { Pair, Player } from "./types";

/** Motion stays in the backfield, inside the same bounds as offensive tokens. */
export const motionPoint = (p: Pair): Pair => [
  Math.max(X_MIN, Math.min(X_MAX, p[0])),
  Math.max(0.9, Math.min(7.4, p[1])),
];

export function motionPoints(p: Player): Pair[] {
  return p.team === "offense" ? (p.preSnap?.pts ?? []).slice(0, MAX_ROUTE_POINTS).map(motionPoint) : [];
}

/** The player's spot from which the post-snap assignment begins. */
export function atSnap(p: Player): Player {
  const end = motionPoints(p).at(-1);
  return end ? { ...p, x: end[0], y: end[1], preSnap: undefined } : p;
}

export function withoutMotion(p: Player): Player {
  const out = { ...p };
  delete out.preSnap;
  return out;
}

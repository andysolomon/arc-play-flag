import { quarterback } from "./lateral";
import { atSnap } from "./pre-snap";
import type { Player, Route } from "./types";

/**
 * Who a blitz comes for. Every blitz used to drive at the quarterback, and that is still what a blitz
 * does unless the coach says otherwise. Aimed at the backfield, it comes for the nearest back lined up
 * near the ball instead (a running back beside or behind the quarterback), and for the quarterback when
 * nobody is back there. Aimed at a player, it comes for that player wherever they line up. A blitz stores
 * nothing for the quarterback, `aim: "backfield"` for the backfield and `target` for a player, so a play
 * from before the choice reads and writes the same.
 *
 * Ways it could go wrong, written down before the code:
 * - B1 no quarterback on the field: the blitz drives at the default quarterback slot (15, 5), as it always has.
 * - B2 aimed at a player who is gone (deleted, or never on the offense): the quarterback, never nothing.
 *   Storage drops the target, so the play reads as a quarterback blitz.
 * - B3 aimed at the backfield with nobody lined up back there: the quarterback.
 * - B4 a back in pre-snap motion: where they stand at the snap, like every other target.
 * - B5 two backs near the ball: the nearer; a tie goes left to right, then by id, so it never depends on storage order.
 * - B6 the quarterback and the centre are never backs: the quarterback is who a blitz falls back to,
 *   and the centre is on the ball.
 * - B7 a receiver on the line (shallower than BACKFIELD_DEPTH) is never a back, however near the ball.
 * - B8 a coach who picks the quarterback by hand gets the default, stored as nothing, so the play
 *   reads back byte for byte and the palette says "QB".
 * - B9 a back who is also the only one near the ball but stands too far out (past BACKFIELD_REACH):
 *   not a back for this purpose, so the quarterback.
 */

/** How a blitz is aimed: at the quarterback (the default), at the backfield, or at one player. */
export type BlitzAim = "qb" | "backfield" | "player";

/** How far behind the line of scrimmage a player must line up to be in the backfield (the line itself sits at 1 yard). */
export const BACKFIELD_DEPTH = 2;
/** How far from the ball (the quarterback or the centre, whichever is nearer) a back may line up and still be blitzed as one, in yards. */
export const BACKFIELD_REACH = 8;

/** The centre: the offensive player labelled C, else the default centre slot. */
export function centre(players: readonly Player[]): Player | undefined {
  return players.find((q) => q.team === "offense" && q.label === "C") ?? players.find((q) => q.id === "o1");
}

/** How a blitz route is aimed. Anything but a blitz, or a blitz with nothing stored, reads as the quarterback. */
export function blitzAim(route: Route | null | undefined): BlitzAim {
  if (route?.type !== "blitz") return "qb";
  if (route.target) return "player";
  return route.aim === "backfield" ? "backfield" : "qb";
}

const dist = (a: Player, b: Player): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The backs: offensive players other than the quarterback and the centre (B6), lined up at least
 * BACKFIELD_DEPTH behind the line (B7) and within BACKFIELD_REACH of the ball (B9), where they stand at
 * the snap (B4), nearest the ball first (B5).
 */
export function backs(players: readonly Player[]): Player[] {
  const qb = quarterback(players);
  const c = centre(players);
  const ball = [qb, c].filter((p): p is Player => p !== undefined).map(atSnap);
  if (!ball.length) return [];
  const near = (p: Player): number => Math.min(...ball.map((b) => dist(p, b)));
  return players
    .filter((p) => p.team === "offense" && p.id !== qb?.id && p.id !== c?.id)
    .map(atSnap)
    .filter((p) => p.y >= BACKFIELD_DEPTH && near(p) <= BACKFIELD_REACH)
    .sort((a, b) => near(a) - near(b) || a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The back a backfield blitz comes for, where they stand at the snap, or undefined when nobody is lined up back there (B3). */
export function nearestBack(players: readonly Player[]): Player | undefined {
  return backs(players)[0];
}

/**
 * Who this blitz comes for, where they stand at the snap: the player it is aimed at, the nearest back,
 * or the quarterback. Undefined only with no quarterback on the field (B1); the caller draws at the
 * default slot then.
 */
export function blitzTarget(route: Route, players: readonly Player[]): Player | undefined {
  const aim = blitzAim(route);
  if (aim === "player") {
    const t = players.find((q) => q.id === route.target && q.team === "offense");
    if (t) return atSnap(t);
  } else if (aim === "backfield") {
    const back = nearestBack(players);
    if (back) return back;
  }
  const qb = quarterback(players);
  return qb ? atSnap(qb) : undefined;
}

/** A blitz aimed at the quarterback or the backfield: nothing stored for the quarterback (B8). */
export function aimedBlitz(aim: "qb" | "backfield"): Route {
  return aim === "backfield" ? { type: "blitz", aim: "backfield" } : { type: "blitz" };
}

/** A blitz aimed at one player; at the quarterback it is the default (B8). */
export function blitzAt(target: Player, players: readonly Player[]): Route {
  return target.id === quarterback(players)?.id ? { type: "blitz" } : { type: "blitz", target: target.id };
}

import { quarterback } from "./lateral";
import { atSnap } from "./pre-snap";
import { X_MAX, X_MIN } from "./routes";
import type { Pair, Player, Route } from "./types";

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
 *
 * A contain blitz (`aim: "contain"`) comes for the quarterback from outside: up the edge on the
 * rusher's side of them to a landmark CONTAIN_WIDTH outside and CONTAIN_LEAD in front of them, then in
 * on them, so they can't escape outside that way. Ways it could go wrong, written down before the code:
 * - C1 no quarterback on the field: it contains the default quarterback slot (15, 5), like B1.
 * - C2 which edge: the rusher's own side of the quarterback, where the quarterback stands at the snap
 *   (B4). A rusher lined up right over the quarterback takes the side with more room to the sideline,
 *   and the left when the quarterback is dead centre, so the edge never flickers or depends on storage.
 *   The palette names the edge and says how to switch it, only when the other edge has room (C4).
 * - C3 the landmark off the field: pulled inside the sideline, where a player may stand.
 * - C4 a quarterback against the sideline leaves no edge to get outside: when the turn in would be
 *   shorter than CONTAIN_TURN, it comes straight for the quarterback, the sideline doing the containing,
 *   and says so. Never a leg with no length, whose arrowhead would point nowhere.
 * - C5 the landmark level with or behind the quarterback gives up the outside (they step up and out
 *   past the rusher), and one in front of the line of scrimmage is no rush at all: CONTAIN_LEAD in front
 *   of them, or CONTAIN_LINE behind the line when they are under centre, closer to it than that allows.
 * - C6 a back lined up level with the quarterback, as Z is in a fresh play, sits where a landmark level
 *   with the quarterback would be: the landmark in front keeps the turn clear of their token, under
 *   centre too, until the quarterback stands within a few steps of the line (under 1.75 yards off it).
 * - C7 stored like the backfield's aim: `aim: "contain"`, cleared by QB, replaced by a player's target,
 *   and a target stored beside it wins. An older build reads it as a quarterback blitz in a saved play
 *   or a share link; its strict readers (a device backup, a play file) refuse a field value they don't
 *   know, as they did the backfield's aim.
 * - C8 the edge follows the rusher: moved across the quarterback, or the whole play flipped, they
 *   contain the other edge. A rusher right over a quarterback at dead centre stands where a flip leaves
 *   them, so they keep the left edge (C2). A blitz offers no mirror; lining up on the other side is how
 *   to switch.
 * - C9 still a blitz: the rusher keeps BLITZ_DEPTH off the line, and the palette, history, storage
 *   and share links treat it like any other aim.
 * - C10 two rushers containing one edge share its landmark and turn: their rushes up the edge are
 *   their own, and the picture shows them meet and turn in together, which is what the call asks.
 */

/** How a blitz is aimed: at the quarterback (the default), at the backfield, containing the quarterback from the edge, or at one player. */
export type BlitzAim = "qb" | "backfield" | "contain" | "player";

/** How far behind the line of scrimmage a player must line up to be in the backfield (the line itself sits at 1 yard). */
export const BACKFIELD_DEPTH = 2;
/** How far from the ball (the quarterback or the centre, whichever is nearer) a back may line up and still be blitzed as one, in yards. */
export const BACKFIELD_REACH = 8;
/** How far short of whoever it comes for a blitz arrow stops, in yards. */
export const BLITZ_STOP = 1.8;
/** How far outside the quarterback a contain blitz's landmark sits, in yards. */
export const CONTAIN_WIDTH = 4;
/** How far in front of the quarterback a contain blitz's landmark sits, in yards (C5). */
export const CONTAIN_LEAD = 2;
/** The shortest turn in a contain blitz draws, in yards; with less room outside the quarterback it comes straight (C4). */
export const CONTAIN_TURN = 1;
/** The closest a contain blitz's landmark comes to the line of scrimmage, in yards (C5). */
export const CONTAIN_LINE = 0.5;
/** Where the quarterback slot is when nobody is on it (B1, C1). */
const QB_SLOT = { x: 15, y: 5 } as const;

/** The centre: the offensive player labelled C, else the default centre slot. */
export function centre(players: readonly Player[]): Player | undefined {
  return players.find((q) => q.team === "offense" && q.label === "C") ?? players.find((q) => q.id === "o1");
}

/** How a blitz route is aimed. Anything but a blitz, or a blitz with nothing stored, reads as the quarterback. */
export function blitzAim(route: Route | null | undefined): BlitzAim {
  if (route?.type !== "blitz") return "qb";
  if (route.target) return "player";
  return route.aim === "backfield" || route.aim === "contain" ? route.aim : "qb";
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

/** The edge a contain blitz rushes: -1 the picture's left of the quarterback, +1 its right. */
export type Edge = -1 | 1;

/** A contain blitz's path after the rusher's spot: up the edge to the landmark, then in on the quarterback. */
export interface ContainPath {
  edge: Edge;
  /** where the rusher turns in, in absolute yards */
  landmark: Pair;
  /** where the arrow ends, BLITZ_STOP short of the quarterback */
  end: Pair;
}

/** The quarterback where they stand at the snap, or their slot with nobody on it (C1). */
function passer(players: readonly Player[]): { x: number; y: number } {
  const qb = quarterback(players);
  return qb ? atSnap(qb) : QB_SLOT;
}

/** The edge a rusher contains: their own side of the quarterback, or for one right over them the side with more room (C2). Only the spot is read, not the route. */
export function containEdge(rusher: Pick<Player, "x">, players: readonly Player[]): Edge {
  const qb = passer(players);
  return rusher.x < qb.x ? -1 : rusher.x > qb.x ? 1 : qb.x < QB_SLOT.x ? 1 : -1;
}

/** How that edge is contained (C1, C3, C5, C6), or null when the sideline leaves no edge outside the quarterback there (C4). */
export function edgePath(edge: Edge, players: readonly Player[]): ContainPath | null {
  const qb = passer(players);
  const lx = Math.max(X_MIN, Math.min(X_MAX, qb.x + edge * CONTAIN_WIDTH));
  const ly = qb.y - Math.max(0, Math.min(CONTAIN_LEAD, qb.y - CONTAIN_LINE));
  const dx = lx - qb.x, dy = ly - qb.y, L = Math.hypot(dx, dy);
  if (L - BLITZ_STOP < CONTAIN_TURN) return null;
  return { edge, landmark: [lx, ly], end: [qb.x + (dx / L) * BLITZ_STOP, qb.y + (dy / L) * BLITZ_STOP] };
}

/** How a rusher contains the quarterback, or null when the sideline leaves no edge on their side and the blitz comes straight for them instead (C4). */
export function containPath(rusher: Pick<Player, "x">, players: readonly Player[]): ContainPath | null {
  return edgePath(containEdge(rusher, players), players);
}

/** A blitz aimed at the quarterback, the backfield or containing the quarterback: nothing stored for the quarterback (B8). */
export function aimedBlitz(aim: "qb" | "backfield" | "contain"): Route {
  return aim === "qb" ? { type: "blitz" } : { type: "blitz", aim };
}

/** A blitz aimed at one player; at the quarterback it is the default (B8). */
export function blitzAt(target: Player, players: readonly Player[]): Route {
  return target.id === quarterback(players)?.id ? { type: "blitz" } : { type: "blitz", target: target.id };
}

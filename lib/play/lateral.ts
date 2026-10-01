import { atSnap } from "./pre-snap";
import { LOS_GAP, PITCH_SET, X_MAX, X_MIN, Y_MAX, isBallJob, isRun } from "./routes";
import type { Hop, Pair, Player, Route } from "./types";

/**
 * Lateral chains (docs/adr/005-unlimited-laterals.md). In flag football the ball can be tossed back
 * behind the line of scrimmage any number of times, to anyone, the same player again included, and
 * still be thrown forward after. The chain is stored once, in order, as the quarterback's `laterals`:
 * each hop names who takes it and, once the coach has moved it, where they catch it. The last player
 * to take it does their own route's job with it: a throw (`throw`) or a keep (a run route). Everything
 * else (who carries, where each toss is let go, where each job starts) is worked out here.
 *
 * A lateral is never forward and never past the line: its catch point is level with or behind the
 * spot it is let go from (the quarterback's spot for the first, the catch before it after that), and
 * behind the line of scrimmage. In yards +y is toward the offense's backfield, so that is
 * `catch.y >= max(LOS_GAP, release.y)`.
 *
 * Ways it could go wrong, written down before the code:
 * - C1 no quarterback on the field: there is no chain, not an error.
 * - C6 the quarterback is the player labelled QB, else the default QB slot, as everywhere else.
 * - R1 a lateral to the player who has it is no toss: the chain ends at them.
 * - R2 a lateral back to someone who carried it before (QB → Z → QB): a toss like any other.
 * - R3 a lateral to nobody on the field, or to a defender: the chain ends at the thrower, and every
 *   later hop with it, since each depends on the one before.
 * - R4 more laterals than storage keeps (MAX_LATERALS): cut at the cap.
 * - R5 a player who carries it more than once has one route: their job when the chain ends with them,
 *   and none otherwise, since every other time they have it they toss it on.
 * - R7 laterals stored on anyone but the quarterback: no chain, and settled away.
 * - R10 a target who carried it before is where they let it go from, not where they lined up.
 * - K1 a catch in front of its release: snapped level with the release.
 * - K2 a catch past the line of scrimmage: snapped back behind it.
 * - K3 a catch dragged off the field: pulled back inside the sidelines and the backfield.
 * - K4 a downstream catch clamped against the upstream catch as it was before that one moved:
 *   the chain is clamped in order, each against the one before it as clamped.
 * - K5 a release that moves up toward the line dragging a catch forward with it: a clamp only
 *   ever moves a catch back, never forward.
 * - K6 a lateral with no catch stored: one is worked out from where its target is.
 * - K7 pre-snap motion: the quarterback lets it go where they are at the snap.
 * - S1 the last carrier, after a lateral, with a pass route: they have the ball, so it goes.
 * - S2 a carrier marked as the primary read: the read is someone the final throw goes to.
 * - S3 a throw left on a player the chain doesn't reach: taken off.
 * - S4 settling a settled play hands back the very same array, so nothing reads as an edit.
 * - S5 a quarterback with no lateral keeps whatever route, and read, they had.
 */

/** As many laterals as a play keeps: a bound on what storage reads, far past any play. */
export const MAX_LATERALS = 60;

/** The quarterback: the offensive player labelled QB, else the default QB slot. */
export function quarterback(players: readonly Player[]): Player | undefined {
  return players.find((q) => q.team === "offense" && q.label === "QB") ?? players.find((q) => q.id === "o2");
}

/** One lateral in a chain: which hop it is, who lets it go and where, and who catches it and where (clamped). */
export interface Link {
  index: number;
  from: Player;
  to: Player;
  release: Pair;
  catch: Pair;
}

const spot = (p: Player): Pair => {
  const s = atSnap(p);
  return [s.x, s.y];
};

/** The quarterback's laterals as stored, before any are checked. */
const storedHops = (qb: Player | undefined): readonly Hop[] => (qb?.team === "offense" ? qb.laterals ?? [] : []);

/** The chain walked once: everyone who holds it in order, and every toss, each from the catch before it. */
function walk(players: readonly Player[]): { qb: Player | undefined; chain: Player[]; links: Link[] } {
  const qb = quarterback(players);
  if (!qb) return { qb, chain: [], links: [] };
  const chain = [qb];
  const links: Link[] = [];
  // where each player is when it comes to them: their last catch, else their spot (R10)
  const at = new Map<string, Pair>();
  let release = spot(qb);
  for (const [index, hop] of storedHops(qb).entries()) {
    const from = chain[chain.length - 1];
    if (index >= MAX_LATERALS || !from) break;
    const to = players.find((q) => q.id === hop.to && q.team === "offense");
    if (!to || to.id === from.id) break;
    const c = hop.catch ? clampCatch(hop.catch, release) : defaultCatch(release, at.get(to.id) ?? spot(to));
    links.push({ index, from, to, release, catch: c });
    at.set(to.id, c);
    chain.push(to);
    release = c;
  }
  return { qb, chain, links };
}

/** Everyone who holds the ball, in order, the same player as often as they take it: the quarterback, then each lateral's target. */
export function chainOf(players: readonly Player[]): Player[] {
  return walk(players).chain;
}

/** Every lateral in the chain, in order, each released where the one before it was caught (K4). */
export function chainLinks(players: readonly Player[]): Link[] {
  return walk(players).links;
}

/** Everyone who holds the ball, by id, when there is at least one lateral; empty when the quarterback just keeps it. */
export function carriers(players: readonly Player[]): Set<string> {
  const { chain, links } = walk(players);
  return new Set(links.length ? chain.map((p) => p.id) : []);
}

/** The places in the chain where this player has the ball: 0 is the quarterback at the snap. */
export function visits(chain: readonly Player[], id: string): number[] {
  return chain.flatMap((p, i) => (p.id === id ? [i] : []));
}

/**
 * The catch pulled back to where a lateral is legal: level with or behind its release (K1),
 * behind the line of scrimmage (K2), and on the field (K3). It never moves a catch forward (K5).
 */
export function clampCatch(c: Pair, release: Pair): Pair {
  return [Math.max(X_MIN, Math.min(X_MAX, c[0])), Math.min(Y_MAX, Math.max(LOS_GAP, release[1], c[1]))];
}

/**
 * Which rule snapped a raw catch point back, for the note the coach is shown: the one it landed on.
 * A catch dragged past the line when the ball is let go 5 yards deep lands level with the release,
 * so it is "forward"; "line" only when the release is on the line itself. Null when nothing snapped.
 */
export function catchClamp(c: Pair, release: Pair): "line" | "forward" | null {
  if (c[1] >= Math.max(LOS_GAP, release[1])) return null;
  return release[1] > LOS_GAP ? "forward" : "line";
}

/**
 * Where a lateral with no stored catch is caught (K6): 3 yards past where its target is, on from the
 * thrower, as they drift out to take it, and at least a yard behind the release and at the set depth,
 * so it reads as a toss back rather than a handoff.
 */
export function defaultCatch(release: Pair, where: Pair): Pair {
  const dir = where[0] >= release[0] ? 1 : -1;
  return clampCatch([where[0] + dir * 3, Math.max(where[1], PITCH_SET, release[1] + 1)], release);
}

/** Where the lateral at this hop is let go from: null past the chain's last toss. */
export function releasePoint(players: readonly Player[], hop: number): Pair | null {
  return walk(players).links[hop]?.release ?? null;
}

/**
 * The player as their post-snap job starts: at their spot after any motion, or, for the last carrier of
 * a chain, at the point they catch the last lateral. Every route is drawn and run from here.
 */
export function startOf(p: Player, players: readonly Player[]): Player {
  const s = atSnap(p);
  if (!storedHops(quarterback(players)).some((h) => h.to === p.id)) return s;
  const { chain, links } = walk(players);
  const last = links[links.length - 1];
  return last && chain[chain.length - 1]?.id === p.id ? { ...s, x: last.catch[0], y: last.catch[1] } : s;
}

function withoutPrimary(r: Route): Route {
  const out = { ...r };
  delete out.primary;
  return out;
}

const sameHop = (a: Hop | undefined, b: Hop): boolean =>
  a?.to === b.to && a.catch?.[0] === b.catch?.[0] && a.catch?.[1] === b.catch?.[1] && (a.catch === undefined) === (b.catch === undefined);

/** A player without their laterals, the key gone rather than left empty, so the record reads as before. */
function withoutLaterals(p: Player): Player {
  const out = { ...p };
  delete out.laterals;
  return out;
}

/**
 * The play with its chain made legal: the quarterback's laterals cut at the first that isn't one (R1, R3,
 * R4) with every stored catch clamped in order (K4), laterals anywhere else taken off (R7), and every
 * route a carrier can't have taken off (R5, S1, S2, S3). A play with nothing to settle comes back as the
 * same array (S4).
 */
export function settleChain<T extends readonly Player[]>(players: T): T {
  const { qb, chain, links } = walk(players);
  const stored = storedHops(qb);
  const kept: Hop[] = links.map((l) => (stored[l.index]?.catch ? { to: l.to.id, catch: l.catch } : { to: l.to.id }));
  const hopsMoved = kept.length !== stored.length || kept.some((h, i) => !sameHop(stored[i], h));
  const inChain = new Set(chain.map((p) => p.id));
  const last = chain[chain.length - 1];
  let changed = false;
  const out = players.map((p) => {
    let next = p;
    if (p.laterals && p.id !== qb?.id) next = withoutLaterals(next);
    else if (p.id === qb?.id && hopsMoved) next = kept.length ? { ...next, laterals: kept } : withoutLaterals(next);
    const r = next.route;
    if (r && p.team === "offense") {
      let route: Route | null = r;
      if (!inChain.has(p.id)) {
        // S3: a throw only a carrier has, on someone who doesn't carry
        if (isBallJob(r.type)) route = null;
      } else if (p.id !== last?.id) {
        // R5: every time they have it they toss it on, so they have no job of their own
        route = null;
      } else if (links.length) {
        // S1, S2: after a lateral the last carrier throws or keeps it, and isn't the read
        if (!isRun(r.type) && !isBallJob(r.type)) route = null;
        else if (r.primary) route = withoutPrimary(r);
      }
      if (route !== r) next = { ...next, route };
    }
    if (next !== p) changed = true;
    return next;
  });
  return changed ? (out as unknown as T) : players;
}

/** What the coach is told when a dragged catch is snapped back: which rule it broke, and who lets it go. */
export function catchNote(rule: "line" | "forward", thrower: string): string {
  return rule === "line"
    ? "A lateral has to be caught behind the line. Snapped the catch back to it."
    : `A lateral can't go forward. Snapped the catch level with where ${thrower} lets it go.`;
}

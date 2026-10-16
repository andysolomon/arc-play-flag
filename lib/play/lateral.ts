import { atSnap } from "./pre-snap";
import { LOS_GAP, PITCH_SET, X_MAX, X_MIN, Y_MAX, isBallJob, isQbAction, isRun } from "./routes";
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
 * A carrier can also run with it first and pitch on the run, the option (docs/adr/007-pitch-on-the-run.md):
 * a hop with a `release` stored is let go there, and the carrier runs straight to it from where they
 * have the ball. The release stays behind the line, so every rule above holds against it unchanged.
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
 * - S5 a quarterback with no lateral keeps whatever route, and read, they had, but for a rollout or boot's read.
 * - Q1, Q2 a rollout or boot (docs/adr/010-qb-rollout-and-boot.md) on anyone but the quarterback, or on a
 *   quarterback whose chain has a lateral, is taken off ahead of the carrier rules, which would keep a ball job
 *   on the last carrier; Q12 one on the quarterback is never the read.
 * - P1 a release past the line of scrimmage: snapped back behind it, so no lateral is ever let go past it.
 * - P2 a release off the field: pulled back inside the sidelines and the backfield.
 * - P3 a release where the carrier already has the ball: no run, the toss leaves from there as with none.
 * - P4 the catch is clamped against the release, never the start: a pitch from up at the line can be
 *   caught anywhere behind the line, deeper than where the run began included.
 * - P5 a release moved behind its catch: the catch is pushed back level with it (K1 against the
 *   release) and, as ever, never pulled forward again (K5).
 * - P6 a release on a hop that is cut (to nobody, to the carrier, past the cap) goes with the hop.
 * - P7 a run before a pitch flips with the field, like every catch (reducer "flip").
 * - P8 a carrier who takes it back after running: their next catch is reached from the release, not
 *   from their spot, so the playback track never jumps.
 * - P9 pre-snap motion: the quarterback's run starts where they stand at the snap.
 */

/** As many laterals as a play keeps: a bound on what storage reads, far past any play. */
export const MAX_LATERALS = 60;

/** The quarterback: the offensive player labelled QB, else the default QB slot. */
export function quarterback(players: readonly Player[]): Player | undefined {
  return players.find((q) => q.team === "offense" && q.label === "QB") ?? players.find((q) => q.id === "o2");
}

/** The centre, who snaps the ball: the offensive player labelled C, else the default centre slot. */
export function centre(players: readonly Player[]): Player | undefined {
  return players.find((q) => q.team === "offense" && q.label === "C") ?? players.find((q) => q.id === "o1" && q.team === "offense");
}

/**
 * Whether this player can be given a jet sweep (docs/adr/006-jet-sweep.md, rule 5): an offensive
 * player who is not the quarterback, who hands it off, nor the centre, who snaps it, and who does not
 * carry the ball in a lateral chain, since the ball comes to a carrier by lateral, never by handoff.
 */
export function canJet(p: Player, players: readonly Player[]): boolean {
  if (p.team !== "offense") return false;
  if (p.id === quarterback(players)?.id || p.id === centre(players)?.id) return false;
  return !carriers(players).has(p.id);
}

/**
 * One lateral in a chain: which hop it is, who lets it go and where, and who catches it and where (clamped).
 * `start` is where the thrower has the ball when it is theirs to toss: their spot, or their own catch.
 * It differs from `release` only when they run with it first (see runsBefore).
 */
export interface Link {
  index: number;
  from: Player;
  to: Player;
  start: Pair;
  release: Pair;
  catch: Pair;
}

/** True when the toss is let go on the run: its thrower carries the ball from `start` to `release` first. */
export const runsBefore = (l: Pick<Link, "start" | "release">): boolean =>
  Math.abs(l.start[0] - l.release[0]) > 0.01 || Math.abs(l.start[1] - l.release[1]) > 0.01;

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
  // where the thrower has it: the quarterback's spot at the snap (K7, P9), then each catch in turn
  let start = spot(qb);
  for (const [index, hop] of storedHops(qb).entries()) {
    const from = chain[chain.length - 1];
    if (index >= MAX_LATERALS || !from) break;
    const to = players.find((q) => q.id === hop.to && q.team === "offense");
    if (!to || to.id === from.id) break;
    // let go on the run from the stored release (P1, P2), else from where they have it
    const release = hop.release ? clampRelease(hop.release) : start;
    const c = hop.catch ? clampCatch(hop.catch, release) : defaultCatch(release, at.get(to.id) ?? spot(to));
    links.push({ index, from, to, start, release, catch: c });
    at.set(to.id, c);
    chain.push(to);
    start = c;
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
 * Where a carrier may let a lateral go on the run: on the field (P2) and behind the line (P1), so the
 * catch rules, clamped against it, hold as ever.
 */
export function clampRelease(r: Pair): Pair {
  return [Math.max(X_MIN, Math.min(X_MAX, r[0])), Math.min(Y_MAX, Math.max(LOS_GAP, r[1]))];
}

/** Which rule snapped a raw release back, for the note the coach is shown: the line, or nothing. */
export function releaseClamp(r: Pair): "line" | null {
  return r[1] < LOS_GAP ? "line" : null;
}

/**
 * Where a carrier runs to before pitching when the coach first asks for it: 4 yards across toward
 * whoever takes it and 3 yards up toward the line, so the toss reads as the option it is, the arc
 * clears the token of a back lined up beside them, and the run never crosses the line.
 */
export function defaultRelease(start: Pair, toward: Pair): Pair {
  const dir = toward[0] >= start[0] ? 1 : -1;
  return clampRelease([start[0] + dir * 4, start[1] - 3]);
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

const samePoint = (a: Pair | undefined, b: Pair | undefined): boolean =>
  (a === undefined) === (b === undefined) && a?.[0] === b?.[0] && a?.[1] === b?.[1];
const sameHop = (a: Hop | undefined, b: Hop): boolean =>
  a?.to === b.to && samePoint(a.catch, b.catch) && samePoint(a.release, b.release);

/** A hop as stored, its catch and release clamped and nothing else changed, the keys only when they are there. */
function keptHop(stored: Hop | undefined, l: Link): Hop {
  const out: Hop = { to: l.to.id };
  if (stored?.catch) out.catch = l.catch;
  if (stored?.release) out.release = l.release;
  return out;
}

/** A player without their laterals, the key gone rather than left empty, so the record reads as before. */
function withoutLaterals(p: Player): Player {
  const out = { ...p };
  delete out.laterals;
  return out;
}

/**
 * The play with its chain made legal: the quarterback's laterals cut at the first that isn't one (R1, R3,
 * R4) with every stored release and catch clamped in order (K4, P1), laterals anywhere else taken off (R7), and every
 * route a carrier can't have taken off (R5, S1, S2, S3). A play with nothing to settle comes back as the
 * same array (S4).
 */
export function settleChain<T extends readonly Player[]>(players: T): T {
  const { qb, chain, links } = walk(players);
  const stored = storedHops(qb);
  const kept: Hop[] = links.map((l) => keptHop(stored[l.index], l));
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
      // J8: a jet sweep is a handoff at the snap, so neither the quarterback, the centre nor a carrier can take one
      if (r.type === "jet" && (p.id === qb?.id || p.id === centre(players)?.id || (links.length && inChain.has(p.id)))) route = null;
      // Q1, Q2: a rollout or boot is the quarterback's job at the snap, so not a carrier's, and Q12 never the read
      else if (isQbAction(r.type) && (p.id !== qb?.id || links.length)) route = null;
      else if (isQbAction(r.type) && r.primary) route = withoutPrimary(r);
      else if (!inChain.has(p.id)) {
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

/** What the coach is told when a dragged release is snapped back: a pitch is let go behind the line. */
export function releaseNote(thrower: string): string {
  return `${thrower} has to pitch from behind the line. Snapped the pitch back to it.`;
}

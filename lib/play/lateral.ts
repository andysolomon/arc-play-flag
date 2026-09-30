import { atSnap } from "./pre-snap";
import { LOS_GAP, PITCH_SET, X_MAX, X_MIN, Y_MAX, isBallJob, isRun } from "./routes";
import { isLateral, type Pair, type Player, type Route } from "./types";

/**
 * Lateral chains. In flag football the ball can be tossed back behind the line of scrimmage
 * any number of times and still be thrown forward after. The chain starts with the quarterback,
 * who takes the snap, and follows each carrier's `lateral` route to the player who takes it.
 * Each carrier laterals again, throws (`throw`), or keeps it (a run route). Nothing about the
 * chain is stored beyond those routes: who carries, where each lateral is let go and caught, and
 * where each carrier's own job starts are all worked out here, from the players as they are.
 *
 * A lateral is never forward and never past the line: its catch point is level with or behind the
 * spot it is let go from (the quarterback's spot for the first, the previous catch after that),
 * and behind the line of scrimmage. In yards +y is toward the offense's backfield, so that is
 * `catch.y >= max(LOS_GAP, release.y)`.
 *
 * Ways it could go wrong, written down before the code:
 * - C1 no quarterback on the field: there is no chain, not an error.
 * - C2 a lateral to a player who is no longer there: the chain stops at the thrower.
 * - C3 a lateral back to someone already in the chain (QB → Z → QB) would loop forever: the
 *   chain stops at the thrower. A chain can't revisit a player (docs/adr/004-lateral-chains.md).
 * - C4 a lateral to a defender: not a hop; laterals go to the offense.
 * - C5 a lateral or throw on a player the chain never reaches: not part of it, and settled away.
 * - C6 the quarterback is the player labelled QB, else the default QB slot, as everywhere else.
 * - K1 a catch in front of its release: snapped level with the release.
 * - K2 a catch past the line of scrimmage: snapped back behind it.
 * - K3 a catch dragged off the field: pulled back inside the sidelines and the backfield.
 * - K4 a downstream catch clamped against the upstream catch as it was before that one moved:
 *   the chain is clamped in order, each against the one before it as clamped.
 * - K5 a release that moves up toward the line dragging a catch forward with it: a clamp only
 *   ever moves a catch back, never forward.
 * - K6 a lateral with no catch stored: one is worked out from where its target stands.
 * - K7 pre-snap motion: the quarterback lets it go where they are at the snap.
 * - K8 a stored catch that isn't a pair of finite numbers: storage drops it (K6 then applies).
 * - S1 a carrier after the quarterback with a pass route: they have the ball, so it goes.
 * - S2 a carrier marked as the primary read: the read is someone the final throw goes to.
 * - S3 a lateral or throw left on a player the chain no longer reaches, or a lateral that goes
 *   nowhere (C2, C3): taken off.
 * - S4 settling a settled play hands back the very same array, so nothing reads as an edit.
 * - S5 a quarterback with no lateral keeps whatever route, and read, they had.
 */

/** The quarterback: the offensive player labelled QB, else the default QB slot. */
export function quarterback(players: readonly Player[]): Player | undefined {
  return players.find((q) => q.team === "offense" && q.label === "QB") ?? players.find((q) => q.id === "o2");
}

/**
 * Everyone who holds the ball, in order: the quarterback, then each lateral's target, stopping at a
 * lateral to a player already in the chain (C3), to nobody on the field (C2) or to a defender (C4).
 */
export function chainOf(players: readonly Player[]): Player[] {
  const out: Player[] = [];
  const seen = new Set<string>();
  let cur = quarterback(players);
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    const r = cur.route;
    cur = isLateral(r) ? players.find((q) => q.id === r.target && q.team === "offense") : undefined;
  }
  return out;
}

/** One lateral in a chain: who lets it go and where, and who catches it and where (clamped). */
export interface Link {
  from: Player;
  to: Player;
  release: Pair;
  catch: Pair;
}

const spot = (p: Player): Pair => {
  const s = atSnap(p);
  return [s.x, s.y];
};

/** Every lateral in the chain, in order, each released where the one before it was caught (K4). */
export function chainLinks(players: readonly Player[]): Link[] {
  const chain = chainOf(players);
  const out: Link[] = [];
  const first = chain[0];
  if (!first) return out;
  let release = spot(first);
  for (let i = 0; i + 1 < chain.length; i++) {
    const from = chain[i], to = chain[i + 1];
    if (!from || !to) break;
    const stored = from.route?.catch;
    const c = stored ? clampCatch(stored, release) : defaultCatch(release, to);
    out.push({ from, to, release, catch: c });
    release = c;
  }
  return out;
}

/** The chain's carriers by id, when it has at least one lateral; empty when the quarterback just keeps it. */
export function carriers(players: readonly Player[]): Set<string> {
  const chain = chainOf(players);
  return new Set(chain.length > 1 ? chain.map((p) => p.id) : []);
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
 * Where a lateral with no stored catch is caught (K6): 3 yards past the target, on from the thrower,
 * as they drift out to take it, and at least a yard behind the release and at the set depth, so it
 * reads as a toss back rather than a handoff.
 */
export function defaultCatch(release: Pair, target: Player): Pair {
  const t = atSnap(target);
  const dir = t.x >= release[0] ? 1 : -1;
  return clampCatch([t.x + dir * 3, Math.max(t.y, PITCH_SET, release[1] + 1)], release);
}

/** Where this carrier's lateral is caught, clamped; null when their lateral is no hop in the chain. */
export function catchPoint(thrower: Player, players: readonly Player[]): Pair | null {
  return chainLinks(players).find((l) => l.from.id === thrower.id)?.catch ?? null;
}

/**
 * Where a player lets the ball go: the quarterback where they stand at the snap (K7), a later carrier
 * where they caught it. Anyone else lets nothing go, and gets their own spot.
 */
export function releasePoint(p: Player, players: readonly Player[]): Pair {
  const links = chainLinks(players);
  const into = links.find((l) => l.to.id === p.id);
  if (into) return into.catch;
  return links.find((l) => l.from.id === p.id)?.release ?? spot(p);
}

/**
 * The player as their post-snap job starts: at their spot after any motion, or, for a carrier after
 * the quarterback, at the point they catch the lateral. Every route is drawn and run from here.
 */
export function startOf(p: Player, players: readonly Player[]): Player {
  const s = atSnap(p);
  if (!players.some((q) => isLateral(q.route) && q.route.target === p.id)) return s;
  const into = chainLinks(players).find((l) => l.to.id === p.id);
  return into ? { ...s, x: into.catch[0], y: into.catch[1] } : s;
}

function withoutPrimary(r: Route): Route {
  const out = { ...r };
  delete out.primary;
  return out;
}

const same = (a: Pair | undefined, b: Pair | undefined): boolean => a?.[0] === b?.[0] && a?.[1] === b?.[1];

/**
 * The play with its chain made legal: every stored catch clamped in chain order (K4), and anything a
 * carrier can't have taken off (S1, S2, S3). A play with nothing to settle comes back as the same array (S4).
 */
export function settleChain<T extends readonly Player[]>(players: T): T {
  const chain = chainOf(players);
  const at = new Map(chain.map((p, i) => [p.id, i]));
  const caught = new Map(chainLinks(players).map((l) => [l.from.id, l.catch]));
  const last = chain.length - 1;
  let changed = false;
  const out = players.map((p) => {
    const r = p.route;
    if (!r || p.team !== "offense") return p;
    const i = at.get(p.id);
    let next: Route | null = r;
    if (i === undefined) {
      // S3: a job only a carrier has, on someone who doesn't carry
      if (isBallJob(r.type)) next = null;
    } else if (i < last) {
      // a hop: its catch clamped against its release, and never the read
      const c = caught.get(p.id);
      if (r.catch && c && !same(r.catch, c)) next = { ...r, catch: c };
      if (next.primary) next = withoutPrimary(next);
    } else if (r.type === "lateral") {
      // S3: the last carrier's lateral goes nowhere, or back into the chain
      next = null;
    } else if (i > 0) {
      // S1, S2: after the quarterback, a carrier throws or keeps it, and isn't the read
      if (!isRun(r.type) && !isBallJob(r.type)) next = null;
      else if (r.primary) next = withoutPrimary(r);
    }
    if (next === r) return p;
    changed = true;
    return { ...p, route: next };
  });
  return changed ? (out as unknown as T) : players;
}

/** What the coach is told when a dragged catch is snapped back: which rule it broke, and who lets it go. */
export function catchNote(rule: "line" | "forward", thrower: string): string {
  return rule === "line"
    ? "A lateral has to be caught behind the line. Snapped the catch back to it."
    : `A lateral can't go forward. Snapped the catch level with where ${thrower} lets it go.`;
}

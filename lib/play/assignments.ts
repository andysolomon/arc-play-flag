/**
 * Who does what on a play, in words: the job of every player on the play's side, read left
 * to right, plus the call and the primary read. The slide panel, its alt text and its
 * speaker notes all read from here, so the three never disagree. Pure; no DOM.
 *
 * What it answers for:
 *
 * - L2 a player with no route, or no label, would be skipped or unnamed: the quarterback's job
 *   comes from the call ("Throw, look to Z first"), the centre's is "Snap", anyone else gets
 *   "No route" or "No assignment", and an unlabelled player is "Player k" or "Defender k",
 *   counted left to right.
 * - L3 a man target that was deleted: the job is plain "Man". A stored play never gets
 *   here, since loading drops the route (`normalizePlayers`) and the player reads "No
 *   assignment"; the fallback is for plays built in memory.
 * - L4 nobody on the play's own side: `assignments` is empty, and callers say so.
 * - L5 an offensive play with no routes: no call name, no call line.
 * - T6 two plays with one name: `headerLine` leads with the play's number.
 * - L6 a lateral chain (lib/play/lateral.ts) reads as who tosses it to whom and how it ends; a
 *   carrier left with the ball and no job is said to be one (`missing`), never "No route"; a player
 *   who has it more than once is given every time, in order.
 * - L7 a read marked on a carrier in a chain is not the read: the final throw goes to someone else.
 * - L8 a blitz aimed at a player reads "Blitz Z", at the backfield "Blitz the backfield", and at the
 *   quarterback plain "Blitz", as every blitz did; one aimed at a player who is gone reads "Blitz" too.
 *   A contain blitz reads "Contain blitz", the same when the sideline leaves no edge and it comes
 *   straight: the call is still contain, and the picture shows the path.
 * - L9 a lateral let go on the run (ADR 007) is a pitch: "QB runs and pitches to Z", and the job "Run
 *   and pitch to Z", so the words say the carrier moves with the ball first.
 * - L10 a deep zone called as a half or a third says so, "Deep half" or "Deep third"; Auto reads
 *   "Zone deep", as every deep zone did.
 * - L11 a quarterback's rollout or boot (ADR 011) says which way they go and who they fake to, by the same
 *   fake the field and playback use: "QB boots left", "Fake to Z, boot left, throw, look to Y first", and
 *   on a run "Hand off to Z, then boot left as a decoy", never the bare "Rollout" or "Boot".
 *
 * Text is used as given; the caller cleans it first (T1–T5).
 */

import type { Numbered } from "@/lib/export/numbered";
import { blitzAim, blitzTarget } from "./blitz";
import { CALL_LABEL, callOf } from "./call";
import { COVERAGE_WORDS, coverageOf } from "./coverage";
import { qbAction, type QbAction } from "./geometry";
import { carriers, chainLinks, chainOf, runsBefore, visits } from "./lateral";
import { isQbAction, isRun, routeName } from "./routes";
import type { Player, SavedPlay, Team } from "./types";

export interface Assignment {
  id: string;
  team: Team;
  label: string;
  /** the label, or "Player k" / "Defender k" when there is none */
  who: string;
  job: string;
  /** the offense's primary read */
  primary: boolean;
  /** nothing to do on this play: no route and no job from the call */
  idle: boolean;
  /** has the ball from a lateral and nothing to do with it: the play isn't finished */
  missing: boolean;
}

/** Left to right, then front to back, then by id so the order never depends on storage. */
export const byLine = (a: Player, b: Player): number => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Every player's name: the label, else "Player k" (offense) / "Defender k" (defense), k counted left to right among that team's unlabelled players. */
export function names(play: { readonly players: readonly Player[] }): Map<string, string> {
  const out = new Map<string, string>();
  for (const team of ["offense", "defense"] as const) {
    let k = 0;
    for (const p of play.players.filter((q) => q.team === team).sort(byLine)) {
      out.set(p.id, p.label || `${team === "offense" ? "Player" : "Defender"} ${String(++k)}`);
    }
  }
  return out;
}

/**
 * The ball carrier: the last carrier of a lateral chain that keeps it, the runner a quarterback's rollout or
 * boot fakes or hands off to (L11), else the primary read on a run route, else the first runner.
 */
export function runnerOf(play: SavedPlay): Player | null {
  const chain = chainOf(play.players);
  const last = chain[chain.length - 1];
  if (chain.length > 1) return last?.route && isRun(last.route.type) ? last : null;
  const act = qbAction(play.players);
  if (act) return act.fake;
  const routed = play.players.filter((p) => p.team === "offense" && p.route).sort(byLine);
  const primary = primaryOf(play);
  if (primary?.route && isRun(primary.route.type)) return primary;
  return routed.find((p) => p.route && isRun(p.route.type)) ?? null;
}

/** The primary read; never a carrier in a lateral chain (L7), whose throw goes to someone else. */
function primaryOf(play: SavedPlay): Player | null {
  const held = carriers(play.players);
  return play.players.find((p) => p.team === "offense" && p.route?.primary && !held.has(p.id)) ?? null;
}

/** A player's name for sentences; a missing runner reads "the runner". */
type Who = (p: Player | null) => string;

function namer(play: SavedPlay): Who {
  const all = names(play);
  return (p) => (p ? all.get(p.id) ?? "" : "the runner");
}

/** A route's job: its name, "Man on X", or plain "Man" when the covered player is gone. Null with no route. */
function routeJob(p: Player, play: SavedPlay, who: Who): string | null {
  const rt = p.route;
  if (!rt) return null;
  if (rt.type === "custom") return "Custom route";
  if (rt.type === "man") {
    const target = play.players.find((q) => q.id === rt.target);
    return target ? `Man on ${who(target)}` : "Man";
  }
  if (rt.type === "blitz") {
    // the quarterback's blitz reads as it always did; one aimed elsewhere says where (L8)
    const aim = blitzAim(rt);
    if (aim === "backfield") return "Blitz the backfield";
    if (aim === "contain") return "Contain blitz";
    const target = aim === "player" ? blitzTarget(rt, play.players) : undefined;
    return target ? `Blitz ${who(target)}` : "Blitz";
  }
  return routeName(p.team, rt) ?? "Custom route";
}

/** Which way a rollout or boot goes, as a job says it ("roll out right", "boot left") or a sentence does ("rolls out right"). */
export function qbMove(act: Pick<QbAction, "type" | "side">, says = false): string {
  const way = act.side > 0 ? "right" : "left";
  if (act.type === "rollout") return `${says ? "rolls" : "roll"} out ${way}`;
  return `${says ? "boots" : "boot"} ${way}`;
}

/** The quarterback's rollout or boot in a sentence, for the field's description: what they do, in the call's words. Null without one. */
export function qbActionLine(play: { readonly players: readonly Player[] }): string | null {
  const act = qbAction(play.players);
  if (!act) return null;
  const all = names(play);
  const who = (p: Player | null): string => (p ? all.get(p.id) ?? "" : "the runner");
  const qb = who(act.qb), move = qbMove(act, true);
  if (act.decoy) return `${qb} hands off to ${who(act.fake)}, then ${move} as a decoy.`;
  const fake = act.fake ? `fakes ${act.type === "boot" ? "the handoff " : ""}to ${who(act.fake)}, then ` : "";
  return callOf(play.players)
    ? `${qb} ${fake}${move} behind the line and throws from the ring.`
    : `${qb} ${fake}${move} behind the line with the ball.`;
}

/** "Pass", "Run", "Play-action", "Double pass", "Lateral pass", "Lateral run", "Lateral · unfinished", or "Defense" for a defensive call; null when nobody has a route. */
export function callName(play: SavedPlay): string | null {
  if (play.side === "defense") return "Defense";
  const call = callOf(play.players);
  return call ? CALL_LABEL[call] : null;
}

/** The call in a sentence: where the ball goes and the primary read, or the defense's coverage. */
export function callLine(play: SavedPlay): string | null {
  if (play.side === "defense") {
    const cover = coverageOf(play.players);
    return cover ? `Defense, ${COVERAGE_WORDS[cover]} coverage.` : "Defense.";
  }
  const call = callOf(play.players);
  if (!call) return null;
  const who = namer(play);
  const r = runnerOf(play), pr = primaryOf(play);
  const read = pr ? ` Primary read: ${who(pr)} (${routeJob(pr, play, who) ?? ""}).` : "";
  // a chain, toss by toss: "QB laterals to Z, Z laterals to X", or "QB runs and pitches to Z" on the run (L9)
  const chain = chainOf(play.players);
  const last = chain[chain.length - 1] ?? null;
  const hops = chainLinks(play.players).map((l) => `${who(l.from)} ${runsBefore(l) ? "runs and pitches" : "laterals"} to ${who(l.to)}`).join(", ");
  // the quarterback's rollout or boot, said in the call (L11)
  const act = qbAction(play.players);
  const qb = act ? `${who(act.qb)} ${qbMove(act, true)}` : "";
  switch (call) {
    case "pass": return act ? `Pass: ${qb} and throws.${read}` : `Pass.${read}`;
    case "play-action": return act ? `Play-action: fake to ${who(r)}, ${qb}, then throws.${read}` : `Play-action: fake to ${who(r)}, then throw.${read}`;
    case "run": {
      const job = r ? routeJob(r, play, who) : null;
      const decoy = act ? ` ${who(act.qb)} hands off, then ${qbMove(act, true)} as a decoy.` : "";
      return `Run: ${who(r)} takes it${job ? ` (${job})` : ""}.${decoy}`;
    }
    case "double-pass":
    case "lateral-pass":
      return `${CALL_LABEL[call]}: ${hops}, ${who(last)} throws.${read}`;
    case "lateral-run": {
      const job = last ? routeJob(last, play, who) : null;
      return `Lateral run: ${hops}, ${who(last)} keeps it${job ? ` (${job})` : ""}.`;
    }
    case "lateral-unfinished":
      return `Lateral: ${hops}. ${who(last)} still needs a job: throw, lateral again or keep it.`;
  }
}

/**
 * Where the ball goes on a lateral chain, as a wristband or slide says it: "QB › Z › X › Y" (the last
 * name is the read the final throw goes to, or "throw" with none marked), "QB › Z keeps", or
 * "QB › Z › ?" while the last carrier has no job. Null for a play with no lateral.
 */
export function chainLine(play: SavedPlay): string | null {
  if (play.side === "defense") return null;
  const chain = chainOf(play.players);
  const last = chain[chain.length - 1];
  if (chain.length < 2 || !last) return null;
  const who = namer(play);
  const path = chain.map((p) => who(p)).join(" › ");
  if (last.route?.type === "throw") {
    const pr = primaryOf(play);
    return `${path} › ${pr ? who(pr) : "throw"}`;
  }
  if (last.route && isRun(last.route.type)) return `${path} keeps`;
  return `${path} › ?`;
}

/** The play's number, name and call: "3 · Otter Hook · Run". */
export function headerLine(item: Numbered): string {
  const call = callName(item.play);
  return `${String(item.n)} · ${item.play.name}${call ? ` · ${call}` : ""}`;
}

/** The quarterback's job when they have no route: it follows the call. Null with no call. */
function qbJob(play: SavedPlay, who: Who): string | null {
  const call = callOf(play.players);
  if (!call) return null;
  const r = runnerOf(play), pr = primaryOf(play);
  const look = pr ? `, look to ${who(pr)} first` : "";
  switch (call) {
    case "pass": return `Throw${look}`;
    case "play-action": return `Fake to ${who(r)}, then throw${look}`;
    case "run": return `Hand off to ${who(r)}`;
    // in a chain the quarterback's job is their lateral
    case "double-pass": case "lateral-pass": case "lateral-run": case "lateral-unfinished": return null;
  }
}

/**
 * The quarterback's job on a rollout or boot (L11): it follows the call, the way the field draws it. Null
 * when they have none.
 */
function qbActionJob(play: SavedPlay, who: Who, look: string): string | null {
  const act = qbAction(play.players);
  if (!act) return null;
  const move = qbMove(act);
  const Move = move.charAt(0).toUpperCase() + move.slice(1);
  if (act.decoy) return `Hand off to ${who(act.fake)}, then ${move} as a decoy`;
  switch (callOf(play.players)) {
    case "play-action": return `Fake to ${who(act.fake)}, ${move}, throw${look}`;
    case "pass": return `${Move}, throw${look}`;
    default: return Move;
  }
}

/**
 * A carrier's job in a lateral chain (L6), said for every time they have it, in order: they toss it on
 * ("Lateral to X"), or, the last time, throw, keep it or, with nothing yet, say so. A player who has it
 * more than once gets each in turn: "Lateral to Z, then lateral to X". Null off the chain, and for a
 * quarterback with no lateral, whose own route says their job, but for a throw (a Pitch saved before ADR 004)
 * and a rollout or boot, said by the call (L11).
 */
function carrierJob(p: Player, chain: readonly Player[], play: SavedPlay, who: Who): { job: string; missing: boolean } | null {
  const at = visits(chain, p.id);
  const rt = p.route;
  const pr = primaryOf(play);
  const look = pr ? `, look to ${who(pr)} first` : "";
  const last = chain.length - 1;
  if (!at.length) return null;
  if (last === 0) {
    if (rt && isQbAction(rt.type)) return { job: qbActionJob(play, who, look) ?? routeJob(p, play, who) ?? "", missing: false };
    return rt?.type === "throw" ? { job: `Throw${look}`, missing: false } : null;
  }
  const links = chainLinks(play.players);
  const one = (i: number): string => {
    // the toss that leaves them this time is hop i: on the run it is a pitch (L9)
    const toss = links[i];
    if (i < last) return `${toss && runsBefore(toss) ? "Run and pitch" : "Lateral"} to ${who(chain[i + 1] ?? null)}`;
    if (rt?.type === "throw") return `Take the lateral, throw${look}`;
    if (rt && isRun(rt.type)) return `Take the lateral, keep it: ${routeJob(p, play, who) ?? ""}`;
    return "Takes the lateral · no job yet";
  };
  const job = at.map(one).map((t, k) => (k === 0 ? t : t.charAt(0).toLowerCase() + t.slice(1))).join(", then ");
  return { job, missing: at.includes(last) && !rt };
}

/** Every player on the play's own side, left to right, with their job. */
export function assignments(play: SavedPlay): Assignment[] {
  const who = namer(play);
  const chain = chainOf(play.players);
  const pr = primaryOf(play);
  return play.players.filter((p) => p.team === play.side).sort(byLine).map((p) => {
    const offense = p.team === "offense";
    const held = offense ? carrierJob(p, chain, play, who) : null;
    let job = held?.job ?? routeJob(p, play, who);
    const missing = held?.missing ?? false;
    let idle = false;
    if (job === null && offense && p.label === "QB") job = qbJob(play, who);
    if (job === null) {
      if (offense && p.label === "C") job = "Snap";
      else {
        job = offense ? "No route" : "No assignment";
        idle = true;
      }
    }
    if (offense && p.preSnap?.pts.length) {
      job = idle ? "Pre-snap motion, then hold" : `Pre-snap motion, then ${job}`;
      idle = false;
    }
    return { id: p.id, team: p.team, label: p.label, who: who(p), job, primary: offense && p.id === pr?.id, idle, missing };
  });
}

/** "Z: Wheel (primary read)" */
export function assignmentLine(a: Assignment): string {
  return `${a.who}: ${a.job}${a.primary ? " (primary read)" : ""}`;
}

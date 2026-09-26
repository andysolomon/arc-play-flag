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
 *
 * Text is used as given; the caller cleans it first (T1–T5).
 */

import type { Numbered } from "@/lib/export/numbered";
import { CALL_LABEL, callOf } from "./call";
import { isPitch, isRun, routeDef } from "./routes";
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
}

/** Left to right, then front to back, then by id so the order never depends on storage. */
export const byLine = (a: Player, b: Player): number => a.x - b.x || a.y - b.y || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Every player's name: the label, else "Player k" (offense) / "Defender k" (defense), k counted left to right among that team's unlabelled players. */
export function names(play: SavedPlay): Map<string, string> {
  const out = new Map<string, string>();
  for (const team of ["offense", "defense"] as const) {
    let k = 0;
    for (const p of play.players.filter((q) => q.team === team).sort(byLine)) {
      out.set(p.id, p.label || `${team === "offense" ? "Player" : "Defender"} ${String(++k)}`);
    }
  }
  return out;
}

/** The ball carrier: the primary read on a run route, else the pitch man on an option, else the first runner. */
export function runnerOf(play: SavedPlay): Player | null {
  const routed = play.players.filter((p) => p.team === "offense" && p.route).sort(byLine);
  const primary = primaryOf(play);
  if (primary?.route && isRun(primary.route.type)) return primary;
  if (callOf(play.players) === "option") return routed.find((p) => p.route && isPitch(p.route.type)) ?? null;
  return routed.find((p) => p.route && isRun(p.route.type)) ?? null;
}

function primaryOf(play: SavedPlay): Player | null {
  return play.players.find((p) => p.team === "offense" && p.route?.primary) ?? null;
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
  return routeDef(p.team, rt.type)?.label ?? "Custom route";
}

/** "Pass", "Run", "Play-action", "Option", or "Defense" for a defensive call; null when nobody has a route. */
export function callName(play: SavedPlay): string | null {
  if (play.side === "defense") return "Defense";
  const call = callOf(play.players);
  return call ? CALL_LABEL[call] : null;
}

/** The call in a sentence: where the ball goes, and the primary read. */
export function callLine(play: SavedPlay): string | null {
  if (play.side === "defense") return "Defense.";
  const call = callOf(play.players);
  if (!call) return null;
  const who = namer(play);
  const r = runnerOf(play), pr = primaryOf(play);
  const read = pr ? ` Primary read: ${who(pr)} (${routeJob(pr, play, who) ?? ""}).` : "";
  switch (call) {
    case "pass": return `Pass.${read}`;
    case "play-action": return `Play-action: fake to ${who(r)}, then throw.${read}`;
    case "option": return `Option: pitch to ${who(r)}, who throws or keeps it.`;
    case "run": {
      const job = r ? routeJob(r, play, who) : null;
      return `Run: ${who(r)} takes it${job ? ` (${job})` : ""}.`;
    }
  }
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
    case "option": return `Pitch to ${who(r)}`;
    case "run": return `${r?.route && isPitch(r.route.type) ? "Pitch" : "Hand off"} to ${who(r)}`;
  }
}

/** Every player on the play's own side, left to right, with their job. */
export function assignments(play: SavedPlay): Assignment[] {
  const who = namer(play);
  return play.players.filter((p) => p.team === play.side).sort(byLine).map((p) => {
    const offense = p.team === "offense";
    let job = routeJob(p, play, who);
    let idle = false;
    if (job === null && offense && p.label === "QB") job = qbJob(play, who);
    if (job === null) {
      if (offense && p.label === "C") job = "Snap";
      else {
        job = offense ? "No route" : "No assignment";
        idle = true;
      }
    }
    return { id: p.id, team: p.team, label: p.label, who: who(p), job, primary: offense && p.route?.primary === true, idle };
  });
}

/** "Z: Wheel (primary read)" */
export function assignmentLine(a: Assignment): string {
  return `${a.who}: ${a.job}${a.primary ? " (primary read)" : ""}`;
}

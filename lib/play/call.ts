import { inNoRunZone, losOf } from "./field";
import { chainOf } from "./lateral";
import { isBallJob, isRun } from "./routes";
import type { Player, Team } from "./types";

export type Call =
  | "run" | "pass" | "play-action"
  /** a lateral chain, by how it ends: one lateral then a throw, two or more then a throw, a keep, or no job yet */
  | "double-pass" | "lateral-pass" | "lateral-run" | "lateral-unfinished";

/**
 * What the play is, read off the routes with the playback's rules but without its coin
 * flips. A lateral chain (lib/play/lateral.ts) is called by its last carrier: a throw after
 * one lateral is a double pass, after more a lateral pass, a keep is a lateral run, and a
 * carrier with no job leaves it unfinished. Otherwise a primary runner (or nobody to throw
 * to) is a run, any other runner beside a pass is play-action, and everything else is a
 * pass. Null when nobody has a route.
 */
export function callOf(players: readonly Player[]): Call | null {
  const chain = chainOf(players);
  const last = chain[chain.length - 1];
  if (chain.length > 1 && last) {
    const job = last.route;
    if (job?.type === "throw") return chain.length === 2 ? "double-pass" : "lateral-pass";
    if (job && isRun(job.type)) return "lateral-run";
    return "lateral-unfinished";
  }
  const offense = players.filter((p) => p.team === "offense" && p.route);
  if (!offense.length) return null;
  const runners = offense.filter((p) => p.route && isRun(p.route.type));
  const receivers = offense.filter((p) => p.route && !isRun(p.route.type) && !isBallJob(p.route.type) && p.label !== "QB");
  const primary = offense.find((p) => p.route?.primary);
  const primaryRun = primary?.route ? isRun(primary.route.type) : false;
  if (runners.length && (primaryRun || receivers.length === 0)) return "run";
  if (!receivers.length) return null;
  return runners.length ? "play-action" : "pass";
}

/** A call whose ball ends up carried on the ground: a run, or a lateral chain that ends in a keep. */
export const isRunCall = (call: Call | null): boolean => call === "run" || call === "lateral-run";

export const CALL_LABEL: Record<Call, string> = {
  run: "Run", pass: "Pass", "play-action": "Play-action",
  "double-pass": "Double pass", "lateral-pass": "Lateral pass", "lateral-run": "Lateral run", "lateral-unfinished": "Lateral · unfinished",
};

/** A call still waiting on a job: its pill wears the highlighter's full gold, not the soft one. */
export const unfinished = (call: Call | null): boolean => call === "lateral-unfinished";

/**
 * A run called with the ball in a no-run zone, which a league with the zones flags: the play
 * is offensive, the ball sits in a zone and its call is a run, or a lateral chain that ends in a
 * keep. A handoff or a lateral that ends in a throw (play-action, a double or lateral pass) is a
 * pass and stays legal, and a chain with no job yet is nothing yet. Every surface that warns about it
 * asks this one rule, so the palette, the field, the play card and every printout agree.
 *
 * Ways it could go wrong, written down before the rule:
 * - N1 a league without no-run zones is flagged: `noRunZones` is asked first.
 * - N2 play-action or a double or lateral pass is flagged, though the ball is thrown: only a run
 *   or a lateral run is.
 * - N3 a defensive call is flagged for its shadow offense, the other team's play: only an offensive play is.
 * - N4 a play with no spot of its own, or one from before the choices were cut to four, is read
 *   somewhere other than the field draws it: the spot goes through `losOf`, as the field's does.
 * - N5 the flag goes stale after the ball, a route, the primary read or the league's rule
 *   changes: nothing stores it, every surface asks again from the play as it is.
 */
export function runInNoRunZone(play: { side: Team; players: readonly Player[]; los?: number }, noRunZones: boolean): boolean {
  return noRunZones && play.side === "offense" && inNoRunZone(losOf(play)) && isRunCall(callOf(play.players));
}

/** What a flagged play is called in words, on the play card, the field's caption and the notice. */
export const NO_RUN_FLAG = "Run in a no-run zone";
/** And on its pictures: the stamp in the backfield of the field, the diagram and every printout. */
export const NO_RUN_STAMP = "RUN IN NO-RUN ZONE";

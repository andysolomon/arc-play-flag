import { inNoRunZone, losOf } from "./field";
import { isPitch, isRun } from "./routes";
import type { BallStep, Player, Team } from "./types";

export type Call = "run" | "pass" | "play-action" | "option";

/**
 * What the play is, read off the routes with the playback's rules but without its coin
 * flips: a primary runner (or nobody to throw to) is a run, a pitch beside a pass is an
 * option (the runner can throw or keep it), any other runner beside a pass is
 * play-action, and everything else is a pass. Null when nobody has a route.
 */
export function callOf(players: readonly Player[], ballPlan?: readonly BallStep[]): Call | null {
  if (ballPlan?.length) return ballPlan.at(-1)?.type === "pass" ? "pass" : "run";
  const offense = players.filter((p) => p.team === "offense" && p.route);
  if (!offense.length) return null;
  const runners = offense.filter((p) => p.route && isRun(p.route.type));
  const receivers = offense.filter((p) => p.route && !isRun(p.route.type) && p.label !== "QB");
  const primary = offense.find((p) => p.route?.primary);
  const primaryRun = primary?.route ? isRun(primary.route.type) : false;
  if (runners.length && (primaryRun || receivers.length === 0)) return "run";
  if (!receivers.length) return null;
  if (runners.some((p) => p.route && isPitch(p.route.type))) return "option";
  return runners.length ? "play-action" : "pass";
}

export const CALL_LABEL: Record<Call, string> = { run: "Run", pass: "Pass", "play-action": "Play-action", option: "Option" };

/**
 * A run called with the ball in a no-run zone, which a league with the zones flags: the play
 * is offensive, the ball sits in a zone and its call is a run. A handoff or pitch that ends in
 * a throw (play-action, option) is a pass and stays legal. Every surface that warns about it
 * asks this one rule, so the palette, the field, the play card and every printout agree.
 *
 * Ways it could go wrong, written down before the rule:
 * - N1 a league without no-run zones is flagged: `noRunZones` is asked first.
 * - N2 play-action or an option is flagged, though the ball is thrown: only a "run" call is.
 * - N3 a defensive call is flagged for its shadow offense, the other team's play: only an offensive play is.
 * - N4 a play with no spot of its own, or one from before the choices were cut to four, is read
 *   somewhere other than the field draws it: the spot goes through `losOf`, as the field's does.
 * - N5 the flag goes stale after the ball, a route, the primary read or the league's rule
 *   changes: nothing stores it, every surface asks again from the play as it is.
 */
export function runInNoRunZone(play: { side: Team; players: readonly Player[]; los?: number; ballPlan?: readonly BallStep[] }, noRunZones: boolean): boolean {
  return noRunZones && play.side === "offense" && inNoRunZone(losOf(play)) && callOf(play.players, play.ballPlan) === "run";
}

/** What a flagged play is called in words, on the play card, the field's caption and the notice. */
export const NO_RUN_FLAG = "Run in a no-run zone";
/** And on its pictures: the stamp in the backfield of the field, the diagram and every printout. */
export const NO_RUN_STAMP = "RUN IN NO-RUN ZONE";

import { isRun } from "./routes";
import type { Player } from "./types";

export type Call = "run" | "pass" | "play-action";

/**
 * What the play is, read off the routes with the playback's rules but without its coin
 * flips: a primary runner (or nobody to throw to) is a run, a runner beside a pass is
 * play-action, and everything else is a pass. Null when nobody has a route.
 */
export function callOf(players: readonly Player[]): Call | null {
  const offense = players.filter((p) => p.team === "offense" && p.route);
  if (!offense.length) return null;
  const runners = offense.filter((p) => p.route && isRun(p.route.type));
  const receivers = offense.filter((p) => p.route && !isRun(p.route.type) && p.label !== "QB");
  const primary = offense.find((p) => p.route?.primary);
  const primaryRun = primary?.route ? isRun(primary.route.type) : false;
  if (runners.length && (primaryRun || receivers.length === 0)) return "run";
  if (!receivers.length) return null;
  return runners.length ? "play-action" : "pass";
}

export const CALL_LABEL: Record<Call, string> = { run: "Run", pass: "Pass", "play-action": "Play-action" };

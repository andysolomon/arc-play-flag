import { END_ZONE_YARDS, GOAL_YARD, LOS_YARD } from "./field";
import { ballAt, positionsAt, type Motion } from "./motion";
import type { Player } from "./types";

/** How finely the carry after the catch is followed: one frame at 60 fps. */
const STEP = 1 / 60;
/** Halvings that pin a carried-in ball's crossing well inside a frame at any refresh rate. */
const BISECT = 20;

/**
 * When a touchdown pass is scored in this playback: the first moment the ball, caught on a pass,
 * is on or past their goal line, whether the receiver caught it in the end zone or carried it in
 * after the catch before the play ends. `los` is the yard line the play's ball is on (see
 * lib/play/field.ts), so the goal line lies `GOAL_YARD - los` yards ahead of it and the end line
 * ten yards beyond that. Null for a run, a play with no throw, a completion that stays short of
 * the goal line, or a catch out the back of the end zone (a route drawn deep from the 5 runs past
 * the end line once the ball is spotted nearer their goal). A carried-in ball's crossing is found
 * to well within a frame, so the celebration starts on the first frame that shows the ball over.
 */
export function touchdownAt(m: Motion, players: readonly Player[], los = LOS_YARD): number | null {
  if (m.kind !== "pass" || m.receiver === null || !Number.isFinite(m.catchAt) || m.catchAt >= m.dur) return null;
  const goal = los - GOAL_YARD;
  const ballY = (t: number): number => ballAt(m, positionsAt(m, players, t), t)?.y ?? Infinity;
  if (ballY(m.catchAt) < goal - END_ZONE_YARDS) return null;
  let short = m.catchAt;
  for (let t = m.catchAt; t < m.dur; t += STEP) {
    if (ballY(t) > goal) {
      short = t;
      continue;
    }
    if (t === m.catchAt) return t;
    let over = t;
    for (let i = 0; i < BISECT; i++) {
      const mid = (short + over) / 2;
      if (ballY(mid) <= goal) over = mid;
      else short = mid;
    }
    return over;
  }
  return null;
}

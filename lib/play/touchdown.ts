import { GOAL_YARD, LOS_YARD } from "./field";
import { ballAt, positionsAt, type Motion } from "./motion";
import type { Player } from "./types";

/** How finely the carry after the catch is followed: one frame at 60 fps. */
const STEP = 1 / 60;

/**
 * When a touchdown pass is scored in this playback: the first moment the ball, caught on a pass,
 * is on or past their goal line, whether the receiver caught it in the end zone or carried it in
 * after the catch before the play ends. `los` is the yard line the play's ball is on (see
 * lib/play/field.ts), so the goal line lies `GOAL_YARD - los` yards ahead of it. Null for a run,
 * a play with no throw, or a completion that stays short of the goal line. Follows the ball
 * exactly as ballAt draws it, so the celebration starts on the frame the coach sees the ball cross.
 */
export function touchdownAt(m: Motion, players: readonly Player[], los = LOS_YARD): number | null {
  if (m.kind !== "pass" || m.receiver === null || !Number.isFinite(m.catchAt) || m.catchAt >= m.dur) return null;
  const goal = los - GOAL_YARD;
  for (let t = m.catchAt; t < m.dur; t += STEP) {
    const ball = ballAt(m, positionsAt(m, players, t), t);
    if (ball && ball.y <= goal) return t;
  }
  return null;
}

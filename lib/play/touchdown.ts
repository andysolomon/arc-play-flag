import { GOAL_LINE } from "./geometry";
import { ballAt, positionsAt, type Motion } from "./motion";
import type { Player } from "./types";

/** How finely the carry after the catch is followed: one frame at 60 fps. */
const STEP = 1 / 60;

/**
 * When a touchdown pass is scored in this playback: the first moment the ball, caught on a pass,
 * is on or past the goal line, whether the receiver caught it in the end zone or carried it in
 * after the catch before the play ends. Null for a run, a play with no throw, or a completion
 * that stays short of the goal line. Follows the ball exactly as ballAt draws it, so the
 * celebration starts on the frame the coach sees the ball cross.
 */
export function touchdownAt(m: Motion, players: readonly Player[], goal = GOAL_LINE): number | null {
  if (m.kind !== "pass" || m.receiver === null || !Number.isFinite(m.catchAt) || m.catchAt >= m.dur) return null;
  for (let t = m.catchAt; t < m.dur; t += STEP) {
    const ball = ballAt(m, positionsAt(m, players, t), t);
    if (ball && ball.y <= goal) return t;
  }
  return null;
}

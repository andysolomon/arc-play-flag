/**
 * Where the ball sits on the field. Yards count from the offense's own goal line: the
 * field is 40 yards goal line to goal line, midfield is the 20, their goal line the 40,
 * and a 10-yard end zone runs to the end line at the 50. Every drive starts on the own
 * goal line. A coach reads a spot the other way, as the yards left to their end zone:
 * the ball on the 30 is "from the 10".
 */

/** Where every drive starts, and where a play with no spot of its own is drawn: the own goal line. */
export const LOS_YARD = 0;
/** Midfield: the field is 40 yards goal line to goal line. */
export const MIDFIELD_YARD = 20;
/** Their goal line. */
export const GOAL_YARD = 40;
/** Goal line to end line. */
export const END_ZONE_YARDS = 10;
/** The no-run zones: the 5 yards before midfield and before the goal line. */
export const NO_RUN_YARDS = 5;
/** The spots a coach can put the ball on: from the 40 (the own goal line), the 20, the 10 and the 5. */
export const LOS_CHOICES: readonly number[] = [LOS_YARD, MIDFIELD_YARD, GOAL_YARD - 10, GOAL_YARD - 5];

/** The yards from a spot to their goal line: the own goal line is the 40, their 5 the 5. */
export const toGo = (los: number): number => GOAL_YARD - los;

/**
 * A stored ball spot as one of LOS_CHOICES: anything that isn't a number is the own goal line,
 * and any other yard line (a play spotted before the choices were cut to four) goes to the
 * nearest one, a tie to the one nearer their goal.
 */
export function readLos(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return LOS_YARD;
  return LOS_CHOICES.reduce((best, c) => (Math.abs(c - v) <= Math.abs(best - v) ? c : best));
}

/** The yard line a play, draft or link puts the ball on: the own goal line unless it says otherwise. */
export const losOf = (x: { los?: number }): number => readLos(x.los);

/**
 * The record with its spot appended last, and only when it isn't the own goal line, so a
 * record without a spot reads, writes and compares the same.
 */
export function withLos<T extends object>(rec: T, los: number): Omit<T, "los"> & { los?: number } {
  const out = { ...rec } as Record<string, unknown>;
  delete out.los;
  const spot = readLos(los);
  if (spot !== LOS_YARD) out.los = spot;
  return out as Omit<T, "los"> & { los?: number };
}

/** The ball is spotted in a no-run zone: the 15 up to midfield, or the 35 and in. */
export const inNoRunZone = (los: number): boolean =>
  (los >= MIDFIELD_YARD - NO_RUN_YARDS && los < MIDFIELD_YARD) || los >= GOAL_YARD - NO_RUN_YARDS;

/** The field's LOS label, in yards to go: "LOS" from the 40, where every drive starts, otherwise "LOS 10". */
export const losLabel = (los: number): string => (los === LOS_YARD ? "LOS" : `LOS ${String(toGo(los))}`);

/** The picker's words for a spot: "From the 40 · drive start", "From the 20 · midfield", "From the 10". */
export function losChoice(los: number): string {
  const n = `From the ${String(toGo(los))}`;
  if (los === LOS_YARD) return `${n} · drive start`;
  if (los === MIDFIELD_YARD) return `${n} · midfield`;
  return n;
}

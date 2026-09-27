/**
 * Where the ball sits on the field. Yards count from the offense's own goal line: the
 * field is 40 yards goal line to goal line, midfield is the 20, their goal line the 40,
 * and a 10-yard end zone runs to the end line at the 50. Every drive starts on the 5.
 */

/** Where every drive starts, and where a play with no spot of its own is drawn: the own 5. */
export const LOS_YARD = 5;
/** Midfield: the field is 40 yards goal line to goal line. */
export const MIDFIELD_YARD = 20;
/** Their goal line. */
export const GOAL_YARD = 40;
/** Goal line to end line. */
export const END_ZONE_YARDS = 10;
/** The no-run zones: the 5 yards before midfield and before the goal line. */
export const NO_RUN_YARDS = 5;
/** The spots a coach can put the ball on: the own 5 to their 1, in whole yards. */
export const LOS_MIN = LOS_YARD;
export const LOS_MAX = GOAL_YARD - 1;
export const LOS_CHOICES: readonly number[] = Array.from({ length: LOS_MAX - LOS_MIN + 1 }, (_, i) => LOS_MIN + i);

/** A stored ball spot as a whole yard LOS_MIN..LOS_MAX; anything that isn't a number is the 5. */
export function readLos(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return LOS_YARD;
  return Math.max(LOS_MIN, Math.min(LOS_MAX, Math.round(v)));
}

/** The yard line a play, draft or link puts the ball on: the 5 unless it says otherwise. */
export const losOf = (x: { los?: number }): number => readLos(x.los);

/**
 * The record with its spot appended last, and only when it isn't the 5, so a record from
 * before plays had a spot reads, writes and compares exactly as it did.
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

/** The field's LOS label: "LOS" on the 5, exactly as it always read, otherwise "LOS 30". */
export const losLabel = (los: number): string => (los === LOS_YARD ? "LOS" : `LOS ${String(los)}`);

/** The picker's words for a spot: "The 5 · drive start", "The 12", "The 20 · midfield", "The 30 · their 10". */
export function losChoice(los: number): string {
  const n = `The ${String(los)}`;
  if (los === LOS_YARD) return `${n} · drive start`;
  if (los === MIDFIELD_YARD) return `${n} · midfield`;
  if (los > MIDFIELD_YARD) return `${n} · their ${String(GOAL_YARD - los)}`;
  return n;
}

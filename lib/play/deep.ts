import type { Route } from "./types";

/**
 * How a deep zone is called. With nothing stored (Auto, and every play from before the choice) the
 * deep zones split the field among themselves by count, the shell reading as cover 1, 2 or 3. Called
 * as a deep half or a deep third, the defender owns the half or third of the field nearest them,
 * however many others play deep (lib/play/zones.ts, D1–D6). Stored as `split` on the route only when
 * called, so a play from before the choice reads and writes the same.
 */
export type DeepSplit = "half" | "third";

/** The split a deep zone is called with; null for Auto and for anything that is not a deep zone. */
export function deepSplit(route: Route | null | undefined): DeepSplit | null {
  if (route?.type !== "zoneDeep") return null;
  return route.split === "half" || route.split === "third" ? route.split : null;
}

/** A deep zone called Auto (nothing stored), as a half or as a third. */
export function splitDeep(split: DeepSplit | null): Route {
  return split ? { type: "zoneDeep", split } : { type: "zoneDeep" };
}

/** The deep zone's name, as the slides, wristbands and printouts say it. */
export const DEEP_NAME: Record<DeepSplit, string> = { half: "Deep half", third: "Deep third" };

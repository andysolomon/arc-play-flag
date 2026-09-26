import { DEF, INK } from "@/lib/play/routes";
import type { Team } from "@/lib/play/types";

/**
 * The live field paints through the --field-* tokens in app/globals.css, so the "Themed field"
 * option can repaint it with no re-render. The tokens default to the standard green field's
 * colours, the same literals lib/render/play-svg.ts writes into exports, which never read them.
 * Each is an inline style over the element's own literal attribute: presentation attributes
 * don't resolve var(), and the attribute keeps the standard colour in the DOM for anything that
 * reads the diagram's markup.
 */
const NAMED: Readonly<Record<string, string>> = {
  [INK.route]: "route",
  [INK.primary]: "primary",
  [INK.deep]: "deep",
  [INK.flat]: "flat",
  [INK.curl]: "curl",
  [INK.mid]: "mid",
  [INK.blitz]: "blitz",
  [DEF]: "cover",
};

/** A route ink from lib/play/routes.ts, as the live field paints it. */
export const fieldInk = (hex: string): string => {
  const name = NAMED[hex];
  return name ? `var(--field-${name})` : hex;
};

/** A zone bubble: its route's ink at the 18% the exports use (the "2e" alpha on the ink). */
export const zoneFill = (hex: string): string => `color-mix(in srgb, ${fieldInk(hex)} 18%, transparent)`;

export const teamPaint = (team: Team): string => (team === "offense" ? "var(--field-offense)" : "var(--field-defense)");

export const FIELD = {
  turf: "var(--field-turf)",
  endzone: "var(--field-endzone)",
  /** yard lines, hatching, yard numbers, the draft route */
  line: "var(--field-line)",
  /** the ring round each player and waypoint */
  outline: "var(--field-outline)",
  /** a player's letters, on their team colour */
  label: "var(--field-label)",
  waypoint: "var(--field-waypoint)",
  /** selection and keyboard-focus rings */
  ring: "var(--field-ring)",
} as const;

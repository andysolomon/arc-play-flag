import { useId } from "react";
import type { TeamSettings } from "@/lib/play/types";

/**
 * What every end zone design is given. It draws into the box (0, 0)–(w, h) in SVG units and
 * nowhere else; its caller clips it there. The live field passes the full 660 wide and the
 * visible depth of the end zone: 11 to 220 in half-yard (11-unit) steps, 44 at most with the ball
 * on the 5 and up to the whole 10-yard end zone (220) with it spotted near their goal, or a sliver
 * when the field is cut short. A picker swatch passes a 300 × 84 preview box, lettering on. With
 * every animation off (reduced motion, the picker's previews) the design must still look finished.
 */
export interface ArtProps {
  w: number;
  h: number;
  /** draw the design's own END ZONE lettering; the field asks when the band is taller than 30 */
  label: boolean;
  /** a touchdown was just scored into this end zone: the design's own celebration, about three seconds */
  celebrate: boolean;
  /** the coach's team, for the designs that wear it */
  team: TeamSettings;
}

/** A prefix for a design's <defs> ids that is unique on the page: the field and every swatch draw the same design at once. */
export function useArtId(name: string): string {
  return `ez-${name}-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  const n = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? "000000";
  const [r = 0, g = 0, b = 0] = [0, 2, 4]
    .map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** Ink or cream, whichever reads better on `fill`. */
export const inkOn = (fill: string): string => (contrast(fill, "#1b1a17") >= contrast(fill, "#fffdf6") ? "#1b1a17" : "#fffdf6");

/** A number for SVG markup, to two places: short, and the same on the server and in the browser. */
export const num = (n: number): string => String(Math.round(n * 100) / 100);
export const px = (n: number): string => `${num(n)}px`;
export const secs = (n: number): string => `${num(n)}s`;

/** A fixed pseudo-random number in [0, 1) for motif `i`: the same on the server and in the browser. */
export function rand(i: number, salt: number): number {
  let x = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** A four-point sparkle's outline, `r` to each point and `waist` between them. */
export function sparkle(x: number, y: number, r: number, waist: number): string {
  const t = r * waist;
  return `M${num(x)} ${num(y - r)}L${num(x + t)} ${num(y - t)}L${num(x + r)} ${num(y)}L${num(x + t)} ${num(y + t)}L${num(x)} ${num(y + r)}L${num(x - t)} ${num(y + t)}L${num(x - r)} ${num(y)}L${num(x - t)} ${num(y - t)}Z`;
}

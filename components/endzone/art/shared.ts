import { useId } from "react";
import type { TeamSettings } from "@/lib/play/types";

/**
 * What every end zone design is given. It draws into the box (0, 0)–(w, h) in SVG units and
 * nowhere else; its caller clips it there. The live field passes the full 660 wide and the
 * visible depth of the end zone: 11 to 220 in half-yard (11-unit) steps, up to the whole 10-yard
 * end zone (220) with the ball spotted near their goal, or a sliver when the field is cut short
 * (from the 40 the end zone is past the deepest card and is not drawn). A picker swatch passes a 300 × 84 preview box, lettering on. With
 * every animation off (reduced motion, the picker's previews) the design must still look finished.
 *
 * A design never spells out END ZONE: the band past the goal line is already the end zone, and
 * the design says so. What it letters, when there is room and the coach has given the team a
 * name, is that name, in its own hand; without a name it draws nothing but the design. The group
 * that carries the name is marked `data-ez-name` with the text as drawn, so a test can find it.
 */
export interface ArtProps {
  w: number;
  h: number;
  /** there is room for lettering; the field asks when the band is taller than 30 */
  label: boolean;
  /** a touchdown was just scored into this end zone: the design's own celebration, about three seconds */
  celebrate: boolean;
  /** the coach's team, for the designs that wear its colour */
  team: TeamSettings;
  /** the team's name as the designs letter it (trimmed, one space between words, in capitals), or "" when the coach hasn't given one */
  name: string;
}

/** The team's name as a design letters it: trimmed, one space between words, in capitals. */
export const letteringName = (team: TeamSettings): string => team.name.trim().replace(/\s+/g, " ").toUpperCase();

/** Patrick Hand's capitals stand this much of an em above the baseline. */
export const CAP = 0.68;

/** Patrick Hand's capitals, digits and space, and each one's advance in hundredths of an em, to measure a name before it is drawn */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
const ADVANCE = [49, 51, 55, 48, 44, 38, 48, 47, 24, 37, 52, 37, 60, 53, 56, 48, 66, 45, 46, 47, 55, 56, 62, 60, 44, 51, 45, 36, 47, 45, 38, 42, 40, 50, 43, 37, 23];
// anything else is taken as wide (a whole em past Latin, where a fallback font draws it), so a name is never underestimated
const advance = (c: string): number => ADVANCE[GLYPHS.indexOf(c)] ?? (c > "ɏ" ? 100 : 60);
/** How many ems `text` runs to in Patrick Hand, letter spacing aside. */
export const ems = (text: string): number => Array.from(text).reduce((sum, c) => sum + advance(c) / 100, 0);

export interface Fit {
  fs: number;
  spacing: number;
  /** the lettering's width as laid out, first letter to last */
  width: number;
  /** condensed to `width` with textLength: the name is too long even at its smallest size */
  squeeze: boolean;
}

/**
 * Sizes a name into `room` in Patrick Hand: a long one gets smaller (to 62% of `size`), then
 * condensed; a short one is spaced out towards `span`, as end zone lettering is.
 */
export function fitText(text: string, size: number, room: number, span: number): Fit {
  const [n, em] = [Array.from(text).length, ems(text)];
  const fs = Math.max(size * 0.62, Math.min(size, room / (em + (n - 1) * 0.05)));
  const spacing = Math.max(fs * 0.05, Math.min(fs * 0.45, (Math.min(span, room) - em * fs) / n));
  const width = em * fs + (n - 1) * spacing;
  return width > room ? { fs, spacing: 0, width: room, squeeze: true } : { fs, spacing, width, squeeze: false };
}

/**
 * The attributes that set a fitted text: its size and spacing, and textLength when it must be
 * condensed. Letter spacing trails the last letter too, so a middle-anchored text is drawn at
 * x + spacing / 2 to keep the letters centred.
 */
export const fitAttrs = (fit: Fit) =>
  ({
    fontFamily: "var(--font-hand)", fontSize: num(fit.fs), letterSpacing: num(fit.spacing),
    ...(fit.squeeze ? { textLength: num(fit.width), lengthAdjust: "spacingAndGlyphs" } : {}),
  }) as const;

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

import { FONT, INK, TURF, YELLOW, esc, playArt, type ArtOptions } from "@/lib/render/play-svg";
import type { Player } from "@/lib/play/types";

/**
 * Printed pages are composed as SVG in points (1/72 in) and rasterised whole, so every
 * export shares one drawing path and the same hand-drawn face.
 */
export interface SvgPage {
  /** points */
  w: number;
  h: number;
  svg: string;
}

export type PaperKey = "letter" | "a4";
export interface Paper { key: PaperKey; label: string; w: number; h: number }
export const PAPERS: Record<PaperKey, Paper> = {
  letter: { key: "letter", label: "Letter", w: 612, h: 792 },
  a4: { key: "a4", label: "A4", w: 595.28, h: 841.89 },
};

/** Letter for the US and its neighbours, A4 for everyone else. */
export function defaultPaper(locale = typeof navigator === "undefined" ? "en-US" : navigator.language): PaperKey {
  const region = /[-_]([A-Za-z]{2})\b/.exec(locale)?.[1]?.toUpperCase();
  return region && ["US", "CA", "MX", "PH"].includes(region) ? "letter" : "a4";
}

export const IN = 72;
export const MUTED = "#6f6c66";
export const PAPER = "#fffdf6";
export const APP_MARK = "Flag Football Play Designer · arc-play-flag.vercel.app";

export const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

export function page(w: number, h: number, body: string): SvgPage {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f2(w)} ${f2(h)}" width="${f2(w)}" height="${f2(h)}"` +
    ` font-family="${FONT}" fill="${INK}"><rect width="${f2(w)}" height="${f2(h)}" fill="#ffffff"/>${body}</svg>`;
  return { w, h, svg };
}

/** A filled rectangle in points: colour bands, rules and writing lines. */
export function rect(x: number, y: number, w: number, h: number, fill: string): string {
  return `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${fill}"/>`;
}

export interface TextOpts {
  anchor?: "start" | "middle" | "end";
  fill?: string;
  opacity?: number;
  weightHack?: boolean;
}

export function text(x: number, y: number, size: number, s: string, o: TextOpts = {}): string {
  return (
    `<text x="${f2(x)}" y="${f2(y)}" font-size="${f2(size)}"` +
    (o.anchor ? ` text-anchor="${o.anchor}"` : "") +
    (o.fill ? ` fill="${o.fill}"` : "") +
    (o.opacity !== undefined ? ` opacity="${f2(o.opacity)}"` : "") +
    `>${esc(s)}</text>`
  );
}

let clipSeq = 0;

/** The play drawn into a box, letterboxed on turf inside a rounded ink border. */
export function field(players: readonly Player[], x: number, y: number, w: number, h: number, opts: ArtOptions = {}, border = 1.5): string {
  const art = playArt(players, { ...opts, box: { pw: w, ph: h } });
  const id = `c${String(++clipSeq)}`;
  const r = Math.min(6, w * 0.04);
  return (
    `<clipPath id="${id}"><rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" rx="${f2(r)}"/></clipPath>` +
    `<g clip-path="url(#${id})"><rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="${TURF}"/>` +
    `<svg x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" viewBox="${art.viewBox}" preserveAspectRatio="xMidYMid meet">${art.body}</svg></g>` +
    (border > 0
      ? `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" rx="${f2(r)}" fill="none" stroke="${INK}" stroke-width="${f2(border)}"/>`
      : "")
  );
}

/** A yellow disc with the play's number in it. */
export function badge(cx: number, cy: number, r: number, n: number): string {
  const size = n >= 100 ? r * 1.0 : n >= 10 ? r * 1.25 : r * 1.5;
  return (
    `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}" fill="${YELLOW}" stroke="${INK}" stroke-width="${f2(Math.max(0.6, r * 0.11))}"/>` +
    `<text x="${f2(cx)}" y="${f2(cy)}" font-size="${f2(size)}" text-anchor="middle" dominant-baseline="central">${String(n)}</text>`
  );
}

/** Faint dashed cut line around a card, for scissors. */
export function cutRect(x: number, y: number, w: number, h: number): string {
  return (
    `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${f2(h)}" fill="none" stroke="${INK}"` +
    ` stroke-width="0.5" stroke-dasharray="3 3" opacity="0.45"/>`
  );
}

export function cutLine(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${f2(x1)}" y1="${f2(y1)}" x2="${f2(x2)}" y2="${f2(y2)}" stroke="${INK}" stroke-width="0.5" stroke-dasharray="3 3" opacity="0.45"/>`;
}

export function appMark(x: number, y: number, size = 7, anchor: TextOpts["anchor"] = "end"): string {
  return text(x, y, size, APP_MARK, { anchor, fill: MUTED });
}

/** A one-word pill: "Run", "Pass", "Play-action". Returns the markup and its width. */
export function pill(x: number, y: number, size: number, label: string, width: number, fill = "#ffffff"): string {
  const h = size * 1.7;
  return (
    `<rect x="${f2(x)}" y="${f2(y - h / 2)}" width="${f2(width)}" height="${f2(h)}" rx="${f2(h / 2)}" fill="${fill}" stroke="${INK}" stroke-width="${f2(size * 0.09)}"/>` +
    `<text x="${f2(x + width / 2)}" y="${f2(y)}" font-size="${f2(size)}" text-anchor="middle" dominant-baseline="central">${esc(label)}</text>`
  );
}

export { INK, TURF, YELLOW, PAPER as CREAM };

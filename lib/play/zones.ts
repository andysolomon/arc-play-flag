import { deepSplit } from "./deep";
import type { Player, RouteType } from "./types";

export interface ZoneBubble {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
export type ZoneMap = Record<string, ZoneBubble>;

const cl = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * Zone bubbles are laid out as a set, not per player: deep zones split the field
 * into halves/thirds by how many are called, so the shell reads as cover 1/2/3.
 *
 * A deep zone can also be called as a deep half or a deep third (`split` on the route,
 * lib/play/deep.ts). Ways that could go wrong, written down before the code:
 * - D1 a deep zone with no split stored (every play from before the choice) must draw exactly as
 *   it did: with no half or third called, the auto zones split the whole field by count.
 * - D2 a half or third is never stored as a side: it takes the slice nearest the defender's spot,
 *   so Flip, a drag across the field and a share link all follow the player, with nothing to flip.
 * - D3 two defenders calling the same slice must not stack: left to right, each takes the slice
 *   nearest it that is still free, else the nearest at all, so three halves overlap but stay on the field.
 * - D4 halves and thirds mixed are each laid on their own grid, as called, even where they overlap.
 * - D5 auto zones beside a called one share what the called ones leave open: each takes the open
 *   stretch nearest it and the auto zones in a stretch split it. With nothing left open they split
 *   the whole field, as in D1, so every deep defender always draws a bubble.
 * - D6 every deep bubble sits at one depth, the shell's, however it was called.
 */
export function zoneLayout(players: readonly Player[], top: number): ZoneMap {
  const map: ZoneMap = {};
  const of = (t: RouteType): Player[] =>
    players.filter((p) => p.team === "defense" && p.route?.type === t).sort((a, b) => a.x - b.x);

  const deep = of("zoneDeep");
  if (deep.length) {
    const ry = 2.3;
    // anchored to a football depth: 4 yards behind the deepest zone defender,
    // never shallower than 12 yards, and only pulled in by the card as a fallback
    const deepest = deep.reduce((m, p) => Math.min(m, p.y), 0);
    const cy = cl(Math.min(-12, deepest - 4), top + ry + 0.6, -8);
    const bubble = (lo: number, hi: number): ZoneBubble => ({ cx: (lo + hi) / 2, cy, rx: Math.min((hi - lo) / 2 - 0.35, 7.4), ry });
    const taken: Span[] = [];
    for (const n of [2, 3] as const) {
      const called = deep.filter((p) => deepSplit(p.route) === (n === 2 ? "half" : "third"));
      slices(called.map((p) => p.x), n).forEach((i, k) => {
        const p = called[k];
        if (!p) return;
        const span: Span = [(i * FIELD) / n, ((i + 1) * FIELD) / n];
        taken.push(span);
        map[p.id] = bubble(...span);
      });
    }
    const auto = deep.filter((p) => !deepSplit(p.route));
    const open = gaps(taken);
    if (!open.length) open.push([0, FIELD]);
    // each auto zone to the open stretch nearest it (D5), then each stretch split among its own
    const home = auto.map((p) => nearest(open, p.x));
    open.forEach((span, s) => {
      const mine = auto.filter((_, k) => home[k] === s);
      const w = (span[1] - span[0]) / (mine.length || 1);
      mine.forEach((p, i) => { map[p.id] = bubble(span[0] + i * w, span[0] + (i + 1) * w); });
    });
  }

  const flat = of("zoneFlat");
  if (flat.length) {
    const rx = Math.min(4.6, 30 / (2 * flat.length) - 0.35), ry = 1.9;
    const lo = top + ry + 0.5;
    for (const p of flat) {
      const toward = p.x < 15 ? -1 : 1;
      map[p.id] = {
        cx: cl(p.x + toward * 2.6, 0.4 + rx, 29.6 - rx),
        cy: cl(p.y - 3.4, lo, -1.2 - ry * 0.2), rx, ry,
      };
    }
    // keep neighbouring flats from stacking on one another
    spread(map, flat, 0.6);
  }

  // curl-flat: intermediate and outside, one bubble per hook/curl defender
  const cf = of("curlFlat");
  if (cf.length) {
    const rx = Math.min(4.9, 30 / (2 * cf.length) - 0.3), ry = 2.1;
    const lo = top + ry + 0.5;
    for (const p of cf) {
      const toward = p.x < 15 ? -1 : 1;
      map[p.id] = {
        cx: cl(p.x + toward * 2.2, 0.4 + rx, 29.6 - rx),
        cy: cl(Math.min(p.y - 3.5, -6.5), lo, -4), rx, ry,
      };
    }
    spread(map, cf, 0.5);
  }

  // mid-read: middle of the field at intermediate depth, splitting the middle third
  const mid = of("midRead");
  if (mid.length) {
    const n = mid.length, span = Math.min(18, 6 + 6 * n), slice = span / n;
    const rx = Math.min(slice / 2 - 0.3, 5.4), ry = 2.1;
    const lo = top + ry + 0.5;
    mid.forEach((p, i) => {
      map[p.id] = {
        cx: 15 - span / 2 + (i + 0.5) * slice,
        cy: cl(Math.min(p.y - 3.5, -7.5), lo, -5), rx, ry,
      };
    });
  }

  for (const p of of("spy")) {
    map[p.id] = { cx: p.x, cy: cl(p.y + 2.4, top + 2.2, -1.4), rx: 2.1, ry: 1.9 };
  }
  return map;
}

function spread(map: ZoneMap, ordered: readonly Player[], overlap: number): void {
  for (let i = 1; i < ordered.length; i++) {
    const prev = ordered[i - 1], cur = ordered[i];
    if (!prev || !cur) continue;
    const a = map[prev.id], b = map[cur.id];
    if (!a || !b) continue;
    const need = a.rx + b.rx - overlap;
    if (b.cx - a.cx < need) b.cx = Math.min(29.6 - b.rx, a.cx + need);
  }
}

const FIELD = 30;
/** A stretch across the field, in yards from the left sideline. */
type Span = readonly [number, number];

/**
 * The slice of n each defender at xs (left to right) takes: the nearest one still free, else the
 * nearest at all (D3). Ties go to the left, so it never depends on storage order.
 */
function slices(xs: readonly number[], n: number): number[] {
  const free = new Set(Array.from({ length: n }, (_, i) => i));
  const mid = (i: number): number => ((i + 0.5) * FIELD) / n;
  const best = (x: number, from: Iterable<number>): number =>
    [...from].reduce((a, b) => (Math.abs(mid(b) - x) < Math.abs(mid(a) - x) ? b : a));
  return xs.map((x) => {
    const i = best(x, free.size ? free : Array.from({ length: n }, (_, k) => k));
    free.delete(i);
    return i;
  });
}

/** What the called slices leave open, left to right; slivers under 2 yards are no room for a zone. */
function gaps(taken: readonly Span[]): Span[] {
  const out: Span[] = [];
  let at = 0;
  for (const [lo, hi] of [...taken].sort((a, b) => a[0] - b[0])) {
    if (lo - at >= 2) out.push([at, lo]);
    at = Math.max(at, hi);
  }
  if (FIELD - at >= 2) out.push([at, FIELD]);
  return out;
}

/** The index of the stretch nearest x: the one it stands in, else the closest edge. */
function nearest(spans: readonly Span[], x: number): number {
  const away = (s: Span): number => (x < s[0] ? s[0] - x : x > s[1] ? x - s[1] : 0);
  return spans.reduce((b, s, i) => (away(s) < away(spans[b] ?? s) ? i : b), 0);
}

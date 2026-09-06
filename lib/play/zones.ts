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
 */
export function zoneLayout(players: readonly Player[], top: number): ZoneMap {
  const map: ZoneMap = {};
  const of = (t: RouteType): Player[] =>
    players.filter((p) => p.team === "defense" && p.route?.type === t).sort((a, b) => a.x - b.x);

  const deep = of("zoneDeep");
  if (deep.length) {
    const n = deep.length, slice = 30 / n;
    const rx = Math.min(slice / 2 - 0.35, 7.4), ry = 2.3;
    // anchored to a football depth: 4 yards behind the deepest zone defender,
    // never shallower than 12 yards, and only pulled in by the card as a fallback
    const deepest = deep.reduce((m, p) => Math.min(m, p.y), 0);
    const cy = cl(Math.min(-12, deepest - 4), top + ry + 0.6, -8);
    deep.forEach((p, i) => {
      map[p.id] = { cx: (i + 0.5) * slice, cy, rx, ry };
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

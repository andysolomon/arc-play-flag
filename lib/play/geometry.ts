import { DEF, ROUTES, inkFor, routeDef } from "./routes";
import type { Pair, Pane, Player, Pt, SnapMode, Team } from "./types";
import type { ZoneMap } from "./zones";

/** SVG units per yard and the field's viewBox width (30 yards). */
export const S = 22;
export const VW = 660;
export const FIELD_YARDS = 30;

export function px(x: number): number {
  return x * S;
}
export function py(y: number, top: number): number {
  return (y - top) * S;
}
/** Yard value at the top edge of the card (the deepest defensive depth shown). */
export function ybv(depthYards: number): number {
  return 8 - depthYards;
}

export function snap(v: number, mode: SnapMode = "half"): number {
  if (mode === "free") return v;
  return mode === "one" ? Math.round(v) : Math.round(v * 2) / 2;
}

/** The line of scrimmage is a hard boundary: offense stays at/below it, defense at/above. */
export function clamp(x: number, y: number, team: Team | null, top: number): Pt {
  const lo = top + 1.2;
  let y2 = Math.max(lo, Math.min(7.4, y));
  if (team === "offense") y2 = Math.max(0.9, y2);
  else if (team === "defense") y2 = Math.min(-0.9, y2);
  return { x: Math.max(1.2, Math.min(28.8, x)), y: y2 };
}

/**
 * Depth is derived on every read from the play plus the measured pane, never stored,
 * so it can never lag behind a route or position change.
 */
export function depth(players: readonly Player[], pane: Pane | null): number {
  const deepest = players.reduce((m, p) => Math.min(m, p.y), 8);
  const hasDeep = players.some((p) => p.route?.type === "zoneDeep");
  const need = hasDeep ? Math.min(deepest, Math.min(-12, deepest - 4) - 2.9) : deepest;
  const aspect = pane && pane.pw > 0 && pane.ph > 0 ? (pane.ph / pane.pw) * FIELD_YARDS : 45;
  const d = Math.max(aspect, 8 - need + 1.2);
  return Math.round(Math.max(24, Math.min(45, d)) * 2) / 2;
}

export function cardWidth(pane: Pane | null, depthYards: number): number | null {
  if (!pane || !(pane.pw > 0) || !(pane.ph > 0)) return null;
  return Math.min(pane.pw, (pane.ph * FIELD_YARDS) / depthYards, 1200);
}

export interface RouteGeom {
  color: string;
  d: string;
  width: number;
  dash: string;
  /** true when the path should play the draw-on animation */
  draw: boolean;
  arrow: string | null;
  bar: { x1: number; y1: number; x2: number; y2: number } | null;
  zone: { cx: number; cy: number; rx: number; ry: number; fill: string } | null;
}

const f1 = (n: number): string => n.toFixed(1);

/** Route geometry in SVG units for one player, or null when nothing should be drawn. */
export function geom(
  p: Player,
  players: readonly Player[],
  top: number,
  zones: ZoneMap,
): RouteGeom | null {
  const rt = p.route;
  if (!rt) return null;
  const def = routeDef(p.team, rt.type);
  if (!def) return null;
  const sign = (p.x < 15 ? -1 : 1) * (rt.mirror ? -1 : 1);
  const zone = def.end === "zone" ? zones[p.id] : undefined;

  if (zone) {
    const col0 = inkFor(p, rt.type);
    const ex = px(zone.cx), ey = py(zone.cy, top);
    const sx = px(p.x), sy = py(p.y, top);
    const L = Math.hypot(ex - sx, ey - sy) || 1;
    let t0 = Math.min(0.55, 27 / L);
    let t1 = 1 - Math.min(0.5, (zone.ry * S * 0.55) / L);
    if (t1 - t0 < 0.12) {
      t0 = Math.min(0.34, 27 / L);
      t1 = Math.max(t0 + 0.14, 0.9);
    }
    const d =
      "M" + f1(sx + (ex - sx) * t0) + " " + f1(sy + (ey - sy) * t0) +
      "L" + f1(sx + (ex - sx) * t1) + " " + f1(sy + (ey - sy) * t1);
    return {
      color: col0, d, width: 5, dash: def.dash ?? "900", draw: false, arrow: null, bar: null,
      zone: { cx: ex, cy: ey, rx: zone.rx * S, ry: zone.ry * S, fill: col0 + "2e" },
    };
  }

  let abs: Pair[];
  if (rt.type === "custom") {
    abs = [[p.x, p.y], ...(rt.pts ?? [])];
  } else if (rt.type === "blitz") {
    // drive past the line of scrimmage, angled at the quarterback
    const qb =
      players.find((q) => q.team === "offense" && q.label === "QB") ??
      players.find((q) => q.id === "o2");
    const tx = qb ? qb.x : 15, ty = qb ? qb.y : 5;
    const dx = tx - p.x, dy = ty - p.y, L = Math.hypot(dx, dy) || 1;
    const reach = Math.max(1.5, L - 1.8);
    abs = [[p.x, p.y], [p.x + (dx / L) * reach, p.y + (dy / L) * reach]];
  } else if (rt.type === "man") {
    const t = players.find((q) => q.id === rt.target);
    if (!t) return null;
    const dx = t.x - p.x, dy = t.y - p.y, L = Math.hypot(dx, dy) || 1;
    abs = [[p.x, p.y], [t.x - (dx / L) * 1.15, t.y - (dy / L) * 1.15]];
  } else {
    const defPts = def.pts ?? ROUTES.go.pts ?? [];
    // shrink the whole route uniformly so nothing — including a zone bubble — leaves the card
    const deep = top + 0.6;
    let k = 1;
    for (const q of defPts) {
      const m = 0.6;
      const dx = sign * q[0], dy = q[1];
      if (dx > 0.001) k = Math.min(k, (29.4 - m - p.x) / dx);
      if (dx < -0.001) k = Math.min(k, (p.x - 0.6 - m) / -dx);
      if (dy > 0.001) k = Math.min(k, (7.6 - m - p.y) / dy);
      if (dy < -0.001) k = Math.min(k, (p.y - deep - m) / -dy);
    }
    k = Math.max(0, Math.min(1, k));
    abs = defPts.map((q) => [p.x + sign * q[0] * k, p.y + q[1] * k] as const);
  }

  const pts: [number, number][] = [];
  for (const q of abs) {
    const X = px(q[0]), Y = py(q[1], top);
    const l = pts[pts.length - 1];
    if (!l || Math.abs(l[0] - X) > 1 || Math.abs(l[1] - Y) > 1) pts.push([X, Y]);
  }
  const a0 = pts[0], a1 = pts[1];
  if (!a0 || !a1) return null;

  const L0 = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1;
  const off = Math.min(rt.type === "man" ? 24 : 27, L0 * 0.42);
  pts[0] = [a0[0] + ((a1[0] - a0[0]) / L0) * off, a0[1] + ((a1[1] - a0[1]) / L0) * off];

  const b = pts[pts.length - 1], a = pts[pts.length - 2];
  if (!a || !b) return null;
  const out: RouteGeom = {
    color: inkFor(p, rt.type),
    d: "M" + pts.map((q) => f1(q[0]) + " " + f1(q[1])).join("L"),
    dash: def.dash ?? "900",
    draw: !def.dash,
    width: rt.primary ? 6.5 : 5,
    arrow: null, bar: null, zone: null,
  };
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const nx = (b[0] - a[0]) / L, ny = (b[1] - a[1]) / L;
  if (def.end === "arrow") {
    const s = 17, w = 9.5, bx = b[0] - nx * s, by = b[1] - ny * s;
    out.arrow =
      f1(b[0]) + "," + f1(b[1]) + " " +
      f1(bx - ny * w) + "," + f1(by + nx * w) + " " +
      f1(bx + ny * w) + "," + f1(by - nx * w);
  } else if (def.end === "bar") {
    out.bar = { x1: b[0] - ny * 17, y1: b[1] + nx * 17, x2: b[0] + ny * 17, y2: b[1] - nx * 17 };
  }
  return out;
}

export function draftPath(p: Player, pts: readonly Pair[], top: number): string {
  return "M" + [[p.x, p.y] as const, ...pts].map((q) => f1(px(q[0])) + " " + f1(py(q[1], top))).join("L");
}

export interface Band { y: number; h: number }
export interface YardLine { y: number; w: number; o: number }
export interface FieldText { key: string; x: number; y: number; t: string; letterSpacing?: number }
export interface FieldLayout {
  top: number;
  vh: number;
  viewBox: string;
  bands: Band[];
  endZone: Band | null;
  lines: YardLine[];
  texts: FieldText[];
}

/** Yard lines, hatched no-run bands, end zone and labels for a given depth. */
export function fieldLayout(depthYards: number, showYardNumbers = true): FieldLayout {
  const top = ybv(depthYards), vh = depthYards * S;
  const clipRect = (y1: number, y2: number): Band | null => {
    const a = Math.max(y1, top), b2 = Math.min(y2, 8);
    if (b2 - a <= 0.05) return null;
    return { y: py(a, top), h: (b2 - a) * S };
  };
  const bands = [clipRect(-20, -15), clipRect(-35, -30)].filter((b): b is Band => b !== null);
  const endZone = clipRect(-37, -35);
  const lines: YardLine[] = [];
  for (let y = 5; y >= -35; y -= 5) {
    if (y < top - 0.01 || y > 8) continue;
    lines.push({
      y: py(y, top),
      w: y === 0 ? 4.5 : y === -35 ? 3 : 1.6,
      o: y === 0 ? 1 : y === -35 ? 0.55 : 0.22,
    });
  }
  const texts: FieldText[] = [];
  if (showYardNumbers) {
    for (let y = 0; y >= -35; y -= 5) {
      if (y < top - 0.01) continue;
      const t = y === 0 ? "LOS" : String(-y);
      texts.push({ key: t + String(y), x: 12, y: py(y, top) - 7, t });
    }
    bands.forEach((b, i) => {
      if (b.h > 46) texts.push({ key: "norun" + String(i), x: 286, y: b.y + b.h / 2 + 6, t: "NO-RUN", letterSpacing: 1.5 });
    });
    if (endZone && endZone.h > 30) {
      texts.push({ key: "ez", x: 266, y: endZone.y + endZone.h / 2 + 6, t: "END ZONE", letterSpacing: 2.5 });
    }
  }
  return { top, vh, viewBox: `0 0 ${String(VW)} ${vh.toFixed(0)}`, bands, endZone, lines, texts };
}

export function teamFill(team: Team): string {
  return team === "offense" ? "#e5675e" : DEF;
}

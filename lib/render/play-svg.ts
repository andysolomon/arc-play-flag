import { S, VW, depth, fieldLayout, geom, px, py, routeYards, teamFill } from "@/lib/play/geometry";
import { routeDef } from "@/lib/play/routes";
import type { Level, Pane, Player, Pt } from "@/lib/play/types";
import { zoneLayout } from "@/lib/play/zones";

/**
 * The play as SVG markup, drawn from the same pure geometry as the live field but with
 * nothing interactive: thumbnails, cards and printed pages all come from here. Colours
 * are the design's; everything must still read on a mono printer, so the highlight is
 * weight plus a fade, never hue alone.
 */
export interface ArtOptions {
  /** Animated tokens over the original, stationary field and routes. */
  positions?: Record<string, Pt>;
  ball?: { x: number; y: number; lift: number } | null;
  /** Embedded sticker for standalone SVG images (external assets cannot load there). */
  footballHref?: string;
  level?: Level;
  /** an offensive player whose route is drawn bold while every other route fades */
  highlight?: string | null;
  showDefense?: boolean;
  showYardNumbers?: boolean;
  /**
   * The box the field will be fitted into: its aspect decides how much depth shows.
   * Null frames the play as tightly as the field allows (24 yards, deeper if the play needs it).
   */
  box?: Pane | null;
  /** the shallowest field to show; the live field uses 24, a wristband cell can go tighter */
  minDepth?: number;
}

export interface Art {
  viewBox: string;
  /** SVG units */
  width: number;
  height: number;
  body: string;
}

export const INK = "#1b1a17";
export const TURF = "#c1f0c1";
export const END_ZONE = "#a7e5a7";
export const YELLOW = "#f2b705";
export const FONT = "'Patrick Hand', 'Comic Sans MS', cursive";
const TIGHT: Pane = { pw: 1000, ph: 1 };

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (n: number): string => n.toFixed(1);

export function playArt(players: readonly Player[], opts: ArtOptions = {}): Art {
  const { level = "simple", highlight = null, showDefense = true, showYardNumbers = true, box = null, minDepth = 24 } = opts;
  const shown = showDefense ? players : players.filter((p) => p.team === "offense");
  const d = depth(shown, box ?? TIGHT, minDepth);
  const layout = fieldLayout(d, showYardNumbers);
  const top = layout.top;
  const zones = zoneLayout(players, top);
  const uid = "h" + Math.abs(hash(players.map((p) => p.id + f1(p.x) + f1(p.y)).join())).toString(36);
  const out: string[] = [];

  out.push(
    `<defs><pattern id="${uid}" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
    `<line x1="0" y1="0" x2="0" y2="11" stroke="${INK}" stroke-width="1.6" opacity="0.19"/></pattern></defs>`,
  );
  out.push(`<rect x="0" y="0" width="${String(VW)}" height="${f1(layout.vh)}" fill="${TURF}"/>`);
  if (layout.endZone) out.push(`<rect x="0" y="${f1(layout.endZone.y)}" width="${String(VW)}" height="${f1(layout.endZone.h)}" fill="${END_ZONE}"/>`);
  for (const b of layout.bands) out.push(`<rect x="0" y="${f1(b.y)}" width="${String(VW)}" height="${f1(b.h)}" fill="url(#${uid})"/>`);
  for (const l of layout.lines) {
    out.push(`<line x1="0" y1="${f1(l.y)}" x2="${String(VW)}" y2="${f1(l.y)}" stroke="${INK}" stroke-width="${String(l.w)}" opacity="${String(l.o)}"/>`);
  }
  if (layout.texts.length) {
    out.push(`<g font-size="17" fill="${INK}" fill-opacity="0.5">`);
    for (const t of layout.texts) {
      const ls = t.letterSpacing ? ` letter-spacing="${String(t.letterSpacing)}"` : "";
      out.push(`<text x="${String(t.x)}" y="${f1(t.y)}"${ls}>${esc(t.t)}</text>`);
    }
    out.push("</g>");
  }

  // routes: faded ones first so the highlighted route sits on top
  const routed = shown.flatMap((p) => { const g = geom(p, players, top, zones); return g ? [{ p, g }] : []; });
  const isHi = (p: Player): boolean => highlight === null || p.id === highlight;
  routed.sort((a, b) => Number(isHi(a.p)) - Number(isHi(b.p)));
  for (const { p, g } of routed) {
    const hi = isHi(p);
    const width = hi && highlight !== null ? g.width + 2 : g.width;
    out.push(hi ? "<g>" : `<g opacity="0.28">`);
    out.push(
      `<path d="${g.d}" fill="none" stroke="${g.color}" stroke-width="${String(width)}" stroke-linecap="round" stroke-linejoin="round"` +
      (g.dash !== "900" ? ` stroke-dasharray="${g.dash}"` : "") + "/>",
    );
    if (g.arrow) out.push(`<polygon points="${g.arrow}" fill="${g.color}" stroke="${g.color}" stroke-width="2.5" stroke-linejoin="round"/>`);
    if (g.zone) {
      out.push(
        `<ellipse cx="${f1(g.zone.cx)}" cy="${f1(g.zone.cy)}" rx="${f1(g.zone.rx)}" ry="${f1(g.zone.ry)}" fill="${g.zone.fill}"` +
        ` stroke="${g.color}" stroke-width="2.5" stroke-dasharray="9 7"/>`,
      );
    }
    if (level === "detailed" && hi) {
      const lbl = routeLabel(p, players, top, g.zone);
      if (lbl) {
        out.push(
          `<text x="${f1(lbl.x)}" y="${f1(lbl.y)}" font-size="15" fill="${g.color}" text-anchor="${lbl.anchor}" paint-order="stroke"` +
          ` stroke="${TURF}" stroke-width="4" stroke-linejoin="round">${esc(lbl.text)}</text>`,
        );
      }
    }
    out.push("</g>");
  }

  for (const p of shown) {
    const spot = opts.positions?.[p.id] ?? p;
    const x = px(spot.x), y = py(spot.y, top);
    out.push(`<g transform="translate(${f1(x)},${f1(y)})">`);
    if (highlight === p.id) out.push(`<circle r="33" fill="none" stroke="${YELLOW}" stroke-width="5"/>`);
    out.push(`<circle r="23" fill="${teamFill(p.team)}" stroke="${INK}" stroke-width="2.5"/>`);
    if (p.label) {
      out.push(
        `<text y="1" text-anchor="middle" dominant-baseline="central" font-size="${p.label.length > 2 ? "15" : "18"}" fill="${INK}">${esc(p.label)}</text>`,
      );
    }
    if (level === "detailed" && p.route?.primary && p.team === "offense") {
      out.push(`<text x="26" y="-22" font-size="26" fill="#c2261a" paint-order="stroke" stroke="${TURF}" stroke-width="4">★</text>`);
    }
    out.push("</g>");
  }

  if (opts.ball && opts.footballHref) {
    const b = opts.ball;
    out.push(`<image href="${esc(opts.footballHref)}" x="-16" y="-16" width="32" height="32" transform="translate(${f1(px(b.x))},${f1(py(b.y, top) - b.lift * 16)}) scale(${(1 + b.lift * 0.6).toFixed(2)})"/>`);
  }

  return { viewBox: layout.viewBox, width: VW, height: layout.vh, body: out.join("") };
}

interface Label { x: number; y: number; text: string; anchor: "start" | "middle" | "end" }

/** Where a route's name goes: beside the last leg, pushed towards the nearest sideline, or in the zone bubble. */
function routeLabel(
  p: Player, players: readonly Player[], top: number,
  zone: { cx: number; cy: number; ry: number } | null,
): Label | null {
  const rt = p.route;
  if (!rt || rt.type === "custom") return null;
  const def = routeDef(p.team, rt.type);
  if (!def) return null;
  if (zone) return { x: zone.cx, y: zone.cy + zone.ry - 8, text: def.label, anchor: "middle" };
  const abs = routeYards(p, players, top);
  if (!abs || abs.length < 2) return null;
  const a = abs[abs.length - 2], b = abs[abs.length - 1];
  if (!a || !b) return null;
  const ax = px(a[0]), ay = py(a[1], top), bx = px(b[0]), by = py(b[1], top);
  const mx = (ax + bx) / 2, my = (ay + by) / 2;
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
  let nx = -dy / L, ny = dx / L;
  // towards the nearer sideline for a vertical leg, upwards for a flat one
  if (Math.abs(nx) >= Math.abs(ny)) { if ((mx < VW / 2) !== (nx < 0)) { nx = -nx; ny = -ny; } }
  else if (ny > 0) { nx = -nx; ny = -ny; }
  const x = mx + nx * 16, y = my + ny * 16 + 5;
  const anchor: Label["anchor"] = Math.abs(nx) < 0.3 ? "middle" : nx < 0 ? "end" : "start";
  return { x: Math.max(30, Math.min(VW - 30, x)), y: Math.max(16, y), text: def.label, anchor };
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/** A complete standalone SVG document for the play, `width` units wide with the font named. */
export function playSvg(players: readonly Player[], opts: ArtOptions = {}): string {
  const a = playArt(players, opts);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${a.viewBox}" width="${String(a.width)}" height="${f1(a.height)}"` +
    ` font-family="${FONT}">${a.body}</svg>`
  );
}

/** Yards of depth the art shows, for callers sizing a box around it. */
export function artDepth(players: readonly Player[], box: Pane | null, showDefense = true, minDepth = 24): number {
  const shown = showDefense ? players : players.filter((p) => p.team === "offense");
  return depth(shown, box ?? TIGHT, minDepth);
}

export { S };

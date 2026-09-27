import { COVERAGE_TAG, coverageOf } from "@/lib/play/coverage";
import { S, VW, depth, fieldLayout, geom, px, py, routeYards, teamFill } from "@/lib/play/geometry";
import { STAMP_FONT, STAMP_SPACING, TAG_FONT, manTags, stampBox, tagged } from "@/lib/play/marks";
import { INK as ROUTE_INK, routeDef } from "@/lib/play/routes";
import type { Level, Pane, Player, Pt, Team, Vis } from "@/lib/play/types";
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
  /** which team is drawn; routes are still laid out against the whole play, as on the live field */
  show?: Vis;
  showYardNumbers?: boolean;
  /** the hatched no-run bands; off for a team whose league plays without them */
  noRunZones?: boolean;
  /**
   * The box the field will be fitted into: its aspect decides how much depth shows.
   * Null frames the play as tightly as the field allows (24 yards, deeper if the play needs it).
   */
  box?: Pane | null;
  /** the shallowest field to show; the live field uses 24, a wristband cell can go tighter */
  minDepth?: number;
  /**
   * The play's own side. With `show` "both", the other team is drawn beneath it at the live
   * shadow's fade and can't be highlighted; a defensive call also gets its coverage stamp.
   * Unset, "both" draws everyone alike.
   */
  side?: Team;
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
/** the other team, when a play includes it: the same fade as the live field's shadow */
export const SHADOW_OPACITY = 0.4;
const PAPER_TEXT = "#fffdf6";
const TIGHT: Pane = { pw: 1000, ph: 1 };

const visible = (players: readonly Player[], show: Vis): readonly Player[] =>
  show === "both" ? players : players.filter((p) => p.team === show);

export const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (n: number): string => n.toFixed(1);
const fade = (o: number): string => (o === 1 ? "" : ` opacity="${String(Number(o.toFixed(3)))}"`);

export function playArt(players: readonly Player[], opts: ArtOptions = {}): Art {
  const { level = "simple", highlight = null, show = "both", showYardNumbers = true, noRunZones = true, box = null, minDepth = 24, side } = opts;
  const shown = visible(players, show);
  const d = depth(shown, box ?? TIGHT, minDepth);
  const layout = fieldLayout(d, showYardNumbers, noRunZones);
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

  const drawn = new Set(shown.map((p) => p.id));
  // the other team, when the play includes it: beneath the play's own side, and never highlighted
  const context = (p: Player): boolean => side !== undefined && show === "both" && p.team !== side;
  const isHi = (p: Player): boolean => highlight === null || (p.id === highlight && !context(p));
  const opacity = (p: Player): number => (context(p) ? SHADOW_OPACITY : 1) * (isHi(p) ? 1 : 0.28);
  // like a Madden card: a defensive call is stamped with its coverage in the empty backfield
  const cover = side === "defense" ? coverageOf(players) : null;
  const stamp = cover ? stampBox(COVERAGE_TAG[cover], shown, top, layout.vh) : null;
  // a man defender whose receiver isn't drawn wears a name tag, never an arrow to nobody;
  // none while the players move, since the tags would stay behind
  const tags = opts.positions ? [] : manTags(shown, players, top, layout.vh, zones, stamp ? [stamp] : []);

  // under the routes, so it never hides the end of one
  if (cover && stamp) {
    out.push(
      `<g data-coverage="${cover}" aria-hidden="true"><rect x="${f1(stamp.x)}" y="${f1(stamp.y)}" width="${f1(stamp.w)}" height="${f1(stamp.h)}" rx="6" fill="${INK}"/>` +
      `<text x="${f1(stamp.x + stamp.w / 2)}" y="${f1(stamp.y + stamp.h / 2 + 1)}" text-anchor="middle" dominant-baseline="central"` +
      ` font-size="${String(STAMP_FONT)}" letter-spacing="${String(STAMP_SPACING)}" fill="${PAPER_TEXT}">${esc(COVERAGE_TAG[cover])}</text></g>`,
    );
  }

  // routes: the other team's first, then faded ones, so the highlighted route sits on top
  const routed = shown.flatMap((p) => {
    if (tagged(p, drawn)) return [];
    const g = geom(p, players, top, zones);
    return g ? [{ p, g }] : [];
  });
  routed.sort((a, b) => Number(!context(a.p)) - Number(!context(b.p)) || Number(isHi(a.p)) - Number(isHi(b.p)));
  for (const { p, g } of routed) {
    const hi = isHi(p);
    const width = hi && highlight !== null ? g.width + 2 : g.width;
    out.push(`<g${fade(opacity(p))}>`);
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
    if (level === "detailed" && hi && !context(p)) {
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

  // tucked under each defender's ring (and a highlight round it), and faded with them under a highlight
  for (const t of tags) {
    const p = shown.find((q) => q.id === t.id);
    out.push(
      `<g data-man-tag="${esc(t.id)}" data-place="${t.place}" aria-hidden="true"${fade(p ? opacity(p) : 1)}>` +
      `<rect x="${f1(t.x)}" y="${f1(t.y)}" width="${f1(t.w)}" height="${f1(t.h)}" rx="${f1(t.h / 2)}" fill="${ROUTE_INK.man}"/>` +
      `<text x="${f1(t.x + t.w / 2)}" y="${f1(t.y + t.h / 2 + 1)}" text-anchor="middle" dominant-baseline="central"` +
      ` font-size="${String(TAG_FONT)}" fill="${PAPER_TEXT}">${esc(t.text)}</text></g>`,
    );
  }

  // the other team's players first, so the play's own side sits on top
  const tokens = [...shown].sort((a, b) => Number(!context(a)) - Number(!context(b)));
  for (const p of tokens) {
    const spot = opts.positions?.[p.id] ?? p;
    const x = px(spot.x), y = py(spot.y, top);
    out.push(`<g transform="translate(${f1(x)},${f1(y)})"${fade(context(p) ? SHADOW_OPACITY : 1)}>`);
    if (highlight === p.id && !context(p)) out.push(`<circle r="33" fill="none" stroke="${YELLOW}" stroke-width="5"/>`);
    out.push(`<circle r="23" fill="${teamFill(p.team)}" stroke="${INK}" stroke-width="2.5"/>`);
    if (p.label) {
      out.push(
        `<text y="1" text-anchor="middle" dominant-baseline="central" font-size="${p.label.length > 2 ? "15" : "18"}" fill="${INK}">${esc(p.label)}</text>`,
      );
    }
    if (level === "detailed" && p.route?.primary && p.team === "offense" && !context(p)) {
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
  if (zone) return { x: onField(zone.cx, "middle", def.label), y: zone.cy + zone.ry - 8, text: def.label, anchor: "middle" };
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
  return { x: onField(x, anchor, def.label), y: Math.max(16, y), text: def.label, anchor };
}

/** The label's x, pulled in so the whole word stays inside the field, 4 units clear of each sideline. */
function onField(x: number, anchor: Label["anchor"], text: string): number {
  const w = text.length * 15 * 0.6; // wider than Patrick Hand (max 0.48 em measured) or its cursive fallback draws
  const lo = anchor === "start" ? 4 : anchor === "end" ? 4 + w : 4 + w / 2;
  const hi = anchor === "start" ? VW - 4 - w : anchor === "end" ? VW - 4 : VW - 4 - w / 2;
  return Math.max(lo, Math.min(hi, x));
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
export function artDepth(players: readonly Player[], box: Pane | null, show: Vis = "both", minDepth = 24): number {
  return depth(visible(players, show), box ?? TIGHT, minDepth);
}

export { S };

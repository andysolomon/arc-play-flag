import { byLine, names } from "./assignments";
import { S, VW, px, py } from "./geometry";
import type { Player } from "./types";
import type { ZoneMap } from "./zones";

/**
 * The marks a defensive picture carries besides routes, laid out in SVG units for both the
 * static art (lib/render/play-svg.ts) and the live field, so the two can never disagree.
 *
 * A man defender whose receiver is not in the picture wears a name tag ("on X") instead of
 * an arrow: an arrow to nobody reads as a defender charging the line of scrimmage. That is
 * how a Madden play card draws man coverage (no line at all), plus the one thing a player
 * needs to know: who. With the receiver in the picture, the arrow stays.
 *
 * Ways a tag can go wrong, written down before the layout:
 * - M1 a defender wears a tag and an arrow, or neither: `tagged` is the one rule both use.
 * - M2 a tag runs off the field: every spot is clamped to the art, and sides that would not fit are skipped.
 * - M3 a tag sits on another tag, M4 on another player, M5 on a zone bubble or the coverage stamp:
 *   each is an obstacle, and the first clear spot wins (below, inward, outward, above). When none
 *   is clear, the spot that does least harm wins: grazing a ring beats covering a player, and
 *   covering a player's centre (and label) is the worst of all.
 * - M6 a tag floats free of its defender: every spot tucks under the defender's own ring, which is
 *   drawn over it, so the ring, and a selection or highlight around it, stays whole.
 * - M7 an unlabelled receiver reads "on Player 2", as the slides name them; a receiver who is gone reads "Man".
 * - M8 a label breaks the markup: callers escape `text`.
 * - M9 the layout depends on storage order: defenders are laid out left to right (byLine).
 * - M10 a tag is left behind while players move: callers draw none during playback or animated frames.
 * - M11 a tag fades differently from its defender under a wristband highlight: callers fade it with them.
 */

/** A box in SVG units. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type TagPlace = "below" | "inside" | "outside" | "above";

export interface ManTag extends Box {
  /** the defender wearing it */
  id: string;
  text: string;
  place: TagPlace;
}

export const TAG_H = 24;
export const TAG_FONT = 17;
export const STAMP_H = 32;
export const STAMP_FONT = 22;
export const STAMP_SPACING = 1.5;
const TOKEN_R = 23;
/** how far a tag tucks under its own defender's ring */
const TUCK = 4;
/** tags keep this far inside the art's edges */
const EDGE = 4;
/** and this far off anything else */
const PAD = 2;

/** Wider than Patrick Hand draws (0.48 em measured), as the route labels are estimated. */
export const tagWidth = (text: string): number => Math.ceil(text.length * TAG_FONT * 0.6) + 16;
export const stampWidth = (text: string): number => Math.ceil(text.length * (STAMP_FONT * 0.6 + STAMP_SPACING)) + 20;

/** A man defender whose receiver is not among `drawn` wears a tag instead of an arrow. */
export function tagged(p: Player, drawn: ReadonlySet<string>): boolean {
  const rt = p.route;
  return rt?.type === "man" && !(rt.target !== undefined && drawn.has(rt.target));
}

const inflate = (b: Box, d: number): Box => ({ x: b.x - d, y: b.y - d, w: b.w + 2 * d, h: b.h + 2 * d });
const hitsBox = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/** How far a point is from a box, 0 inside it. */
const reach = (b: Box, cx: number, cy: number): number =>
  Math.hypot(Math.max(b.x, Math.min(cx, b.x + b.w)) - cx, Math.max(b.y, Math.min(cy, b.y + b.h)) - cy);

function hitsCircle(b: Box, cx: number, cy: number, r: number): boolean {
  return reach(b, cx, cy) < r;
}

interface Ellipse { cx: number; cy: number; rx: number; ry: number }

/** Scaled into the ellipse's own unit circle, where the box stays a box. */
function hitsEllipse(b: Box, e: Ellipse): boolean {
  return hitsCircle({ x: (b.x - e.cx) / e.rx, y: (b.y - e.cy) / e.ry, w: b.w / e.rx, h: b.h / e.ry }, 0, 0, 1);
}

interface Token { id: string; cx: number; cy: number }

const tokensOf = (drawn: readonly Player[], top: number): Token[] => drawn.map((p) => ({ id: p.id, cx: px(p.x), cy: py(p.y, top) }));

/**
 * Where the coverage stamp goes: the bottom-left corner, in the backfield, where a
 * defense-only picture is empty (as on a Madden card); the bottom-right if a player sits there.
 */
export function stampBox(text: string, drawn: readonly Player[], top: number, vh: number): Box {
  const w = stampWidth(text), h = STAMP_H, y = vh - 10 - h;
  const left: Box = { x: 10, y, w, h }, right: Box = { x: VW - 10 - w, y, w, h };
  const clear = (b: Box): boolean => !tokensOf(drawn, top).some((t) => hitsCircle(inflate(b, 4), t.cx, t.cy, TOKEN_R));
  return clear(left) || !clear(right) ? left : right;
}

/**
 * The name tag of every man defender in `drawn` whose receiver is not drawn, laid out left to
 * right. `all` is the whole play (the receiver is looked up there), `zones` the bubbles as laid
 * out for it, and `avoid` anything else already on the picture (the coverage stamp).
 */
export function manTags(
  drawn: readonly Player[], all: readonly Player[], top: number, vh: number, zones: ZoneMap, avoid: readonly Box[] = [],
): ManTag[] {
  const ids = new Set(drawn.map((p) => p.id));
  const who = names({ players: all });
  const tokens = tokensOf(drawn, top);
  const bubbles: Ellipse[] = drawn.flatMap((p) => {
    const z = zones[p.id];
    return z ? [{ cx: px(z.cx), cy: py(z.cy, top), rx: z.rx * S + PAD, ry: z.ry * S + PAD }] : [];
  });
  const placed: ManTag[] = [];
  for (const p of drawn.filter((q) => tagged(q, ids)).sort(byLine)) {
    const target = all.find((q) => q.id === p.route?.target);
    const text = target ? `on ${who.get(target.id) ?? ""}` : "Man";
    const w = tagWidth(text), h = TAG_H;
    const cx = px(p.x), cy = py(p.y, top);
    const inward = cx <= VW / 2 ? 1 : -1;
    const across = (s: number): number => (s > 0 ? cx + TOKEN_R - TUCK : cx - TOKEN_R + TUCK - w);
    const centred = Math.max(EDGE, Math.min(VW - EDGE - w, cx - w / 2));
    const spots: { place: TagPlace; x: number; y: number }[] = [
      // hanging off the bottom of the ring like a name plate, clear of the defender's own label
      { place: "below", x: centred, y: cy + TOKEN_R - TUCK },
      { place: "inside", x: across(inward), y: cy - h / 2 },
      { place: "outside", x: across(-inward), y: cy - h / 2 },
      { place: "above", x: centred, y: cy - TOKEN_R + TUCK - h },
    ];
    let best: ManTag | null = null, least = Infinity;
    for (const s of spots) {
      const box: Box = { x: s.x, y: s.y, w, h };
      if (box.x < EDGE - 0.01 || box.x + w > VW - EDGE + 0.01 || box.y < EDGE || box.y + h > vh - EDGE) continue;
      const near = inflate(box, PAD);
      // harm, not a count: a ring grazed by a unit is nearly nothing, a player's centre covered is the worst
      let harm = 0;
      for (const t of tokens) {
        if (t.id === p.id) continue;
        const d = reach(near, t.cx, t.cy);
        if (d < TOKEN_R) harm += TOKEN_R - d + (d === 0 ? 400 : 0);
      }
      for (const t of placed) if (hitsBox(near, t)) harm += 200 + overlap(near, t) / 10;
      for (const b of avoid) if (hitsBox(near, b)) harm += 200 + overlap(near, b) / 10;
      for (const e of bubbles) if (hitsEllipse(near, e)) harm += 30;
      if (harm < least) { best = { id: p.id, text, place: s.place, ...box }; least = harm; }
      if (harm === 0) break;
    }
    placed.push(best ?? { id: p.id, text, place: "below", x: centred, y: cy + TOKEN_R - TUCK, w, h });
  }
  return placed;
}

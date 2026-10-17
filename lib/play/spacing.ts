/**
 * Spacing: a player is never put on top of a teammate. A token is a disc about 2 yards across (46 units at
 * S = 22 a yard), so two teammates stand at least PLAYER_SPACING apart, centre to centre: at that their discs
 * just touch, and a bunch or a stack two yards apart, on the half yard like every drop, still lines up. A
 * drag, an arrow step or a blitzer backed off to the blitz line lands clear of every teammate, held to the
 * field as before (clamp in lib/play/geometry.ts). Pure; components/Field.tsx holds the live drag and the
 * keys to it, in a play and in roster mode alike, and lib/play/reducer.ts the blitz line.
 *
 * Ways it could go wrong, written down before the code:
 *
 * - C1 a player dropped on a teammate: it lands beside them instead, PLAYER_SPACING off, at the nearest such
 *   spot to where it was let go, on the half yard like any drop.
 * - C2 a drop whose live spot was clear but whose half-yard snap is not (snapped in toward a teammate): it
 *   lands on the nearest half-yard spot that is clear, never the crowded one.
 * - C3 a pocket between teammates (let go where two or three of them crowd it): the nearest spot clear of
 *   every one of them, never only of the nearest.
 * - C4 the clear spot over a sideline, past the line of scrimmage (or a blitzer's blitz line) or above the
 *   card's top: never. A spot is held to the field first, and only spots the field allows count as clear.
 * - C5 a player already on top of a teammate (a play or a roster spot stored before this, or by hand): it
 *   opens as stored, and it can still be moved off, dragged or stepped; it never blocks itself. Nothing moves
 *   a stored player but the coach.
 * - C6 the other side: never in the way. The line of scrimmage already keeps the sides apart (each LOS_GAP
 *   off it, so their discs can never be more than a hair over each other across it), and a shadow side
 *   hidden from the field must never stop a move the coach can't see the reason for.
 * - C7 an arrow step onto a teammate: the player goes on past them, a yard at a time the same way, to the
 *   first clear spot; with none before the sideline, the line or the card's top, it stays where it is. A key
 *   held down walks the player up to the teammate and stops there, so a held key never carries them on past
 *   someone they didn't mean to pass, and says so once a hold; a fresh press then steps past.
 * - C8 nowhere clear at all (it can't happen with five a side on a field 27 yards wide, but): the player
 *   stays where it was.
 * - C9 dragging over a teammate: the token is held at the edge of the teammate's disc and slides round it,
 *   and once the pointer is past the teammate's centre it is held on the far side, so a teammate never walls
 *   a player in. A finger resting on the teammate's centre, where a hair's jitter would swing it from side to
 *   side, keeps it on the side it is drawn on until the finger is HOLD past the centre, so a player let go
 *   right on a teammate lands on the side it came from.
 * - C10 a blitzer backed off to the blitz line onto a teammate standing there: the nearest clear half-yard
 *   spot at or behind the line. A route that moves nobody moves nobody, even a player stored on top of
 *   another (C5).
 * - C11 two clear spots equally near (a pointer exactly on a teammate's spot, or a blitzer backed onto one):
 *   the one nearer where the player came from, then nearer the line of scrimmage, then further left, so the
 *   same move always lands in the same place.
 * - C12 a spot exactly PLAYER_SPACING from a teammate, or a hair under it from rounding: clear.
 * - C13 a token held in a sliver no drop can land in (at a sideline between two teammates, no half-yard spot
 *   in it clear): it is drawn where the drop will land, so what the coach sees is where it goes.
 * - C14 a drop held back onto the spot it started from: nothing moved, so nothing is written; no undo step,
 *   and Redo is kept.
 * - C15 a step past a teammate that cuts the player's route short at the sideline: one note says both.
 *
 * Under centre: the quarterback may line up right behind the centre, UNDER_CENTRE back, closer than any other
 * two teammates stand. Ways that could go wrong, written down before the code:
 *
 * - U1 the quarterback dropped right behind the centre lands kept 2 yards off them, as anyone else would,
 *   so a QB can't line up under centre at all: dropped on or near the spot UNDER_CENTRE behind the C (or
 *   anywhere in the back of the C's disc that is nearer that spot than the disc's edge), they land on it.
 * - U2 the spot too close: the discs on top of each other, the C's label hidden under the QB's. At
 *   UNDER_CENTRE the discs overlap as a QB under centre is drawn, and both labels stay in sight. Each is
 *   still pressed by its own label (a token's tap circle is wider than UNDER_CENTRE, so the QB's would take
 *   a tap on the C's), and the C's name, shown under him, is not hidden by the QB standing there.
 * - U3 the spot off the grid a drop snaps to (snapping by the whole yard, or the C off the half yard):
 *   the spot itself, never the grid point beside it, which is inside the C's disc or 2 yards off.
 * - U4 the arrow keys walk past it: a step back toward the C that would end inside their disc, with the
 *   spot on the way, stops on it, a held key too; a further step on says there is no room past the C, and
 *   a step back or aside leaves it as from anywhere.
 * - U5 anyone else gets in: only the quarterback and only straight behind the centre. Any other player,
 *   or the QB beside or in front of the C, is kept PLAYER_SPACING off as before; a spot elsewhere in the
 *   C's disc is never clear.
 * - U6 a crowd: the spot is clear only of the C. A third teammate within PLAYER_SPACING of it keeps the
 *   quarterback out, as any spot.
 * - U7 the centre can't come back: the pair holds both ways, so the C dragged or stepped in front of a QB
 *   who stands where the spot would put them lands UNDER_CENTRE in front of them.
 * - U8 a misleading note: a QB going under centre is not told they were kept 2 yards off the C. A drop
 *   kept off the C is told so at the drop, with where to go to line up under centre, not while the
 *   finger passes over the C's disc on its way to the spot.
 * - U9 no centre or no quarterback (a relabelled side, the defense, roster positions without one), or the
 *   two the same player: no spot, and spacing as before. The quarterback and the centre are who
 *   lib/play/lateral.ts says they are, labels first.
 * - U10 the spot off the field (a centre lined up deep in the backfield): only where the field lets the
 *   quarterback stand, as every spot is held to it (C4).
 * - U11 a play stored with the quarterback anywhere near the centre opens as stored (C5), under centre
 *   or not.
 */

import { MAX_DEPTH, clamp, snap } from "./geometry";
import { centre, quarterback } from "./lateral";
import type { Player, Pt, SnapMode, Team } from "./types";

/** How far apart two teammates stand at the closest, centre to centre, in yards: about a token's width. */
export const PLAYER_SPACING = 2;
/**
 * How far behind the centre a quarterback stands under centre, centre to centre, in yards: their discs overlap
 * as a QB under centre is drawn, and both labels stay in sight (U1, U2).
 */
export const UNDER_CENTRE = 1.5;
/** A teammate to keep clear of, and the one spot inside their disc this player may still take, if any (U1, U7). */
export type Mate = Pt & { readonly slot?: Pt };
/** A rounding error's worth of yards, so a spot exactly PLAYER_SPACING off is clear (C12). */
const EPS = 1e-6;
/** How far past a teammate's centre a finger goes before the player it drags is held on the far side (C9). */
export const HOLD = 0.5;
/** The deepest card's top (MAX_DEPTH), for the blitz line, which the reducer moves to without a card. */
const DEEPEST_TOP = 8 - MAX_DEPTH;

/**
 * The players a player must keep clear of: their own side but themself (C5, C6). The quarterback's centre,
 * and the centre's quarterback, carry the one spot the pair may stand closer than that: the QB UNDER_CENTRE
 * straight behind the C (U1, U5, U7, U9).
 */
export function teammates(players: readonly Player[], id: string): (Player & { slot?: Pt })[] {
  const me = players.find((p) => p.id === id);
  if (!me) return [];
  const mates = players.filter((p) => p.team === me.team && p.id !== id);
  const qb = quarterback(players), c = centre(players);
  if (me.team !== "offense" || !qb || !c || qb.id === c.id || qb.team !== "offense") return mates;
  if (me.id === qb.id) return mates.map((m) => (m.id === c.id ? { ...m, slot: { x: m.x, y: m.y + UNDER_CENTRE } } : m));
  if (me.id === c.id) return mates.map((m) => (m.id === qb.id ? { ...m, slot: { x: m.x, y: m.y - UNDER_CENTRE } } : m));
  return mates;
}

/** Whether a spot is exactly where one of these teammates lets this player stand inside their disc (U1, U3). */
function onSlot(pt: Pt, slot: Pt | undefined): boolean {
  return !!slot && Math.hypot(pt.x - slot.x, pt.y - slot.y) < EPS;
}

/** Whether a spot is a teammate's slot: the quarterback under centre, or the centre in front of them (U8). */
export function inSlot(pt: Pt, mates: readonly Mate[]): boolean {
  return mates.some((m) => onSlot(pt, m.slot));
}

/** The nearest teammate a spot is on top of, or null when it is clear of them all. */
export function crowding<T extends Mate>(pt: Pt, mates: readonly T[]): T | null {
  let near: T | null = null, best = PLAYER_SPACING - EPS;
  for (const m of mates) {
    // the one spot inside their disc this player may take is clear of them, and of nobody else (U5, U6)
    if (onSlot(pt, m.slot)) continue;
    const d = Math.hypot(pt.x - m.x, pt.y - m.y);
    if (d < best) { near = m; best = d; }
  }
  return near;
}

/** Where on the field a player may stand at all: the box clamp holds them to, its edges included (C4). */
function fieldBox(team: Team, top: number, gap: number) {
  const lo = clamp(-Infinity, -Infinity, team, top, gap), hi = clamp(Infinity, Infinity, team, top, gap);
  return { x0: lo.x, y0: lo.y, x1: hi.x, y1: hi.y };
}

/**
 * Whether `a` lands nearer `to` than `b`; equally near, nearer `from` (where the player came from), then
 * nearer the line of scrimmage, then further left (C11).
 */
function nearer(a: Pt, b: Pt | null, to: Pt, from: Pt | null): boolean {
  if (!b) return true;
  const da = Math.hypot(a.x - to.x, a.y - to.y), db = Math.hypot(b.x - to.x, b.y - to.y);
  if (Math.abs(da - db) > 1e-9) return da < db;
  if (from) {
    const fa = Math.hypot(a.x - from.x, a.y - from.y), fb = Math.hypot(b.x - from.x, b.y - from.y);
    if (Math.abs(fa - fb) > 1e-9) return fa < fb;
  }
  if (Math.abs(Math.abs(a.y) - Math.abs(b.y)) > 1e-9) return Math.abs(a.y) < Math.abs(b.y);
  return a.x < b.x;
}

/**
 * Whether a finger within HOLD of a teammate's centre finds the player already drawn pressed against a
 * teammate on the way to it (`from` clear, on that teammate's edge, the finger on their side of it): then
 * the player stays where they are drawn, so the hold never swings them about, even out of a pocket (C9).
 */
function pressed(at: Pt, mates: readonly Pt[], from: Pt): boolean {
  const m = crowding(at, mates);
  if (!m || Math.hypot(at.x - m.x, at.y - m.y) >= HOLD || crowding(from, mates)) return false;
  return mates.some((n) => Math.abs(Math.hypot(from.x - n.x, from.y - n.y) - PLAYER_SPACING) < EPS
    && (from.x - n.x) * (at.x - from.x) + (from.y - n.y) * (at.y - from.y) < 0);
}

/**
 * A spot within HOLD of a teammate's centre, read as on the edge of that core on the side `from` is (C9),
 * for a player not yet drawn beside anyone (a quick flick straight onto a teammate): they come out on the
 * side they came from.
 */
function held(p: Pt, mates: readonly Pt[], from: Pt | null): Pt {
  const m = from ? crowding(p, mates) : null;
  if (!m || !from || Math.hypot(p.x - m.x, p.y - m.y) >= HOLD) return p;
  const dx = from.x - m.x, dy = from.y - m.y, L = Math.hypot(dx, dy);
  return L > EPS ? { x: m.x + (dx / L) * HOLD, y: m.y + (dy / L) * HOLD } : p;
}

/**
 * The spot nearest `want` that the field allows and that is clear of every teammate: `want` held to the
 * field, if that is clear, else the nearest point of the field outside every teammate's disc (C1, C3, C4,
 * C9). That point is the spot itself held to an edge of the field, or on one teammate's circle (straight
 * out from them, where it crosses another's, or where it crosses an edge), or a corner; every one of them is
 * tried and the nearest clear one wins. `from` is where the player is drawn now, which a finger on a
 * teammate's centre keeps them beside (C9) and which breaks a tie (C11). Null only when nowhere is clear (C8).
 */
export function freeSpot(want: Pt, team: Team, top: number, gap: number, mates: readonly Mate[], from: Pt | null = null): Pt | null {
  const at = clamp(want.x, want.y, team, top, gap);
  if (!crowding(at, mates)) return at;
  if (from && pressed(at, mates, from)) return from;
  const hold = held(at, mates, from);
  const p = clamp(hold.x, hold.y, team, top, gap);
  const b = fieldBox(team, top, gap);
  const R = PLAYER_SPACING;
  const tries: Pt[] = [
    { x: b.x0, y: p.y }, { x: b.x1, y: p.y }, { x: p.x, y: b.y0 }, { x: p.x, y: b.y1 },
    { x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x0, y: b.y1 }, { x: b.x1, y: b.y1 },
  ];
  mates.forEach((m, i) => {
    // the spot under centre, when the back of the C's disc is nearer it than the disc's edge (U1)
    if (m.slot) tries.push({ x: m.slot.x, y: m.slot.y });
    const dx = p.x - m.x, dy = p.y - m.y, L = Math.hypot(dx, dy);
    // straight out from the teammate; from exactly on their spot there is no way out, so every way is tried (C11)
    if (L > EPS) tries.push({ x: m.x + (dx / L) * R, y: m.y + (dy / L) * R });
    else tries.push({ x: m.x, y: m.y - R }, { x: m.x, y: m.y + R }, { x: m.x - R, y: m.y }, { x: m.x + R, y: m.y });
    // where this teammate's circle crosses the field's edges
    for (const X of [b.x0, b.x1]) {
      const h = R * R - (X - m.x) ** 2;
      if (h >= 0) tries.push({ x: X, y: m.y - Math.sqrt(h) }, { x: X, y: m.y + Math.sqrt(h) });
    }
    for (const Y of [b.y0, b.y1]) {
      const h = R * R - (Y - m.y) ** 2;
      if (h >= 0) tries.push({ x: m.x - Math.sqrt(h), y: Y }, { x: m.x + Math.sqrt(h), y: Y });
    }
    // and where it crosses every other teammate's
    for (const n of mates.slice(i + 1)) {
      const ux = n.x - m.x, uy = n.y - m.y, d = Math.hypot(ux, uy);
      if (d < EPS || d > 2 * R) continue;
      const h = Math.sqrt(Math.max(0, R * R - (d / 2) ** 2));
      const mx = (m.x + n.x) / 2, my = (m.y + n.y) / 2;
      tries.push({ x: mx - (uy / d) * h, y: my + (ux / d) * h }, { x: mx + (uy / d) * h, y: my - (ux / d) * h });
    }
  });
  let best: Pt | null = null;
  for (const t of tries) {
    if (t.x < b.x0 - 1e-9 || t.x > b.x1 + 1e-9 || t.y < b.y0 - 1e-9 || t.y > b.y1 + 1e-9) continue;
    // a slot is taken as it is, never moved onto the box's edge by a rounding hair (U10)
    const c = inSlot(t, mates) ? t : { x: Math.max(b.x0, Math.min(b.x1, t.x)), y: Math.max(b.y0, Math.min(b.y1, t.y)) };
    if (!crowding(c, mates) && nearer(c, best, p, from)) best = c;
  }
  return best;
}

/**
 * Where a drop lands: the live spot (already clear, see freeSpot) snapped as every drop is and held to the
 * field, if that is clear; else the nearest snapped spot that is (C2, C3). With snapping off it is the live
 * spot. A tie goes to the spot nearer `from`, where the player came from (C11). Null only when nowhere is
 * clear (C8).
 */
export function freeSnap(at: Pt, team: Team, top: number, gap: number, mates: readonly Mate[], mode: SnapMode, from: Pt | null = null): Pt | null {
  // the spot under centre is where it is, on the grid or off it, so a drop on it stays on it (U3)
  if (inSlot(at, mates) && !crowding(at, mates)) return { x: at.x, y: at.y };
  if (mode === "free") return freeSpot(at, team, top, gap, mates, from);
  const first = clamp(snap(at.x, mode), snap(at.y, mode), team, top, gap);
  if (!crowding(first, mates)) return first;
  const g = mode === "one" ? 1 : 0.5;
  const b = fieldBox(team, top, gap);
  let best: Pt | null = null;
  // every spot a drop can land on: each on the grid, held to the field, snapped and held again as a drop
  // is, so the field's edges are tried and nothing a plain drop never gives (0.9 off the line) is
  for (let j = Math.floor(b.y0 / g); j <= Math.ceil(b.y1 / g); j++) {
    for (let i = Math.floor(b.x0 / g); i <= Math.ceil(b.x1 / g); i++) {
      const v = clamp(i * g, j * g, team, top, gap);
      const c = clamp(snap(v.x, mode), snap(v.y, mode), team, top, gap);
      if (!crowding(c, mates) && nearer(c, best, at, from)) best = c;
    }
  }
  // and the spot under centre, if it is nearer than any spot on the grid (U3)
  for (const m of mates) {
    const t = m.slot;
    if (!t || t.x < b.x0 - 1e-9 || t.x > b.x1 + 1e-9 || t.y < b.y0 - 1e-9 || t.y > b.y1 + 1e-9) continue;
    if (!crowding(t, mates) && nearer(t, best, at, from)) best = { x: t.x, y: t.y };
  }
  return best;
}

/**
 * An arrow step: a yard (or `step`) the way pressed, held to the field, and, on a fresh press (`pass`), on
 * past any teammate in the way, a step at a time, to the first clear spot (C7). `to` is null when the edge
 * of the field comes first, or a held key (`pass` false) meets a teammate; `past` is the first teammate in
 * the way, if one was.
 */
export function stepPast<T extends Mate>(from: Pt, step: readonly [number, number], team: Team, top: number, gap: number, mates: readonly T[], pass = true): { to: Pt | null; past: T | null } {
  let past: T | null = null;
  let prev: Pt | null = null;
  let last: Pt = from;
  // the field is 30 yards across and at most 45 deep, so a yard at a time this always reaches an edge
  for (let k = 1; k <= 60; k++) {
    const c = clamp(from.x + step[0] * k, from.y + step[1] * k, team, top, gap);
    if (prev && Math.abs(c.x - prev.x) < 1e-9 && Math.abs(c.y - prev.y) < 1e-9) break;
    const who = crowding(c, mates);
    if (!who) return { to: c, past };
    // a step that would end inside the C's disc, with the spot under centre on the way, stops on it (U4)
    const under = mates.find((m) => m.slot && passes(m.slot, last, c) && !crowding(m.slot, mates))?.slot;
    if (under) return { to: { x: under.x, y: under.y }, past };
    past ??= who;
    if (!pass) break;
    prev = c;
    last = c;
  }
  return { to: null, past };
}

/** Whether a step from `a` to `b` goes through `s` on the way, `a` itself aside (U4). */
function passes(s: Pt, a: Pt, b: Pt): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  if (L2 < EPS) return false;
  const t = ((s.x - a.x) * dx + (s.y - a.y) * dy) / L2;
  return t > EPS && t <= 1 + EPS && Math.hypot(a.x + t * dx - s.x, a.y + t * dy - s.y) < EPS;
}

/**
 * What the coach is told when a player is kept off a teammate: dragged and kept beside them, stepped on past
 * them, or held where they are with no room past them before the edge of the field.
 */
export function crowdNote(who: string, mate: string, how: "kept" | "past" | "stuck", under = false): string {
  const said = "Players can't stand on top of each other.";
  if (how === "past") return `${said} Stepped ${who} past ${mate}.`;
  if (how === "stuck") return `${said} No room for ${who} past ${mate}.`;
  // the quarterback kept off the centre is told where they may stand closer: right behind them (U8)
  const hint = under ? ` Drop ${who} right behind ${mate} to line up under centre.` : "";
  return `${said} Kept ${who} ${String(PLAYER_SPACING)} yards off ${mate}.${hint}`;
}

/**
 * The quarterback and the centre, when the QB stands under centre (UNDER_CENTRE straight behind the C), else
 * null: their discs overlap, so the field puts the C's name above them, clear of the QB (U2).
 */
export function underCentre(players: readonly Player[]): { qb: string; c: string } | null {
  const qb = quarterback(players), c = centre(players);
  if (!qb || !c || qb.id === c.id || qb.team !== "offense") return null;
  return Math.hypot(qb.x - c.x, qb.y - (c.y + UNDER_CENTRE)) < EPS ? { qb: qb.id, c: c.id } : null;
}

/** Whether a teammate kept this player off is the centre, and this player the quarterback who may stand under them (U8). */
export function underCentreOf(mate: Mate): boolean {
  return !!mate.slot && mate.slot.y > mate.y;
}

/**
 * A player the app moved (a blitzer backed off to the blitz line, `moved` after `before`): where they are,
 * if that is clear of their teammates, else the nearest clear half-yard spot their route allows (C10). A
 * player the app did not move stays where they are, on top of someone or not (C5).
 */
export function spaced(players: readonly Player[], before: Player, moved: Player, gap: number): Player {
  if (moved === before || (moved.x === before.x && moved.y === before.y)) return moved;
  const mates = teammates(players, before.id);
  if (!crowding(moved, mates)) return moved;
  const at = freeSnap(moved, moved.team, DEEPEST_TOP, gap, mates, "half", before);
  return at ? { ...moved, x: at.x, y: at.y } : moved;
}

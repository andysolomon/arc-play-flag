/**
 * The roster's own picture and sheet (docs/adr/010-roster-exports.md), drawn as a game-day depth board: the
 * formation laid out on turf, each position a card hanging under its token where the player lines up, the
 * starter on the highlighter and the backups in order under. The picture is the side on view, sized for a
 * phone; the sheet is both sides with every chart whole, then the team, every player against every position
 * ("Who plays where") under the gaps to fill. Beside a device backup they are the only files with the players'
 * names in them, and only when the coach asks (docs/adr/008-roster-depth-chart.md, rule 4). Pure: SVG pages in, drawn and saved
 * by lib/export/run.ts; every word is a real <text>, so the PDF's invisible text layer finds it.
 *
 * Ways it could go wrong, written down before the code:
 *
 * - E1 a blank team name: the band reads "Flag football" and the file starts flag-football, never "play".
 * - E2 a long name (forty letters): wrapped at its spaces and hyphens over up to four lines, smaller only down
 *   to a size that still reads; a starter never smaller than a backup; past that the name loses its middle,
 *   never its end, which is what tells two long names apart.
 * - E3 a team colour too dark for ink (navy, black): the band's words in cream, by contrast. The highlighter's
 *   yellow (the team colour nobody chose) or no colour at all: an ink band, since yellow means the starter.
 * - E4 a side told by hue alone: offense red and defense blue print as one grey, so each side is named in ink,
 *   in a lane no token enters.
 * - E5 a position nobody is down for: "Unassigned" on a dashed card, never a gap; on paper, lines to pencil
 *   a starter and backups in. A position with nobody behind its starter: "No backup" in ink as its 2nd line,
 *   and on paper lines to pencil one in.
 * - E6 a player on no depth chart: said on the picture's gaps line and the sheet's gaps to fill, and on the
 *   team page, "No position".
 * - E7 a tag the formation has no token for (FS, H): a card "Not in this formation", on its own shelf after
 *   the board, its token dashed, never drawn on the turf.
 * - E8 the Secondary Lineup: drawn as the field shows it, made fresh from the starting lineup's charts, and
 *   saying it was made from them; a branch says what it was branched from.
 * - E9 more than fits: the picture cuts a long chart to "+n more on the sheet" before its words go below what
 *   reads on a phone; the sheet keeps every name whole, never below its print size, and goes on over another
 *   page (a side each, the tags not in the formation, the team), each with its header and "page n of N".
 * - E10 Letter or A4: laid out from the paper's own width and height; the header inside the printable area.
 * - E11 an export that changes the roster: these read the lineups and write nothing.
 * - E12 text measured before the hand face has loaded: the builders run inside the export's thunk.
 * - E13 a title or file name the PDF or the device can't carry: the title is ASCII-joined, the file kebab-cased.
 * - E14 the coach's own formation: each card hangs where its position was dragged (formationOf).
 * - E15 a blank lineup name: "Untitled lineup" (lineupName).
 * - E16 an empty roster: the sheet is a blank depth chart to fill in by hand; a side with nobody on it says
 *   so to whoever is sent the picture, with no word about the app.
 * - E17 an old printout taken for today's: every page and picture says the day it was made.
 */

import { byLine } from "@/lib/play/assignments";
import { teamFill } from "@/lib/play/geometry";
import { SECOND_LINEUP, fromName, lineupName, teamNames } from "@/lib/play/lineup";
import { depthOf, depthWord, isOffField, standings } from "@/lib/play/roster";
import { kebab } from "@/lib/play/storage";
import type { Lineup, Lineups, Player, Team, TeamSettings, Vis } from "@/lib/play/types";
import { INK, TURF, YELLOW, esc } from "@/lib/render/play-svg";
import { MUTED, appMark, f2, page, rect, text, type Paper, type SvgPage } from "./pages";
import { measure } from "./raster";
import { onBand, safeColor } from "./slides";

/** The picture is drawn a pixel to its unit: 1080 wide, as the play card is. */
export const PICTURE_SCALE = 1;
/** The sheet prints as the binder's full pages do. */
export const SHEET_DPI = 220;

const GROUND = "#f4efe2"; // the picture's paper
const CREAM = "#fffdf6"; // cards and panels
const HAIR = 0.14; // dividers and hard shadows: ink at 14%

/** The team's name for a page or a file: "Flag football" while it is blank (E1). */
export const teamWord = (team: TeamSettings): string => team.name.trim() || "Flag football";

/** A roster export's file name: team, lineup and what it is, kebab-cased (E1, E13, E15). */
export function rosterFile(team: TeamSettings, lineup: Lineup, what: string, ext: "png" | "pdf"): string {
  return `${kebab(`${teamWord(team)} ${lineupName(lineup)} ${what}`)}.${ext}`;
}

/** The sheet's PDF title, joined in ASCII since the PDF's title keeps nothing else (E13). */
export const rosterTitle = (team: TeamSettings, lineup: Lineup): string => `${teamWord(team)} - ${lineupName(lineup)} - roster sheet`;

/** The band behind the team's name: the team's colour, or ink where that would be the starter's yellow (E3). */
const bandColor = (team: TeamSettings): string => {
  const c = safeColor(team.color);
  return c === YELLOW ? INK : c;
};

// ---------------------------------------------------------------------------------------------------------
// Text

type Anchor = "start" | "middle" | "end";

/** An uppercase eyebrow, letter-spaced: the only capitals on the page. */
function eyebrow(x: number, y: number, size: number, s: string, o: { anchor?: Anchor; fill?: string; opacity?: number } = {}): string {
  return (
    `<text x="${f2(x)}" y="${f2(y)}" font-size="${f2(size)}" letter-spacing="${f2(size * 0.12)}"` +
    (o.anchor ? ` text-anchor="${o.anchor}"` : "") + (o.fill ? ` fill="${o.fill}"` : "") +
    (o.opacity !== undefined ? ` opacity="${f2(o.opacity)}"` : "") + `>${esc(s.toUpperCase())}</text>`
  );
}

/** The run cut with an ellipsis to fit. */
function cut(s: string, width: number, size: number): string {
  if (measure(s, size) <= width) return s;
  let t = s;
  while (t.length > 1 && measure(`${t}…`, size) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** The run's end kept and its start cut to fit: the end of a long name is what tells it from another (E2). */
function cutStart(s: string, width: number, size: number): string {
  if (measure(s, size) <= width) return s;
  let t = s;
  while (t.length > 1 && measure(`…${t}`, size) > width) t = t.slice(1);
  return `…${t.trimStart()}`;
}

/** A word wider than its box broken at letters into lines that fit, so none of it is lost (E2). */
function breakWord(s: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of s) {
    if (line && measure(line + ch, size) > width) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  // as many lines, the letters shared out evenly, so no line is left a lone letter
  const chars = Array.from(s);
  const per = Math.ceil(chars.length / lines.length);
  const even = Array.from({ length: lines.length }, (_, i) => chars.slice(i * per, i * per + per).join("")).filter(Boolean);
  return even.every((l) => measure(l, size) <= width) ? even : lines;
}

/** A name's places to break: between words, and after a hyphen ("Brooks-" "Washington"). */
function pieces(s: string): { t: string; space: boolean }[] {
  return s.trim().split(/\s+/).filter(Boolean).flatMap((word) => word.split(/(?<=-)/).map((t, i) => ({ t, space: i === 0 })));
}

function wrapName(s: string, width: number, size: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const p of pieces(s)) {
    const next = line ? line + (p.space ? " " : "") + p.t : p.t;
    if (!line || measure(next, size) <= width) { line = next; continue; }
    lines.push(line);
    line = p.t;
  }
  if (line) lines.push(line);
  return lines;
}

interface Fitted { lines: string[]; size: number }

/**
 * A name as large as it fits in as few lines as it can (E2): one line at the two largest sizes, two at the
 * three largest, the last line allowed at any size. At the smallest a word wider than the box breaks at its
 * letters; past `maxLines` the first lines are kept and the last keeps the name's end, cut at its start, so
 * two long names that differ at the end are still two.
 */
function fitName(s: string, width: number, sizes: readonly number[], maxLines: number): Fitted {
  for (let n = 1; n <= maxLines; n++) {
    for (const size of sizes.slice(0, n === maxLines ? sizes.length : n + 1)) {
      const lines = wrapName(s, width, size);
      if (lines.length <= n && lines.every((l) => measure(l, size) <= width)) return { lines, size };
    }
  }
  const size = sizes[sizes.length - 1] ?? 10;
  const all = wrapName(s, width, size).flatMap((l) => (measure(l, size) <= width ? [l] : breakWord(l, width, size)));
  if (all.length <= maxLines) return { lines: all, size };
  // what is left is more than a line, so the end that fits one is all past the lines kept
  return { lines: [...all.slice(0, maxLines - 1), cutStart(s.trim(), width, size)], size };
}

/** A run wrapped at its spaces, at most `max` lines, the last cut with an ellipsis. */
function wrapWords(s: string, width: number, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${w}` : w;
    if (!line || measure(next, size) <= width) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  const kept = lines.slice(0, max);
  if (lines.length > max) kept[max - 1] = lines.slice(max - 1).join(" ");
  return kept.map((l) => cut(l, width, size));
}

/** A list of places ("X starter, LC 2nd") wrapped at its commas, at most `max` lines. */
function wrapList(s: string, width: number, size: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of s.split(/(?<=,) /)) {
    const next = line ? `${line} ${w}` : w;
    if (!line || measure(next, size) <= width) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  const kept = lines.slice(0, max);
  if (lines.length > max) kept[max - 1] = lines.slice(max - 1).join(" ");
  return kept.map((l) => cut(l, width, size));
}

// ---------------------------------------------------------------------------------------------------------
// The roster as the exports read it

/** What the exports are made from: the roster on the field, as roster mode's panel shows it. */
export interface RosterExport {
  lineups: Lineups;
  /** the lineup on the field (activeLineup), the Secondary Lineup made fresh (E8) */
  lineup: Lineup;
  team: TeamSettings;
  /** every position the roster lists: the formation as the coach stood it, then the tags off it (rosterPositions) */
  positions: readonly Player[];
  /** the day it is made, said on every page (E17) */
  on: Date;
}

interface Position {
  team: Team;
  tag: string;
  /** yards, where the coach stands it in roster mode (E14); a tag off the formation has no spot */
  x: number;
  y: number;
  onField: boolean;
  /** the depth chart, starter first, blank lines out */
  depth: readonly string[];
}

interface Member {
  name: string;
  /** every place on this lineup, starts first */
  at: { team: Team; tag: string; depth: number }[];
  /** "X starter, LC 2nd", or "No position", as the roster panel says it (E6) */
  sits: string;
}

interface Board {
  team: string;
  band: string;
  lineup: string;
  /** what the lineup was branched or made from (E8) */
  note: string | null;
  /** "Oct 16, 2026" (E17) */
  day: string;
  /** the whole team, alphabetical */
  players: Member[];
  /** each side: the formation's left to right, then its tags not in the formation in tag order */
  offense: Position[];
  defense: Position[];
}

/** Everything the exports draw, read once. */
function boardOf({ lineups, lineup, team, positions, on }: RosterExport): Board {
  const roster = lineup.slots;
  const chart = (t: Team, tag: string): string[] => depthOf(roster, t, tag).map((n) => n.trim()).filter(Boolean);
  // the formation by x, then the tags off it, whose x puts them past the right edge (lib/play/roster.ts, R9)
  const side = (t: Team): Position[] => positions.filter((p) => p.team === t && p.label).sort(byLine)
    .map((p) => ({ team: t, tag: p.label, x: p.x, y: p.y, onField: !isOffField(p), depth: chart(t, p.label) }));
  const parent = fromName(lineups, lineup);
  const note = !parent ? null : lineup.id === SECOND_LINEUP
    ? `Made from ${parent}'s depth charts: at each position the next player up starts.`
    : `Branched from ${parent}.`;
  return {
    team: teamWord(team),
    band: bandColor(team),
    lineup: lineupName(lineup),
    note,
    day: on.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }),
    players: teamNames(lineups).map((name) => {
      const at = standings(roster, name);
      return { name, at, sits: at.map((s) => `${s.tag} ${depthWord(s.depth).toLowerCase()}`).join(", ") || "No position" };
    }),
    offense: side("offense"),
    defense: side("defense"),
  };
}

const sidesOf = (show: Vis): Team[] => (show === "both" ? ["defense", "offense"] : [show]);
const sideOf = (b: Board, t: Team): Position[] => (t === "offense" ? b.offense : b.defense);
const onField = (b: Board, t: Team): Position[] => sideOf(b, t).filter((p) => p.onField);
const offField = (b: Board, t: Team): Position[] => sideOf(b, t).filter((p) => !p.onField);
const allOf = (b: Board, show: Vis): Position[] => sidesOf(show).flatMap((t) => sideOf(b, t));
const nobody = (ps: readonly Position[]): boolean => !ps.some((p) => p.depth.length);

/** What a coach fills before game day: positions nobody is down for, starters with nobody behind, players on no chart. */
function gapsOf(b: Board, show: Vis = "both"): { head: string; items: string[] }[] {
  // in the order the matrix reads, offense first
  const all = (["offense", "defense"] as const).filter((t) => show === "both" || show === t).flatMap((t) => sideOf(b, t));
  return [
    { head: "Unassigned", items: all.filter((p) => !p.depth.length).map((p) => p.tag) },
    { head: "No backup", items: all.filter((p) => p.depth.length === 1).map((p) => p.tag) },
    { head: "No position", items: b.players.filter((p) => !p.at.length).map((p) => p.name) },
  ];
}

// ---------------------------------------------------------------------------------------------------------
// The name card: the position's token on its top edge, the starter on the highlighter, the backups under

/** Every size on the board from one unit: 1 is the picture's 1080px scale; a printed page's is about 0.5pt. */
function metrics(u: number) {
  return {
    u,
    tokR: 27 * u,
    stroke: 2.5 * u,
    radius: 10 * u,
    shadow: 5 * u,
    padX: 12 * u,
    word: 22 * u,
    // a starter is never smaller than a backup (E2)
    starter: [36 * u, 31 * u, 27 * u],
    backup: [27 * u, 24 * u, 21 * u],
    gap: 16 * u,
    eyebrow: 20 * u,
    side: 26 * u,
  };
}
type M = ReturnType<typeof metrics>;

type Kind = "starter" | "backup" | "need" | "muted" | "blank";
interface Line { word: string; lines: string[]; size: number; h: number; kind: Kind }
interface Card { pos: Position; lines: Line[]; h: number; top: number; wordW: number }

const lineH = (size: number): number => size * 1.04;
/** The depth words under the starter, "2nd" to "8th": the widest sets every card's name column, so backups line up. */
const BACKUP_WORDS = Array.from({ length: 7 }, (_, i) => depthWord(i + 1));

/**
 * How a card is filled. `maxDepth` cuts a long chart to "+n more on the sheet", for a crowded picture only,
 * never on paper (E9); `pencil` gives open lines to write on, for paper (E5); `sideTag` names the side in
 * the corner of a card not in the formation, where both sides share its shelf (E4).
 */
interface CardOpts { maxDepth: number; pencil: boolean; sideTag: boolean }

/** A card's rows at a width. */
function card(pos: Position, cw: number, m: M, co: CardOpts): Card {
  const wordW = Math.max(...BACKUP_WORDS.map((w) => measure(w, m.word))) + 12 * m.u;
  const inner = cw - 2 * m.padX;
  const out: Line[] = [];
  const shown = pos.depth.length > co.maxDepth ? pos.depth.slice(0, co.maxDepth - 1) : pos.depth;
  const size = m.backup[0] ?? 0;
  const blank = (i: number): Line => ({ word: depthWord(i), lines: [], size, h: size + 16 * m.u, kind: "blank" });
  shown.forEach((name, i) => {
    const starter = i === 0;
    // the starter's name has the card's whole width under its word; a backup's sits after its depth word
    const f = starter ? fitName(name, inner - 4 * m.u, m.starter, 4) : fitName(name, inner - wordW, m.backup, 3);
    const h = starter
      ? 9 * m.u + m.word + 3 * m.u + (f.lines.length - 1) * lineH(f.size) + f.size * 0.92 + 12 * m.u
      : (f.lines.length - 1) * lineH(f.size) + f.size * 0.9 + 13 * m.u;
    out.push({ word: depthWord(i), lines: f.lines, size: f.size, h, kind: starter ? "starter" : "backup" });
  });
  const more = pos.depth.length - shown.length;
  if (more > 0) {
    // no depth word before it, so it has the card's whole inside, wrapped to fit
    const ms = m.backup[1] ?? 0;
    const lines = wrapWords(`+${String(more)} more on the sheet`, inner, ms, 2);
    out.push({ word: "", lines, size: ms, h: (lines.length - 1) * lineH(ms) + ms * 0.9 + 13 * m.u, kind: "muted" });
  }
  if (pos.depth.length === 1) {
    // nobody behind the starter: said in ink as the 2nd line, or two lines to pencil a backup in (E5)
    if (co.pencil) out.push(blank(1), blank(2));
    else out.push({ word: depthWord(1), lines: ["No backup"], size, h: size * 0.9 + 13 * m.u, kind: "need" });
  }
  if (!pos.depth.length) {
    if (co.pencil) out.push(blank(0), blank(1), blank(2));
    else out.push({ word: "", lines: ["Unassigned"], size: m.starter[1] ?? 0, h: (m.starter[1] ?? 0) * 0.9 + 24 * m.u, kind: "muted" });
  }
  // a side named under the token takes a line of its own, so the token never covers it
  const top = m.tokR + 7 * m.u + (!pos.onField && co.sideTag ? m.word * 0.8 + 6 * m.u : 0);
  return { pos, lines: out, h: top + out.reduce((n, l) => n + l.h, 0) + 8 * m.u, top, wordW };
}

/** A position's token, as the field draws it; dashed for a tag with no spot in the formation (E7). */
function token(cx: number, cy: number, team: Team, tag: string, r: number, stroke: number, dashed = false): string {
  const size = tag.length > 2 ? r * 0.68 : r * 0.88;
  return (
    `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}" fill="${teamFill(team)}" stroke="${INK}" stroke-width="${f2(stroke)}"` +
    (dashed ? ` stroke-dasharray="${f2(r * 0.19)} ${f2(r * 0.13)}"` : "") + "/>" +
    `<text x="${f2(cx)}" y="${f2(cy + size * 0.05)}" font-size="${f2(size)}" text-anchor="middle" dominant-baseline="central">${esc(tag)}</text>`
  );
}

/** The card at (x, y), its token centred on its top edge. */
function drawCard(c: Card, x: number, y: number, cw: number, m: M, co: CardOpts): string {
  const out: string[] = [];
  const empty = !c.pos.depth.length;
  out.push(`<rect x="${f2(x)}" y="${f2(y + m.shadow)}" width="${f2(cw)}" height="${f2(c.h)}" rx="${f2(m.radius)}" fill="${INK}" opacity="${f2(HAIR)}"/>`);
  out.push(
    `<rect x="${f2(x)}" y="${f2(y)}" width="${f2(cw)}" height="${f2(c.h)}" rx="${f2(m.radius)}" fill="${CREAM}" stroke="${INK}" stroke-width="${f2(m.stroke)}"` +
    (empty ? ` stroke-dasharray="${f2(9 * m.u)} ${f2(6 * m.u)}"` : "") + "/>",
  );
  const wordX = x + m.padX;
  // every line to pencil a name on starts past the widest word on it, "Starter" included, so they line up
  const blankX = wordX + Math.max(c.wordW, measure(depthWord(0), m.word) + 10 * m.u);
  const rule = (yy: number): string =>
    `<rect x="${f2(x + m.padX)}" y="${f2(yy)}" width="${f2(cw - 2 * m.padX)}" height="${f2(Math.max(0.4, 1.2 * m.u))}" fill="${INK}" opacity="${f2(HAIR)}"/>`;
  let cy = y + c.top;
  c.lines.forEach((l, i) => {
    if (l.kind === "starter") {
      const inset = 5 * m.u;
      out.push(`<rect x="${f2(x + inset)}" y="${f2(cy)}" width="${f2(cw - 2 * inset)}" height="${f2(l.h)}" rx="${f2(6 * m.u)}" fill="${YELLOW}"/>`);
      const wb = cy + 9 * m.u + m.word * 0.78;
      out.push(text(wordX, wb, m.word, l.word));
      const nb = wb + m.word * 0.22 + 3 * m.u + l.size * 0.8;
      l.lines.forEach((s, k) => out.push(text(wordX, nb + k * lineH(l.size), l.size, s)));
    } else if (l.kind === "blank") {
      const base = cy + l.h - 9 * m.u;
      out.push(text(wordX, base, m.word, l.word, { fill: MUTED }));
      out.push(`<rect x="${f2(blankX)}" y="${f2(base)}" width="${f2(x + cw - m.padX - blankX)}" height="${f2(Math.max(0.6, 1.4 * m.u))}" fill="${INK}" opacity="0.6"/>`);
    } else if (l.kind === "muted" && empty) {
      out.push(text(x + cw / 2, cy + 12 * m.u + l.size * 0.8, l.size, l.lines[0] ?? "", { fill: MUTED, anchor: "middle" }));
    } else {
      if (i > 0) out.push(rule(cy));
      const base = cy + 6.5 * m.u + l.size * 0.8;
      if (l.word) out.push(text(wordX, base, m.word, l.word, { fill: MUTED }));
      l.lines.forEach((s, k) => {
        out.push(text(l.word ? wordX + c.wordW : wordX, base + k * lineH(l.size), l.size, s, { fill: l.kind === "muted" ? MUTED : INK }));
      });
    }
    cy += l.h;
  });
  if (!c.pos.onField && co.sideTag) out.push(eyebrow(x + cw / 2, y + m.tokR + 4 * m.u + m.word * 0.62, m.word * 0.8, c.pos.team, { anchor: "middle" }));
  out.push(token(x + cw / 2, y, c.pos.team, c.pos.tag, m.tokR, m.stroke, !c.pos.onField));
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------
// The board: the formation's levels as rows of cards, defense above the LOS and offense below

interface Placed { c: Card; x: number; y: number }

/** The formation's levels: a position within 2.5 yards of a row's first is on that row (the line, the backfield). */
function levels(ps: readonly Position[]): Position[][] {
  const rows: Position[][] = [];
  for (const p of [...ps].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows[rows.length - 1];
    if (row?.[0] && p.y - row[0].y <= 2.5) row.push(p);
    else rows.push([p]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

/**
 * One side's cards from `top` down, deepest defender first and the offense's line first: each level a row,
 * each card centred under its position's own spot across the field (E14), slid sideways only as far as a
 * neighbour needs, and each row as high as the cards above it allow.
 */
function placeSide(ps: readonly Position[], W: number, cw: number, m: M, top: number, co: CardOpts): { placed: Placed[]; bottom: number } {
  const placed: Placed[] = [];
  const spot = (p: Position): number => (W * p.x) / 30;
  let prevTop = -Infinity, bottom = top;
  for (const row of levels(ps)) {
    const left = row.map((p) => Math.max(0, Math.min(W - cw, spot(p) - cw / 2)));
    for (let i = 1; i < left.length; i++) left[i] = Math.max(left[i] ?? 0, (left[i - 1] ?? 0) + cw + m.gap);
    for (let i = left.length - 1; i >= 0; i--) left[i] = Math.min(left[i] ?? 0, i === left.length - 1 ? W - cw : (left[i + 1] ?? 0) - cw - m.gap);
    const cards = row.map((p) => card(p, cw, m, co));
    let y = Math.max(top, prevTop + 2 * m.tokR + 14 * m.u);
    for (const a of left) {
      for (const q of placed) {
        if (a < q.x + cw + m.gap / 2 && q.x < a + cw + m.gap / 2) y = Math.max(y, q.y + q.c.h + m.shadow + m.tokR + 12 * m.u);
      }
    }
    cards.forEach((c, i) => {
      const a = left[i] ?? 0;
      placed.push({ c, x: a, y });
      bottom = Math.max(bottom, y + c.h + m.shadow);
    });
    prevTop = y;
  }
  return { placed, bottom };
}

/** Every card on a board is one width: as many as the busiest row holds across, up to a comfortable 380. */
const cardWidth = (W: number, n: number, m: M): number => Math.min(380 * m.u, (W - (n - 1) * m.gap) / n);

interface Layout { W: number; m: M; cw: number; placed: Placed[]; los: number; h: number; show: Vis; co: CardOpts }

/**
 * The sides on view at their natural height: the LOS under the defense's last row, the offense hanging from
 * it. Either side of the line is a lane no card or token enters, for the sides' names (E4).
 */
function layoutBoard(b: Board, show: Vis, W: number, m: M, co: CardOpts): Layout {
  const n = Math.max(1, ...sidesOf(show).flatMap((t) => levels(onField(b, t)).map((r) => r.length)));
  const cw = cardWidth(W, n, m);
  const placed: Placed[] = [];
  const pad = 20 * m.u;
  const lane = m.side + 22 * m.u;
  let los = lane + 10 * m.u, h: number;
  if (show !== "offense") {
    const d = placeSide(onField(b, "defense"), W, cw, m, pad + m.tokR, co);
    placed.push(...d.placed);
    los = d.bottom + lane;
  }
  if (show !== "defense") {
    const o = placeSide(onField(b, "offense"), W, cw, m, los + lane + m.tokR, co);
    placed.push(...o.placed);
    h = o.bottom + pad;
  } else {
    h = los + lane;
  }
  return { W, m, cw, placed, los, h, show, co };
}

/**
 * The board on turf `bh` tall (at least its own height). The spare turf goes behind the play, as more field
 * (above the defense, below the offense, split when both are on), or all under it with `spareBelow`.
 */
function drawBoard(b: Layout, x: number, y: number, bh: number, padX: number, spareBelow = false): string {
  const { m } = b;
  const extra = Math.max(0, bh - b.h);
  const oy = y + (spareBelow ? 0 : b.show === "defense" ? extra : b.show === "both" ? extra / 2 : 0);
  const ox = x + padX;
  const fw = b.W + 2 * padX;
  const r = 12 * m.u;
  const losY = oy + b.los;
  const out: string[] = [];
  out.push(`<rect x="${f2(x)}" y="${f2(y + 8 * m.u)}" width="${f2(fw)}" height="${f2(bh)}" rx="${f2(r)}" fill="${INK}" opacity="${f2(HAIR)}"/>`);
  out.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(fw)}" height="${f2(bh)}" rx="${f2(r)}" fill="${TURF}"/>`);
  // faint lines out from the LOS, as the field draws its yard lines: turf, not a scale
  const pitch = 92 * m.u;
  for (let k = -60; k <= 60; k++) {
    const ly = losY + k * pitch;
    if (k === 0 || ly <= y + 4 * m.u || ly >= y + bh - 4 * m.u) continue;
    out.push(`<rect x="${f2(x)}" y="${f2(ly - 0.8 * m.u)}" width="${f2(fw)}" height="${f2(1.6 * m.u)}" fill="${INK}" opacity="0.2"/>`);
  }
  out.push(rect(x, losY - 2.25 * m.u, fw, 4.5 * m.u, INK));
  // the sides named in ink, either side of the line, where no token goes; the line itself named at its end
  const s = m.side;
  if (b.show !== "offense") out.push(eyebrow(x + 16 * m.u, losY - 12 * m.u, s, "Defense"));
  if (b.show !== "defense") out.push(eyebrow(x + 16 * m.u, losY + 12 * m.u + s * 0.74, s, "Offense"));
  out.push(eyebrow(x + fw - 16 * m.u, b.show === "defense" ? losY + 12 * m.u + s * 0.6 : losY - 12 * m.u, s * 0.8, "LOS", { anchor: "end" }));
  for (const p of b.placed) out.push(drawCard(p.c, ox + p.x, oy + p.y, b.cw, m, b.co));
  out.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(fw)}" height="${f2(bh)}" rx="${f2(r)}" fill="none" stroke="${INK}" stroke-width="${f2(3.5 * m.u)}"/>`);
  return out.join("");
}

// ---------------------------------------------------------------------------------------------------------
// Not in this formation: tags with a chart and no token (H, FS), on a shelf by the turf in board order (E7)

const SHELF = "Not in this formation";
const SHELF_NOTE = "Positions with no spot in the formation.";

interface Shelf { h: number; rowH: number[]; draw: (x: number, y: number) => string }

function layoutShelf(ps: readonly Position[], W: number, cw: number, m: M, co: CardOpts, heading = true): Shelf | null {
  if (!ps.length) return null;
  const per = Math.max(1, Math.floor((W + m.gap) / (cw + m.gap)));
  const noteSize = m.word * 0.95;
  const head = (heading ? m.eyebrow * 0.78 + 10 * m.u + noteSize + 14 * m.u : 0) + m.tokR;
  const cards = ps.map((p) => card(p, cw, m, co));
  const rows = Math.ceil(cards.length / per);
  const rowH = Array.from({ length: rows }, (_, r) => Math.max(...cards.slice(r * per, r * per + per).map((c) => c.h)) + m.shadow);
  const rowGap = m.tokR + 14 * m.u;
  const h = head + rowH.reduce((n, rh) => n + rh, 0) + (rows - 1) * rowGap;
  return {
    h,
    // what each row costs: its own height, and the head or the gap above it
    rowH: rowH.map((rh, r) => rh + (r ? rowGap : head)),
    draw: (x, y) => {
      const out = heading ? [eyebrow(x, y + m.eyebrow * 0.78, m.eyebrow, SHELF), text(x, y + m.eyebrow * 0.78 + 10 * m.u + noteSize * 0.85, noteSize, SHELF_NOTE, { fill: MUTED })] : [];
      let ry = y + head;
      for (let r = 0; r < rows; r++) {
        cards.slice(r * per, r * per + per).forEach((c, i) => { out.push(drawCard(c, x + i * (cw + m.gap), ry, cw, m, co)); });
        ry += (rowH[r] ?? 0) + rowGap;
      }
      return out.join("");
    },
  };
}

const shelfOf = (b: Board, show: Vis): Position[] => sidesOf(show).flatMap((t) => offField(b, t));

interface Fit { b: Layout; shelf: Shelf | null; gap: number; padX: number; ok: boolean }
/** One way to try the board: charts cut to `maxDepth` lines, at units from the largest down to `uMin`. */
interface Step { maxDepth: number; uMin: number }

/**
 * The board and its shelf in a box: the largest unit down to each step's floor that fits, the steps in turn
 * (E9). `ok` is false when even the last step's smallest overflows.
 */
function fitBoard(b: Board, show: Vis, W: number, H: number, padX: number, uMax: number, steps: readonly Step[], co: Omit<CardOpts, "maxDepth">): Fit {
  const at = (u: number, maxDepth: number): Fit => {
    const m = metrics(u);
    const opts = { ...co, maxDepth };
    const lay = layoutBoard(b, show, W - 2 * padX * u, m, opts);
    const shelf = layoutShelf(shelfOf(b, show), W, lay.cw, m, opts);
    const gap = shelf ? 28 * u : 0;
    return { b: lay, shelf, gap, padX: padX * u, ok: lay.h + gap + (shelf?.h ?? 0) <= H };
  };
  for (const s of steps) {
    for (let u = uMax; u >= s.uMin - 1e-9; u -= 0.01) {
      const f = at(u, s.maxDepth);
      if (f.ok) return f;
    }
  }
  const last = steps[steps.length - 1] ?? { maxDepth: Infinity, uMin: uMax };
  return at(last.uMin, last.maxDepth);
}

// ---------------------------------------------------------------------------------------------------------
// The picture: the board on a phone-sized canvas

/**
 * One canvas per view. A side alone is the play card's 4:5 portrait, 1080 x 1350: full screen on a phone,
 * uncropped in a group chat, and a postcard if it is printed. Both sides are a phone screen's 9:16, 1080 x
 * 1920: the same width, so a card is as large as on a side's own picture, the defense above the offense.
 */
export const PICTURE_SIZE: Readonly<Record<Vis, { w: number; h: number }>> = {
  offense: { w: 1080, h: 1350 },
  defense: { w: 1080, h: 1350 },
  both: { w: 1080, h: 1920 },
};

const VIEW_WORDS: Record<Vis, string> = { offense: "Offense depth chart", defense: "Defense depth chart", both: "Offense and defense depth chart" };

/**
 * Below this unit a backup's name is under 24px, about 8pt on a phone held at arm's length: a long chart is
 * cut to "+n more on the sheet" first, and only a crowd that still won't fit goes smaller (E9).
 */
const PHONE_U = 0.9;
const PICTURE_STEPS: readonly Step[] = [
  { maxDepth: Infinity, uMin: PHONE_U }, { maxDepth: 6, uMin: PHONE_U }, { maxDepth: 4, uMin: PHONE_U }, { maxDepth: 3, uMin: PHONE_U }, { maxDepth: 3, uMin: 0.62 },
];

/** The picture's gaps on the sides on view, one line each kind, for whoever it is sent to (E6). */
function gapLine(b: Board, show: Vis): string {
  return gapsOf(b, show).filter((g) => g.items.length).map((g) => `${g.head}: ${g.items.join(", ")}`).join(" · ");
}

/** The roster's picture: the side on view (or both) of the lineup on the field, every chart under its position. */
export function rosterPicture(o: RosterExport & { view: Vis }): SvgPage {
  const v = boardOf(o);
  const show = o.view;
  const { w: W, h: H } = PICTURE_SIZE[show];
  const mx = 44, tx = mx + 12, tw = W - 2 * tx;
  const out: string[] = [rect(0, 0, W, H, GROUND)];
  // the team band, its name in ink or cream as reads better on it (E3)
  const bandH = 128;
  out.push(rect(0, 0, W, bandH, v.band) + rect(0, bandH, W, 6, INK));
  out.push(text(tx, bandH / 2 + 21, 60, cut(v.team, tw, 60), { fill: onBand(v.band) }));
  // the side in words, since the tokens print the same grey on a mono printer (E4), then the lineup
  let y = bandH + 6 + 54;
  out.push(eyebrow(tx, y, 25, VIEW_WORDS[show]));
  y += 62;
  out.push(text(tx, y, 56, cut(v.lineup, tw, 56)));
  // the gaps on view, over the foot, wrapped at its stops
  const empty = nobody(allOf(v, show));
  const gaps = empty ? [] : wrapWords(gapLine(v, show), tw, 24, 3);
  // under the lineup, what it is made from; a side with nobody on it says so in the spare turf, as the app's
  // empty states do (a dashed box), or under the lineup when the board leaves no room for one (E16); `below`
  // are the lines over the foot
  const lay = (b: Board, notes: readonly string[], below: readonly string[]) => {
    const foot = H - 72 - (below.length ? below.length * 32 + 14 : 0);
    const top = y + notes.length * 38 + 34;
    const avail = foot - top;
    const fit = fitBoard(b, show, W - 2 * mx, avail, 22, 1.3, PICTURE_STEPS, { pencil: false, sideTag: show === "both" });
    const bh = Math.max(fit.b.h, avail - (fit.shelf ? fit.gap + fit.shelf.h : 0));
    return { b, notes, below, foot, top, fit, bh, spare: bh - fit.b.h };
  };
  let l = lay(v, v.note ? [v.note] : [], gaps);
  // a crowd of positions not in the formation that won't fit beside the board: named in a line, drawn on the sheet (E9)
  const off = shelfOf(v, show);
  if (!l.fit.ok && off.length) {
    const named = wrapWords(`${SHELF}, on the sheet: ${off.map((p) => p.tag).join(", ")}`, tw, 24, 2);
    l = lay({ ...v, offense: onField(v, "offense"), defense: onField(v, "defense") }, l.notes, [...named, ...gaps]);
  }
  if (empty && l.spare < 220) l = lay(l.b, [...l.notes, EMPTY], l.below);
  const { top, fit, bh, spare, foot } = l;
  l.notes.forEach((n, i) => out.push(text(tx, y + 38 * (i + 1), 25, cut(n, tw, 25), { fill: MUTED })));
  const emptyState = empty && spare >= 220;
  out.push(drawBoard(fit.b, mx, top, bh, fit.padX, emptyState));
  if (emptyState) out.push(emptyBox(W / 2, top + fit.b.h + spare / 2, Math.min(760, W - 2 * mx - 80)));
  if (fit.shelf) out.push(fit.shelf.draw(mx, top + bh + fit.gap));
  l.below.forEach((g, i) => out.push(text(tx, foot + 14 + 24 + i * 32, 24, g)));
  out.push(text(mx, H - 32, 22, cut(`${v.team} · ${v.lineup} · ${v.day}`, W * 0.55 - mx, 22), { fill: MUTED }));
  out.push(appMark(W - mx, H - 32, 20));
  return page(W, H, out.join(""));
}

const EMPTY = "Nobody is on this depth chart yet.";

/** The empty state: a dashed cream box saying what's missing, centred at (cx, cy). */
function emptyBox(cx: number, cy: number, w: number): string {
  const h = 120;
  return (
    `<rect x="${f2(cx - w / 2)}" y="${f2(cy - h / 2)}" width="${f2(w)}" height="${f2(h)}" rx="14" fill="${CREAM}" stroke="${INK}" stroke-width="3" stroke-dasharray="12 8"/>` +
    text(cx, cy + 13, 38, EMPTY, { anchor: "middle" })
  );
}

// ---------------------------------------------------------------------------------------------------------
// The sheet: page 1 the board of both sides (or a side a page), then the tags not in the formation if they
// crowd it, then the team

const MARGIN = 36; // half an inch
const FOOT = 40; // the footer's band at the page's foot
const BAND_TOP = 24; // the band inside the printer's margin (E10)
const BAND_H = 34;

interface Head { kicker: string; title: string; sub: string | null; aside?: string }

/** A page's head (the team band, a kicker, the title and a muted line) and its foot. `top` is where the body starts. */
function sheetFrame(v: Board, W: number, H: number, head: Head, n: number, of: number): { body: string; top: number } {
  const out: string[] = [];
  const cw = W - 2 * MARGIN;
  out.push(`<rect x="${f2(MARGIN)}" y="${f2(BAND_TOP)}" width="${f2(cw)}" height="${f2(BAND_H)}" rx="7" fill="${v.band}" stroke="${INK}" stroke-width="1.5"/>`);
  out.push(text(MARGIN + 12, BAND_TOP + BAND_H / 2 + 7, 20, cut(v.team, cw - 24, 20), { fill: onBand(v.band) }));
  let y = BAND_TOP + BAND_H + 19;
  out.push(eyebrow(MARGIN, y, 9, head.kicker));
  y += 22;
  const asideW = head.aside ? measure(head.aside, 10.5) + 16 : 0;
  if (head.aside) out.push(text(W - MARGIN, y, 10.5, head.aside, { anchor: "end", fill: MUTED }));
  out.push(text(MARGIN, y, 22, cut(head.title, cw - asideW, 22)));
  if (head.sub) { y += 16; out.push(text(MARGIN, y, 10.5, cut(head.sub, cw, 10.5), { fill: MUTED })); }
  out.push(text(MARGIN, H - 22, 8, cut(`${v.team} · ${v.lineup} · ${v.day} · page ${String(n)} of ${String(of)}`, cw * 0.62, 8), { fill: MUTED }));
  out.push(appMark(W - MARGIN, H - 22, 7));
  return { body: out.join(""), top: y + 12 };
}

/** Below this unit a backup's name would print under about 10pt: the sheet goes on over more pages instead (E9). */
const PRINT_MIN_U = 0.37;
const PRINT_MAX_U = 0.62;
const PRINT: Omit<CardOpts, "maxDepth"> = { pencil: true, sideTag: true };

type PageFn = (n: number, of: number) => SvgPage;

const count = (n: number, one: string, many: string): string => `${String(n)} ${n === 1 ? one : many}`;

/** The roster's sheet, every page of it: the board, the tags not in the formation when they crowd it, the team. */
export function rosterSheet(o: RosterExport & { paper: Paper }): SvgPage[] {
  const v = boardOf(o);
  const { w: W, h: H } = o.paper;
  const cw = W - 2 * MARGIN;
  const bottom = H - FOOT;
  const pages: PageFn[] = [];
  const nPos = v.offense.length + v.defense.length;
  const aside = `${count(nPos, "position", "positions")} · ${count(v.players.length, "player", "players")}`;
  const boardPage = (b: Board, show: Vis, title: string, more = false): { fit: Fit; page: PageFn } => {
    const head: Head = { kicker: (show === "both" ? "Depth chart" : VIEW_WORDS[show]) + (more ? ", continued" : ""), title, sub: v.note, aside };
    const top = sheetFrame(v, W, H, head, 1, 1).top;
    const fit = fitBoard(b, show, cw, bottom - top, 16, PRINT_MAX_U, [{ maxDepth: Infinity, uMin: PRINT_MIN_U }], PRINT);
    return {
      fit,
      page: (n, of) => {
        const fr = sheetFrame(v, W, H, head, n, of);
        const bh = Math.max(fit.b.h, bottom - fr.top - (fit.shelf ? fit.gap + fit.shelf.h : 0));
        return page(W, H, fr.body + drawBoard(fit.b, MARGIN, fr.top, bh, fit.padX) + (fit.shelf ? fit.shelf.draw(MARGIN, fr.top + bh + fit.gap) : ""));
      },
    };
  };
  // both sides on one page with the tags not in the formation under them; else those tags on pages of their
  // own; else a side a page: never smaller than the print floor (E9)
  const field: Board = { ...v, offense: onField(v, "offense"), defense: onField(v, "defense") };
  let one = boardPage(v, "both", v.lineup);
  const crowded = !one.fit.ok && shelfOf(v, "both").length > 0;
  if (crowded) one = boardPage(field, "both", v.lineup);
  // a side a page, and a side too deep for one page on over more, its formation's levels in order: one level
  // of cards always fits a page at the print floor, so nothing is drawn over the foot or off the page (E9)
  const sidePages = (t: Team): PageFn[] => {
    const out: PageFn[] = [];
    const part = (rows: Position[][]): Board => (t === "offense" ? { ...field, offense: rows.flat() } : { ...field, defense: rows.flat() });
    let rows = levels(onField(v, t));
    while (rows.length) {
      let k = rows.length;
      while (k > 1 && !boardPage(part(rows.slice(0, k)), t, v.lineup).fit.ok) k--;
      out.push(boardPage(part(rows.slice(0, k)), t, v.lineup, out.length > 0).page);
      rows = rows.slice(k);
    }
    return out;
  };
  if (one.fit.ok) pages.push(one.page);
  else for (const t of sidesOf("both")) pages.push(...sidePages(t));
  const u = Math.max(PRINT_MIN_U, one.fit.b.m.u);
  if (crowded) pages.push(...shelfPages(v, W, H, u));
  pages.push(...teamPages(v, W, H));
  return pages.map((f, i) => f(i + 1, pages.length));
}

/** The tags not in the formation on pages of their own, at the board's card size: a row of cards never split. */
function shelfPages(v: Board, W: number, H: number, u: number): PageFn[] {
  const cw = W - 2 * MARGIN;
  const bottom = H - FOOT;
  const head: Head = { kicker: "Depth chart", title: SHELF, sub: SHELF_NOTE };
  const top = sheetFrame(v, W, H, head, 1, 1).top + 6;
  const m = metrics(u);
  const width = cardWidth(cw, 4, m);
  const co: CardOpts = { ...PRINT, maxDepth: Infinity };
  const all = shelfOf(v, "both");
  const whole = layoutShelf(all, cw, width, m, co, false);
  const per = Math.max(1, Math.floor((cw + m.gap) / (width + m.gap)));
  const rowGap = m.tokR + 14 * m.u;
  const chunks: Position[][] = [];
  let used = Infinity;
  (whole?.rowH ?? []).forEach((rh, r) => {
    const own = rh - (r ? rowGap : m.tokR);
    const row = all.slice(r * per, r * per + per);
    if (used + rowGap + own > bottom - top) { chunks.push([...row]); used = m.tokR + own; }
    else { chunks[chunks.length - 1]?.push(...row); used += rowGap + own; }
  });
  return chunks.map((chunk) => {
    const s = layoutShelf(chunk, cw, width, m, co, false);
    return (n: number, of: number) => {
      const fr = sheetFrame(v, W, H, head, n, of);
      return page(W, H, fr.body + (s ? s.draw(MARGIN, fr.top + 6) : ""));
    };
  });
}

// ---------------------------------------------------------------------------------------------------------
// The team: the gaps to fill, then every player against every position

interface Column { team: Team; tag: string; onField: boolean; deep: number }
interface Row { pl: Member; name: Fitted; sits: string[]; h: number }

const NAME_W = 178; // a forty-letter name fits whole on two lines at 9.5pt
const GROUP_GAP = 12;
const MIN_COL = 18;
const GRID_HEAD = 56;
const SITS = 8;
const KEY_H = 22;

function teamPages(v: Board, W: number, H: number): PageFn[] {
  const cw = W - 2 * MARGIN;
  const bottom = H - FOOT;
  const cols = (t: Team): Column[] => sideOf(v, t).map((p) => ({ team: t, tag: p.tag, onField: p.onField, deep: p.depth.length }));
  const colW = (groups: Column[][]): number =>
    Math.min(34, (cw - NAME_W - GROUP_GAP * (groups.length - 1)) / Math.max(1, groups.reduce((n, g) => n + g.length, 0)));
  // one grid of both sides while a column is at least 18pt; else a grid a side, each down the whole team, a
  // side with more positions than a page holds at 18pt in grids of as many as it does (E9)
  const both = [cols("offense"), cols("defense")].filter((g) => g.length);
  const most = Math.max(1, Math.floor((cw - NAME_W) / MIN_COL));
  const chunks = (g: Column[]): Column[][] => Array.from({ length: Math.ceil(g.length / most) }, (_, i) => g.slice(i * most, i * most + most));
  const grids: Column[][][] = colW(both) >= MIN_COL ? [both] : both.flatMap((g) => chunks(g).map((c) => [c]));
  const empty = nobody([...v.offense, ...v.defense]);

  const rows: Row[] = v.players.map((pl) => {
    const name = fitName(pl.name, NAME_W - 10, [10.5, 9.5], 2);
    const sits = wrapList(pl.sits, NAME_W - 10, SITS, 3);
    return { pl, name, sits, h: 9 + name.lines.length * name.size * 1.12 + sits.length * SITS * 1.2 };
  });

  const head = (cont: boolean): Head => ({ kicker: "The team", title: cont ? "Who plays where, continued" : "Who plays where", sub: `${v.lineup} · ${count(v.players.length, "player", "players")}` });
  const gapsH = gapsHeight(v, cw);
  const pages: PageFn[] = [];
  let first = true;
  for (const grid of grids) {
    let i = 0;
    do {
      const withGaps = first;
      const top = sheetFrame(v, W, H, head(!first), 1, 1).top;
      let y = top + 6 + (withGaps ? gapsH + 18 : 0) + GRID_HEAD;
      const from = i;
      while (i < rows.length && y + (rows[i]?.h ?? 0) <= bottom - KEY_H) { y += rows[i]?.h ?? 0; i++; }
      if (i === from && i < rows.length) i++;
      const slice = rows.slice(from, i);
      const cont = !first;
      pages.push((n, of) => {
        const fr = sheetFrame(v, W, H, head(cont), n, of);
        const out = [fr.body];
        let gy = fr.top + 6;
        if (withGaps) { out.push(drawGaps(v, MARGIN, gy, cw)); gy += gapsH + 18; }
        out.push(drawGrid(grid, slice, MARGIN, gy, colW(grid), empty));
        return page(W, H, out.join(""));
      });
      first = false;
    } while (i < rows.length);
  }
  return pages;
}

const GAP_SIZE = 11;

/** The gaps box's say: one line when nothing is filled in yet or nothing is missing, else a column a kind. */
function gapColumns(v: Board, cw: number): { head: string; lines: string[]; ink: boolean; w: number }[] {
  const all = [...v.offense, ...v.defense];
  if (nobody(all)) return [{ head: "", lines: ["Every position is open: fill in the depth chart in pencil."], ink: true, w: cw - 28 }];
  const gaps = gapsOf(v);
  if (gaps.every((g) => !g.items.length)) return [{ head: "", lines: ["No gaps: every position has a starter and a backup, and everyone is on a chart."], ink: true, w: cw - 28 }];
  const w = (cw - 28 - 2 * 18) / 3;
  const totals = [all.length, all.length, v.players.length];
  const nouns = ["positions", "positions", "players"];
  return gaps.map((g, i) => {
    const total = totals[i] ?? 0;
    const lines = !g.items.length ? ["None"]
      : g.items.length === total && total > 2 ? [`All ${String(total)} ${nouns[i] ?? ""}`]
      : listWithMore(g.items, w, GAP_SIZE, 4);
    return { head: g.head, lines, ink: g.items.length > 0, w };
  });
}

/** Items joined with commas over at most `max` lines, the last saying "and n more" when they don't all fit. */
function listWithMore(items: readonly string[], width: number, size: number, max: number): string[] {
  for (let k = items.length; k >= 1; k--) {
    const rest = items.length - k;
    const s = items.slice(0, k).join(", ") + (rest ? ` and ${String(rest)} more` : "");
    const lines = wrapList(s, width, size, Infinity);
    if (lines.length <= max && lines.every((l) => !l.endsWith("…"))) return lines;
  }
  if (items.length === 1) return wrapWords(items[0] ?? "", width, size, max);
  return [cut(items[0] ?? "", width, size), `and ${String(items.length - 1)} more`];
}

const gapsHeight = (v: Board, cw: number): number => {
  const cols = gapColumns(v, cw);
  return (cols.some((c) => c.head) ? 40 : 26) + Math.max(...cols.map((c) => c.lines.length)) * GAP_SIZE * 1.3;
};

function drawGaps(v: Board, x: number, y: number, cw: number): string {
  const h = gapsHeight(v, cw);
  const out: string[] = [];
  out.push(`<rect x="${f2(x)}" y="${f2(y + 3)}" width="${f2(cw)}" height="${f2(h)}" rx="7" fill="${INK}" opacity="${f2(HAIR)}"/>`);
  out.push(`<rect x="${f2(x)}" y="${f2(y)}" width="${f2(cw)}" height="${f2(h)}" rx="7" fill="${CREAM}" stroke="${INK}" stroke-width="1.5"/>`);
  out.push(eyebrow(x + 14, y + 17, 9, "Gaps to fill"));
  gapColumns(v, cw).forEach((c, i) => {
    const cx = x + 14 + i * (c.w + 18);
    const first = c.head ? y + 31 + 14 : y + 33;
    if (c.head) out.push(text(cx, y + 31, 9.5, c.head, { fill: MUTED }));
    c.lines.forEach((l, k) => out.push(text(cx, first + k * GAP_SIZE * 1.3, GAP_SIZE, l, { fill: c.ink ? INK : MUTED })));
  });
  return out.join("");
}

/**
 * The grid: a row a player (name, then where they play in words), a column a position under its token with
 * how deep it is, and in each cell the player's line on that chart: 1 on the highlighter for a starter. A
 * column one deep or none is said in ink, so the thin spots stand out; with nobody on any chart the cells
 * are left clear to pencil in.
 */
function drawGrid(groups: Column[][], rows: readonly Row[], x: number, y: number, colW: number, empty: boolean): string {
  const out: string[] = [];
  const r = Math.max(2, Math.min(9.5, colW / 2 - 3));
  const cells: { c: Column; cx: number }[] = [];
  let cx = x + NAME_W;
  groups.forEach((g, gi) => {
    if (gi > 0) cx += GROUP_GAP;
    const gx = cx;
    for (const c of g) { cells.push({ c, cx: cx + colW / 2 }); cx += colW; }
    out.push(eyebrow(gx + 2, y + 10, 8.5, g[0]?.team ?? ""));
    out.push(rect(gx, y + 15, cx - gx, 1, INK));
  });
  const right = cx;
  out.push(eyebrow(x, y + 10, 8.5, "Player"));
  const tokY = y + 22 + r;
  for (const { c, cx: ccx } of cells) {
    out.push(token(ccx, tokY, c.team, c.tag, r, 1.2, !c.onField));
    const deep = `${String(c.deep)} deep`;
    const size = Math.max(6, Math.min(7.5, ((colW - 2) / measure(deep, 7.5)) * 7.5));
    out.push(text(ccx, tokY + r + 10.5, size, deep, { anchor: "middle", fill: c.deep <= 1 ? INK : MUTED }));
  }
  let ry = y + GRID_HEAD;
  out.push(rect(x, ry - 1.2, right - x, 1.2, INK));
  rows.forEach((row, i) => {
    if (i > 0) out.push(`<rect x="${f2(x)}" y="${f2(ry)}" width="${f2(right - x)}" height="0.8" fill="${INK}" opacity="${f2(HAIR)}"/>`);
    let ty = ry + 4.8 + row.name.size * 0.8;
    for (const l of row.name.lines) { out.push(text(x + 2, ty, row.name.size, l)); ty += row.name.size * 1.12; }
    ty -= 0.5;
    for (const l of row.sits) { out.push(text(x + 2, ty, SITS, l, { fill: MUTED })); ty += SITS * 1.2; }
    const mid = ry + row.h / 2;
    for (const { c, cx: ccx } of cells) {
      const at = row.pl.at.find((a) => a.team === c.team && a.tag === c.tag);
      if (!at) { if (!empty) out.push(`<circle cx="${f2(ccx)}" cy="${f2(mid)}" r="1.3" fill="${INK}" opacity="0.25"/>`); continue; }
      if (at.depth === 0) out.push(`<circle cx="${f2(ccx)}" cy="${f2(mid)}" r="${f2(Math.max(2, Math.min(8.5, colW / 2 - 3)))}" fill="${YELLOW}" stroke="${INK}" stroke-width="1"/>`);
      out.push(text(ccx, mid + 3.6, 10.5, String(at.depth + 1), { anchor: "middle" }));
    }
    ry += row.h;
  });
  out.push(rect(x, ry, right - x, 1.2, INK));
  const dashed = cells.some(({ c }) => !c.onField) ? ` A dashed tag is ${SHELF.toLowerCase()}.` : "";
  out.push(text(x, ry + 15, 8.5, `1 on yellow is the starter; 2, 3 and on are next up, in order.${dashed}`, { fill: MUTED }));
  return out.join("");
}

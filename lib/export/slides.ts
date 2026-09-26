/**
 * The slide deck for a team meeting, composed as 960 × 540 pt SVG faces in the hand face: a
 * title slide, the plays at a glance six to a slide (only for two or more plays), then one
 * slide per play with its field, a "who does what" panel and the coach's points. Each face
 * comes with its hidden title, alt text and speaker notes, which carry the full text any
 * face had to cut.
 *
 * What can go wrong with the text:
 *
 * - T1 XML metacharacters in a name, notes or label: the faces go through `esc()` in
 *   pages.ts, and the package escapes titles, alt text and notes.
 * - T2, T3 C0 controls, U+FFFE/U+FFFF and lone surrogates: everything is cleaned once, up
 *   front, in `slidePlans`, before anything is measured or drawn.
 * - T4 newlines: titles and names are one line; the notes keep the coach's own line breaks.
 * - T5 blank names: the book becomes "Playbook", a play "Untitled play", and a blank team is
 *   "Flag football" on the band and left out of the notes, alt text and footer.
 * - T6 two plays with one name: titles are "<n> · <name>".
 * - T7 a bad team colour: `safeColor` falls back to the design's yellow.
 * - T8 long names or notes: `fit()` and `wrap()` end the face's text with "…"; the title,
 *   alt text and notes keep all of it.
 * - T9 is the journey's to guard: it proves the hostile text reached storage.
 *
 * And with the layout:
 *
 * - L1 job rows crowding out the coach's notes: three lines of notes are reserved, and rows
 *   step down from 26 pt to 22 pt, then to one line each, then to "+m more in the speaker
 *   notes", before any note is cut.
 * - L2, L3, L5 players with no route or label, a deleted man target, a play with no routes:
 *   the words come from lib/play/assignments.ts.
 * - L4 nobody on the play's own side: "Nobody on this side yet." on the face, in the alt
 *   text and in the notes.
 * - L6 route labels clipped at the sideline: play-svg.ts keeps them on the field.
 * - L7 measuring before the face has loaded: `slidePlans` measures, so it runs inside the
 *   thunk `exportSlides` calls after `ensureFont()`.
 */

import { assignmentLine, assignments, callLine, callName, headerLine, type Assignment } from "@/lib/play/assignments";
import { teamFill } from "@/lib/play/geometry";
import type { Team, TeamSettings } from "@/lib/play/types";
import { esc } from "@/lib/render/play-svg";
import { fitField, playSlot } from "./binder";
import { playShow, type Numbered } from "./numbered";
import { CREAM, INK, MUTED, YELLOW, appMark, badge, f2, field, page, pill, rect, text, type SvgPage } from "./pages";
import type { Box } from "./pptx";
import { measure, wrap } from "./raster";
import { fit } from "./wristband";
import { clean, oneLine } from "./xml";

/** points, and the pixels each face is drawn at: 2 px/pt, 1080p */
export const SLIDE_W = 960, SLIDE_H = 540, SLIDE_PX = 1920, SLIDE_PY = 1080, GLANCE = 6;
/** the design's paper */
export const SLIDE_BG = "#f4efe2";
const SOFT = "#ffe9a8";
const RED = "#c2261a";

export interface SlidesOptions {
  bookName: string;
  team: TeamSettings;
}

export interface SlidePlan {
  page: SvgPage;
  title: string;
  titleBox: Box;
  /** points */
  titleSize: number;
  alt: string;
  notes: string;
}

export interface DeckPlan {
  title: string;
  /** the team colour, as #rrggbb */
  band: string;
  slides: SlidePlan[];
}

/** A title slide, a glance slide per six plays when there are two or more, and one slide per play. */
export function slideCount(plays: number): number {
  return plays === 0 ? 0 : 1 + (plays > 1 ? Math.ceil(plays / GLANCE) : 0) + plays;
}

/** The team colour when it is #rrggbb, else the design's yellow. */
export function safeColor(c: string): string {
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : YELLOW;
}

function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Ink or cream, whichever reads better on the band (WCAG contrast). */
export function onBand(bg: string): string {
  return contrast(INK, bg) >= contrast(CREAM, bg) ? INK : CREAM;
}

const TITLE_BOX: Box = { x: 48, y: 226, w: 864, h: 80 };
const GLANCE_BOX: Box = { x: 36, y: 26, w: 600, h: 48 };
const PLAY_BOX: Box = { x: 100, y: 32, w: 600, h: 48 };

const nPlays = (n: number): string => `${String(n)} ${n === 1 ? "play" : "plays"}`;

/** The glance and play slides' ground: the paper, and the team strip that matches the master's. */
function paper(band: string): string {
  return rect(0, 0, SLIDE_W, SLIDE_H, SLIDE_BG) + rect(0, 0, SLIDE_W, 10, band) + rect(0, 10, SLIDE_W, 2, INK);
}

function footer(teamName: string, bookTitle: string): string {
  const who = [teamName, bookTitle].filter(Boolean).join(" · ");
  return text(36, 528, 12, fit(who, 520, 12), { fill: MUTED }) + appMark(924, 528, 11);
}

function titleSlide(items: readonly Numbered[], bookTitle: string, teamName: string, band: string): SlidePlan {
  const out: string[] = [rect(0, 0, SLIDE_W, SLIDE_H, SLIDE_BG), rect(0, 0, SLIDE_W, 168, band), rect(0, 168, SLIDE_W, 4, INK)];
  out.push(text(48, 106, 48, fit(teamName || "Flag football", 864, 48), { fill: onBand(band) }));
  const bk = fit(bookTitle, 864, 64);
  out.push(rect(42, 264, Math.min(864, measure(bk, 64)) + 12, 30, YELLOW));
  out.push(text(48, 290, 64, bk));
  const n = items.length, d = items.filter((i) => i.play.side === "defense").length;
  const sub = nPlays(n) + (d > 0 ? ` · ${String(n - d)} offense, ${String(d)} defense` : "");
  out.push(text(48, 350, 30, sub, { fill: MUTED }));
  out.push(text(48, 510, 16, "5v5 flag", { fill: MUTED }) + appMark(912, 510, 12));
  return {
    page: page(SLIDE_W, SLIDE_H, out.join("")),
    title: bookTitle,
    titleBox: TITLE_BOX,
    titleSize: 40,
    alt: `Title slide: ${bookTitle}${teamName ? `, ${teamName}` : ""}. ${sub}.`,
    notes: [[bookTitle, teamName].filter(Boolean).join(" · "), `${nPlays(n)}, in book order:`, ...items.map(headerLine)].join("\n"),
  };
}

function glanceSlide(slice: readonly Numbered[], total: number, bookTitle: string, teamName: string, band: string): SlidePlan {
  const a = slice[0]?.n ?? 0, b = slice[slice.length - 1]?.n ?? 0;
  const range = a === b ? String(a) : `${String(a)}–${String(b)}`;
  const out: string[] = [paper(band)];
  out.push(text(36, 62, 36, "Plays at a glance"));
  out.push(text(924, 62, 22, `${range} of ${String(total)}`, { anchor: "end", fill: MUTED }));
  slice.forEach((item, i) => {
    const col = i % 3, row = Math.floor(i / 3);
    out.push(playSlot(item, 36 + col * 304, 88 + row * 218, 280, 196, undefined, 16, 24, 2));
  });
  out.push(footer(teamName, bookTitle));
  return {
    page: page(SLIDE_W, SLIDE_H, out.join("")),
    title: `Plays at a glance · ${range}`,
    titleBox: GLANCE_BOX,
    titleSize: 32,
    alt: `Plays at a glance, ${range} of ${String(total)}: ${slice.map((i) => `${String(i.n)} ${i.play.name}`).join("; ")}.`,
    notes: slice.map(headerLine).join("\n"),
  };
}

/** A player's token as on the field: the team's disc, the label in it, or a blank disc. */
function token(cx: number, cy: number, r: number, team: Team, label: string): string {
  return (
    `<circle cx="${f2(cx)}" cy="${f2(cy)}" r="${f2(r)}" fill="${teamFill(team)}" stroke="${INK}" stroke-width="2"/>` +
    (label
      ? `<text x="${f2(cx)}" y="${f2(cy + 1)}" font-size="${f2(label.length > 2 ? r - 1 : r + 2)}" text-anchor="middle"` +
        ` dominant-baseline="central">${esc(label)}</text>`
      : "")
  );
}

interface Row {
  a: Assignment;
  lines: string[];
  h: number;
}

// the panel's inside: text from X0 to XR, the last baseline no lower than BOTTOM
const X0 = 596, XR = 904, BOTTOM = 492, TOP = 136;

/**
 * One row per player at `s` pt, their job over at most two lines, or one fitted line. Rows
 * take what `budget` allows: 26 pt, then 22 pt, then one line each, then the first rows and
 * a count of the rest.
 */
function panelRows(as: readonly Assignment[], budget: number): { s: number; rows: Row[]; more: number } {
  const layout = (s: number, maxLines: number): Row[] => {
    const r = s === 26 ? 16 : 14, lead = s + 6, tx = X0 + 2 * r + 12;
    return as.map((a) => {
      const t = a.job + (a.primary ? " ★" : "");
      const lines = maxLines === 1 ? [fit(t, XR - tx, s)] : wrap(t, XR - tx, s, maxLines);
      return { a, lines, h: Math.max(2 * r + 8, lines.length * lead + 8) };
    });
  };
  const fits = (rows: readonly Row[]): boolean => rows.reduce((m, row) => m + row.h, 0) <= budget;
  const big = layout(26, 2);
  if (fits(big)) return { s: 26, rows: big, more: 0 };
  const two = layout(22, 2);
  if (fits(two)) return { s: 22, rows: two, more: 0 };
  const one = layout(22, 1);
  if (fits(one)) return { s: 22, rows: one, more: 0 };
  const k = Math.floor((budget - 36) / 36);
  return { s: 22, rows: one.slice(0, k), more: one.length - k };
}

function playSlide(item: Numbered, bookTitle: string, teamName: string, band: string): SlidePlan {
  const play = item.play, show = playShow(play), notes = play.notes;
  const out: string[] = [paper(band)];

  // header, centred on y = 56: number, name, the call
  out.push(badge(62, 56, 26, item.n));
  let right = 924;
  const call = callName(play);
  if (call) {
    const pw = Math.ceil(measure(call, 24)) + 44;
    out.push(pill(924 - pw, 56, 24, call, pw, play.side === "defense" ? "#ffffff" : SOFT));
    right = 924 - pw - 20;
  }
  out.push(text(100, 70, 40, fit(play.name, right - 100, 40)));

  // the field, on a hard shadow
  const f = fitField(play.players, 520, 408, show);
  const fx = 36 + (520 - f.w) / 2, fy = 100;
  out.push(`<rect x="${f2(fx)}" y="${f2(fy + 7)}" width="${f2(f.w)}" height="${f2(f.h)}" rx="6" fill="${INK}" opacity="0.14"/>`);
  out.push(field(play.players, fx, fy, f.w, f.h, { level: "detailed", show }, 3));

  // who does what
  out.push(`<rect x="584" y="104" width="340" height="408" rx="14" fill="${INK}" opacity="0.14"/>`);
  out.push(`<rect x="580" y="100" width="340" height="408" rx="14" fill="${CREAM}" stroke="${INK}" stroke-width="2"/>`);
  out.push(text(X0, 124, 15, "WHO DOES WHAT", { fill: MUTED }));
  const as = assignments(play);
  // with notes, three lines of them are kept: baselines at 436, 464 and 492
  const { s, rows, more } = panelRows(as, notes ? 244 : 356);
  const r = s === 26 ? 16 : 14, lead = s + 6, tx = X0 + 2 * r + 12;
  let y = TOP;
  if (!as.length) {
    out.push(text(X0, y + 26, 22, "Nobody on this side yet.", { fill: MUTED }));
    y += 40;
  }
  for (const row of rows) {
    const cy = y + 4 + r;
    out.push(token(X0 + r, cy, r, row.a.team, row.a.label));
    const fill = row.a.primary ? RED : row.a.idle ? MUTED : INK;
    row.lines.forEach((l, i) => { out.push(text(tx, cy + Math.round(s * 0.35) + i * lead, s, l, { fill })); });
    y += row.h;
  }
  if (more) {
    out.push(text(X0, y + 24, 22, `+${String(more)} more in the speaker notes`, { fill: MUTED }));
    y += 36;
  }
  if (notes) {
    y += 14;
    out.push(text(X0, y + 12, 15, "COACHING POINTS", { fill: MUTED }));
    const b0 = y + 42;
    wrap(notes, XR - X0, 22, Math.floor((BOTTOM - b0) / 28) + 1).forEach((l, i) => { out.push(text(X0, b0 + i * 28, 22, l)); });
  }
  out.push(footer(teamName, bookTitle));

  const cl = callLine(play);
  const lines = as.map(assignmentLine);
  return {
    page: page(SLIDE_W, SLIDE_H, out.join("")),
    title: `${String(item.n)} · ${play.name}`,
    titleBox: PLAY_BOX,
    titleSize: 32,
    alt: [
      `Play ${String(item.n)}: ${play.name}.`,
      cl,
      lines.length ? `Left to right: ${lines.join("; ")}.` : "Nobody on this side yet.",
      notes ? `Coaching points: ${notes.replace(/\s+/g, " ")}` : null,
    ].filter((l) => l !== null).join("\n"),
    notes: [
      headerLine(item),
      cl,
      notes || null,
      lines.length ? ["Left to right:", ...lines].join("\n") : "Nobody on this side yet.",
    ].filter((l) => l !== null).join("\n\n"),
  };
}

/**
 * The whole deck, in order. Every piece of user text is cleaned here, once, before anything
 * is measured or drawn, so the faces, titles, alt text and notes all say the same thing.
 * Measures text: call it after `ensureFont()`.
 */
export function slidePlans(items: readonly Numbered[], o: SlidesOptions): DeckPlan {
  const bookTitle = oneLine(o.bookName) || "Playbook";
  const teamName = oneLine(o.team.name);
  const band = safeColor(o.team.color);
  const book: Numbered[] = items.map(({ n, play }) => ({
    n,
    play: {
      ...play,
      name: oneLine(play.name) || "Untitled play",
      notes: clean(play.notes).trim(),
      players: play.players.map((p) => ({ ...p, label: clean(p.label) })),
    },
  }));
  const slides: SlidePlan[] = [];
  if (book.length) {
    slides.push(titleSlide(book, bookTitle, teamName, band));
    if (book.length > 1) {
      for (let i = 0; i < book.length; i += GLANCE) slides.push(glanceSlide(book.slice(i, i + GLANCE), book.length, bookTitle, teamName, band));
    }
    for (const item of book) slides.push(playSlide(item, bookTitle, teamName, band));
  }
  return { title: bookTitle, band, slides };
}

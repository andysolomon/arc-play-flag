import type { TeamSettings } from "@/lib/play/types";
import { playerWithLabel, positionsOf, type Numbered } from "./numbered";
import { IN, MUTED, PAPERS, badge, cutRect, field, page, text, type PaperKey, type SvgPage } from "./pages";
import { measure } from "./raster";

/** An insert card in inches and the grid of plays on it. */
export interface BandSize {
  w: number;
  h: number;
  rows: number;
  cols: number;
}

export interface BandPreset extends BandSize {
  key: string;
  label: string;
}

/** The sizes that cover the bands flag coaches actually own; anything else is a custom size. */
export const BAND_PRESETS: readonly BandPreset[] = [
  { key: "youthSlim", label: "Youth slim · 4.5 × 2.25 in", w: 4.5, h: 2.25, rows: 2, cols: 3 },
  { key: "adultSlim", label: "Adult slim · 4.75 × 2.75 in", w: 4.75, h: 2.75, rows: 2, cols: 4 },
  { key: "youthStd", label: "Youth standard · 3.5 × 2.75 in", w: 3.5, h: 2.75, rows: 2, cols: 3 },
  { key: "adultStd", label: "Adult standard · 5 × 3 in", w: 5, h: 3, rows: 3, cols: 4 },
];

export interface WristbandOptions {
  size: BandSize;
  paper: PaperKey;
  bookName: string;
  team: TeamSettings;
}

export interface BandCard {
  /** the position this card highlights, or null for the unhighlighted set */
  position: string | null;
  /** which card of the set this is when the plays overflow one insert */
  index: number;
  count: number;
  cells: (Numbered | null)[];
}

/** One card set per position plus one unhighlighted set, each overflowing onto extra cards. */
export function planCards(plays: readonly Numbered[], perCard: number): BandCard[] {
  const sets: (string | null)[] = [...positionsOf(plays), null];
  const per = Math.max(1, perCard);
  const count = Math.max(1, Math.ceil(plays.length / per));
  const cards: BandCard[] = [];
  for (const position of sets) {
    for (let i = 0; i < count; i++) {
      const slice = plays.slice(i * per, (i + 1) * per);
      const cells: (Numbered | null)[] = Array.from({ length: per }, (_, k) => slice[k] ?? null);
      cards.push({ position, index: i, count, cells });
    }
  }
  return cards;
}

const CAPTION = 0.16 * IN;
const MARGIN = 0.4 * IN;
const GAP = 0.22 * IN;
/** content stays this far inside the card edge, because pockets and windows differ by brand */
const SAFE = 0.125 * IN;

/** How many cards tile onto the paper, and where. */
export function tile(paper: PaperKey, size: BandSize): { perPage: number; cols: number; rows: number; cw: number; ch: number } {
  const p = PAPERS[paper];
  const cw = size.w * IN, ch = size.h * IN;
  const cols = Math.max(1, Math.floor((p.w - 2 * MARGIN + GAP) / (cw + GAP)));
  const rows = Math.max(1, Math.floor((p.h - 2 * MARGIN + GAP) / (ch + CAPTION + GAP)));
  return { perPage: cols * rows, cols, rows, cw, ch };
}

/** Text cut to fit a width, with an ellipsis. */
export function fit(s: string, maxWidth: number, size: number): string {
  if (measure(s, size) <= maxWidth) return s;
  let t = s;
  while (t.length > 1 && measure(t + "…", size) > maxWidth) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

function cell(x: number, y: number, w: number, h: number, item: Numbered | null, position: string | null): string {
  if (!item) return "";
  const pad = Math.min(3, w * 0.03);
  const head = Math.min(0.2 * IN, h * 0.22);
  const r = head * 0.4;
  const size = head * 0.72;
  const out: string[] = [];
  out.push(badge(x + pad + r, y + pad + head / 2, r, item.n));
  const nameX = x + pad + r * 2 + 3;
  out.push(text(nameX, y + pad + head / 2 + size * 0.36, size, fit(item.play.name, x + w - pad - nameX, size)));
  const fy = y + pad + head + 1;
  out.push(
    field(item.play.players, x + pad, fy, w - 2 * pad, y + h - pad - fy, {
      highlight: playerWithLabel(item.play, position),
      show: "offense",
      showYardNumbers: false,
      // a landscape cell: show only as much field as the cell's shape needs, so the play fills it
      minDepth: 14,
    }, 0.75),
  );
  return out.join("");
}

function card(x: number, y: number, size: BandSize, c: BandCard, bookName: string): string {
  const cw = size.w * IN, ch = size.h * IN;
  const out: string[] = [];
  const who = c.position ?? "Everyone";
  const more = c.count > 1 ? ` · ${String(c.index + 1)} of ${String(c.count)}` : "";
  out.push(text(x, y + CAPTION - 4, 8, fit(`${who} · ${bookName}${more}`, cw, 8), { fill: MUTED }));
  const top = y + CAPTION;
  out.push(cutRect(x, top, cw, ch));
  const gw = (cw - 2 * SAFE) / size.cols, gh = (ch - 2 * SAFE) / size.rows;
  c.cells.forEach((item, i) => {
    const col = i % size.cols, row = Math.floor(i / size.cols);
    out.push(cell(x + SAFE + col * gw, top + SAFE + row * gh, gw, gh, item, c.position));
  });
  return out.join("");
}

export function wristbandPages(plays: readonly Numbered[], o: WristbandOptions): SvgPage[] {
  const p = PAPERS[o.paper];
  const t = tile(o.paper, o.size);
  const cards = planCards(plays, o.size.rows * o.size.cols);
  const pages: SvgPage[] = [];
  for (let i = 0; i < cards.length; i += t.perPage) {
    const body: string[] = [];
    cards.slice(i, i + t.perPage).forEach((c, k) => {
      const col = k % t.cols, row = Math.floor(k / t.cols);
      body.push(card(MARGIN + col * (t.cw + GAP), MARGIN + row * (t.ch + CAPTION + GAP), o.size, c, o.bookName));
    });
    const who = o.team.name ? `${o.team.name} · ` : "";
    body.push(text(p.w - MARGIN, p.h - MARGIN + 14, 7, `${who}${o.bookName} · wristbands`, { anchor: "end", fill: MUTED }));
    pages.push(page(p.w, p.h, body.join("")));
  }
  return pages;
}

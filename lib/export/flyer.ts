import type { TeamSettings, Vis } from "@/lib/play/types";
import { playSlot } from "./binder";
import type { Numbered } from "./numbered";
import { IN, INK, MUTED, PAPERS, appMark, page, rect, text, type PaperKey, type SvgPage } from "./pages";
import { fit } from "./wristband";

/** One page, six plays: the sheet a coach hands to parents or pins in the team chat. */
export const FLYER_SLOTS = 6;

export interface FlyerOptions {
  paper: PaperKey;
  bookName: string;
  team: TeamSettings;
  vis?: Vis;
}

/** The first six plays of the book: what the flyer shows until the coach picks otherwise. */
export function flyerDefault(plays: readonly Numbered[]): (Numbered | null)[] {
  return Array.from({ length: FLYER_SLOTS }, (_, i) => plays[i] ?? null);
}

const MARGIN = 0.45 * IN;
const GAP = 0.26 * IN;
const BAND = 0.62 * IN;
const FOOTER = 20;
const COLS = 2;
const ROWS = FLYER_SLOTS / COLS;

/**
 * The fixed six-slot template. Slots are filled in order and an unused one is simply left
 * blank, so a book with four plays still prints a whole, balanced page.
 */
export function flyerPage(picks: readonly (Numbered | null)[], o: FlyerOptions): SvgPage {
  const p = PAPERS[o.paper];
  const W = p.w, H = p.h;
  const vis = o.vis ?? "both";
  const out: string[] = [];

  // team band: the colour reads across a room, the name and book read up close
  out.push(rect(0, 0, W, BAND, o.team.color));
  out.push(rect(0, BAND, W, 2, INK));
  const title = o.team.name || "Flag football";
  out.push(text(MARGIN, BAND / 2 + 8, 22, fit(title, W - 2 * MARGIN, 22), { fill: INK }));
  out.push(text(W - MARGIN, BAND / 2 + 8, 15, fit(o.bookName, (W - 2 * MARGIN) / 2, 15), { anchor: "end", fill: INK }));

  const top = BAND + 2 + GAP;
  const cw = (W - 2 * MARGIN - GAP) / COLS;
  const ch = (H - top - MARGIN - FOOTER - (ROWS - 1) * GAP) / ROWS;
  picks.slice(0, FLYER_SLOTS).forEach((item, i) => {
    if (!item) return;
    const col = i % COLS, row = Math.floor(i / COLS);
    out.push(playSlot(item, MARGIN + col * (cw + GAP), top + row * (ch + GAP), cw, ch, vis, 9, 15));
  });

  out.push(text(MARGIN, H - MARGIN + 10, 9, "Routes only — ask your coach for the rest.", { fill: MUTED }));
  out.push(appMark(W - MARGIN, H - MARGIN + 10, 7));
  return page(W, H, out.join(""));
}

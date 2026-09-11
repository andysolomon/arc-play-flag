import type { TeamSettings, Vis } from "@/lib/play/types";
import { CARD_H, CARD_W, cardBody } from "./card";
import type { Numbered } from "./numbered";
import { IN, INK, MUTED, PAPERS, appMark, badge, cutRect, f2, page, rect, text, type SvgPage, type PaperKey } from "./pages";
import { measure, wrap } from "./raster";
import { fit } from "./wristband";

/** The card a kid keeps on the fridge: the picture card on the front, what to remember on the back. */
export type PostcardSize = "twoUp" | "card46";

export const POSTCARD_SIZES: readonly { key: PostcardSize; label: string }[] = [
  { key: "twoUp", label: "Two-up with cut lines" },
  { key: "card46", label: "4 × 6 in card stock · one per sheet" },
];

export interface PostcardOptions {
  size: PostcardSize;
  paper: PaperKey;
  bookName: string;
  team: TeamSettings;
  vis?: Vis;
}

interface Slot { x: number; y: number; w: number; h: number }

const M = 60;
const BAND_H = 96;
const NOTES_TOP = 300;
const NOTES_SIZE = 32;
const NOTES_LEAD = 44;
const NOTES_BOTTOM = 1150;
const WRITING_LEAD = 96;

/**
 * The back, drawn in the same 1080 x 1350 space as the front: the team band again so a cut
 * card matches on both faces, the coaching points, and a line for the player's own name.
 */
export function postcardBack(item: Numbered, o: PostcardOptions): string {
  const out: string[] = [];
  out.push(rect(0, 0, CARD_W, CARD_H, "#f4efe2"));
  out.push(rect(0, 0, CARD_W, BAND_H, o.team.color));
  out.push(rect(0, BAND_H, CARD_W, 4, INK));
  out.push(text(M, BAND_H / 2 + 15, 40, fit(o.team.name || "Flag football", CARD_W - 2 * M, 40), { fill: INK }));

  const r = 30;
  const titleY = BAND_H + 44 + r;
  out.push(badge(M + r, titleY, r, item.n));
  const nameX = M + 2 * r + 18;
  out.push(text(nameX, titleY + 16, 44, fit(item.play.name, CARD_W - M - nameX, 44)));

  out.push(text(M, titleY + r + 54, 22, "COACHING POINTS", { fill: MUTED }));
  const notes = item.play.notes.trim();
  if (notes) {
    const maxLines = Math.floor((NOTES_BOTTOM - NOTES_TOP) / NOTES_LEAD) + 1;
    let y = NOTES_TOP;
    for (const line of wrap(notes, CARD_W - 2 * M, NOTES_SIZE, maxLines)) {
      out.push(text(M, y, NOTES_SIZE, line));
      y += NOTES_LEAD;
    }
  } else {
    // nothing written yet: give the coach lines to write on at the kitchen table
    for (let y = NOTES_TOP + 20; y <= NOTES_BOTTOM; y += WRITING_LEAD) out.push(rect(M, y, CARD_W - 2 * M, 2, MUTED));
  }

  const labelY = 1232;
  out.push(text(M, labelY, 28, "Player", { fill: MUTED }));
  const lineX = M + measure("Player", 28) + 18;
  out.push(rect(lineX, labelY + 8, CARD_W - M - lineX, 2, INK));

  out.push(appMark(CARD_W - M, CARD_H - M + 10, 20));
  out.push(text(M, CARD_H - M + 10, 20, "5v5 flag", { fill: MUTED }));
  return out.join("");
}

/**
 * Where the cards sit on one sheet. Both sizes put a single centred column on the page, so a
 * back sheet mirrored about the paper's vertical centre lands exactly on its own front: print
 * double-sided flipping on the long edge.
 */
export function postcardSheet(o: PostcardOptions): { w: number; h: number; slots: Slot[] } {
  if (o.size === "card46") {
    const w = 4 * IN, h = 6 * IN, m = 0.2 * IN;
    const cw = Math.min(w - 2 * m, (h - 2 * m) * (CARD_W / CARD_H));
    const ch = cw * (CARD_H / CARD_W);
    return { w, h, slots: [{ x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch }] };
  }
  const p = PAPERS[o.paper];
  const m = 0.4 * IN, gap = 0.28 * IN, footer = 16;
  const ch = Math.min((p.h - 2 * m - gap - footer) / 2, (p.w - 2 * m) * (CARD_H / CARD_W));
  const cw = ch * (CARD_W / CARD_H);
  return {
    w: p.w,
    h: p.h,
    slots: [0, 1].map((i) => ({ x: (p.w - cw) / 2, y: m + i * (ch + gap), w: cw, h: ch })),
  };
}

function face(body: string, s: Slot): string {
  return (
    `<svg x="${f2(s.x)}" y="${f2(s.y)}" width="${f2(s.w)}" height="${f2(s.h)}"` +
    ` viewBox="0 0 ${String(CARD_W)} ${String(CARD_H)}">${body}</svg>`
  );
}

function sheet(items: readonly Numbered[], o: PostcardOptions, side: "front" | "back"): SvgPage {
  const { w, h, slots } = postcardSheet(o);
  const vis = o.vis ?? "both";
  const out: string[] = [];
  items.forEach((item, i) => {
    const s = slots[i];
    if (!s) return;
    const body = side === "front"
      ? cardBody({ name: item.play.name, players: item.play.players, n: item.n, team: o.team, vis })
      : postcardBack(item, o);
    out.push(face(body, s));
    // scissors only need a guide where the sheet is bigger than the card
    if (o.size === "twoUp") out.push(cutRect(s.x, s.y, s.w, s.h));
  });
  if (o.size === "twoUp") {
    const who = [o.team.name, o.bookName].filter(Boolean).join(" · ");
    if (who) out.push(text(0.4 * IN, h - 0.4 * IN + 10, 9, fit(who, w * 0.5, 9), { fill: MUTED }));
    out.push(text(w - 0.4 * IN, h - 0.4 * IN + 10, 9, side === "front" ? "Fronts" : "Backs · flip on the long edge", { anchor: "end", fill: MUTED }));
  }
  return page(w, h, out.join(""));
}

/** Front and back sheets in printing order: fronts, then the backs that belong under them. */
export function postcardPages(plays: readonly Numbered[], o: PostcardOptions): SvgPage[] {
  const per = postcardSheet(o).slots.length;
  const pages: SvgPage[] = [];
  for (let i = 0; i < plays.length; i += per) {
    const chunk = plays.slice(i, i + per);
    pages.push(sheet(chunk, o, "front"), sheet(chunk, o, "back"));
  }
  return pages;
}

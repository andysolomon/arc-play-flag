import { CALL_LABEL, callOf } from "@/lib/play/call";
import type { Player, TeamSettings, Vis } from "@/lib/play/types";
import { artDepth } from "@/lib/render/play-svg";
import type { Numbered } from "./numbered";
import { IN, MUTED, PAPERS, appMark, badge, cutLine, field, page, pill, text, type PaperKey, type SvgPage } from "./pages";
import { measure, wrap } from "./raster";
import { fit } from "./wristband";

export type BinderLayout = "one" | "four";

export interface BinderOptions {
  layout: BinderLayout;
  paper: PaperKey;
  bookName: string;
  team: TeamSettings;
}

/** The largest field that fits a box without letterboxing, given how deep the play needs to be. */
export function fitField(players: readonly Player[], w: number, h: number, show: Vis = "both"): { w: number; h: number } {
  const ratio = (artDepth(players, { pw: w, ph: h }, show) * 22) / 660;
  const fh = Math.min(h, w * ratio);
  return { w: fh / ratio, h: fh };
}

const MARGIN = 0.5 * IN;

function detailedPage(item: Numbered, o: BinderOptions): SvgPage {
  const p = PAPERS[o.paper];
  const W = p.w, H = p.h;
  const cw = W - 2 * MARGIN;
  const out: string[] = [];
  const play = item.play;
  const call = callOf(play.players);

  // header: number, name, the call
  const r = 15;
  let right = W - MARGIN;
  if (call) {
    const label = CALL_LABEL[call];
    const pw = measure(label, 12) + 22;
    out.push(pill(right - pw, MARGIN + r, 12, label, pw, "#ffe9a8"));
    right -= pw + 10;
  }
  out.push(badge(MARGIN + r, MARGIN + r, r, item.n));
  const nameX = MARGIN + 2 * r + 10;
  out.push(text(nameX, MARGIN + r + 9, 26, fit(play.name, right - nameX, 26)));

  // notes below the field, wrapped in the real face
  const notesSize = 13, lead = 17;
  const lines = play.notes.trim() ? wrap(play.notes.trim(), cw, notesSize, 10) : [];
  const notesH = lines.length ? lines.length * lead + 16 : 0;
  const footerH = 24;
  const top = MARGIN + 2 * r + 16;
  const box = { w: cw, h: H - MARGIN - footerH - notesH - top };
  const f = fitField(play.players, box.w, box.h);
  const fx = MARGIN + (cw - f.w) / 2;
  out.push(field(play.players, fx, top, f.w, f.h, { level: "detailed" }, 2));

  let y = top + f.h + 16 + notesSize;
  for (const l of lines) {
    out.push(text(MARGIN, y, notesSize, l));
    y += lead;
  }

  const foot = H - MARGIN + 12;
  const who = [o.team.name, o.bookName].filter(Boolean).join(" · ");
  if (who) out.push(text(MARGIN, foot, 9, fit(who, cw * 0.5, 9), { fill: MUTED }));
  out.push(appMark(W - MARGIN, foot, 7));
  return page(W, H, out.join(""));
}

function fourUpPage(items: readonly Numbered[], o: BinderOptions): SvgPage {
  const p = PAPERS[o.paper];
  const W = p.w, H = p.h;
  const m = 0.4 * IN, g = 0.3 * IN, footerH = 20;
  const cw = (W - 2 * m - g) / 2, ch = (H - 2 * m - g - footerH) / 2;
  const out: string[] = [];
  items.forEach((item, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = m + col * (cw + g), y = m + row * (ch + g);
    const r = 10;
    out.push(badge(x + r, y + r, r, item.n));
    const nameX = x + 2 * r + 6;
    out.push(text(nameX, y + r + 6, 17, fit(item.play.name, x + cw - nameX, 17)));
    const top = y + 2 * r + 8;
    const f = fitField(item.play.players, cw, y + ch - top);
    out.push(field(item.play.players, x + (cw - f.w) / 2, top, f.w, f.h, { level: "simple" }, 1.5));
  });
  // cut lines through the gutters
  out.push(cutLine(W / 2, m - 8, W / 2, H - footerH - m + 8));
  out.push(cutLine(m - 8, m + ch + g / 2, W - m + 8, m + ch + g / 2));
  const who = [o.team.name, o.bookName].filter(Boolean).join(" · ");
  if (who) out.push(text(m, H - m + 10, 9, who, { fill: MUTED }));
  out.push(appMark(W - m, H - m + 10, 7));
  return page(W, H, out.join(""));
}

export function binderPages(plays: readonly Numbered[], o: BinderOptions): SvgPage[] {
  if (o.layout === "one") return plays.map((item) => detailedPage(item, o));
  const pages: SvgPage[] = [];
  for (let i = 0; i < plays.length; i += 4) pages.push(fourUpPage(plays.slice(i, i + 4), o));
  return pages;
}

import { CALL_LABEL, callOf } from "@/lib/play/call";
import { kebab } from "@/lib/play/storage";
import type { Level, Player, TeamSettings, Vis } from "@/lib/play/types";
import { artDepth, type ArtOptions } from "@/lib/render/play-svg";
import { ybv } from "@/lib/play/geometry";
import { fitField } from "./binder";
import { INK, MUTED, appMark, badge, field, page, pill, text, type SvgPage } from "./pages";
import { download, ensureFont, measure, rasterise } from "./raster";
import { fit } from "./wristband";

/** The shareable card: a 4:5 portrait that reads on a phone and prints as a postcard front. */
export const CARD_W = 1080;
export const CARD_H = 1350;

export interface CardOptions {
  name: string;
  players: readonly Player[];
  /** the play's number in its playbook, when it has one */
  n?: number | null;
  team: TeamSettings;
  level?: Level;
  /** which side is present in the saved picture or clip */
  vis?: Vis;
}

/** Shared viewport: animation must use exactly the same yards as the card art. */
export function cardField(players: readonly Player[], vis: Vis = "both"): { w: number; h: number; top: number } {
  const f = fitField(players, CARD_W - 120, CARD_H - 240 - 60 - 40, vis);
  return { ...f, top: ybv(artDepth(players, { pw: f.w, ph: f.h }, vis)) };
}

export function cardSvg(o: CardOptions, frame: Pick<ArtOptions, "positions" | "ball" | "footballHref"> = {}): SvgPage {
  const W = CARD_W, H = CARD_H, m = 60;
  const out: string[] = [];
  out.push(`<rect width="${String(W)}" height="${String(H)}" fill="#f4efe2"/>`);
  // team band
  const bandH = 96;
  out.push(`<rect width="${String(W)}" height="${String(bandH)}" fill="${o.team.color}"/>`);
  out.push(`<rect x="0" y="${String(bandH)}" width="${String(W)}" height="4" fill="${INK}"/>`);
  out.push(text(m, bandH / 2 + 15, 40, fit(o.team.name || "Flag football", W - 2 * m, 40), { fill: INK }));

  // title row
  const r = 34;
  const titleY = bandH + 40 + r;
  let x = m;
  if (o.n) { out.push(badge(m + r, titleY, r, o.n)); x = m + 2 * r + 20; }
  let right = W - m;
  const call = callOf(o.players);
  if (call) {
    const label = CALL_LABEL[call];
    const pw = measure(label, 28) + 48;
    out.push(pill(right - pw, titleY, 28, label, pw, "#ffe9a8"));
    right -= pw + 20;
  }
  out.push(text(x, titleY + 20, 56, fit(o.name, right - x, 56)));

  const top = titleY + r + 36;
  const vis = o.vis ?? "both";
  const f = cardField(o.players, vis);
  out.push(field(o.players, (W - f.w) / 2, top, f.w, f.h, {
    level: o.level ?? "simple",
    ...frame,
    ball: vis === "defense" ? null : frame.ball,
    show: vis,
  }, 5));
  out.push(appMark(W - m, H - m + 10, 20));
  out.push(text(m, H - m + 10, 20, "5v5 flag", { fill: MUTED }));
  return page(W, H, out.join(""));
}

/** Draws the card and saves it as <play-name>.png. */
export async function exportCardPng(o: CardOptions): Promise<void> {
  await ensureFont();
  const card = cardSvg(o);
  const c = await rasterise(card.svg, CARD_W, CARD_H, "#f4efe2");
  const blob = await new Promise<Blob | null>((resolve) => { c.toBlob(resolve, "image/png"); });
  if (!blob) throw new Error("The card could not be encoded.");
  download(blob, kebab(o.name) + ".png");
}

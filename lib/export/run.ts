import type { SvgPage } from "./pages";
import { buildPdf, type PdfPage } from "./pdf";
import { buildPptx, slidePicture, type DeckSlide } from "./pptx";
import { PT, download, ensureFont, rasterise, toPdfImage, toPng } from "./raster";
import { SLIDE_BG, SLIDE_PX, SLIDE_PY, type DeckPlan } from "./slides";

export interface RunOptions {
  /** print resolution; 300 keeps a wristband diagram crisp */
  dpi?: number;
  onProgress?: (done: number, total: number) => void;
}

/** Rasterises each page in turn, wraps them in a PDF and saves it. */
export async function exportPdf(pages: readonly SvgPage[], filename: string, title: string, o: RunOptions = {}): Promise<void> {
  const dpi = o.dpi ?? 300;
  await ensureFont();
  const out: PdfPage[] = [];
  let i = 0;
  for (const pg of pages) {
    o.onProgress?.(i, pages.length);
    const c = await rasterise(pg.svg, (pg.w / PT) * dpi, (pg.h / PT) * dpi);
    out.push({ w: pg.w, h: pg.h, image: await toPdfImage(c) });
    c.width = 0; // release the bitmap early on phones
    i++;
    await new Promise((r) => { window.setTimeout(r, 0); });
  }
  o.onProgress?.(pages.length, pages.length);
  download(buildPdf(out, title), filename);
}

/**
 * Draws each slide face in turn, seals it as a PNG, then packs the deck and saves it. The plan
 * is a thunk because it measures text, so it runs only once the hand face has loaded.
 *
 * Anything that goes wrong throws before `download()`, so a failed deck never saves:
 *
 * - R1 no 2D context (a phone's canvas budget, low memory): `rasterise` throws "No canvas.".
 * - R2 `toBlob` gives null: `toPng` throws "The slide could not be encoded.".
 * - R3 the face will not load as an image: `rasterise` throws "The page could not be drawn.".
 * - R4 canvases piling up: one 1920 × 1080 canvas at a time, released in `finally`, with a
 *   yield between slides.
 * - R5 the file held twice: each PNG is read once, sealed into a Blob and dropped, and the file
 *   is a Blob of those chunks.
 * - R6 the wrong MIME type, which iOS will not sniff: the Blob is typed, and so is `download()`.
 * - R7 a second export while one runs: the panel's `busy` guard.
 * - R8 offline: static imports, no network, and the face from the precached stylesheet.
 */
export async function exportSlides(plan: () => DeckPlan, filename: string, o: Pick<RunOptions, "onProgress"> = {}): Promise<void> {
  await ensureFont(); // measuring happens inside plan(), after the face is loaded
  const deck = plan();
  const when = new Date();
  const n = deck.slides.length, slides: DeckSlide[] = [];
  for (const [i, s] of deck.slides.entries()) {
    o.onProgress?.(i, n);
    const c = await rasterise(s.page.svg, SLIDE_PX, SLIDE_PY, SLIDE_BG);
    let png: Uint8Array;
    try { png = await toPng(c); } finally { c.width = 0; } // one canvas alive at a time
    slides.push({ title: s.title, titleBox: s.titleBox, titleSize: s.titleSize, alt: s.alt, notes: s.notes, picture: slidePicture(png) });
    await new Promise((r) => { window.setTimeout(r, 0); });
  }
  o.onProgress?.(n, n);
  download(buildPptx({ title: deck.title, band: deck.band, slides }, when), filename);
}

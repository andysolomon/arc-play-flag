import type { SvgPage } from "./pages";
import { buildPdf, type PdfPage } from "./pdf";
import { PT, download, ensureFont, rasterise, toPdfImage } from "./raster";

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

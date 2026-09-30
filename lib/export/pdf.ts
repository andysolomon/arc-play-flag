/**
 * A tiny PDF writer: each page is one image drawn edge to edge, keeping the app free of a PDF
 * dependency. Images arrive already encoded (zlib-deflated RGB for crisp lines, or JPEG where the
 * browser has no CompressionStream). Under the picture each page carries its words as invisible
 * text (render mode 3, as a scanner's OCR layer does), so a binder can be searched for "Mesh",
 * its notes copied out, or the page read aloud, while it prints exactly as the picture.
 */
export interface PdfImage {
  width: number;
  height: number;
  filter: "FlateDecode" | "DCTDecode";
  data: Uint8Array;
}

/** A run of words where the picture shows them, in points from the page's top left. */
export interface PdfText {
  s: string;
  x: number;
  /** the baseline */
  y: number;
  size: number;
  /** how wide the run is drawn, so a selection covers the words it stands for */
  width: number;
}

export interface PdfPage {
  /** points (1/72 in) */
  w: number;
  h: number;
  image: PdfImage;
  text?: readonly PdfText[];
}

const enc = new TextEncoder();
const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

function pdfString(s: string): string {
  return "(" + s.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?") + ")";
}

/** Windows-1252 above Latin-1's control block, which WinAnsiEncoding follows. */
const CP1252: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a,
  "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97,
  "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Helvetica's advance widths (1/1000 em) for printable ASCII, from its AFM; anything else is read as 556. */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/**
 * A run as WinAnsi bytes. A character the encoding has no code for (a star, an emoji) is left
 * out rather than printed as "?", which would only get in the way of a search.
 */
function winAnsi(s: string): number[] {
  const out: number[] = [];
  for (const ch of s.replace(/\s+/g, " ")) {
    const c = ch.codePointAt(0) ?? 0;
    const b = (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) ? c : CP1252[ch];
    if (b !== undefined) out.push(b);
  }
  return out;
}

/** The run's words drawn invisibly in Helvetica, stretched to the width the picture draws them. */
function textRun(t: PdfText, pageH: number): string {
  const bytes = winAnsi(t.s.trim());
  if (!bytes.length || !(t.size > 0) || !(t.width > 0)) return "";
  const em = bytes.reduce((n, b) => n + (b >= 0x20 && b <= 0x7e ? HELVETICA[b - 0x20] ?? 556 : 556), 0) / 1000;
  const tz = Math.max(1, Math.min(1000, (100 * t.width) / (em * t.size)));
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `/F1 ${f2(t.size)} Tf ${f2(tz)} Tz 1 0 0 1 ${f2(t.x)} ${f2(pageH - t.y)} Tm <${hex}> Tj\n`;
}

export function buildPdf(pages: readonly PdfPage[], title: string): Uint8Array {
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const put = (s: string | Uint8Array): void => {
    const b = typeof s === "string" ? enc.encode(s) : s;
    chunks.push(b);
    length += b.length;
  };
  const obj = (n: number, body: string, stream?: Uint8Array): void => {
    offsets[n] = length;
    put(`${String(n)} 0 obj\n${body}\n`);
    if (stream) {
      put("stream\n");
      put(stream);
      put("\nendstream\n");
    }
    put("endobj\n");
  };

  // the second line is the conventional "this file holds binary" marker
  put("%PDF-1.4\n%âãÏÓ\n");
  // 1 catalog, 2 pages, 3 info, 4 the text layer's font, then 3 objects per page: page, image, content
  const first = 5;
  const kids = pages.map((_, i) => `${String(first + i * 3)} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  obj(3, `<< /Title ${pdfString(title)} /Producer (Flag Football Play Designer) /CreationDate (D:${stamp}Z) >>`);
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  pages.forEach((pg, i) => {
    const pn = first + i * 3, im = pn + 1, cn = pn + 2;
    obj(
      pn,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(pg.w)} ${f2(pg.h)}]` +
      ` /Resources << /XObject << /Im1 ${String(im)} 0 R >> /Font << /F1 4 0 R >> >> /Contents ${String(cn)} 0 R >>`,
    );
    obj(
      im,
      `<< /Type /XObject /Subtype /Image /Width ${String(pg.image.width)} /Height ${String(pg.image.height)}` +
      ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${pg.image.filter} /Length ${String(pg.image.data.length)} >>`,
      pg.image.data,
    );
    const runs = (pg.text ?? []).map((t) => textRun(t, pg.h)).join("");
    const words = runs ? `\nBT 3 Tr\n${runs}ET` : "";
    const content = enc.encode(`q ${f2(pg.w)} 0 0 ${f2(pg.h)} 0 0 cm /Im1 Do Q${words}`);
    obj(cn, `<< /Length ${String(content.length)} >>`, content);
  });

  const count = first + pages.length * 3;
  const xref = length;
  put(`xref\n0 ${String(count)}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) put(String(offsets[n] ?? 0).padStart(10, "0") + " 00000 n \n");
  put(`trailer\n<< /Size ${String(count)} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * A tiny PDF writer: each page is one image drawn edge to edge. That is all a playbook
 * needs, and it keeps the app free of a PDF dependency. Images arrive already encoded
 * (zlib-deflated RGB for crisp lines, or JPEG where the browser has no CompressionStream).
 */
export interface PdfImage {
  width: number;
  height: number;
  filter: "FlateDecode" | "DCTDecode";
  data: Uint8Array;
}

export interface PdfPage {
  /** points (1/72 in) */
  w: number;
  h: number;
  image: PdfImage;
}

const enc = new TextEncoder();
const f2 = (n: number): string => (Math.round(n * 100) / 100).toString();

function pdfString(s: string): string {
  return "(" + s.replace(/[\\()]/g, (c) => "\\" + c).replace(/[^\x20-\x7e]/g, "?") + ")";
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
  // 1 catalog, 2 pages, 3 info, then 3 objects per page: page, image, content
  const first = 4;
  const kids = pages.map((_, i) => `${String(first + i * 3)} 0 R`).join(" ");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${String(pages.length)} >>`);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  obj(3, `<< /Title ${pdfString(title)} /Producer (Flag Football Play Designer) /CreationDate (D:${stamp}Z) >>`);
  pages.forEach((pg, i) => {
    const pn = first + i * 3, im = pn + 1, cn = pn + 2;
    obj(
      pn,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f2(pg.w)} ${f2(pg.h)}]` +
      ` /Resources << /XObject << /Im1 ${String(im)} 0 R >> >> /Contents ${String(cn)} 0 R >>`,
    );
    obj(
      im,
      `<< /Type /XObject /Subtype /Image /Width ${String(pg.image.width)} /Height ${String(pg.image.height)}` +
      ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${pg.image.filter} /Length ${String(pg.image.data.length)} >>`,
      pg.image.data,
    );
    const content = enc.encode(`q ${f2(pg.w)} 0 0 ${f2(pg.h)} 0 0 cm /Im1 Do Q`);
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

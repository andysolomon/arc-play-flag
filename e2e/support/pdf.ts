/**
 * An independent reader for the PDFs the app writes (lib/export/pdf.ts), so a journey can check the
 * words a printout carries without trusting the writer: it imports nothing from lib/.
 */

/** One run of words under a page's picture, in PDF points from the page's bottom left. */
export interface PdfRun { s: string; x: number; y: number; size: number; invisible: boolean }
export interface PdfWords { pages: { box: number[]; runs: PdfRun[] }[] }

/** Latin-1 view of the file, byte for byte. */
export const latin = (b: Buffer): string => b.toString("latin1");

const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/**
 * The words under each page's picture, read out of the PDF's content streams: every `<hex> Tj`
 * run between BT and ET, decoded from WinAnsi, with where the run sits. The page boxes come from
 * each page object's MediaBox, so a run can be checked against the page it is on.
 */
export function pdfWords(pdf: Buffer): PdfWords {
  const s = latin(pdf);
  const objects = new Map<number, string>();
  for (const m of s.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)) objects.set(Number(m[1]), m[2] ?? "");
  const pages: PdfWords["pages"][number][] = [];
  for (const body of objects.values()) {
    if (!body.startsWith("<< /Type /Page ")) continue;
    const box = (/\/MediaBox \[([^\]]+)\]/.exec(body)?.[1] ?? "").split(" ").map(Number);
    const contents = Number(/\/Contents (\d+) 0 R/.exec(body)?.[1]);
    const stream = /stream\n([\s\S]*)\nendstream/.exec(objects.get(contents) ?? "")?.[1] ?? "";
    const runs: PdfRun[] = [];
    for (const block of stream.matchAll(/BT([\s\S]*?)ET/g)) {
      const text = block[1] ?? "";
      const invisible = /(^|\s)3 Tr(\s|$)/.test(text);
      for (const r of text.matchAll(/\/F1 ([\d.]+) Tf [\d.]+ Tz 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm <([0-9a-f]*)> Tj/g)) {
        const bytes = Buffer.from(r[4] ?? "", "hex");
        const word = Array.from(bytes, (b) => (b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] ?? "" : String.fromCharCode(b))).join("");
        runs.push({ s: word, size: Number(r[1]), x: Number(r[2]), y: Number(r[3]), invisible });
      }
    }
    pages.push({ box, runs });
  }
  return { pages };
}

/** How many pages the PDF says it has. */
export function pdfPageCount(pdf: Buffer): number {
  return Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(latin(pdf))?.[1]);
}

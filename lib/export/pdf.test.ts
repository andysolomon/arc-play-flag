import { describe, expect, test } from "bun:test";
import { buildPdf } from "./pdf";

const latin = (b: Uint8Array): string => new TextDecoder("latin1").decode(b);

describe("pdf writer", () => {
  test("lays out one image per page with a valid xref", () => {
    const image = { width: 2, height: 1, filter: "DCTDecode" as const, data: new Uint8Array([1, 2, 3, 4, 5, 6]) };
    const bytes = buildPdf([{ w: 612, h: 792, image }, { w: 324, h: 162, image }], "Week (1) \\ test");
    const s = latin(bytes);
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.endsWith("%%EOF\n")).toBe(true);
    expect(s).toContain("/Count 2");
    expect(s).toContain("/MediaBox [0 0 612 792]");
    expect(s).toContain("/MediaBox [0 0 324 162]");
    expect(s).toContain("/Title (Week \\(1\\) \\\\ test)");
    expect(s).toContain("/Width 2 /Height 1");
    // every xref entry points at "<n> 0 obj"
    const start = Number(/startxref\n(\d+)/.exec(s)?.[1]);
    expect(s.slice(start, start + 4)).toBe("xref");
    const entries = s.slice(start).split("\n").slice(2).filter((l) => / n $/.test(l));
    expect(entries).toHaveLength(3 + 2 * 3);
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      const head = `${String(i + 1)} 0 obj`;
      expect(s.slice(off, off + head.length)).toBe(head);
    });
    // the image bytes survive untouched between stream markers
    const at = s.indexOf("stream\n", s.indexOf("/Im1 Do") < 0 ? 0 : s.indexOf("/Width")) + "stream\n".length;
    expect(Array.from(bytes.slice(at, at + 6))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

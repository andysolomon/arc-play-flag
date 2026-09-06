import { FONT } from "@/lib/render/play-svg";
import type { PdfImage } from "./pdf";

/** Points per inch. */
export const PT = 72;

let fontCss: Promise<string> | null = null;

/** The self-hosted Patrick Hand face as a data-URL @font-face, so SVG rendered off-screen can use it offline. */
export function embeddedFontCss(): Promise<string> {
  fontCss ??= (async () => {
    const faces: string[] = [];
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of Array.from(rules)) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          const family = rule.style.getPropertyValue("font-family");
          if (!/^"?patrick hand"?$/i.test(family.trim())) continue;
          const m = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"));
          if (!m?.[1]) continue;
          const href = new URL(m[1], sheet.href ?? location.href).href;
          const buf = await (await fetch(href)).arrayBuffer();
          let bin = "";
          for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
          const range = rule.style.getPropertyValue("unicode-range");
          faces.push(
            `@font-face{font-family:'Patrick Hand';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2')` +
            (range ? `;unicode-range:${range}` : "") + "}",
          );
        }
      }
    } catch { /* fall back to the system cursive */ }
    return faces.join("");
  })();
  return fontCss;
}

/** Make sure the face is loaded before measuring or drawing text with it. */
export async function ensureFont(): Promise<void> {
  try {
    await document.fonts.load(`17px ${FONT}`);
  } catch { /* measured with the fallback face */ }
}

/** Draws standalone SVG markup into a canvas of the given pixel size. */
export async function rasterise(svg: string, width: number, height: number, background = "#ffffff"): Promise<HTMLCanvasElement> {
  const css = await embeddedFontCss();
  const doc = css ? svg.replace(/^(<svg[^>]*>)/, `$1<style>${css}</style>`) : svg;
  const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(doc);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => { resolve(); };
    img.onerror = () => { reject(new Error("The page could not be drawn.")); };
    img.src = src;
  });
  const c = document.createElement("canvas");
  c.width = Math.round(width);
  c.height = Math.round(height);
  const g = c.getContext("2d");
  if (!g) throw new Error("No canvas.");
  g.fillStyle = background;
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A canvas as a PDF image: zlib RGB when the browser can compress, JPEG otherwise. */
export async function toPdfImage(c: HTMLCanvasElement): Promise<PdfImage> {
  const g = c.getContext("2d");
  if (!g) throw new Error("No canvas.");
  const { data, width, height } = g.getImageData(0, 0, c.width, c.height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i] ?? 0;
    rgb[j + 1] = data[i + 1] ?? 0;
    rgb[j + 2] = data[i + 2] ?? 0;
  }
  const packed = await deflate(rgb);
  if (packed) return { width, height, filter: "FlateDecode", data: packed };
  const blob = await new Promise<Blob | null>((resolve) => { c.toBlob(resolve, "image/jpeg", 0.92); });
  if (!blob) throw new Error("The page could not be encoded.");
  return { width, height, filter: "DCTDecode", data: new Uint8Array(await blob.arrayBuffer()) };
}

let measurer: CanvasRenderingContext2D | null = null;

/** Width of a run of text in the hand face at `size` px. */
export function measure(text: string, size: number): number {
  if (typeof document === "undefined") return text.length * size * 0.48;
  measurer ??= document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * size * 0.48;
  measurer.font = `${String(size)}px ${FONT}`;
  return measurer.measureText(text).width;
}

/** Greedy word wrap against the real face; long words are split rather than overflowing. */
export function wrap(text: string, maxWidth: number, size: number, maxLines = Infinity): string[] {
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? line + " " + word : word;
      if (measure(next, size) <= maxWidth) { line = next; continue; }
      if (line) lines.push(line);
      line = word;
      while (measure(line, size) > maxWidth && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut), size) > maxWidth) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = (kept[maxLines - 1] ?? "").replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

export function download(bytes: Uint8Array | Blob, filename: string): void {
  const type = filename.endsWith(".pdf") ? "application/pdf" : filename.endsWith(".json") ? "application/json" : "application/octet-stream";
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => { URL.revokeObjectURL(url); }, 10_000);
}

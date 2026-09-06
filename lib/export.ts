import { VW } from "./play/geometry";
import { kebab } from "./play/storage";

let fontCss: Promise<string> | null = null;

/** The self-hosted Patrick Hand face as a data-URL @font-face, so the exported SVG can use it offline. */
function embeddedFontCss(): Promise<string> {
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

/** Rasterise the field at 2× and download it as <play-name>.png. */
export async function exportPng(svg: SVGSVGElement, name: string): Promise<void> {
  const vb = svg.viewBox.baseVal;
  const vh = vb.height || 990;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(VW * 2));
  clone.setAttribute("height", String(vh * 2));
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  for (const el of Array.from(clone.querySelectorAll("[data-export='skip']"))) el.remove();
  clone.setAttribute("font-family", "'Patrick Hand', cursive");
  for (const el of Array.from(clone.querySelectorAll("[font-family]"))) el.setAttribute("font-family", "'Patrick Hand', cursive");
  const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = await embeddedFontCss();
  clone.insertBefore(style, clone.firstChild);

  const src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => { resolve(); };
    img.onerror = () => { reject(new Error("svg failed to load")); };
    img.src = src;
  });
  const c = document.createElement("canvas");
  c.width = VW * 2;
  c.height = vh * 2;
  const g = c.getContext("2d");
  if (!g) return;
  g.fillStyle = "#c1f0c1";
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  const a = document.createElement("a");
  a.href = c.toDataURL("image/png");
  a.download = kebab(name) + ".png";
  a.click();
}

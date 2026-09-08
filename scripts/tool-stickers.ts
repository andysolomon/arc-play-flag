// Draws the new, notes and playbook tool stickers in the style of the design's icons, into
// design/assets/icons. Then run `bun run icons`.
// Run with `node scripts/tool-stickers.ts` — sharp's SVG rasteriser stalls under Bun here.
import path from "node:path";
import sharp from "sharp";

const INK = "#1b1a17", YELLOW = "#f2b705", OFF = "#e5675e", CREAM = "#fffdf6";
const W = "512";
const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${body}</svg>`;
const line = (x1: number, y1: number, x2: number, y2: number, w = 26): string =>
  `<line x1="${String(x1)}" y1="${String(y1)}" x2="${String(x2)}" y2="${String(y2)}" stroke="${INK}" stroke-width="${String(w)}" stroke-linecap="round"/>`;

const stickers: Record<string, string> = {
  // a fresh sheet, corner turned up, with a bold yellow plus
  new: svg(
    `<g transform="rotate(4 256 256)">` +
    `<path d="M112 72 H352 L400 120 V440 H112 Z" fill="${CREAM}" stroke="${INK}" stroke-width="26" stroke-linejoin="round"/>` +
    `<path d="M352 72 V120 H400 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="26" stroke-linejoin="round"/>` +
    `<path d="M256 170 V346 M168 258 H344" stroke="${YELLOW}" stroke-width="72" stroke-linecap="round"/>` +
    `<path d="M256 170 V346 M168 258 H344" stroke="${INK}" stroke-width="30" stroke-linecap="round"/>` +
    `</g>`,
  ),
  // a yellow sticky note, corner turned up, three lines of marker
  notes: svg(
    `<g transform="rotate(-6 256 256)">` +
    `<path d="M96 88 H416 V344 L344 424 H96 Z" fill="${YELLOW}" stroke="${INK}" stroke-width="26" stroke-linejoin="round"/>` +
    `<path d="M416 344 L344 344 L344 424 Z" fill="${CREAM}" stroke="${INK}" stroke-width="26" stroke-linejoin="round"/>` +
    line(150, 170, 360, 170) + line(150, 236, 360, 236) + line(150, 302, 290, 302) +
    `</g>`,
  ),
  // a ring binder with a red token on the cover
  playbook: svg(
    `<rect x="110" y="72" width="300" height="368" rx="26" fill="${CREAM}" stroke="${INK}" stroke-width="26"/>` +
    `<rect x="110" y="72" width="64" height="368" rx="26" fill="${YELLOW}" stroke="${INK}" stroke-width="26"/>` +
    `<circle cx="142" cy="160" r="22" fill="${CREAM}" stroke="${INK}" stroke-width="20"/>` +
    `<circle cx="142" cy="352" r="22" fill="${CREAM}" stroke="${INK}" stroke-width="20"/>` +
    `<circle cx="300" cy="216" r="54" fill="${OFF}" stroke="${INK}" stroke-width="22"/>` +
    line(300, 216, 300, 130, 22) +
    `<polygon points="300,96 326,140 274,140" fill="${INK}" stroke="${INK}" stroke-width="14" stroke-linejoin="round"/>` +
    line(228, 340, 372, 340, 22) + line(228, 392, 330, 392, 22),
  ),
};

const out = path.resolve("design/assets/icons");
for (const [name, s] of Object.entries(stickers)) {
  await sharp(Buffer.from(s)).png().toFile(path.join(out, `${name}.png`));
  console.log("wrote", name);
}

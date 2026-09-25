// Cuts a dark-theme icon sheet (chalk outlines on a dark board, one labelled tile per sticker)
// into transparent 192px stickers in design/assets/icons-dark, framed like the light set.
// Then run `bun run icons`. Usage: `node scripts/cut-stickers.ts <tools|defense|offense> <sheet.png>`
// (sharp under Bun is fine here, but the sibling sticker scripts need node, so this one matches).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/** Reading order of the owner's three sheets. Extras (menu, block, light/dark mode) stay in design only. */
const SHEETS: Record<string, string[]> = {
  tools: [
    "football", "menu", "flip", "clear",
    "offOnly", "defOnly", "reset", "save", "duplicate",
    "export", "demo", "offense", "defense", "undo",
    "redo", "lightMode", "darkMode",
  ],
  defense: ["man", "zoneDeep", "zoneFlat", "curlFlat", "midRead", "blitz", "spy", "customDef", "deselectDef"],
  offense: [
    "go", "out", "in", "slant", "corner",
    "post", "curl", "flat", "cross", "wheel",
    "block", "handoff", "customOff", "deselectOff",
  ],
};
const SIZE = 192, MARGIN = 0.05; // like the light stickers: the glyph fills ~90% of a 192px square
const LO = 14, HI = 60; // deviation from the board colour: under LO is board, over HI is sticker, between is edge
const FRAME_EDGE = 9; // the tile frame's stroke plus its soft edge, kept out of the glyph

const [kind, sheet] = process.argv.slice(2);
const names = kind ? SHEETS[kind] : undefined;
if (!kind || !names || !sheet) {
  console.error(`usage: node scripts/cut-stickers.ts <${Object.keys(SHEETS).join("|")}> <sheet.png>`);
  process.exit(2);
}
const OUT = path.resolve("design/assets/icons-dark");
await mkdir(OUT, { recursive: true });

const { data, info } = await sharp(sheet).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const at = (x: number, y: number): number => (y * W + x) * 3;
const px = (i: number): number => data[i] ?? 0;

// 1. Tile frames: the big hollow bright components.
const bright = new Uint8Array(N);
for (let i = 0; i < N; i++) if (Math.min(px(i * 3), px(i * 3 + 1), px(i * 3 + 2)) > 185) bright[i] = 1;
const seen = new Uint8Array(N), stack = new Int32Array(N), isFrame = new Uint8Array(N);
let sp = 0;
const pop = (): number => stack[--sp] ?? 0;
const frames: { x0: number; y0: number; x1: number; y1: number }[] = [];
for (let s = 0; s < N; s++) {
  if (!bright[s] || seen[s]) continue;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  const members: number[] = [];
  stack[sp++] = s; seen[s] = 1;
  while (sp) {
    const i = pop(), x = i % W, y = Math.floor(i / W);
    members.push(i);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    for (const j of [i - 1, i + 1, i - W, i + W]) {
      if (j < 0 || j >= N || Math.abs((j % W) - x) > 1) continue;
      if (bright[j] && !seen[j]) { seen[j] = 1; stack[sp++] = j; }
    }
  }
  if (x1 - x0 < 200 || y1 - y0 < 180) continue;
  frames.push({ x0, y0, x1, y1 });
  for (const i of members) {
    const x = i % W, y = Math.floor(i / W);
    for (let dy = -FRAME_EDGE; dy <= FRAME_EDGE; dy++) for (let dx = -FRAME_EDGE; dx <= FRAME_EDGE; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < W && yy >= 0 && yy < H) isFrame[yy * W + xx] = 1;
    }
  }
}
frames.sort((a, b) => (Math.abs(a.y0 - b.y0) > 20 ? a.y0 - b.y0 : a.x0 - b.x0));
if (frames.length !== names.length) throw new Error(`${kind}: found ${String(frames.length)} tiles for ${String(names.length)} names`);

for (const [k, f] of frames.entries()) {
  const name = names[k] ?? String(k);
  // 2. The board colour inside this tile: the median of a strip just inside the frame.
  const strip = 22, samples: number[][] = [];
  for (let x = f.x0 + strip; x <= f.x1 - strip; x += 3) {
    for (const y of [f.y0 + strip, f.y0 + strip + 2, f.y1 - strip, f.y1 - strip - 2]) samples.push([...data.subarray(at(x, y), at(x, y) + 3)]);
  }
  const bg = [0, 1, 2].map((c) => samples.map((s) => s[c] ?? 0).sort((a, b) => a - b)[samples.length >> 1] ?? 0);
  const dev = (x: number, y: number): number => {
    if (isFrame[y * W + x]) return 0;
    const i = at(x, y);
    return Math.max(Math.abs(px(i) - (bg[0] ?? 0)), Math.abs(px(i + 1) - (bg[1] ?? 0)), Math.abs(px(i + 2) - (bg[2] ?? 0)));
  };
  // 3. The label is the lowest band of rows with sticker in them; the glyph is everything above the gap.
  const ix0 = f.x0 + 6, iy0 = f.y0 + 6, ix1 = f.x1 - 6, iy1 = f.y1 - 6;
  const rowHas: boolean[] = [];
  for (let y = iy0; y <= iy1; y++) { rowHas[y] = false; for (let x = ix0; x <= ix1; x++) if (dev(x, y) > HI) { rowHas[y] = true; break; } }
  let y = iy1;
  while (y > iy0 && !rowHas[y]) y--; // under the label
  while (y > iy0 && rowHas[y]) y--; // the label
  while (y > iy0 && !rowHas[y]) y--; // the gap
  let gx0 = W, gy0 = H, gx1 = 0, gy1 = 0;
  for (let yy = iy0; yy <= y; yy++) for (let x = ix0; x <= ix1; x++) {
    if (dev(x, yy) <= HI) continue;
    if (x < gx0) gx0 = x; if (x > gx1) gx1 = x; if (yy < gy0) gy0 = yy; if (yy > gy1) gy1 = yy;
  }
  const pad = 6;
  gx0 -= pad; gy0 -= pad; gx1 += pad; gy1 += pad;
  const cw = gx1 - gx0 + 1, ch = gy1 - gy0 + 1;
  if (cw < 20 || ch < 20) throw new Error(`${kind} ${name}: no glyph found in tile ${JSON.stringify(f)}`);
  // 4. Key out the board: flood from the crop's edge over near-board pixels, with a soft alpha at the rim.
  const alpha = new Uint8Array(cw * ch).fill(255), visited = new Uint8Array(cw * ch), todo = new Int32Array(cw * ch);
  sp = 0;
  const push = (i: number): void => { if (!visited[i]) { visited[i] = 1; todo[sp++] = i; } };
  for (let x = 0; x < cw; x++) { push(x); push((ch - 1) * cw + x); }
  for (let yy = 0; yy < ch; yy++) { push(yy * cw); push(yy * cw + cw - 1); }
  while (sp) {
    const i = todo[--sp] ?? 0, x = i % cw, yy = Math.floor(i / cw), d = dev(gx0 + x, gy0 + yy);
    if (d >= HI) continue;
    alpha[i] = Math.round((255 * Math.max(0, d - LO)) / (HI - LO));
    if (x > 0) push(i - 1); if (x < cw - 1) push(i + 1); if (yy > 0) push(i - cw); if (yy < ch - 1) push(i + cw);
  }
  const rgba = Buffer.alloc(cw * ch * 4);
  for (let yy = 0; yy < ch; yy++) for (let x = 0; x < cw; x++) {
    const i = at(gx0 + x, gy0 + yy), o = (yy * cw + x) * 4;
    rgba[o] = px(i); rgba[o + 1] = px(i + 1); rgba[o + 2] = px(i + 2); rgba[o + 3] = alpha[yy * cw + x] ?? 0;
  }
  // 5. Frame it: the longer side fills 90% of a 192px square, centred.
  const inner = Math.round(SIZE * (1 - 2 * MARGIN));
  const fitted = await sharp(rgba, { raw: { width: cw, height: ch, channels: 4 } }).resize(inner, inner, { fit: "inside" }).png().toBuffer();
  const m = await sharp(fitted).metadata();
  const top = Math.floor((SIZE - m.height) / 2), left = Math.floor((SIZE - m.width) / 2);
  await sharp(fitted)
    .extend({ top, bottom: SIZE - m.height - top, left, right: SIZE - m.width - left, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, `${name}.png`));
  console.log(`${name.padEnd(12)} ${String(cw)}x${String(ch)} from tile ${String(k + 1)}`);
}

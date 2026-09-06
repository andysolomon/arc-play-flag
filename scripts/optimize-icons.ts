// Re-encodes the design stickers into small palette PNGs for /public/icons.
// Run once with `bun run icons`; the output is committed.
import { readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = path.resolve("design/assets/icons");
const OUT = path.resolve("public/icons");
const SIZE = 112; // shown at 40px (56px in the empty state); 112px covers 2× DPR
const BUDGET = 8 * 1024;

await mkdir(OUT, { recursive: true });
const files = (await readdir(SRC)).filter((f) => f.endsWith(".png")).sort();
let worst = 0;
for (const f of files) {
  const out = path.join(OUT, f);
  await sharp(path.join(SRC, f))
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 80, compressionLevel: 9, effort: 10 })
    .toFile(out);
  const { size } = await stat(out);
  worst = Math.max(worst, size);
  const flag = size > BUDGET ? "  OVER BUDGET" : "";
  console.log(`${f.padEnd(16)} ${(size / 1024).toFixed(1).padStart(5)} KB${flag}`);
}
console.log(`${String(files.length)} icons, largest ${(worst / 1024).toFixed(1)} KB`);
if (worst > BUDGET) process.exit(1);

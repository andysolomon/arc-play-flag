// Re-encodes the design stickers into small palette PNGs for /public/icons: the light set as
// <name>.png and, for every sticker that has one, the dark board's as <name>-dark.png.
// Run once with `bun run icons`; the output is committed.
import { readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const SRC = path.resolve("design/assets/icons");
const DARK = path.resolve("design/assets/icons-dark");
const OUT = path.resolve("public/icons");
const SIZE = 112; // shown at 40px (56px in the empty state); 112px covers 2× DPR
const BUDGET = 8 * 1024;

await mkdir(OUT, { recursive: true });
const light = (await readdir(SRC)).filter((f) => f.endsWith(".png")).sort();
const dark = new Set(await readdir(DARK));
// dark stickers without a light twin (the sheets' extras) stay in the design system only
const jobs: [src: string, name: string][] = light.flatMap((f) => [
  [path.join(SRC, f), f],
  ...(dark.has(f) ? [[path.join(DARK, f), f.replace(/\.png$/, "-dark.png")] as [string, string]] : []),
]);
const missing = light.filter((f) => !dark.has(f));
let worst = 0;
for (const [src, name] of jobs) {
  const out = path.join(OUT, name);
  await sharp(src)
    .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ palette: true, quality: 80, compressionLevel: 9, effort: 10 })
    .toFile(out);
  const { size } = await stat(out);
  worst = Math.max(worst, size);
  const flag = size > BUDGET ? "  OVER BUDGET" : "";
  console.log(`${name.padEnd(20)} ${(size / 1024).toFixed(1).padStart(5)} KB${flag}`);
}
console.log(`${String(jobs.length)} icons, largest ${(worst / 1024).toFixed(1)} KB`);
if (missing.length > 0) console.log(`no dark sticker yet for: ${missing.join(", ")}`);
if (worst > BUDGET) process.exit(1);

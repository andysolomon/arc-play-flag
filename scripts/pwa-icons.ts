// App icons for the manifest, cut from the football sticker. Run once: `bun run scripts/pwa-icons.ts`.
import path from "node:path";
import sharp from "sharp";

const src = path.resolve("design/assets/icons/football.png");
const out = (f: string) => path.resolve("public/icons", f);
const paper = { r: 0xf4, g: 0xef, b: 0xe2, alpha: 1 };

await sharp(src).resize(192, 192).png({ palette: true, effort: 10 }).toFile(out("app-192.png"));
await sharp(src).resize(512, 512, { kernel: "lanczos3" }).png({ palette: true, effort: 10 }).toFile(out("app-512.png"));
// maskable: sticker inside the safe zone on parchment
await sharp(src)
  .resize(360, 360, { kernel: "lanczos3" })
  .extend({ top: 76, bottom: 76, left: 76, right: 76, background: paper })
  .flatten({ background: paper })
  .png({ palette: true, effort: 10 })
  .toFile(out("app-maskable-512.png"));
console.log("wrote app-192, app-512, app-maskable-512");

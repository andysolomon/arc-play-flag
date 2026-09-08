// Draws the run-route stickers (dive, stretch, counter, reverse, delay, pitch) in the style of
// the design's route icons, into design/assets/icons. Then run `bun run icons`.
// Run with `node scripts/run-stickers.ts` — sharp's SVG rasteriser stalls under Bun here.
import path from "node:path";
import sharp from "sharp";

const INK = "#1b1a17", OFF = "#e5675e", BALL = "#a15d2c", LACE = "#fffdf6";
const W = "512";
const n = (v: number): string => String(Math.round(v * 10) / 10);

const token = (cx: number, cy: number, r = 82): string =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${OFF}" stroke="${INK}" stroke-width="26"/>`;
const ball = (cx: number, cy: number, rot = -30): string =>
  `<g transform="translate(${n(cx)} ${n(cy)}) rotate(${n(rot)})">` +
  `<ellipse rx="52" ry="34" fill="${BALL}" stroke="${INK}" stroke-width="16"/>` +
  `<line x1="-20" y1="0" x2="20" y2="0" stroke="${LACE}" stroke-width="9" stroke-linecap="round"/>` +
  `<line x1="-10" y1="-9" x2="-10" y2="9" stroke="${LACE}" stroke-width="8" stroke-linecap="round"/>` +
  `<line x1="10" y1="-9" x2="10" y2="9" stroke="${LACE}" stroke-width="8" stroke-linecap="round"/></g>`;
const line = (d: string, dash = ""): string =>
  `<path d="${d}" fill="none" stroke="${INK}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"` +
  (dash ? ` stroke-dasharray="${dash}"` : "") + "/>";
/** arrowhead pointing along (dx,dy) with its tip at (x,y) */
const head = (x: number, y: number, dx: number, dy: number): string => {
  const L = Math.hypot(dx, dy), nx = dx / L, ny = dy / L, s = 78, w = 50;
  const bx = x - nx * s, by = y - ny * s;
  const pts = `${n(x)},${n(y)} ${n(bx - ny * w)},${n(by + nx * w)} ${n(bx + ny * w)},${n(by - nx * w)}`;
  return `<polygon points="${pts}" fill="${INK}" stroke="${INK}" stroke-width="18" stroke-linejoin="round"/>`;
};
const svg = (body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">${body}</svg>`;

const stickers: Record<string, string> = {
  // straight through the middle, ball tucked at the hip
  dive: svg(token(256, 400) + line("M256 320 Q252 200 256 96") + head(256, 60, 0, -1) + ball(150, 420)),
  // a wide sweep to the sideline that turns the corner
  stretch: svg(token(120, 410) + line("M200 400 Q330 380 400 300 Q446 240 430 96") + head(428, 60, -0.1, -1) + ball(120, 300, -20)),
  // a jab step one way, then cut back the other
  counter: svg(token(400, 410) + line("M330 380 Q250 360 220 300 Q290 270 310 190 Q330 120 320 96") + head(318, 60, -0.1, -1) + ball(400, 300, -40)),
  // all the way around the far end
  reverse: svg(token(410, 400) + line("M340 420 Q200 470 130 400 Q80 340 100 96") + head(100, 60, 0, -1) + ball(410, 290, -40)),
  // a pause on the spot, then go
  delay: svg(token(256, 400) + line("M256 320 L256 240", "1 62") + line("M256 200 Q252 150 256 96") + head(256, 60, 0, -1) + ball(150, 420)),
  // the toss comes in from the quarterback's side; the runner sets up wide, then runs or throws
  pitch: svg(
    token(370, 400) + line("M60 330 Q170 300 260 370", "1 62") +
    line("M330 330 Q300 260 250 210") + line("M250 210 L250 96") + head(250, 60, 0, -1) +
    line("M250 210 L120 140") + head(84, 120, -1, -0.55) + ball(470, 300, -40),
  ),
};

const out = path.resolve("design/assets/icons");
for (const [name, s] of Object.entries(stickers)) {
  await sharp(Buffer.from(s)).png().toFile(path.join(out, `${name}.png`));
  console.log("wrote", name);
}

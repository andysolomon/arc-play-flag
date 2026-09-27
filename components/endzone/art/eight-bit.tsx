import type { CSSProperties } from "react";
import type { ArtProps } from "./shared";

/** A sprite as rows of pixels, one letter per colour in PALETTE; anything else is clear. */
type Sprite = readonly string[];
/** A sprite set on the pixel grid by its top-left pixel. */
interface Stamp {
  sprite: Sprite;
  x: number;
  y: number;
}
interface Rect {
  x: number;
  y: number;
  len: number;
  tall: number;
}
type Vars = CSSProperties & { [key: `--ez-eight-bit-${string}`]: string };

const SKY = "#5c94fc";
/** A console's worth of colours; each letter becomes one path per layer. */
const PALETTE = {
  K: "#000000",
  W: "#fcfcfc",
  S: "#a4e4fc",
  B: "#c84c0c",
  L: "#fc9838",
  /** the title card, a shade deeper than the bricks so its white lettering reads at 6:1 */
  T: "#a44010",
  G: "#00a800",
  D: "#005800",
  Y: "#fca044",
  C: "#f8b800",
  H: "#f8d878",
  V: "#b8f818",
} as const;
type Ink = keyof typeof PALETTE;
const INKS = Object.keys(PALETTE) as Ink[];

/** The colours END ZONE flickers through on a touchdown, as with a star's invincibility; each reads on the card at 4.5:1 or better. */
const STAR: readonly Ink[] = ["H", "V", "S"];

/** Rows of brick the band stands on; one more lies hidden under the goal line for the bricks to bump up from. */
const GROUND = 4;
/** The clouds repeat this many pixels apart, so drifting them one repeat along loops. Keep in step with the CSS. */
const CLOUD_REPEAT = 120;
/** How tall the ? blocks and the title card between them stand. */
const ROW = 11;

/** Riveted, lit along its top and left, its ? in brick red with a black shadow. */
const QUESTION: Sprite = [
  "BBBBBBBBBBK",
  "BKYBBBBYYKK",
  "BYBBKKBBYYK",
  "BYYKKYBBKYK",
  "BYYYYBBKKYK",
  "BYYYBBKKYYK",
  "BYYYYKKYYYK",
  "BYYYBBYYYYK",
  "BYYYYKKYYYK",
  "BKYYYYYYYKK",
  "KKKKKKKKKKK",
];

const COIN: Sprite = [
  ".KKKK.",
  "KCHCCK",
  "KHCCBK",
  "KHCCBK",
  "KHCCBK",
  "KHCCBK",
  "KHCCBK",
  "KHCCBK",
  "KCCBBK",
  ".KKKK.",
];

const CLOUD: Sprite = [
  ".....KKKK.......",
  "..KKKWWWWKKKK...",
  ".KWWWWWWWWWWWKK.",
  "KWWWWWWWWWWWWWWK",
  "KWWSWWWSSWWWSWWK",
  ".KKKKKKKKKKKKKK.",
];

const PUFF: Sprite = [
  "...KKKK...",
  ".KKWWWWKK.",
  "KWWWWWWWWK",
  "KWWWWWWWWK",
  ".KSWWSSWK.",
  "..KKKKKK..",
];

/** Capitals five pixels wide and seven tall, "#" inked. */
const FONT: Readonly<Record<string, Sprite>> = {
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  N: ["#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  " ": ["...", "...", "...", "...", "...", "...", "..."],
};

/** Three by five, for the 1UP. */
const MINI: Readonly<Record<string, Sprite>> = {
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  P: ["##.", "#.#", "##.", "#..", "#.."],
};

const num = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Every pixel of each colour across the stamps, as path data keyed by colour: a run along a row
 * becomes one rectangle, and runs over the same columns on the rows below stretch it down.
 */
function trace(stamps: readonly Stamp[]): Map<Ink, string> {
  const rects = new Map<Ink, { all: Rect[]; open: Map<string, Rect> }>();
  for (const { sprite, x, y } of stamps) {
    sprite.forEach((row, j) => {
      for (let i = 0; i < row.length; ) {
        const c = row[i] ?? ".";
        let k = i + 1;
        while (row[k] === c) k++;
        if (c in PALETTE) {
          const ink = rects.get(c as Ink) ?? { all: [], open: new Map<string, Rect>() };
          rects.set(c as Ink, ink);
          const key = `${String(x + i)},${String(k - i)}`;
          const run = ink.open.get(key);
          if (run && run.y + run.tall === y + j) run.tall++;
          else {
            const rect = { x: x + i, y: y + j, len: k - i, tall: 1 };
            ink.all.push(rect);
            ink.open.set(key, rect);
          }
        }
        i = k;
      }
    });
  }
  const out = new Map<Ink, string>();
  for (const [c, { all }] of rects) {
    out.set(c, all.map((r) => `M${String(r.x)} ${String(r.y)}h${String(r.len)}v${String(r.tall)}h${String(-r.len)}z`).join(""));
  }
  return out;
}

/** Stamps painted as one path per colour; stamps in one layer must not overlap. */
function Pixels({ stamps }: { stamps: readonly Stamp[] }) {
  const d = trace(stamps);
  return (
    <>
      {INKS.map((ink) => {
        const path = d.get(ink);
        return path ? <path key={ink} d={path} fill={PALETTE[ink]} /> : null;
      })}
    </>
  );
}

/** A sprite repainted in one colour wherever it has a pixel of `from`. */
const recolour = (sprite: Sprite, from: string, to: Ink): Sprite => sprite.map((row) => Array.from(row, (c) => (c === from ? to : ".")).join(""));

/** Text set in `font` in white, each stroke with a black drop shadow a pixel down and right; the sprite is a pixel wider and taller than the text for it. */
function lettering(text: string, font: Readonly<Record<string, Sprite>>): Sprite {
  const glyphs = Array.from(text, (ch) => font[ch] ?? []);
  const tall = Math.max(...glyphs.map((g) => g.length));
  const wide = glyphs.reduce((sum, g) => sum + (g[0]?.length ?? 0) + 1, -1);
  const ink = Array.from({ length: tall + 1 }, () => Array.from({ length: wide + 1 }, () => false));
  let x = 0;
  for (const g of glyphs) {
    g.forEach((row, j) => {
      Array.from(row).forEach((c, i) => {
        const line = ink[j];
        if (c === "#" && line) line[x + i] = true;
      });
    });
    x += (g[0]?.length ?? 0) + 1;
  }
  return ink.map((row, j) => row.map((on, i) => (on ? "W" : ink[j - 1]?.[i - 1] ? "K" : ".")).join(""));
}

/** A title card `wide` by `tall`: lit along its top and left, shadowed along its bottom and right, a rivet in each corner. */
function card(wide: number, tall: number): Sprite {
  return Array.from({ length: tall }, (_, r) =>
    Array.from({ length: wide }, (_, i) => {
      if (r === tall - 1 || i === wide - 1) return "K";
      if (r === 0 || i === 0) return "L";
      if ((r === 1 || r === tall - 2) && (i === 1 || i === wide - 2)) return "K";
      return "T";
    }).join(""),
  );
}

/** A tag `wide` by `tall` in one colour, its corners clipped. */
const tag = (wide: number, tall: number, ink: Ink): Sprite =>
  Array.from({ length: tall }, (_, r) => (r === 0 || r === tall - 1 ? `.${ink.repeat(wide - 2)}.` : ink.repeat(wide)));

/** A rounded green hill `wide` by `tall`, outlined, with a few darker tufts. */
function hill(wide: number, tall: number): Sprite {
  // between a dome and a parabola: round on top, broad at the foot
  const half = (r: number): number => Math.round((wide / 2) * Math.sqrt(Math.max(0, 1 - ((tall - r - 0.5) / tall) ** 1.5)));
  const inside = (i: number, r: number): boolean => r >= 0 && r < tall && Math.abs(i - (wide - 1) / 2) <= half(r) - 0.5;
  const tufts = [
    [0.36, 0.4],
    [0.62, 0.55],
    [0.3, 0.75],
  ].map(([u = 0, v = 0]) => `${String(Math.round(wide * u))},${String(Math.round(tall * v))}`);
  return Array.from({ length: tall }, (_, r) =>
    Array.from({ length: wide }, (_, i) => {
      if (!inside(i, r)) return ".";
      if (!inside(i - 1, r) || !inside(i + 1, r) || !inside(i, r - 1)) return "K";
      return tufts.includes(`${String(i)},${String(r)}`) || tufts.includes(`${String(i)},${String(r - 1)}`) ? "D" : "G";
    }).join(""),
  );
}

/** A course of bricks from column x0 to x1, lit along its top and left, one row deeper than the band shows. */
function bricks(x0: number, x1: number): Sprite {
  return Array.from({ length: GROUND + 1 }, (_, r) =>
    Array.from({ length: x1 - x0 }, (_, k) => {
      const i = x0 + k;
      if (r === 0 || i % 8 === 7) return "K";
      if (r === 1 || i % 8 === 0) return "L";
      return "B";
    }).join(""),
  );
}

const delay = (s: number): CSSProperties => ({ animationDelay: `${num(s)}s` });

/** A ? block, its face brightening now and then; the `i`th to be bumped from below on a touchdown. */
function Block({ x, y, i }: { x: number; y: number; i: number }) {
  return (
    <g className="ez-eight-bit-bump" style={delay(i * 0.12)}>
      <Pixels stamps={[{ sprite: QUESTION, x, y }]} />
      <g className="ez-eight-bit-shimmer" style={delay(i * 0.5)} opacity={0}>
        <Pixels stamps={[{ sprite: recolour(QUESTION, "Y", "H"), x, y }]} />
      </g>
    </g>
  );
}

function Coin({ x, y, className = "ez-eight-bit-coin" }: { x: number; y: number; className?: string }) {
  return (
    <g className={className}>
      <Pixels stamps={[{ sprite: COIN, x, y }]} />
    </g>
  );
}

/** A touchdown's coins, popped up out of the `i`th ? block with each bump, spinning, arcing off to either side and fading. */
function Pops({ x, y, rise, i }: { x: number; y: number; rise: number; i: number }) {
  return (
    <>
      {[-1, 1].map((side) => (
        <g key={side} className="ez-eight-bit-pop" style={{ "--ez-eight-bit-dx": `${String(side * 15)}px`, "--ez-eight-bit-rise": `${String(-rise)}px`, ...delay(i * 0.12) } as Vars}>
          <Coin x={x} y={y} className="ez-eight-bit-flip" />
        </g>
      ))}
    </>
  );
}

/**
 * 8-Bit: the end zone as a side-scroller's level. A sky-blue screen over a course of brick, pixel
 * clouds drifting a pixel at a time, rounded green hills, spinning gold coins, and END ZONE on a
 * riveted title card in a hand-built 5×7 pixel font between two shimmering ? blocks, a 1UP
 * blinking over it all. Everything sits on one integer pixel grid, a colour to a path. A touchdown
 * knocks the ? blocks and the card up from below, each knock popping coins out, ripples the bricks
 * out from the middle, flickers END ZONE through a star's colours, spins the coins up and flashes
 * the 1UP.
 */
export function EightBitArt({ w, h, label, celebrate }: ArtProps) {
  const p = Math.max(2, Math.round(h / 28));
  const cols = Math.ceil(w / p);
  const rows = Math.ceil(h / p);
  // the grid sits on the goal line; any part of a pixel left over is lost off the top
  const top = h - rows * p;
  const ground = rows - GROUND;
  const sky = h / p - GROUND;

  const text = lettering("END ZONE", FONT);
  // a bevel and two pixels of margin before the text, the shadow, a pixel and a bevel after it
  const cardW = (text[0]?.length ?? 0) + 5;
  const cardX = Math.round((cols - cardW) / 2);
  // the row of blocks floats a pixel over the bricks, or as near as the sky allows
  const rowY = Math.max(Math.round((rows - h / p + ground - ROW) / 2), ground - ROW - 1);
  const gap = Math.min(24, Math.max(3, Math.round(cardX * 0.18)));
  const [left, right] = [cardX - gap - ROW, cardX + cardW + gap];
  const blocks = sky >= ROW + 1 ? [left, right] : [];
  const headroom = rowY >= 12;

  // a coin over the left block when there's sky above it, else a row of three out beyond each block
  const coinRow = (x: number, n: number, y: number): Stamp[] => Array.from({ length: n }, (_, k) => ({ sprite: COIN, x: x + k * 9, y }));
  const coins: Stamp[] = blocks.length === 0 ? [] : headroom ? coinRow(left + 3, 1, rowY - 11) : [...coinRow(left - 32, 3, rowY + 1), ...coinRow(right + ROW + 8, 3, rowY + 1)];
  // the hills stoop to keep under a low sky
  const tall = Math.min(12, Math.max(6, ground - 5));
  const small = Math.round(tall * 0.6);
  const hills: Stamp[] = [
    { sprite: hill(Math.round(tall * 3.4), tall), x: Math.round(cardX * 0.12 - tall * 1.7), y: ground - tall },
    { sprite: hill(Math.round(small * 3.7), small), x: Math.min(right + ROW + 36, cols - Math.round(small * 3.7)), y: ground - small },
  ];
  // at rest a pair of clouds hangs over the card; the rest repeat off either side of it
  const cloudX = ((Math.round(cols / 2) - 20) % CLOUD_REPEAT) - CLOUD_REPEAT;
  const clouds: Stamp[] =
    sky >= 8
      ? Array.from({ length: Math.ceil(cols / CLOUD_REPEAT) + 2 }, (_, k) => [
          { sprite: CLOUD, x: cloudX + k * CLOUD_REPEAT, y: 1 },
          { sprite: PUFF, x: cloudX + k * CLOUD_REPEAT + 26, y: 1 },
        ]).flat()
      : [];
  const oneUp = lettering("1UP", MINI);
  // a pixel of green all round the text and its shadow
  const tagW = (oneUp[0]?.length ?? 0) + 2;
  const tagAt = headroom ? { x: Math.round(right + (ROW - tagW) / 2), y: rowY - 9 } : { x: cols - tagW - 3, y: 1 };

  return (
    <g className={celebrate ? "ez-eight-bit-party" : undefined}>
      <rect width={w} height={h} fill={SKY} />
      <g transform={`translate(0 ${num(top)}) scale(${String(p)})`} shapeRendering="crispEdges">
        <g className="ez-eight-bit-clouds">
          <Pixels stamps={clouds} />
        </g>
        <Pixels stamps={[...hills, ...(celebrate ? [] : [{ sprite: bricks(0, cols), x: 0, y: ground }])]} />
        {celebrate &&
          Array.from({ length: Math.ceil(cols / 24) }, (_, k) => (
            <g key={k} className="ez-eight-bit-ripple" style={delay((Math.abs(k * 24 + 12 - cols / 2) / cols) * 0.8)}>
              <Pixels stamps={[{ sprite: bricks(k * 24, Math.min(cols, k * 24 + 24)), x: k * 24, y: ground }]} />
            </g>
          ))}
        {coins.map((c) => (
          <Coin key={`${String(c.x)},${String(c.y)}`} x={c.x} y={c.y} />
        ))}
        {celebrate && blocks.map((x, i) => <Pops key={x} x={x + 3} y={rowY + 1} rise={Math.min(10, Math.max(4, rowY + 1))} i={i * 2} />)}
        {blocks.map((x, i) => (
          <Block key={x} x={x} y={rowY} i={i * 2} />
        ))}
        {label && (
          <g className="ez-eight-bit-bump" style={delay(0.12)}>
            <Pixels stamps={[{ sprite: card(cardW, ROW), x: cardX, y: rowY }]} />
            <Pixels stamps={[{ sprite: text, x: cardX + 3, y: rowY + 2 }]} />
            {celebrate &&
              STAR.map((ink, k) => (
                <g key={ink} className="ez-eight-bit-star" style={delay((k + 1) * 0.08)} opacity={0}>
                  <Pixels stamps={[{ sprite: recolour(text, "W", ink), x: cardX + 3, y: rowY + 2 }]} />
                </g>
              ))}
          </g>
        )}
        {sky >= 9 && (
          <g className="ez-eight-bit-oneup">
            <Pixels stamps={[{ sprite: tag(tagW, oneUp.length + 2, "D"), ...tagAt }]} />
            <Pixels stamps={[{ sprite: oneUp, x: tagAt.x + 1, y: tagAt.y + 1 }]} />
          </g>
        )}
      </g>
    </g>
  );
}

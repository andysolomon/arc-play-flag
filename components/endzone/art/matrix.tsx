import type { CSSProperties, SVGProps } from "react";
import { num, rand, useArtId, type ArtProps } from "./shared";

/** The Matrix's own palette: the black of the screen, the dim and bright code, and the near-white a falling drop leads with. */
const BLACK = "#0d0208";
const FADED = "#072a14";
const GREEN = "#008f11";
const PHOSPHOR = "#00ff41";
const HEAD = "#dcffe4";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", "DejaVu Sans Mono", monospace';

/** What the rain is written in: hex and operators, the digits twice as likely. No other letters, so no stray word ever spells out. */
const CODE = "01234567890123456789ABCDEF<>{}[]=+*/#$%&|:";

/** The rain has a grid of its own, ROW units to a row and PITCH to a column, scaled to the band. */
const ROW = 10;
const PITCH = 12.5;
const GLYPH = 10.5;
/** where a glyph's baseline sits in its row, so its capitals are centred there */
const BASE = ROW / 2 + GLYPH * 0.36;
/**
 * Rows from one drop to the next down a column. ez-matrix-fall moves a column exactly this far
 * (240px in steps(24)), and every column repeats with this period, so each loop is seamless.
 */
const PERIOD = 24;
/** a drop's trail, head included, for the three kinds of column */
const TRAILS = [8, 12, 17] as const;
/** how many different strings of code the columns draw from */
const STRINGS = 5;
/** the most columns that fall on their own clock; past that, columns far apart share one */
const CLOCKS = 34;
/** a touchdown's sheet of drops: this many rows of trail, falling through the band in ez-matrix-wave */
const WAVE = 6;
/** the scrambled code a letter decodes from during a touchdown: ez-matrix-reel drops this many through its cell */
const REEL = 8;

const pick = (i: number, salt: number): string => CODE.charAt(Math.floor(rand(i, salt) * CODE.length));

const mod = (a: number, n: number): number => ((a % n) + n) % n;

type Cell = readonly [x: number, row: number];

/** One <text> of glyphs, each centred in its own [x, row] cell of the rain's grid: SVG lets every glyph take its own x and y. */
function Glyphs({ cells, chars, ...rest }: { cells: readonly Cell[]; chars: string } & Omit<SVGProps<SVGTextElement>, "x" | "y">) {
  return (
    <text
      x={cells.map(([x]) => num(x)).join(" ")} y={cells.map(([, r]) => num(r * ROW + BASE)).join(" ")}
      textAnchor="middle" fontFamily={MONO} fontSize={GLYPH} fontWeight={700} {...rest}
    >
      {chars}
    </text>
  );
}

/** A glyph's soft phosphor bloom: a stroke painted under its fill. */
const bloom = { strokeWidth: 3.4, strokeLinejoin: "round", paintOrder: "stroke" } as const;

interface Column {
  x: number;
  /** which string of code it runs */
  code: number;
  /** which of TRAILS its drops leave */
  trail: number;
  /** some columns run their code mirrored, as the film's do */
  flip: boolean;
  /** how far down its drops start, so the still frame is a good one */
  offset: number;
}

/** A column's drops, painted by its trail's repeating gradient. */
function Drops({ id, col }: { id: string; col: Column }) {
  return (
    <use
      href={`#${id}-code-${String(col.code)}`} x={num(col.flip ? -col.x : col.x)} y={num(col.offset)} transform={col.flip ? "scale(-1 1)" : undefined}
      fill={GREEN} stroke={PHOSPHOR} {...bloom}
      style={{ fill: `url(#${id}-tail-${String(col.trail)})`, stroke: `url(#${id}-glow-${String(col.trail)})` }}
    />
  );
}

/** The fading trail behind each drop, repeating down a column every PERIOD rows: nothing, then dim green brightening to phosphor, then the near-white head. */
function TrailGradients({ id }: { id: string }) {
  const span = { gradientUnits: "userSpaceOnUse", x1: 0, x2: 0, y1: 0, y2: PERIOD * ROW, spreadMethod: "repeat" } as const;
  const at = (rows: number): number => rows / PERIOD;
  return (
    <>
      {TRAILS.map((len, t) => (
        <linearGradient key={`tail-${String(len)}`} id={`${id}-tail-${String(t)}`} {...span}>
          <stop offset={at(PERIOD - len)} stopColor={GREEN} stopOpacity={0} />
          <stop offset={at(PERIOD - len * 0.7)} stopColor={GREEN} stopOpacity={0.85} />
          <stop offset={at(PERIOD - len * 0.3)} stopColor={PHOSPHOR} stopOpacity={0.9} />
          <stop offset={at(PERIOD - 1)} stopColor={PHOSPHOR} />
          <stop offset={at(PERIOD - 1)} stopColor={HEAD} />
          <stop offset={1} stopColor={HEAD} />
        </linearGradient>
      ))}
      {TRAILS.map((len, t) => (
        <linearGradient key={`glow-${String(len)}`} id={`${id}-glow-${String(t)}`} {...span}>
          <stop offset={at(PERIOD - 3)} stopColor={PHOSPHOR} stopOpacity={0} />
          <stop offset={at(PERIOD - 1)} stopColor={PHOSPHOR} stopOpacity={0.12} />
          <stop offset={at(PERIOD - 1)} stopColor={PHOSPHOR} stopOpacity={0.5} />
          <stop offset={1} stopColor={PHOSPHOR} stopOpacity={0.5} />
        </linearGradient>
      ))}
    </>
  );
}

/** The strings of code the columns run, one glyph a row wherever some trail could light it, from row `top` to row `bottom`. */
function CodeStrings({ id, top, bottom }: { id: string; top: number; bottom: number }) {
  const longest = Math.max(...TRAILS);
  const rows = Array.from({ length: bottom - top + 1 }, (_, k) => top + k).filter((r) => mod(r, PERIOD) >= PERIOD - longest);
  return (
    <>
      {Array.from({ length: STRINGS }, (_, s) => (
        <Glyphs
          key={s} id={`${id}-code-${String(s)}`} cells={rows.map((r) => [0, r] as const)}
          chars={rows.map((r) => pick(s * PERIOD + mod(r, PERIOD), 7)).join("")}
        />
      ))}
    </>
  );
}

/** A touchdown's downpour: every column at once, a sheet of drops falling through the band, its heads a little ragged. */
function Wave({ id, xs, rows }: { id: string; xs: readonly number[]; rows: number }) {
  const lag = (j: number): number => Math.floor(rand(j, 21) * 3);
  // the sheet falls its own depth, its lag and the band's rows, so every head and trail clears the goal line however deep the band
  return (
    <g className="ez-matrix-wave" style={{ "--ez-matrix-drop": `${String((rows + WAVE + 2) * ROW)}px` } as CSSProperties}>
      {[0, 1, 2].map((k) => {
        const cells = xs.filter((_, j) => lag(j) === k).flatMap((x) => Array.from({ length: WAVE }, (_, r): Cell => [x, r - WAVE]));
        return (
          <g key={k} transform={`translate(0 ${String(-k * ROW)})`}>
            <Glyphs
              cells={cells} chars={cells.map(([x, r]) => pick(Math.round(x * 3) + r * 257, 23)).join("")}
              fill={HEAD} stroke={PHOSPHOR} {...bloom} style={{ fill: `url(#${id}-wave)`, stroke: `url(#${id}-wave-glow)` }}
            />
          </g>
        );
      })}
    </g>
  );
}

function WaveGradients({ id }: { id: string }) {
  const span = { gradientUnits: "userSpaceOnUse", x1: 0, x2: 0, y1: -WAVE * ROW, y2: 0 } as const;
  const at = (rows: number): number => rows / WAVE;
  return (
    <>
      <linearGradient id={`${id}-wave`} {...span}>
        <stop offset={0} stopColor={PHOSPHOR} stopOpacity={0} />
        <stop offset={at(WAVE - 3)} stopColor={PHOSPHOR} stopOpacity={0.9} />
        <stop offset={at(WAVE - 1)} stopColor={PHOSPHOR} />
        <stop offset={at(WAVE - 1)} stopColor="#ffffff" />
        <stop offset={1} stopColor="#ffffff" />
      </linearGradient>
      <linearGradient id={`${id}-wave-glow`} {...span}>
        <stop offset={at(2)} stopColor={PHOSPHOR} stopOpacity={0} />
        <stop offset={1} stopColor={PHOSPHOR} stopOpacity={0.6} />
      </linearGradient>
    </>
  );
}

/**
 * The team's name in phosphor on a black terminal plate, behind a prompt and ahead of a blinking
 * cursor. A long name types smaller, down to half size, and past that the line runs out of columns
 * and the rest of the name is cut. During a touchdown each letter rolls in through falling code,
 * left to right, and the plate glitches.
 */
function Terminal({ id, w, h, name, celebrate }: { id: string; w: number; h: number; name: string; celebrate: boolean }) {
  const size = Math.min(h * 0.5, 20, 16 + (h - 33) * 0.2);
  // the prompt, a space, the word and the cursor, each a cell 0.64 em wide, and the plate's padding of 1.1 em, in 92% of the band
  const fs = Math.max(size * 0.5, Math.min(size, (w * 0.92) / ((Array.from(name).length + 3) * 0.64 + 1.1)));
  const columns = Math.floor(((w * 0.92) / fs - 1.1) / 0.64) - 3;
  const word = Array.from(name).slice(0, Math.max(1, columns)).join("").trimEnd();
  const cell = fs * 0.64;
  const cap = fs * 0.73;
  const cells = Array.from(word).length + 3;
  const plate = { w: cells * cell + fs * 1.1, h: fs * 1.45 };
  const x0 = (w - plate.w) / 2;
  const y0 = (h - plate.h) / 2;
  const baseline = h / 2 + cap / 2;
  const at = (k: number): number => x0 + fs * 0.55 + (k + 0.5) * cell;
  const letters = Array.from(word).map((c, i) => ({ c, x: at(i + 2), i })).filter(({ c }) => c !== " ");
  const type = { fontFamily: MONO, fontWeight: 700, textAnchor: "middle", paintOrder: "stroke", strokeOpacity: 0.22, strokeLinejoin: "round" } as const;
  // a reel is drawn at font size 10 and scaled to fit, its glyphs a plate's height apart: 14.5, as ez-matrix-reel expects
  const pitch = (plate.h / fs) * 10;
  return (
    <g className="ez-matrix-glitch" data-ez-name={word}>
      <rect x={num(x0)} y={num(y0)} width={num(plate.w)} height={num(plate.h)} rx={num(fs * 0.12)} fill={BLACK} fillOpacity={0.94} />
      <rect
        className="ez-matrix-frame" x={num(x0 + 0.75)} y={num(y0 + 0.75)} width={num(plate.w - 1.5)} height={num(plate.h - 1.5)} rx={num(fs * 0.1)}
        fill="none" stroke={PHOSPHOR} strokeWidth={1.5} strokeOpacity={0.55}
      />
      <text x={num(at(0))} y={num(baseline)} {...type} fontSize={num(fs)} strokeWidth={num(fs * 0.1)} fill={GREEN} stroke={GREEN}>{">"}</text>
      {celebrate ? (
        <>
          <defs>
            <clipPath id={`${id}-slot`}>
              <rect x={num(x0)} y={num(y0 + 1.5)} width={num(plate.w)} height={num(plate.h - 3)} />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}-slot)`}>
            {letters.map(({ c, x, i }) => (
              <g key={i} transform={`translate(${num(x)} ${num(baseline)}) scale(${num(fs / 10)})`}>
                <text
                  className="ez-matrix-reel" style={{ animationDuration: `${num(0.5 + i * 0.12)}s` }}
                  x={Array.from({ length: REEL + 1 }, () => "0").join(" ")}
                  y={Array.from({ length: REEL + 1 }, (_, k) => num(k * pitch)).join(" ")}
                  {...type} fontSize={10} strokeWidth={1} fill={PHOSPHOR} stroke={PHOSPHOR}
                >
                  {c + Array.from({ length: REEL }, (_, k) => pick(i * REEL + k, 31)).join("")}
                </text>
              </g>
            ))}
          </g>
        </>
      ) : (
        <text x={Array.from(word).map((_, i) => num(at(i + 2))).join(" ")} y={num(baseline)} {...type} fontSize={num(fs)} strokeWidth={num(fs * 0.1)} fill={PHOSPHOR} stroke={PHOSPHOR}>
          {word}
        </text>
      )}
      <rect className="ez-matrix-cursor" x={num(at(cells - 1) - cell * 0.38)} y={num(baseline - cap)} width={num(cell * 0.76)} height={num(cap)} fill={PHOSPHOR} />
    </g>
  );
}

/**
 * Matrix: digital rain. Columns of phosphor code fall down a black end zone a row at a time, each
 * drop led by a near-white glyph and trailing a fading tail, over faint runs of code already
 * fallen; the team's name sits on a black terminal plate with a blinking cursor. A touchdown
 * flashes the screen, floods the band with a sheet of drops, rushes every column and decodes the
 * lettering from scrambled code, one letter at a time.
 */
export function MatrixArt({ w, h, label, celebrate, name }: ArtProps) {
  const id = useArtId("matrix");
  // whole rows to the band, so a drop ticks cell to cell inside it; bigger rows in a taller band
  const rows = Math.max(1, Math.floor(h / Math.max(8.5, Math.min(14, 4 + h * 0.16)) + 0.35));
  const scale = h / rows / ROW;
  const band = w / scale;
  const count = Math.floor(band / PITCH);
  const xs = Array.from({ length: count }, (_, j) => (band - count * PITCH) / 2 + (j + 0.5) * PITCH);
  // fewer drops across the middle third, where the lettering and most routes are
  const falling = xs.filter((x, j) => rand(j, 1) < (Math.abs(x / band - 0.5) < 1 / 6 ? 0.45 : 0.8));
  const cols = falling.map((x, k): Column => {
    // a third of the drops are caught mid-band in the still frame, the rest anywhere in their fall
    const head = rand(k, 5) < 0.35 ? Math.floor(rand(k, 6) * rows) : rows - PERIOD + Math.floor(rand(k, 6) * PERIOD);
    return { x, code: Math.floor(rand(k, 2) * STRINGS), trail: Math.floor(rand(k, 3) * TRAILS.length), flip: rand(k, 4) < 0.4, offset: (head - (PERIOD - 1)) * ROW };
  });
  const clocks = Array.from({ length: Math.min(CLOCKS, cols.length) }, (_, c) => cols.filter((_, k) => k % CLOCKS === c));
  // the residue: short runs of faded code down most columns, the newest glyph of each a little brighter
  const seen = new Set<string>();
  const residue = xs.flatMap((x, j) =>
    Array.from({ length: rand(j, 30) < 0.5 ? 2 : 1 }, (_, n) => {
      const len = 1 + Math.floor(rand(j * 4 + n, 31) * 3);
      const end = Math.floor(rand(j * 4 + n, 32) * (rows + 2)) - 1;
      return Array.from({ length: len }, (_, q) => ({ x, r: end - q, newest: q === 0 }));
    }).flat(),
  ).filter(({ x, r }) => {
    const key = `${num(x)}:${String(r)}`;
    const fresh = r >= 0 && r < rows && !seen.has(key);
    seen.add(key);
    return fresh;
  });
  const faded = residue.filter((c) => !c.newest).map(({ x, r }): Cell => [x, r]);
  const newest = residue.filter((c) => c.newest).map(({ x, r }): Cell => [x, r]);
  const chars = (cells: readonly Cell[], salt: number): string => cells.map(([x, r]) => pick(Math.round(x * 3) + r * 257, salt)).join("");
  // the code's reach: the still frame and a column's own fall, and a touchdown's rush on top
  const top = rows - PERIOD - (PERIOD - 1) * (celebrate ? 2 : 1);
  return (
    <g className={celebrate ? "ez-matrix-party" : undefined}>
      <rect width={w} height={h} fill={BLACK} />
      <g transform={`scale(${num(scale)})`}>
        <defs>
          <CodeStrings id={id} top={top} bottom={2 * PERIOD - 2} />
          <TrailGradients id={id} />
          {celebrate && <WaveGradients id={id} />}
        </defs>
        {h >= 20 && (
          <>
            <Glyphs cells={faded} chars={chars(faded, 12)} fill={FADED} />
            <Glyphs cells={newest} chars={chars(newest, 13)} fill={GREEN} fillOpacity={0.32} />
          </>
        )}
        <g className="ez-matrix-rush">
          {clocks.map((group, c) => (
            <g key={c} className="ez-matrix-fall" style={{ animationDuration: `${num(PERIOD / (2.6 + rand(c, 8) * 2.6))}s` }}>
              {group.map((col) => <Drops key={col.x} id={id} col={col} />)}
            </g>
          ))}
        </g>
        {celebrate && <Wave id={id} xs={xs} rows={rows} />}
      </g>
      {celebrate && <rect className="ez-matrix-flash" width={w} height={h} fill={PHOSPHOR} opacity={0} />}
      {label && name && <Terminal id={id} w={w} h={h} name={name} celebrate={celebrate} />}
    </g>
  );
}

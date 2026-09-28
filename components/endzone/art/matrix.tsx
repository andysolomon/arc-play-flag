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
/**
 * The clocks the columns fall on, in rows a second. Every column shares one of these three, and
 * they all tick on a 12 Hz lattice (3, 4 and 6 divide 12), so the band is repainted at most a
 * dozen times a second however many columns fall: a column of its own on a clock of its own
 * would have some column moving, and the band repainting, on nearly every frame.
 */
const SPEEDS = [3, 4, 6] as const;
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

/**
 * A drop's head glows: a soft phosphor stroke painted under its fill. Only the heads get one,
 * as a separate <text> of their own; stroking every glyph of the rain with a gradient that
 * left all but the heads transparent was most of what a frame of this design used to cost.
 */
const glow = { fill: "none", stroke: PHOSPHOR, strokeOpacity: 0.5, strokeWidth: 3.4, strokeLinejoin: "round" } as const;

interface Column {
  x: number;
  /** which string of code it runs */
  code: number;
  /** which of TRAILS its drops leave */
  trail: number;
  /** some columns run their code mirrored, as the film's do */
  flip: boolean;
  /** which of SPEEDS it falls at */
  clock: number;
  /** the band row the first drop's head is on before the column has moved, so the still frame is a good one */
  head: number;
}

/**
 * A column's drops: the glyphs of its code, from the row its first head starts on, that its
 * fall can ever bring into the band, and no more. A trail lights only its last rows of each
 * PERIOD, so the rest are never written; the tail gradient does the fading.
 */
function Drops({ id, col, rows, reach }: { id: string; col: Column; rows: number; reach: number }) {
  const len = TRAILS[col.trail] ?? TRAILS[1];
  // the column sits with row 0 of its code at band row (head - (PERIOD - 1)), then falls `reach` rows; a row's
  // glyph is worth drawing if some step of that fall puts it in the band (a row's grace either side for its glyph's own height)
  const shift = col.head - (PERIOD - 1);
  const first = -1 - shift - reach;
  const last = rows - shift;
  const lit: number[] = [];
  const heads: number[] = [];
  for (let r = first; r <= last; r++) {
    const phase = mod(r, PERIOD);
    if (phase >= PERIOD - len) lit.push(r);
    if (phase === PERIOD - 1) heads.push(r);
  }
  const chars = (rs: readonly number[]): string => rs.map((r) => pick(col.code * PERIOD + mod(r, PERIOD), 7)).join("");
  const cells = (rs: readonly number[]): Cell[] => rs.map((r): Cell => [0, r]);
  return (
    <g transform={`translate(${num(col.x)} ${num(shift * ROW)})${col.flip ? " scale(-1 1)" : ""}`}>
      <Glyphs cells={cells(heads)} chars={chars(heads)} {...glow} />
      <Glyphs cells={cells(lit)} chars={chars(lit)} fill={GREEN} style={{ fill: `url(#${id}-tail-${String(col.trail)})` }} />
    </g>
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
    </>
  );
}

/** A touchdown's downpour: every column at once, a sheet of drops falling through the band, its heads a little ragged. */
function Wave({ id, xs, rows }: { id: string; xs: readonly number[]; rows: number }) {
  const lag = (j: number): number => Math.floor(rand(j, 21) * 3);
  const glyph = ([x, r]: Cell): string => pick(Math.round(x * 3) + r * 257, 23);
  // the sheet falls its own depth, its lag and the band's rows, so every head and trail clears the goal line however deep the band
  return (
    <g className="ez-matrix-wave" style={{ "--ez-matrix-drop": `${String((rows + WAVE + 2) * ROW)}px` } as CSSProperties}>
      {[0, 1, 2].map((k) => {
        const cols = xs.filter((_, j) => lag(j) === k);
        const cells = cols.flatMap((x) => Array.from({ length: WAVE }, (_, r): Cell => [x, r - WAVE]));
        // the two brightest rows of the sheet glow; the rest just fall
        const heads = cols.flatMap((x): Cell[] => [[x, -2], [x, -1]]);
        return (
          <g key={k} transform={`translate(0 ${String(-k * ROW)})`}>
            <Glyphs cells={heads} chars={heads.map(glyph).join("")} {...glow} />
            <Glyphs cells={cells} chars={cells.map(glyph).join("")} fill={HEAD} style={{ fill: `url(#${id}-wave)` }} />
          </g>
        );
      })}
    </g>
  );
}

function WaveGradient({ id }: { id: string }) {
  const at = (rows: number): number => rows / WAVE;
  return (
    <linearGradient id={`${id}-wave`} gradientUnits="userSpaceOnUse" x1={0} x2={0} y1={-WAVE * ROW} y2={0}>
      <stop offset={0} stopColor={PHOSPHOR} stopOpacity={0} />
      <stop offset={at(WAVE - 3)} stopColor={PHOSPHOR} stopOpacity={0.9} />
      <stop offset={at(WAVE - 1)} stopColor={PHOSPHOR} />
      <stop offset={at(WAVE - 1)} stopColor="#ffffff" />
      <stop offset={1} stopColor="#ffffff" />
    </linearGradient>
  );
}

/**
 * END ZONE in phosphor on a black terminal plate, behind a prompt and ahead of a blinking cursor.
 * During a touchdown each letter rolls in through falling code, left to right, and the plate glitches.
 */
function Terminal({ id, w, h, celebrate }: { id: string; w: number; h: number; celebrate: boolean }) {
  const fs = Math.min(h * 0.5, 20, 16 + (h - 33) * 0.2);
  const cell = fs * 0.64;
  const cap = fs * 0.73;
  const word = "END ZONE";
  // the prompt, a space, the word, the cursor
  const cells = word.length + 3;
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
    <g className="ez-matrix-glitch">
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
 * fallen; END ZONE sits on a black terminal plate with a blinking cursor. A touchdown flashes the
 * screen, floods the band with a sheet of drops, rushes every column and decodes the lettering
 * from scrambled code, one letter at a time.
 *
 * Drawn to be cheap to repaint, since every step of the rain repaints the band: each column is
 * one <text> of just the glyphs its fall can show, only the heads are stroked, and the columns
 * fall on three shared clocks that tick together.
 */
export function MatrixArt({ w, h, label, celebrate }: ArtProps) {
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
    return { x, code: Math.floor(rand(k, 2) * STRINGS), trail: Math.floor(rand(k, 3) * TRAILS.length), flip: rand(k, 4) < 0.4, clock: Math.floor(rand(k, 8) * SPEEDS.length), head };
  });
  const clocks = SPEEDS.map((_, c) => cols.filter((col) => col.clock === c)).filter((group) => group.length > 0);
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
  // how far a column falls: one loop of its own, and a touchdown's rush on top
  const reach = PERIOD * (celebrate ? 2 : 1);
  return (
    <g className={celebrate ? "ez-matrix-party" : undefined}>
      <rect width={w} height={h} fill={BLACK} />
      <g transform={`scale(${num(scale)})`}>
        <defs>
          <TrailGradients id={id} />
          {celebrate && <WaveGradient id={id} />}
        </defs>
        {h >= 20 && (
          <>
            <Glyphs cells={faded} chars={chars(faded, 12)} fill={FADED} />
            <Glyphs cells={newest} chars={chars(newest, 13)} fill={GREEN} fillOpacity={0.32} />
          </>
        )}
        <g className="ez-matrix-rush">
          {clocks.map((group) => {
            const clock = group[0]?.clock ?? 0;
            return (
              <g key={clock} className="ez-matrix-fall" style={{ animationDuration: `${num(PERIOD / (SPEEDS[clock] ?? SPEEDS[0]))}s` }}>
                {group.map((col) => <Drops key={col.x} id={id} col={col} rows={rows} reach={reach} />)}
              </g>
            );
          })}
        </g>
        {celebrate && <Wave id={id} xs={xs} rows={rows} />}
      </g>
      {celebrate && <rect className="ez-matrix-flash" width={w} height={h} fill={PHOSPHOR} opacity={0} />}
      {label && <Terminal id={id} w={w} h={h} celebrate={celebrate} />}
    </g>
  );
}

import type { CSSProperties } from "react";
import { useArtId, type ArtProps } from "./shared";

const CREAM = "#fdf5ee";
const BLUSH = "#f9dce3";
const BARK = "#3b2429";
const PETAL = "#f7a6bc";
const PETAL_EDGE = "#df7896";
const PALE = "#fff3f6";
const HEART = "#cf3f70";
const STAMEN = "#a3284f";
const BUD = "#ea6f93";
/** the lettering's ink, and the mist it sits on */
const PLUM = "#5a1a36";
const MIST = "#fffaf5";
const SEAL = "#c63a31";
/** the loose petals, after the celebration's confetti (lib/endzone.ts) */
const DRIFT = ["#ffb0c1", "#ff8fab", "#f9a3b8", "#f48fb1"] as const;
/** Patrick Hand's capitals stand this much of an em above the baseline */
const CAP = 0.68;
/** a blossom's radius in its <defs>, scaled to each one's size where it's used */
const UNIT = 10;

type Vars = CSSProperties & { [key: `--ez-sakura-${string}`]: string };
/** A band of mist: its left and right ends, its middle's height and its depth. */
type Band = readonly [x0: number, x1: number, y: number, d: number];

const num = (n: number): string => String(Math.round(n * 100) / 100);
const px = (n: number): string => `${num(n)}px`;
const secs = (n: number): string => `${num(n)}s`;

/** A fixed pseudo-random number in [0, 1) for motif `i`: the same on the server and in the browser. */
function rand(i: number, salt: number): number {
  let x = Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** Maps a shape drawn upright about (0, 0) to (x, y), turned `deg`. */
function turn(x: number, y: number, deg: number): (u: number, v: number) => string {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return (u, v) => `${num(x + u * c - v * s)} ${num(y + u * s + v * c)}`;
}

/** One sakura petal from (x, y) outwards at `deg`, `len` long, with the notch in its tip that tells it from a plum's. */
function petal(x: number, y: number, len: number, deg: number): string {
  const at = turn(x, y, deg);
  const half = len * 0.33;
  return (
    `M${at(0, 0)}C${at(-half * 1.1, -len * 0.2)} ${at(-half * 1.25, -len * 0.8)} ${at(-half * 0.4, -len)}` +
    `L${at(0, -len * 0.84)}L${at(half * 0.4, -len)}C${at(half * 1.25, -len * 0.8)} ${at(half * 1.1, -len * 0.2)} ${at(0, 0)}Z`
  );
}

/** Five petals round (x, y). */
const flower = (x: number, y: number, r: number, deg: number): string =>
  [0, 72, 144, 216, 288].map((d) => petal(x, y, r, deg + d)).join("");

/** A loose petal centred on (x, y), turned `deg`. */
function loose(x: number, y: number, len: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return petal(x + Math.sin(a) * len * 0.5, y - Math.cos(a) * len * 0.5, len, deg + 180);
}

/** A closed bud: a pink drop `r` long from its stalk at (x, y), tipped `deg` from upright. */
function bud(x: number, y: number, r: number, deg: number): string {
  const at = turn(x, y, deg);
  const half = r * 0.36;
  return `M${at(0, 0)}C${at(-half * 1.5, -r * 0.35)} ${at(-half, -r)} ${at(0, -r)}C${at(half, -r)} ${at(half * 1.5, -r * 0.35)} ${at(0, 0)}Z`;
}

/** A limb as one tapered shape: each knot is [x, y, thickness]; the kinks between them are what make it gnarled. */
function limb(knots: readonly (readonly [number, number, number])[]): string {
  const side = (sign: number) =>
    knots.map(([x, y, t], i) => {
      const [ax, ay] = knots[Math.max(0, i - 1)] ?? [x, y];
      const [bx, by] = knots[Math.min(knots.length - 1, i + 1)] ?? [x, y];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      return `${num(x - ((by - ay) / len) * (t / 2) * sign)} ${num(y + ((bx - ax) / len) * (t / 2) * sign)}`;
    });
  return `M${side(1).join("L")}L${side(-1).reverse().join("L")}Z`;
}

/** A knob at each bend of a limb: rounds its kinks and knuckles the bark, as old cherry wood is. */
const knuckles = (knots: readonly (readonly [number, number, number])[]): string =>
  knots.map(([x, y, r]) => `M${num(x - r)} ${num(y)}a${num(r)} ${num(r)} 0 1 0 ${num(r * 2)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-r * 2)} 0Z`).join("");

/**
 * A stepped bank of mist, as on a folding screen: a long band, with a shorter one stepping out
 * from under its right end, and from its left end either above (`rise`) or below, so the bank
 * under the lettering can keep clear of the boughs over it.
 */
const cloud = ([x0, x1, y, d]: Band, rise = true): Band[] => [
  [x0, x1, y, d],
  [x0 - d * 0.9, x0 + (x1 - x0) * 0.42, y + d * (rise ? -0.36 : 0.3), d * 0.5],
  [x1 - (x1 - x0) * 0.45, x1 + d * 0.95, y + d * 0.38, d * 0.46],
];

/** Across the reach and down the bough's depth, as fractions; thickness in units at the field's full depth. */
type Knot = readonly [u: number, v: number, thick: number];
interface Bloom {
  readonly u: number;
  readonly v: number;
  readonly s: number;
  readonly pale?: boolean;
}
interface Sprig {
  readonly limbs: readonly (readonly Knot[])[];
  /** blossoms grouped as they hang, so each bunch can bounce on its own */
  readonly bunches: readonly (readonly Bloom[])[];
  /** the first two burst open for a touchdown */
  readonly buds: readonly (readonly [number, number])[];
}

const LEFT: Sprig = {
  limbs: [
    [[-0.06, 0.02, 9.5], [0.1, 0.2, 7.8], [0.2, 0.34, 6.6], [0.33, 0.24, 5.6], [0.47, 0.4, 4.6], [0.6, 0.33, 3.6], [0.74, 0.5, 2.8], [0.86, 0.46, 2], [0.97, 0.58, 1.2]],
    [[0.2, 0.34, 4.2], [0.25, 0.56, 3], [0.23, 0.72, 1.8]],
    [[0.33, 0.24, 3.6], [0.4, 0.08, 2.4], [0.46, -0.06, 1.6]],
    [[0.6, 0.33, 2.8], [0.66, 0.56, 2], [0.73, 0.68, 1.1]],
    [[0.74, 0.5, 2.2], [0.8, 0.3, 1.5], [0.85, 0.18, 0.9]],
  ],
  bunches: [
    [{ u: 0.08, v: 0.36, s: 0.9, pale: true }, { u: 0.17, v: 0.74, s: 0.72 }, { u: 0.23, v: 0.64, s: 1.05 }, { u: 0.29, v: 0.78, s: 0.8, pale: true }],
    [{ u: 0.29, v: 0.1, s: 0.72 }, { u: 0.37, v: 0.12, s: 1, pale: true }, { u: 0.44, v: 0.02, s: 0.85 }],
    [{ u: 0.44, v: 0.6, s: 0.75, pale: true }, { u: 0.5, v: 0.5, s: 1.05 }, { u: 0.56, v: 0.38, s: 0.8, pale: true }, { u: 0.66, v: 0.62, s: 0.95 }, { u: 0.74, v: 0.72, s: 0.75, pale: true }],
    [{ u: 0.79, v: 0.32, s: 0.62 }, { u: 0.84, v: 0.16, s: 0.85, pale: true }, { u: 0.9, v: 0.4, s: 0.95 }, { u: 0.99, v: 0.58, s: 0.75, pale: true }],
  ],
  buds: [[0.96, 0.7], [0.61, 0.2], [0.14, 0.5], [0.88, 0.06], [0.35, 0.32]],
};

const RIGHT: Sprig = {
  limbs: [
    [[-0.04, -0.08, 9.5], [0.08, 0.16, 8], [0.16, 0.4, 6.6], [0.3, 0.34, 5.6], [0.44, 0.5, 4.6], [0.58, 0.4, 3.6], [0.72, 0.52, 2.6], [0.84, 0.44, 1.8], [0.93, 0.52, 1.1]],
    [[0.16, 0.4, 4.2], [0.22, 0.62, 3], [0.18, 0.8, 1.6]],
    [[0.3, 0.34, 3.6], [0.36, 0.14, 2.5], [0.46, 0.04, 1.6]],
    [[0.58, 0.4, 2.6], [0.63, 0.62, 1.8], [0.7, 0.72, 1]],
    [[0.72, 0.52, 2], [0.78, 0.28, 1.4], [0.76, 0.16, 0.9]],
  ],
  bunches: [
    [{ u: 0.06, v: 0.14, s: 0.9, pale: true }, { u: 0.13, v: 0.62, s: 0.75 }, { u: 0.19, v: 0.74, s: 1 }, { u: 0.25, v: 0.6, s: 0.8, pale: true }],
    [{ u: 0.31, v: 0.22, s: 0.7 }, { u: 0.38, v: 0.12, s: 1 }, { u: 0.46, v: 0.04, s: 0.8, pale: true }],
    [{ u: 0.4, v: 0.64, s: 0.7 }, { u: 0.46, v: 0.56, s: 1.05, pale: true }, { u: 0.52, v: 0.42, s: 0.8 }, { u: 0.6, v: 0.56, s: 0.7, pale: true }, { u: 0.66, v: 0.68, s: 0.95 }],
    [{ u: 0.76, v: 0.18, s: 0.9, pale: true }, { u: 0.84, v: 0.42, s: 0.85 }, { u: 0.93, v: 0.56, s: 0.7, pale: true }],
  ],
  buds: [[0.92, 0.66], [0.54, 0.28], [0.24, 0.86], [0.8, 0.08], [0.1, 0.32]],
};

/** The two kinds of blossom, drawn once: pink, and the paler kind blushing at the heart. */
function BlossomDefs({ id }: { id: string }) {
  const stamens = [18, 90, 162, 234, 306].map((d) => petal(0, 0, UNIT * 0.42, d)).join("");
  const kind = (name: string, outer: string, inner: string, innerOpacity: number) => (
    <g id={`${id}-${name}`}>
      <path d={flower(0, 0, UNIT, 0)} fill={outer} stroke={PETAL_EDGE} strokeWidth={num(UNIT * 0.085)} strokeLinejoin="round" />
      <path d={flower(0, 0, UNIT * 0.52, 0)} fill={inner} opacity={innerOpacity} />
      <path d={stamens} fill="none" stroke={STAMEN} strokeWidth={num(UNIT * 0.05)} opacity={0.7} />
      <circle r={num(UNIT * 0.17)} fill={HEART} />
    </g>
  );
  return (
    <defs>
      {kind("pink", PETAL, PALE, 0.7)}
      {kind("pale", PALE, PETAL, 0.75)}
    </defs>
  );
}

const Blossom = ({ id, x, y, r, deg, pale }: { id: string; x: number; y: number; r: number; deg: number; pale: boolean }) => (
  <use href={`#${id}-${pale ? "pale" : "pink"}`} transform={`translate(${num(x)} ${num(y)}) rotate(${num(deg)}) scale(${num(r / UNIT)})`} />
);

/** A gnarled bough reaching in from one top corner, `reach` across and `depth` down, heavy with blossom. */
function Bough({ id, sprig, w, reach, depth, k, flip, celebrate }: { id: string; sprig: Sprig; w: number; reach: number; depth: number; k: number; flip: boolean; celebrate: boolean }) {
  const x = (u: number): number => (flip ? w - u * reach : u * reach);
  const y = (v: number): number => v * depth;
  const r = 8.8 * k;
  // a wave of bounces following the gust across from the left
  const after = (u: number, from: number): CSSProperties => ({ animationDelay: secs(from + (x(u) / w) * 0.55) });
  return (
    <g className={flip ? "ez-sakura-bough ez-sakura-bough-right" : "ez-sakura-bough"} style={{ transformOrigin: `${px(flip ? w : 0)} 0px` }}>
      <g fill={BARK} stroke={BARK} strokeWidth={num(0.8 * k)} strokeLinejoin="round">
        {sprig.limbs.map((knots, i) => (
          <path key={i} d={limb(knots.map(([u, v, t]) => [x(u), y(v), t * k] as const))} />
        ))}
        <path d={knuckles(sprig.limbs.flatMap((knots) => knots.slice(1, -1).map(([u, v, t]) => [x(u), y(v), t * k * 0.62] as const)))} />
      </g>
      <path
        d={sprig.buds.map(([u, v], i) => bud(x(u), y(v), r * 0.5, (flip ? -1 : 1) * (60 + rand(i, 21) * 90))).join("")}
        fill={BUD} stroke={PETAL_EDGE} strokeWidth={num(r * 0.05)} strokeLinejoin="round"
      />
      {sprig.bunches.map((bunch, b) => (
        <g key={b} className="ez-sakura-bunch" style={after(bunch[0]?.u ?? 0, 0.1)}>
          {bunch.map((bloom, i) => (
            <Blossom key={i} id={id} x={x(bloom.u)} y={y(bloom.v)} r={r * bloom.s} deg={rand(b * 8 + i, flip ? 31 : 30) * 72} pale={bloom.pale ?? false} />
          ))}
        </g>
      ))}
      {celebrate &&
        sprig.buds.slice(0, 2).map(([u, v], i) => (
          <g key={i} className="ez-sakura-bloom" style={after(u, 0.2)}>
            <Blossom id={id} x={x(u)} y={y(v)} r={r * 0.8} deg={rand(i, 40) * 72} pale={i % 2 === 0} />
          </g>
        ))}
    </g>
  );
}

interface Drifter {
  x: number;
  y: number;
  d: string;
  color: string;
  style: Vars;
  variant: "a" | "b";
}

/** Loose petals crossing the band on the breeze, each placed where its drift passes at time zero so a still frame is the same scene. */
function drifters(w: number, h: number, scale: number): { far: Drifter[]; near: Drifter[] } {
  const n = Math.max(4, Math.min(12, Math.round(w / 55)));
  const far: Drifter[] = [];
  const near: Drifter[] = [];
  for (let i = 0; i < n; i++) {
    const back = i % 3 === 2;
    const len = scale * (back ? 5.5 : 7.5) * (0.85 + rand(i, 3) * 0.35);
    const x = (w * (i + 0.5 + (rand(i, 1) - 0.5) * 0.7)) / n;
    const margin = len * 2 + 8;
    const span = w + margin * 2;
    const dur = back ? 24 + rand(i, 5) * 6 : 15 + rand(i, 5) * 6;
    (back ? far : near).push({
      x,
      y: h * (0.16 + rand(i, 2) * 0.66),
      d: loose(0, 0, len, rand(i, 4) * 360),
      color: DRIFT[i % DRIFT.length] ?? PETAL,
      variant: i % 2 ? "a" : "b",
      style: {
        "--ez-sakura-from": px(-(x + margin)),
        "--ez-sakura-span": px(span),
        "--ez-sakura-bob": px(h * (0.07 + rand(i, 6) * 0.07)),
        animationDuration: secs(dur),
        animationDelay: secs(-((x + margin) / span) * dur),
      },
    });
  }
  return { far, near };
}

function Petals({ list, opacity }: { list: readonly Drifter[]; opacity: number }) {
  return (
    <g opacity={opacity} stroke={PETAL_EDGE} strokeWidth={0.4} strokeLinejoin="round">
      {list.map((p) => (
        <g key={p.x} transform={`translate(${num(p.x)} ${num(p.y)})`}>
          <path className={`ez-sakura-drift ez-sakura-drift-${p.variant}`} style={p.style} d={p.d} fill={p.color} />
        </g>
      ))}
    </g>
  );
}

/** Petals already fallen, strewn along the ground by the goal line. */
function Fallen({ w, h, scale }: { w: number; h: number; scale: number }) {
  const n = Math.round(w / 34);
  const d = Array.from({ length: n }, (_, i) => {
    const x = (w * (i + 0.5 + (rand(i, 50) - 0.5) * 0.9)) / n;
    return loose(x, h - 3 - rand(i, 51) * Math.min(h * 0.14, 7), scale * 4.6 * (0.8 + rand(i, 52) * 0.4), 60 + rand(i, 53) * 60);
  }).join("");
  return <path d={d} fill="#f29ab2" opacity={0.55} />;
}

/** Far-off trees in blossom, a soft pink haze of crowns along the ground. */
function Grove({ w, h }: { w: number; h: number }) {
  // crowns packed close enough to merge into one soft ridge
  const n = Math.round(w / (h * 0.26));
  const d = Array.from({ length: n }, (_, i) => {
    const r = h * (0.13 + rand(i, 60) * 0.11);
    const x = (w * (i + 0.5 + (rand(i, 61) - 0.5) * 0.6)) / n;
    const y = h - r * 0.4;
    return `M${num(x - r)} ${num(y)}a${num(r)} ${num(r)} 0 1 1 ${num(r * 2)} 0a${num(r)} ${num(r)} 0 1 1 ${num(-r * 2)} 0Z`;
  }).join("");
  return <path d={d} fill="#f5bccb" opacity={0.45} />;
}

/** Long, round-ended bands of mist, the kasumi of old Japanese screens. */
function Mist({ bands, fill, opacity }: { bands: readonly Band[]; fill: string; opacity: number }) {
  return (
    <g fill={fill} opacity={opacity}>
      {bands.map(([x0, x1, y, d]) => (
        <rect key={`${num(x0)} ${num(y)}`} x={num(x0)} y={num(y - d / 2)} width={num(x1 - x0)} height={num(d)} rx={num(d / 2)} />
      ))}
    </g>
  );
}

/** A touchdown's wind: two streaks, each curling at its tail, sweeping across behind the boughs and the lettering. */
function Wind({ w, h }: { w: number; h: number }) {
  const len = Math.min(w * 0.32, 170);
  const a = h * 0.08;
  const c = h * 0.13;
  const d =
    `M0 0C${num(len * 0.3)} ${num(-a)} ${num(len * 0.6)} ${num(a)} ${num(len)} 0` +
    `c${num(c * 0.7)} ${num(-c * 0.3)} ${num(c * 0.9)} ${num(-c * 1.3)} ${num(c * 0.1)} ${num(-c * 1.4)}c${num(-c * 0.6)} ${num(-c * 0.1)} ${num(-c * 0.7)} ${num(c * 0.6)} ${num(-c * 0.15)} ${num(c * 0.7)}`;
  return (
    <g fill="none" stroke="#ffffff" strokeWidth={num(Math.max(1.6, h * 0.06))}>
      {[0.32, 0.7].map((v, i) => {
        const style: Vars = { "--ez-sakura-span": px(w + len + 40), animationDelay: secs(i * 0.3), strokeLinecap: "round" };
        return (
          <g key={v} transform={`translate(${num(-len - 20)} ${num(h * v)})`}>
            <path className="ez-sakura-wind" style={style} d={d} />
          </g>
        );
      })}
    </g>
  );
}

/** A touchdown's gust: clumps of petals shaken off both boughs and blown in from the left, whirling away across the band. */
function Gust({ w, h, reach, depth, scale }: { w: number; h: number; reach: number; depth: number; scale: number }) {
  const n = Math.max(6, Math.round(w / 47));
  return (
    <g stroke={PETAL_EDGE} strokeWidth={0.5} strokeLinejoin="round">
      {Array.from({ length: n }, (_, i) => {
        // a third blow in from off the left, the rest shake loose from the blossom
        const fromBough = i % 3 !== 0;
        const u = 0.15 + rand(i, 11) * 0.8;
        const x = fromBough ? (i % 2 ? u * reach : w - u * reach) : -12;
        const y = fromBough ? depth * (0.2 + rand(i, 12) * 0.5) : h * (0.2 + rand(i, 12) * 0.6);
        const len = scale * 8.5 * (0.8 + rand(i, 13) * 0.4);
        // four petals round the clump's middle, so its spin whirls them round each other
        const at = (j: number): string => {
          const a = ((j * 90 + rand(i * 4 + j, 19) * 50) * Math.PI) / 180;
          const r = len * (0.7 + rand(i * 4 + j, 20) * 0.6);
          return loose(Math.cos(a) * r, Math.sin(a) * r, len * (0.8 + rand(i * 4 + j, 22) * 0.35), rand(i * 4 + j, 18) * 360);
        };
        const style: Vars = {
          "--ez-sakura-span": px(w - x + 40),
          "--ez-sakura-loop": px(h * (0.12 + rand(i, 14) * 0.12)),
          "--ez-sakura-bob": px(h * (rand(i, 15) - 0.45) * 0.5),
          // every clump is gone by 3.3 s, inside the celebration
          animationDuration: secs(2 + rand(i, 16) * 0.7),
          animationDelay: secs(rand(i, 17) * 0.4 + (Math.max(0, x) / w) * 0.2),
        };
        return (
          <g key={i} transform={`translate(${num(x)} ${num(y)})`}>
            <g className="ez-sakura-gust" style={style}>
              <path d={at(0) + at(2)} fill={DRIFT[i % DRIFT.length] ?? PETAL} />
              <path d={at(1) + at(3)} fill={DRIFT[(i + 2) % DRIFT.length] ?? PETAL} />
            </g>
          </g>
        );
      })}
    </g>
  );
}

/** A red name seal pressed after the lettering, a white blossom cut into it. */
function Seal({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g className="ez-sakura-seal">
      <g transform={`rotate(-5 ${num(x)} ${num(y)})`}>
        <rect x={num(x - s / 2)} y={num(y - s / 2)} width={num(s)} height={num(s)} rx={num(s * 0.14)} fill={SEAL} />
        <rect x={num(x - s * 0.39)} y={num(y - s * 0.39)} width={num(s * 0.78)} height={num(s * 0.78)} rx={num(s * 0.08)} fill="none" stroke={MIST} strokeWidth={num(s * 0.05)} />
        <path d={flower(x, y, s * 0.3, 0)} fill={MIST} />
        <circle cx={num(x)} cy={num(y)} r={num(s * 0.06)} fill={SEAL} />
      </g>
    </g>
  );
}

/** END ZONE in plum on a bank of mist, sealed. */
function Lettering({ cx, cy, fs, sun }: { cx: number; cy: number; fs: number; sun: boolean }) {
  // Patrick Hand sets END ZONE about 4.4 em wide at this spacing
  const width = fs * 4.42;
  const spacing = fs * 0.1;
  const seal = fs * 0.92;
  const gap = fs * 0.4;
  const tx = cx - (gap + seal) / 2;
  return (
    <g>
      {sun && <circle cx={num(cx)} cy={num(cy - fs * 0.55)} r={num(fs * 1.25)} fill="#f7c0cd" opacity={0.55} />}
      <Mist fill={MIST} opacity={0.95} bands={cloud([tx - width / 2 - fs * 0.7, cx + (width + gap + seal) / 2 + fs * 0.6, cy, fs * 1.3], false)} />
      <text x={num(tx + spacing / 2)} y={num(cy + (fs * CAP) / 2)} textAnchor="middle" fontFamily="var(--font-hand)" fontSize={num(fs)} letterSpacing={num(spacing)} fill={PLUM}>
        END ZONE
      </text>
      <Seal x={tx + width / 2 + gap + seal / 2} y={cy} s={seal} />
    </g>
  );
}

/**
 * Sakura: a spring end zone. A cream sky blushing down to a petal-strewn ground, gnarled boughs
 * reaching in from both top corners heavy with five-petal blossom, END ZONE in plum on a bank of
 * mist with a red seal, and loose petals drifting across on the breeze, tumbling as they go. A
 * touchdown blows a gust through it: wind streaks across, the boughs shake, the blossom bounces,
 * buds burst open, the seal stamps down and clumps of petals whirl off the branches and away.
 */
export function SakuraArt({ w, h, label, celebrate }: ArtProps) {
  const id = useArtId("sakura");
  const reach = Math.min(w * 0.36, h * 4.4);
  // the swatch is taller than the field is deep: its boughs keep the field's proportions, with bigger blossom
  const depth = Math.min(h, reach * 0.55);
  const k = Math.max(Math.sqrt(reach * depth) / 92, h / 70);
  const boughs = h >= 22;
  const scale = Math.max(k, Math.min(1, h / 20));
  const fs = Math.min(h * 0.45, 18 + (h - 44) * 0.15);
  const { far, near } = drifters(w, h, scale);
  return (
    <g className={celebrate ? "ez-sakura-party" : undefined}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={CREAM} />
          <stop offset="1" stopColor={BLUSH} />
        </linearGradient>
      </defs>
      {boughs && <BlossomDefs id={id} />}
      <rect width={w} height={h} fill={CREAM} style={{ fill: `url(#${id}-sky)` }} />
      {boughs && w > 400 && <Mist fill="#ffffff" opacity={0.5} bands={[...cloud([w * 0.26, w * 0.37, h * 0.76, h * 0.15]), ...cloud([w * 0.63, w * 0.74, h * 0.22, h * 0.13])]} />}
      {boughs && <Grove w={w} h={h} />}
      <Fallen w={w} h={h} scale={scale} />
      <Petals list={far} opacity={0.65} />
      {celebrate && <Wind w={w} h={h} />}
      {boughs && (
        <>
          <Bough id={id} sprig={LEFT} w={w} reach={reach} depth={depth} k={k} flip={false} celebrate={celebrate} />
          <Bough id={id} sprig={RIGHT} w={w} reach={reach} depth={depth} k={k} flip celebrate={celebrate} />
        </>
      )}
      <Petals list={near} opacity={1} />
      {label && <Lettering cx={w / 2} cy={h / 2 + Math.max(0, h - 44) * 0.25} fs={fs} sun={boughs} />}
      {celebrate && <Gust w={w} h={h} reach={reach} depth={depth} scale={scale} />}
    </g>
  );
}

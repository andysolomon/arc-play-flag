import type { CSSProperties } from "react";
import { useArtId, type ArtProps } from "./shared";

const INDIGO = "#1f3a60";
const PRUSSIAN = "#2b4d7e";
const BLUE = "#3f6fb5";
const FOAM = "#f4ecd8";
const SPRAY = "#fffdf6";
const SKY_TOP = "#d9cbab";
const SKY = "#efe5cb";
const FUJI = "#3a5680";
const SEAL = "#b3321f";
/** the seal's lettering and frame: the cream of the foam */
const SEAL_INK = "#fbf3e1";
/** Patrick Hand's capitals stand this much of an em above the baseline */
const CAP = 0.68;

type Vars = CSSProperties & { [key: `--ez-great-wave-${string}`]: string };
type Pt = readonly [u: number, v: number];
type Curve = readonly [Pt, Pt, Pt];
/** Maps a point given across and up as fractions of a shape's box to SVG coordinates. */
type At = (u: number, v: number) => string;

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

/** A box `bw` across and `bh` high standing on (x0, bottom), measured up from its foot. */
const box = (x0: number, bottom: number, bw: number, bh: number): At => (u, v) => `${num(x0 + u * bw)} ${num(bottom - v * bh)}`;

const shape = (at: At, start: Pt, curves: readonly Curve[], close = true): string =>
  `M${at(...start)}` + curves.map(([a, b, c]) => `C${at(...a)} ${at(...b)} ${at(...c)}`).join("") + (close ? "Z" : "");

/**
 * A talon of foam: a finger `len` long reaching out from (x, y) at `deg` (clockwise from east)
 * and hooking round clockwise at its tip, as the Great Wave's crest breaks into claws.
 */
function claw(x: number, y: number, len: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const at = (u: number, v: number): string => `${num(x + u * c - v * s)} ${num(y + u * s + v * c)}`;
  const hw = len * 0.3;
  return `M${at(0, -hw)}C${at(len * 0.55, -hw * 1.2)} ${at(len * 1.08, -hw * 0.2)} ${at(len * 0.9, len * 0.42)}C${at(len * 0.72, hw * 0.25)} ${at(len * 0.42, hw)} ${at(0, hw)}Z`;
}

const dot = (x: number, y: number, r: number): string =>
  `M${num(x - r)} ${num(y)}a${num(r)} ${num(r)} 0 1 0 ${num(r * 2)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-r * 2)} 0Z`;

/** The big wave's outline, rising from its foot on the left, curling over and falling away down its face. */
const WAVE: { start: Pt; curves: Curve[] } = {
  start: [-0.04, 0],
  curves: [
    [[0.12, 0.2], [0.2, 0.62], [0.36, 0.84]],
    [[0.46, 0.97], [0.56, 1], [0.66, 0.99]],
    [[0.8, 0.97], [0.93, 0.84], [0.95, 0.66]],
    [[0.96, 0.56], [0.92, 0.5], [0.87, 0.52]],
    [[0.8, 0.62], [0.7, 0.66], [0.64, 0.56]],
    [[0.58, 0.44], [0.62, 0.18], [0.78, 0.06]],
    [[0.86, 0.01], [0.95, 0], [1.05, 0]],
  ],
};

/** The cream cap along its crest, from partway up its back round the lip. */
const CAP_FOAM: { start: Pt; curves: Curve[] } = {
  start: [0.3, 0.74],
  curves: [
    [[0.4, 0.92], [0.54, 1.03], [0.66, 1.02]],
    [[0.81, 1], [0.95, 0.86], [0.97, 0.66]],
    [[0.98, 0.55], [0.93, 0.47], [0.86, 0.5]],
    [[0.9, 0.6], [0.86, 0.8], [0.7, 0.84]],
    [[0.56, 0.87], [0.44, 0.84], [0.3, 0.74]],
  ],
};

/** Lighter currents running up its back, as Hokusai cut them. */
const STREAKS: readonly { start: Pt; curves: Curve[] }[] = [
  { start: [0.06, 0.1], curves: [[[0.16, 0.26], [0.24, 0.56], [0.38, 0.74]]] },
  { start: [0.18, 0.06], curves: [[[0.28, 0.2], [0.34, 0.46], [0.47, 0.64]]] },
  { start: [0.32, 0.05], curves: [[[0.4, 0.16], [0.45, 0.36], [0.55, 0.52]]] },
];

/** Where the talons reach from the lip: across, up, angle. */
const TALONS: readonly (readonly [number, number, number])[] = [
  [0.8, 0.98, 8],
  [0.9, 0.9, 30],
  [0.955, 0.77, 55],
  [0.97, 0.63, 85],
  [0.93, 0.51, 125],
  [0.85, 0.52, 160],
];

/** The Great Wave itself, `bw` wide and `bh` tall, standing on the band's floor at x0. */
function GreatWave({ x0, bottom, bw, bh, className }: { x0: number; bottom: number; bw: number; bh: number; className?: string }) {
  const at = box(x0, bottom, bw, bh);
  const talon = bh * 0.2;
  const at2 = (u: number, v: number): readonly [number, number] => [x0 + u * bw, bottom - v * bh];
  return (
    <g className={className}>
      <path d={shape(at, WAVE.start, WAVE.curves)} fill={INDIGO} />
      <g fill="none" stroke={BLUE} strokeWidth={num(Math.max(1.2, bh * 0.045))} style={{ strokeLinecap: "round" }}>
        {STREAKS.map((s, i) => (
          <path key={i} d={shape(at, s.start, s.curves, false)} />
        ))}
      </g>
      <g className="ez-great-wave-foam">
        <path
          d={shape(at, CAP_FOAM.start, CAP_FOAM.curves) + TALONS.map(([u, v, deg]) => claw(...at2(u, v), talon * (0.75 + rand(Math.round(u * 100), 3) * 0.4), deg)).join("")}
          fill={FOAM}
        />
      </g>
    </g>
  );
}

/**
 * A band of rolling waves: crests `t` apart, troughs on y = `b`, crests `a` high, from a crest
 * behind the left edge to one past the right, so sliding the whole band one crest along loops.
 */
function Swell({ w, h, t, b, a, body, streak, foam, className, dur }: { w: number; h: number; t: number; b: number; a: number; body: string; streak: string | null; foam: string; className: string; dur: number }) {
  const n = Math.ceil(w / t) + 2;
  let d = `M${num(-t)} ${num(h)}L${num(-t)} ${num(b)}`;
  let cap = "";
  let lines = "";
  for (let i = 0; i < n; i++) {
    const at = box(-t + i * t, b, t, a);
    d += `C${at(0.3, 0)} ${at(0.45, 1)} ${at(0.63, 1)}C${at(0.75, 1)} ${at(0.8, 0.6)} ${at(0.76, 0.45)}C${at(0.8, 0.2)} ${at(0.9, 0)} ${at(1, 0)}`;
    cap +=
      shape(at, [0.38, 0.5], [
        [[0.46, 0.95], [0.55, 1.04], [0.63, 1.04]],
        [[0.76, 1.04], [0.83, 0.62], [0.77, 0.42]],
        [[0.74, 0.62], [0.66, 0.8], [0.58, 0.78]],
        [[0.5, 0.76], [0.44, 0.62], [0.38, 0.5]],
      ]) +
      claw(-t + i * t + 0.8 * t, b - 0.62 * a, a * 0.42, 50) +
      claw(-t + i * t + 0.78 * t, b - 0.44 * a, a * 0.32, 115);
    lines += shape(at, [0.08, -0.35], [[[0.22, -0.2], [0.34, 0.2], [0.46, 0.55]]], false);
  }
  d += `L${num(w + t * 2)} ${num(h)}Z`;
  const style: Vars = { "--ez-great-wave-tile": px(t), animationDuration: secs(dur) };
  return (
    <g className={className} style={style}>
      <path d={d} fill={body} />
      {streak && <path d={lines} fill="none" stroke={streak} strokeWidth={num(Math.max(1, a * 0.12))} style={{ strokeLinecap: "round" }} />}
      <path d={cap} fill={foam} />
    </g>
  );
}

/** Fuji far off in a trough: a dark cone with a flat top and a jagged cap of snow. */
function Fuji({ x, base, fw, fh }: { x: number; base: number; fw: number; fh: number }) {
  const at = box(x - fw / 2, base, fw, fh);
  const cone = shape(at, [0, 0], [
    [[0.22, 0.2], [0.36, 0.7], [0.44, 1]],
    [[0.48, 1.01], [0.53, 1.01], [0.56, 1]],
    [[0.64, 0.7], [0.78, 0.2], [1, 0]],
  ]);
  const snow = `M${at(0.44, 1)}L${at(0.56, 1)}L${at(0.63, 0.72)}L${at(0.58, 0.62)}L${at(0.55, 0.7)}L${at(0.5, 0.56)}L${at(0.46, 0.7)}L${at(0.42, 0.6)}L${at(0.37, 0.72)}Z`;
  return (
    <g>
      <path d={cone} fill={FUJI} />
      <path d={snow} fill={SPRAY} />
    </g>
  );
}

/** END ZONE carved in a vermilion seal, pressed a touch askew, as a print is signed. */
function Seal({ cx, cy, fs }: { cx: number; cy: number; fs: number }) {
  const width = fs * 4.5;
  const sw = width + fs * 1.1;
  const sh = fs * 1.5;
  const inset = sh * 0.13;
  const wob = (i: number): number => (rand(i, 70) - 0.5) * sh * 0.06;
  const [l, r, t, b] = [cx - sw / 2, cx + sw / 2, cy - sh / 2, cy + sh / 2];
  const edge = `M${num(l + wob(0))} ${num(t + wob(1))}L${num(r + wob(2))} ${num(t + wob(3))}L${num(r + wob(4))} ${num(b + wob(5))}L${num(l + wob(6))} ${num(b + wob(7))}Z`;
  return (
    <g className="ez-great-wave-seal">
      <g transform={`rotate(-2 ${num(cx)} ${num(cy)})`}>
        <path d={edge} fill={SEAL} stroke={SEAL} strokeWidth={num(sh * 0.06)} strokeLinejoin="round" />
        <rect x={num(l + inset)} y={num(t + inset)} width={num(sw - inset * 2)} height={num(sh - inset * 2)} fill="none" stroke={SEAL_INK} strokeWidth={num(Math.max(0.8, sh * 0.045))} strokeDasharray={`${num(sw * 0.7)} ${num(sh * 0.12)} ${num(sw)}`} />
        <text x={num(cx + fs * 0.06)} y={num(cy + (fs * CAP) / 2)} textAnchor="middle" fontFamily="var(--font-hand)" fontSize={num(fs)} letterSpacing={num(fs * 0.12)} fill={SEAL_INK}>
          END ZONE
        </text>
      </g>
    </g>
  );
}

/** Flecks of spray blown off the big wave's lip, drifting down like the snow they turn into in the print. */
function Flecks({ x0, bottom, bw, bh }: { x0: number; bottom: number; bw: number; bh: number }) {
  return (
    <g fill={SPRAY}>
      {Array.from({ length: 6 }, (_, i) => {
        const x = x0 + bw * (0.98 + rand(i, 80) * 0.5);
        const y = bottom - bh * (0.45 + rand(i, 81) * 0.5);
        return <path key={i} className="ez-great-wave-fleck" style={{ animationDelay: secs(-rand(i, 82) * 5) }} d={dot(x, y, Math.max(0.7, bh * (0.02 + rand(i, 83) * 0.015)))} />;
      })}
    </g>
  );
}

/** A touchdown's spray: droplets thrown up from the crests as the surge runs under them, left to right. */
function Spray({ w, crest, h, surge }: { w: number; crest: number; h: number; surge: number }) {
  const n = Math.max(10, Math.round(w / 26));
  return (
    <g fill={SPRAY}>
      {Array.from({ length: n }, (_, i) => {
        const x = (w * (i + 0.5 + (rand(i, 90) - 0.5) * 0.8)) / n;
        const style: Vars = {
          "--ez-great-wave-dx": px((rand(i, 91) * 0.8 + 0.2) * h * 0.5),
          "--ez-great-wave-dy": px(-h * (0.35 + rand(i, 92) * 0.35)),
          animationDelay: secs(0.15 + (x / w) * surge * 0.85),
        };
        return <path key={i} className="ez-great-wave-drop" style={style} d={dot(x, crest + rand(i, 93) * h * 0.15, Math.max(1, h * (0.025 + rand(i, 94) * 0.025)))} />;
      })}
    </g>
  );
}

/**
 * Great Wave: the end zone as Hokusai's print. A parchment sky over layered bands of Prussian
 * blue swell rolling in, a great wave rearing on the left with its crest breaking into claws of
 * foam, tiny snow-capped Fuji waiting in the trough beyond it, and END ZONE carved in a vermilion
 * seal. The swell rolls on and the foam breathes; a touchdown sends a huge wave surging through,
 * throwing spray off every crest, as the sea heaves and the seal bobs on it.
 */
export function GreatWaveArt({ w, h, label, celebrate }: ArtProps) {
  const id = useArtId("great-wave");
  const sliver = h < 22;
  const fs = Math.min(h * 0.46, 17 + (h - 44) * 0.18);
  const sealW = fs * 5.6;
  const bh = h * 0.97;
  const bw = Math.min(bh * 2.3, w * 0.36);
  const sealX = Math.max(w / 2, bw + h * 0.5 + sealW / 2);
  const sealY = h / 2 - Math.max(0, h - 44) * 0.3;
  const horizon = h * 0.55;
  const fujiX = bw + (sealX - sealW / 2 - bw) * 0.45;
  const surge = 2.6;
  if (sliver) {
    return (
      <g>
        <rect width={w} height={h} fill={PRUSSIAN} />
        <Swell w={w} h={h} t={h * 3} b={h * 0.95} a={h * 0.55} body={INDIGO} streak={null} foam={FOAM} className="ez-great-wave-roll" dur={14} />
      </g>
    );
  }
  return (
    <g className={celebrate ? "ez-great-wave-party" : undefined}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={SKY_TOP} />
          <stop offset="0.45" stopColor={SKY} />
          <stop offset="1" stopColor={SKY} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={SKY} style={{ fill: `url(#${id}-sky)` }} />
      <Fuji x={fujiX} base={horizon + h * 0.04} fw={h * 0.95} fh={h * 0.34} />
      <g className="ez-great-wave-heave">
        <Swell w={w} h={h} t={h * 1.5} b={horizon + h * 0.14} a={h * 0.16} body={BLUE} streak={null} foam={FOAM} className="ez-great-wave-roll" dur={30} />
      </g>
      <GreatWave x0={0} bottom={h} bw={bw} bh={bh} className="ez-great-wave-big" />
      <Flecks x0={0} bottom={h} bw={bw} bh={bh} />
      <g className="ez-great-wave-heave ez-great-wave-heave-near">
        <Swell w={w} h={h} t={h * 2.4} b={h * 0.94} a={h * 0.3} body={INDIGO} streak={BLUE} foam={FOAM} className="ez-great-wave-roll" dur={16} />
      </g>
      {celebrate && (
        <>
          <g className="ez-great-wave-surge" style={{ "--ez-great-wave-run": px(w + bw * 1.6), animationDuration: secs(surge) } as Vars}>
            <GreatWave x0={-bw * 1.3} bottom={h} bw={bw * 1.1} bh={bh} />
          </g>
          <Spray w={w} crest={h * 0.45} h={h} surge={surge} />
        </>
      )}
      {label && <Seal cx={sealX} cy={sealY} fs={fs} />}
    </g>
  );
}

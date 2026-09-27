import type { CSSProperties } from "react";
import { useArtId, type ArtProps } from "./shared";

const INDIGO = "#1f3a60";
const PRUSSIAN = "#2b4d7e";
const BLUE = "#3f6fb5";
/** the cream of the foam, the snow, the spray and the seal's carving */
const FOAM = "#fbf6ea";
const SKY_TOP = "#cbb88c";
const SKY = "#e0d0a8";
const FUJI = "#3a5680";
const SEAL = "#b3321f";
/** Patrick Hand's capitals stand this much of an em above the baseline */
const CAP = 0.68;
/** below this depth there is no room for sky, the big wave or Fuji: the band is all sea */
const SLIVER = 22;

type Vars = CSSProperties & { [key: `--ez-great-wave-${string}`]: string };
type Pt = readonly [u: number, v: number];
type Curve = readonly [Pt, Pt, Pt];
/** An outline drawn in a shape's box: a start and the curves on from it, as fractions across and up. */
interface Outline {
  start: Pt;
  curves: readonly Curve[];
}
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

const shape = (at: At, { start, curves }: Outline, close = true): string =>
  `M${at(...start)}` + curves.map(([a, b, c]) => `C${at(...a)} ${at(...b)} ${at(...c)}`).join("") + (close ? "Z" : "");

/**
 * A talon of foam: a finger `len` long reaching out from (x, y) at `deg` (clockwise from east)
 * and hooking round clockwise at its tip, as the Great Wave's crest breaks into claws. `girth`
 * is its half-width at the root, as a fraction of its length.
 */
function claw(x: number, y: number, len: number, deg: number, girth = 0.3): string {
  const a = (deg * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  const at = (u: number, v: number): string => `${num(x + u * c - v * s)} ${num(y + u * s + v * c)}`;
  const hw = len * girth;
  return `M${at(0, -hw)}C${at(len * 0.55, -hw * 1.2)} ${at(len * 1.08, -hw * 0.2)} ${at(len * 0.9, len * 0.42)}C${at(len * 0.72, hw * 0.25)} ${at(len * 0.42, hw)} ${at(0, hw)}Z`;
}

const dot = (x: number, y: number, r: number): string =>
  `M${num(x - r)} ${num(y)}a${num(r)} ${num(r)} 0 1 0 ${num(r * 2)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-r * 2)} 0Z`;

/**
 * Cream foam with the print's indigo keyline. The keyline is the same outline stroked wide
 * beneath the fill, so where the cap and its claws overlap only the outer edge is inked.
 */
function Inked({ d, line }: { d: string; line: number }) {
  return (
    <>
      <path d={d} fill={INDIGO} stroke={INDIGO} strokeWidth={num(line * 2)} strokeLinejoin="round" />
      <path d={d} fill={FOAM} />
    </>
  );
}

/** The big wave's outline, rising from its foot on the left, curling over and falling away down its face. */
const WAVE: Outline = {
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
const CAP_FOAM: Outline = {
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
const STREAKS: readonly Outline[] = [
  { start: [0.06, 0.1], curves: [[[0.16, 0.26], [0.24, 0.56], [0.38, 0.74]]] },
  { start: [0.18, 0.06], curves: [[[0.28, 0.2], [0.34, 0.46], [0.47, 0.64]]] },
  { start: [0.32, 0.05], curves: [[[0.4, 0.16], [0.45, 0.36], [0.55, 0.52]]] },
];

/** Where the talons reach from round the lip, fanning forward and down: across, up, angle. */
const TALONS: readonly (readonly [number, number, number])[] = [
  [0.82, 0.96, -15],
  [0.92, 0.86, 20],
  [0.965, 0.7, 55],
  [0.95, 0.55, 95],
];

/** The Great Wave itself, `bw` wide and `bh` tall, standing on the band's floor at x0. */
function GreatWave({ x0, bottom, bw, bh, className }: { x0: number; bottom: number; bw: number; bh: number; className?: string }) {
  const at = box(x0, bottom, bw, bh);
  const point = (u: number, v: number): readonly [number, number] => [x0 + u * bw, bottom - v * bh];
  const foam = shape(at, CAP_FOAM) + TALONS.map(([u, v, deg], i) => claw(...point(u, v), bh * (0.28 + rand(i, 3) * 0.05), deg, 0.2)).join("");
  return (
    <g className={className}>
      <path d={shape(at, WAVE)} fill={INDIGO} />
      <g fill="none" stroke={BLUE} strokeWidth={num(Math.max(1.2, bh * 0.045))} style={{ strokeLinecap: "round" }}>
        {STREAKS.map((s, i) => (
          <path key={i} d={shape(at, s, false)} />
        ))}
      </g>
      <Inked d={foam} line={Math.max(0.9, bh * 0.03)} />
    </g>
  );
}

/**
 * A band of rolling waves: crests `t` apart, troughs on y = `b`, crests `a` high, from a crest
 * behind the left edge to one past the right, so sliding the whole band one crest along loops.
 * Its body runs on below the band, so a touchdown's heave never lifts its foot into view.
 */
function Swell({ w, h, t, b, a, body, streak, dur }: { w: number; h: number; t: number; b: number; a: number; body: string; streak: string | null; dur: number }) {
  const floor = h + a + 4;
  const crests = Array.from({ length: Math.ceil(w / t) + 2 }, (_, i) => -t + i * t);
  const waves = crests
    .map((x) => {
      const at = box(x, b, t, a);
      return `C${at(0.3, 0)} ${at(0.45, 1)} ${at(0.63, 1)}C${at(0.75, 1)} ${at(0.8, 0.6)} ${at(0.76, 0.45)}C${at(0.8, 0.2)} ${at(0.9, 0)} ${at(1, 0)}`;
    })
    .join("");
  const caps = crests
    .map(
      (x) =>
        shape(box(x, b, t, a), {
          start: [0.38, 0.5],
          curves: [
            [[0.46, 0.95], [0.55, 1.04], [0.63, 1.04]],
            [[0.76, 1.04], [0.83, 0.62], [0.77, 0.42]],
            [[0.74, 0.62], [0.66, 0.8], [0.58, 0.78]],
            [[0.5, 0.76], [0.44, 0.62], [0.38, 0.5]],
          ],
        }) +
        claw(x + 0.8 * t, b - 0.62 * a, a * 0.42, 50) +
        claw(x + 0.78 * t, b - 0.44 * a, a * 0.32, 115),
    )
    .join("");
  const style: Vars = { "--ez-great-wave-tile": px(t), animationDuration: secs(dur) };
  return (
    <g className="ez-great-wave-roll" style={style}>
      <path d={`M${num(-t)} ${num(floor)}L${num(-t)} ${num(b)}${waves}L${num(w + t * 2)} ${num(floor)}Z`} fill={body} />
      {streak && (
        <path
          d={crests.map((x) => shape(box(x, b, t, a), { start: [0.08, -0.35], curves: [[[0.22, -0.2], [0.34, 0.2], [0.46, 0.55]]] }, false)).join("")}
          fill="none"
          stroke={streak}
          strokeWidth={num(Math.max(1, a * 0.12))}
          style={{ strokeLinecap: "round" }}
        />
      )}
      <Inked d={caps} line={Math.max(0.5, a * 0.06)} />
    </g>
  );
}

/** Fuji far off in a trough: a dark cone with a flat top and a jagged cap of snow. */
function Fuji({ x, base, fw, fh }: { x: number; base: number; fw: number; fh: number }) {
  const at = box(x - fw / 2, base, fw, fh);
  const cone = shape(at, {
    start: [0, 0],
    curves: [
      [[0.22, 0.2], [0.36, 0.7], [0.44, 1]],
      [[0.48, 1.01], [0.53, 1.01], [0.56, 1]],
      [[0.64, 0.7], [0.78, 0.2], [1, 0]],
    ],
  });
  const snow = `M${at(0.44, 1)}L${at(0.56, 1)}L${at(0.63, 0.72)}L${at(0.58, 0.62)}L${at(0.55, 0.7)}L${at(0.5, 0.56)}L${at(0.46, 0.7)}L${at(0.42, 0.6)}L${at(0.37, 0.72)}Z`;
  return (
    <g>
      <path d={cone} fill={FUJI} />
      <path d={snow} fill={FOAM} />
    </g>
  );
}

/** END ZONE carved in a vermilion seal `sw` wide, pressed a touch askew, as a print is signed. */
function Seal({ cx, cy, fs, sw }: { cx: number; cy: number; fs: number; sw: number }) {
  const sh = fs * 1.5;
  const inset = sh * 0.13;
  const wob = (i: number): number => (rand(i, 70) - 0.5) * sh * 0.06;
  const [l, r, t, b] = [cx - sw / 2, cx + sw / 2, cy - sh / 2, cy + sh / 2];
  const edge = `M${num(l + wob(0))} ${num(t + wob(1))}L${num(r + wob(2))} ${num(t + wob(3))}L${num(r + wob(4))} ${num(b + wob(5))}L${num(l + wob(6))} ${num(b + wob(7))}Z`;
  const [rw, rh] = [sw - inset * 2, sh - inset * 2];
  // the carved frame, whole but for two nicks: one near the top's right end, one near the bottom's left
  const nick = sh * 0.12;
  const [topNick, bottomNick] = [rw * 0.8, rw + rh + rw * 0.76];
  const chipped = [topNick, nick, bottomNick - topNick - nick, nick * 0.8, (rw + rh) * 2].map(num).join(" ");
  return (
    <g className="ez-great-wave-seal">
      <g transform={`rotate(-2 ${num(cx)} ${num(cy)})`}>
        <path d={edge} fill={SEAL} stroke={SEAL} strokeWidth={num(sh * 0.06)} strokeLinejoin="round" />
        <rect x={num(l + inset)} y={num(t + inset)} width={num(rw)} height={num(rh)} fill="none" stroke={FOAM} strokeWidth={num(Math.max(0.8, sh * 0.045))} strokeDasharray={chipped} />
        <text x={num(cx + fs * 0.06)} y={num(cy + (fs * CAP) / 2)} textAnchor="middle" fontFamily="var(--font-hand)" fontSize={num(fs)} letterSpacing={num(fs * 0.12)} fill={FOAM}>
          END ZONE
        </text>
      </g>
    </g>
  );
}

/** Flecks of spray blown off the big wave's lip, drifting down like the snow they turn into in the print; kept above Fuji's peak. */
function Flecks({ bw, h }: { bw: number; h: number }) {
  return (
    <g fill={FOAM}>
      {Array.from({ length: 6 }, (_, i) => {
        const x = bw * (1 + rand(i, 80) * 0.35);
        const y = h * (0.06 + rand(i, 81) * 0.16);
        return <path key={i} className="ez-great-wave-fleck" style={{ animationDelay: secs(-rand(i, 82) * 5) }} d={dot(x, y, Math.max(0.8, h * (0.02 + rand(i, 83) * 0.015)))} />;
      })}
    </g>
  );
}

/**
 * A touchdown's spray: splashes of foam flung up off the near swell's crests, fingers hooking over
 * like the big wave's claws and drops thrown off them, each as the surging wave's lip reaches it.
 * The lip starts at x = `lip` and runs `run` along at an even pace, so each splash waits its
 * fraction of that run (the CSS multiplies it by the surge's duration).
 */
function Spray({ w, h, lip, run }: { w: number; h: number; lip: number; run: number }) {
  const n = Math.max(8, Math.round(w / 50));
  const y = h * 0.64;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const x = (w * (i + 0.5 + (rand(i, 90) - 0.5) * 0.6)) / n;
        const len = h * (0.3 + rand(i, 91) * 0.1);
        const tilt = (rand(i, 92) - 0.5) * 20;
        const style: Vars = {
          "--ez-great-wave-dx": px(h * (0.1 + rand(i, 93) * 0.25)),
          "--ez-great-wave-dy": px(-h * (0.2 + rand(i, 94) * 0.2)),
          "--ez-great-wave-at": num(Math.max(0, (x - lip) / run)),
        };
        const splash =
          [-125, -88, -52].map((deg, k) => claw(x + (k - 1) * len * 0.22, y, len * (k === 1 ? 1 : 0.72), deg + tilt, 0.24)).join("") +
          dot(x + len * 0.55, y - len * 1.05, h * 0.045) +
          dot(x - len * 0.15, y - len * 1.3, h * 0.035);
        return (
          <g key={i} className="ez-great-wave-spray" style={style}>
            <Inked d={splash} line={Math.max(0.6, h * 0.018)} />
          </g>
        );
      })}
    </>
  );
}

/**
 * Great Wave: the end zone as Hokusai's print. A parchment sky over layered bands of Prussian
 * blue swell rolling in, a great wave rearing on the left with its crest breaking into claws of
 * foam, tiny snow-capped Fuji waiting in the trough beyond it, and END ZONE carved in a vermilion
 * seal. The swell rolls on and the big wave breathes; a touchdown sends a huge wave surging
 * through, flinging spray off every crest, as the sea heaves, the big wave rears and the seal rocks.
 */
export function GreatWaveArt({ w, h, label, celebrate }: ArtProps) {
  const id = useArtId("great-wave");
  const party = celebrate ? "ez-great-wave-party" : undefined;
  if (h < SLIVER) {
    return (
      <g className={party}>
        <rect width={w} height={h} fill={PRUSSIAN} />
        <g className="ez-great-wave-heave">
          <Swell w={w} h={h} t={h * 3} b={h * 0.95} a={h * 0.55} body={INDIGO} streak={null} dur={14} />
        </g>
      </g>
    );
  }
  const fs = Math.min(h * 0.46, 17 + (h - 44) * 0.18);
  const sealW = fs * 5.6;
  const bh = h * 0.92;
  const bw = Math.min(bh * 2.3, w * 0.32);
  const fw = h * 0.66;
  // mid-band, unless that leaves the wave and Fuji too little room (the swatch): then at the right end
  const sealX = Math.min(Math.max(w / 2, bw + fw + h * 0.4 + sealW / 2), w - sealW / 2 - h * 0.08);
  const sealY = h / 2 - Math.max(0, h - 44) * 0.3;
  const sealLeft = sealX - sealW / 2;
  const horizon = h * 0.55;
  // in the trough between the wave and the seal, its left foot under the lip where the band is narrow
  const fujiX = Math.min(bw + (sealLeft - bw) * 0.45, sealLeft - fw / 2 - h * 0.1);
  // the surge, a bigger wave than the one at rest, runs in from off the left edge until it is off the right
  const surgeX = -bw * 1.3;
  const surgeW = bw * 1.1;
  const run = w + bw * 1.6;
  const surgeStyle: Vars = { "--ez-great-wave-run": px(run) };
  return (
    <g className={party}>
      <defs>
        <linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={SKY_TOP} />
          <stop offset="0.45" stopColor={SKY} />
          <stop offset="1" stopColor={SKY} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={SKY} style={{ fill: `url(#${id}-sky)` }} />
      <Fuji x={fujiX} base={horizon + h * 0.04} fw={fw} fh={h * 0.3} />
      <g className="ez-great-wave-heave">
        <Swell w={w} h={h} t={h * 1.5} b={horizon + h * 0.14} a={h * 0.16} body={BLUE} streak={null} dur={30} />
      </g>
      <g className="ez-great-wave-rear">
        <GreatWave x0={0} bottom={h} bw={bw} bh={bh} className="ez-great-wave-big" />
      </g>
      <Flecks bw={bw} h={h} />
      <g className="ez-great-wave-heave ez-great-wave-heave-near">
        <Swell w={w} h={h} t={h * 2.4} b={h * 0.94} a={h * 0.3} body={INDIGO} streak={BLUE} dur={16} />
      </g>
      {celebrate && (
        <>
          <g className="ez-great-wave-surge" style={surgeStyle}>
            <GreatWave x0={surgeX} bottom={h} bw={surgeW} bh={h} />
          </g>
          <Spray w={w} h={h} lip={surgeX + surgeW * 0.95} run={run} />
        </>
      )}
      {label && <Seal cx={sealX} cy={sealY} fs={fs} sw={sealW} />}
    </g>
  );
}

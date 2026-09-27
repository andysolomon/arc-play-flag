import type { CSSProperties } from "react";
import { useArtId, type ArtProps } from "./shared";

const INDIGO = "#1f3a60";
const BLUE = "#3f6fb5";
/** the flat distant sea, paler with the haze of distance */
const HAZE = "#7d9ccb";
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
/** Maps a point given across and up as fractions of a shape's box to SVG path coordinates. */
type At = (u: number, v: number) => string;
/** A shape's box: `bw` across and `bh` high, standing on (x0, bottom). */
interface Box {
  x0: number;
  bottom: number;
  bw: number;
  bh: number;
}
/** A talon of foam reaching from (u, v) in its wave's box, `len` long as a fraction of the box's height, at `deg` clockwise from east. */
type Talon = readonly [u: number, v: number, len: number, deg: number];

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

/** The point (u, v) in a box, given as fractions across and up from its foot. */
const spot = ({ x0, bottom, bw, bh }: Box, u: number, v: number): readonly [x: number, y: number] => [x0 + u * bw, bottom - v * bh];
const box =
  (b: Box): At =>
  (u, v) =>
    spot(b, u, v).map(num).join(" ");

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

/** The talons round a crest standing in box `b`. */
const claws = (talons: readonly Talon[], b: Box, girth?: number): string =>
  talons.map(([u, v, len, deg]) => claw(...spot(b, u, v), len * b.bh, deg, girth)).join("");

const dot = (x: number, y: number, r: number): string =>
  `M${num(x - r)} ${num(y)}a${num(r)} ${num(r)} 0 1 0 ${num(r * 2)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-r * 2)} 0Z`;

/** A four-pointed glint of spray or snow, its sides pinched in towards (x, y). */
function glint(x: number, y: number, r: number): string {
  const p = (dx: number, dy: number): string => `${num(x + dx)} ${num(y + dy)}`;
  const c = p(0, 0);
  return `M${p(0, -r)}Q${c} ${p(r, 0)}Q${c} ${p(0, r)}Q${c} ${p(-r, 0)}Q${c} ${p(0, -r)}Z`;
}

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

/** The talons round the big wave's lip, fanning forward and down. */
const TALONS: readonly [Talon, Talon, Talon, Talon] = [
  [0.82, 0.96, 0.29, -15],
  [0.92, 0.86, 0.31, 20],
  [0.965, 0.7, 0.3, 55],
  [0.95, 0.55, 0.32, 95],
];

/** The surge breaks into one more talon, hanging back under its lip, so it is not the resting wave over again. */
const SURGE_TALONS: readonly Talon[] = [...TALONS, [0.88, 0.5, 0.26, 140]];

/** The foam cap along a swell crest, from its back round to its front, in the crest's box. */
const SWELL_CAP: Outline = {
  start: [0.38, 0.5],
  curves: [
    [[0.46, 0.95], [0.55, 1.04], [0.63, 1.04]],
    [[0.76, 1.04], [0.83, 0.62], [0.77, 0.42]],
    [[0.74, 0.62], [0.66, 0.8], [0.58, 0.78]],
    [[0.5, 0.76], [0.44, 0.62], [0.38, 0.5]],
  ],
};

/** A lighter current running up a swell crest's back from the trough before it. */
const SWELL_STREAK: Outline = { start: [0.08, -0.35], curves: [[[0.22, -0.2], [0.34, 0.2], [0.46, 0.55]]] };

/** One crest of a swell: its width and height as fractions of the swell's mean crest, and its talons. */
interface Crest {
  span: number;
  rise: number;
  talons: readonly Talon[];
}
/**
 * A swell's crests come in pairs, a broad tall one breaking into three claws and then a
 * narrower, lower one with one, so the band does not repeat crest for crest.
 */
const BROAD: Crest = {
  span: 1.14,
  rise: 1,
  talons: [
    [0.8, 0.62, 0.42, 50],
    [0.78, 0.44, 0.32, 115],
    [0.7, 0.96, 0.3, 15],
  ],
};
const NARROW: Crest = { span: 2 - BROAD.span, rise: 0.72, talons: [[0.79, 0.52, 0.46, 75]] };

/** The Great Wave itself, standing in box `b`. */
function GreatWave({ b, talons, className }: { b: Box; talons: readonly Talon[]; className?: string }) {
  const at = box(b);
  return (
    <g className={className}>
      <path d={shape(at, WAVE)} fill={INDIGO} />
      <g fill="none" stroke={BLUE} strokeWidth={num(Math.max(1.2, b.bh * 0.045))} style={{ strokeLinecap: "round" }}>
        {STREAKS.map((s, i) => (
          <path key={i} d={shape(at, s, false)} />
        ))}
      </g>
      <Inked d={shape(at, CAP_FOAM) + claws(talons, b, 0.2)} line={Math.max(0.9, b.bh * 0.03)} />
    </g>
  );
}

interface SwellProps {
  w: number;
  h: number;
  /** the mean distance from one crest to the next */
  pitch: number;
  /** the y of the troughs */
  trough: number;
  /** how high the broad crests rise above the troughs */
  rise: number;
  body: string;
  /** the colour of the currents up each crest's back, if it has them */
  streak: string | null;
  /** seconds to roll one pair of crests along */
  dur: number;
}

/**
 * A band of rolling waves, from a pair of crests behind the left edge to one past the right,
 * so sliding the whole band one pair along loops. Its body runs on below the band, so a
 * touchdown's heave never lifts its foot into view.
 */
function Swell({ w, h, pitch, trough, rise, body, streak, dur }: SwellProps) {
  const floor = h + rise + 4;
  const crests: (Box & { talons: readonly Talon[] })[] = [];
  let end = -pitch * 2;
  while (end < w) {
    const crest = crests.length % 2 === 0 ? BROAD : NARROW;
    crests.push({ x0: end, bottom: trough, bw: pitch * crest.span, bh: rise * crest.rise, talons: crest.talons });
    end += pitch * crest.span;
  }
  const waves = crests
    .map((c) => {
      const at = box(c);
      return `C${at(0.3, 0)} ${at(0.45, 1)} ${at(0.63, 1)}C${at(0.75, 1)} ${at(0.8, 0.6)} ${at(0.76, 0.45)}C${at(0.8, 0.2)} ${at(0.9, 0)} ${at(1, 0)}`;
    })
    .join("");
  const style: Vars = { "--ez-great-wave-tile": px(pitch * 2), animationDuration: secs(dur) };
  return (
    <g className="ez-great-wave-roll" style={style}>
      <path d={`M${num(-pitch * 2)} ${num(floor)}L${num(-pitch * 2)} ${num(trough)}${waves}L${num(end)} ${num(floor)}Z`} fill={body} />
      {streak && (
        <path
          d={crests.map((c) => shape(box(c), SWELL_STREAK, false)).join("")}
          fill="none"
          stroke={streak}
          strokeWidth={num(Math.max(1, rise * 0.12))}
          style={{ strokeLinecap: "round" }}
        />
      )}
      <Inked d={crests.map((c) => shape(box(c), SWELL_CAP) + claws(c.talons, c)).join("")} line={Math.max(0.5, rise * 0.06)} />
    </g>
  );
}

/** Fuji far off on the horizon: a dark cone with a flat top and a jagged cap of snow. */
function Fuji({ x, base, fw, fh }: { x: number; base: number; fw: number; fh: number }) {
  const at = box({ x0: x - fw / 2, bottom: base, bw: fw, bh: fh });
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
  const spacing = fs * 0.12;
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
        {/* letter-spacing trails the last glyph too, which pushes middle-anchored text left by half of it */}
        <text x={num(cx + spacing / 2)} y={num(cy + (fs * CAP) / 2)} textAnchor="middle" fontFamily="var(--font-hand)" fontSize={num(fs)} letterSpacing={num(spacing)} fill={FOAM}>
          END ZONE
        </text>
      </g>
    </g>
  );
}

type Xy = readonly [x: number, y: number];
/** Where a talon reaches from, where its hooked tip ends, its length and its heading in radians. */
interface Reach {
  root: Xy;
  tip: Xy;
  l: number;
  a: number;
}

/** How a talon of the wave standing in box `b` reaches. */
function reach([u, v, len, deg]: Talon, b: Box): Reach {
  const root = spot(b, u, v);
  const [l, a] = [len * b.bh, (deg * Math.PI) / 180];
  return { root, tip: [root[0] + l * (0.9 * Math.cos(a) - 0.42 * Math.sin(a)), root[1] + l * (0.9 * Math.sin(a) + 0.42 * Math.cos(a))], l, a };
}

/**
 * Spray flung on ahead of the big wave's two upper talons, round drops and four-pointed glints
 * falling as the snow they turn into in the print. It falls short of Fuji, since over the summit
 * it reads as smoke: in the swatch, where Fuji stands right under the lip, none is left.
 */
function Flecks({ wave, fujiX, fw }: { wave: Box; fujiX: number; fw: number }) {
  const r = Math.max(0.9, wave.bh * 0.03);
  const flung = ({ tip, l, a }: Reach, k: number, i: number): Xy => {
    const d = l * (1 + k * 0.75 + rand(i, 80) * 0.3);
    const heading = a + ((k * 13 - 8 + (rand(i, 81) - 0.5) * 10) * Math.PI) / 180;
    return [tip[0] + d * Math.cos(heading), tip[1] + d * Math.sin(heading)];
  };
  const [top, upper] = [reach(TALONS[0], wave), reach(TALONS[1], wave)];
  const flecks = [0, 1, 2, 3].map((k) => flung(top, k, k)).concat([0, 1].map((k) => flung(upper, k, k + 4)));
  const clear = ([x, y]: Xy): boolean => y > r * 1.5 && x < fujiX - fw * 0.35 - r;
  return (
    <g fill={FOAM}>
      {flecks.map(
        ([x, y], i) =>
          clear([x, y]) && (
            <path
              key={i}
              className="ez-great-wave-fleck"
              style={{ animationDelay: secs(-rand(i, 82) * 5) }}
              d={i % 2 === 1 ? glint(x, y, r * 1.9) : dot(x, y, r * (0.8 + rand(i, 83) * 0.4))}
            />
          ),
      )}
    </g>
  );
}

/**
 * A touchdown's spray: splashes of foam flung up off the near swell's crests beyond the big
 * wave, fingers hooking over like the big wave's claws and drops thrown off them, each as the
 * surging wave's lip reaches it. The lip starts at x = `lip` and runs `run` along at an even
 * pace, so each splash waits its fraction of that run (the CSS multiplies it by the surge's duration).
 */
function Spray({ w, h, from, lip, run }: { w: number; h: number; from: number; lip: number; run: number }) {
  const n = Math.max(8, Math.round((w - from) / 50));
  const y = h * 0.64;
  return (
    <>
      {Array.from({ length: n }, (_, i) => {
        const x = from + ((w - from) * (i + 0.5 + (rand(i, 90) - 0.5) * 0.6)) / n;
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
 * Great Wave: the end zone as Hokusai's print. A parchment sky over a flat distant sea and
 * layered bands of Prussian blue swell rolling in, a great wave rearing on the left with its
 * crest breaking into claws of foam, tiny snow-capped Fuji on the horizon beyond it, and END ZONE
 * carved in a vermilion seal. The swell rolls on and the big wave breathes; a touchdown sends a
 * broader wave surging through, flinging spray off every crest, as the sea heaves, the big wave
 * lunges and the seal rocks.
 */
export function GreatWaveArt({ w, h, label, celebrate }: ArtProps) {
  const id = useArtId("great-wave");
  const party = celebrate ? "ez-great-wave-party" : undefined;
  if (h < SLIVER) {
    return (
      <g className={party}>
        <rect width={w} height={h} fill={BLUE} />
        <g className="ez-great-wave-heave">
          <Swell w={w} h={h} pitch={h * 3} trough={h * 0.95} rise={h * 0.55} body={INDIGO} streak={null} dur={28} />
        </g>
      </g>
    );
  }
  const fs = Math.min(h * 0.46, 17 + (h - 44) * 0.18);
  const sealW = fs * 5.6;
  const bh = h * 0.92;
  const bw = Math.min(bh * 2.3, w * 0.32);
  const wave: Box = { x0: 0, bottom: h, bw, bh };
  const fw = h * 0.66;
  const fh = h * 0.3;
  // mid-band, unless that leaves the wave and Fuji too little room (the swatch): then at the right end
  const sealX = Math.min(Math.max(w / 2, bw + fw + h * 0.4 + sealW / 2), w - sealW / 2 - h * 0.08);
  // lifted in a band deeper than the field's (the swatch), so the seal sits in the sky above the swell
  const sealY = h / 2 - Math.max(0, h - 44) * 0.3;
  const sealLeft = sealX - sealW / 2;
  // the flat distant sea, low as in the print, that Fuji stands on and the far swell rolls across
  const horizon = h * 0.59;
  // on the horizon between the wave and the seal, its left foot under the lip where the band is narrow
  const fujiX = Math.min(bw + (sealLeft - bw) * 0.45, sealLeft - fw / 2 - h * 0.1);
  // the surge, broader than the wave at rest, runs in from off the left edge until it is off the right
  const surgeW = bw * 1.6;
  const surgeX = -surgeW * 1.12;
  const run = w - surgeX + surgeW * 0.06;
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
      <rect y={num(horizon)} width={w} height={num(h - horizon)} fill={HAZE} />
      <Fuji x={fujiX} base={horizon} fw={fw} fh={fh} />
      <g className="ez-great-wave-heave">
        <Swell w={w} h={h} pitch={h * 1.5} trough={horizon + h * 0.1} rise={h * 0.16} body={BLUE} streak={null} dur={60} />
      </g>
      <g className="ez-great-wave-rear">
        <GreatWave b={wave} talons={TALONS} className="ez-great-wave-big" />
      </g>
      <Flecks wave={wave} fujiX={fujiX} fw={fw} />
      <g className="ez-great-wave-heave ez-great-wave-heave-near">
        <Swell w={w} h={h} pitch={h * 2.4} trough={h * 0.94} rise={h * 0.3} body={INDIGO} streak={BLUE} dur={32} />
      </g>
      {celebrate && (
        <>
          <g className="ez-great-wave-surge" style={surgeStyle}>
            <GreatWave b={{ x0: surgeX, bottom: h, bw: surgeW, bh: h * 0.93 }} talons={SURGE_TALONS} />
          </g>
          <Spray w={w} h={h} from={bw} lip={surgeX + surgeW * 0.95} run={run} />
        </>
      )}
      {label && <Seal cx={sealX} cy={sealY} fs={fs} sw={sealW} />}
    </g>
  );
}

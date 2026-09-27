import type { CSSProperties } from "react";
import { num, rand, sparkle, useArtId, type ArtProps } from "./shared";

/** The SynthWave '84 palette the celebration's confetti uses (lib/endzone.ts). */
const PINK = "#ff2a6d";
const ORANGE = "#ff8b39";
const YELLOW = "#fede5d";
const CYAN = "#36f9f6";
/** the deepest night: the top of the sky and the lettering's outline */
const NIGHT = "#1a0b2e";
const SILHOUETTE = "#12061f";
/** the chrome lettering, top to bottom; every band reads on NIGHT at 9:1 or better */
const CHROME = ["#ffffff", "#8ff4ff", "#f2fdff", "#ff9bd8", "#ffd27a"] as const;
/** Patrick Hand's capitals stand this much of an em above the baseline */
const CAP = 0.68;
/** the lettering's italic lean, as run over rise */
const SLANT = 0.21;

/**
 * The ratio between one grid line's distance from the horizon and the next nearer one's, and the
 * same for the sun's slits from the top of their zone. Scaling either set by it about that edge
 * carries every line onto the next, so ez-synthwave-zoom, which scales by exactly this, loops
 * without a seam.
 */
const STEP = 1.7;

/** Distances from an edge, `STEP` apart geometrically, from `near` in towards the edge until they are too fine to see. */
function recede(near: number, finest: number): number[] {
  const out: number[] = [];
  for (let d = near; d >= finest; d /= STEP) out.push(d);
  return out;
}

/** Horizontal bands as one path: each [top, bottom] across x0..x1. */
const bands = (x0: number, x1: number, spans: readonly (readonly [number, number])[]): string =>
  spans.map(([a, b]) => `M${num(x0)} ${num(a)}H${num(x1)}V${num(b)}H${num(x0)}Z`).join("");

/** Transforms about a point in the design's own coordinates (the CSS sets transform-box: view-box). */
const about = (x: number, y: number): CSSProperties => ({ transformOrigin: `${num(x)}px ${num(y)}px` });

const delay = (s: number): CSSProperties => ({ animationDelay: `${num(s)}s` });

/** The neon floor: rails converging on the vanishing point, and rungs rolling in towards the goal line. */
function Grid({ w, h, cx, horizon, celebrate }: { w: number; h: number; cx: number; horizon: number; celebrate: boolean }) {
  const depth = h - horizon;
  const pitch = Math.max(30, Math.min(48, w / 14));
  const reach = Math.ceil((w * 1.1) / pitch);
  // half a pitch off the middle, so no rail stands under the sun like a stick
  const rails = Array.from({ length: reach * 2 }, (_, i) => cx + (i - reach + 0.5) * pitch);
  // each rail a thin wedge from the vanishing point, so it narrows into the distance
  const wedges = (half: number): string =>
    rails.map((x) => `M${num(cx)} ${num(horizon)}L${num(x - half)} ${num(h + 1)}H${num(x + half)}Z`).join("");
  const rail = Math.max(0.75, depth * 0.07);
  // a rung is as thick as it is near, so the set is self-similar under the zoom; the finest are
  // left out, hairlines under the haze that only render as seams
  const rungs = recede(depth * 0.93, 1);
  const rungSpans = (thick: number) => rungs.map((d) => [horizon + d * (1 - 0.055 * thick), horizon + d * (1 + 0.055 * thick)] as const);
  return (
    <g>
      <path d={wedges(rail * 2.8)} fill={CYAN} opacity={0.16} />
      <path d={wedges(rail)} fill={CYAN} opacity={0.8} />
      {celebrate && <path className="ez-synthwave-ignite" d={wedges(rail)} fill={PINK} opacity={0} />}
      <g className="ez-synthwave-grid" style={about(cx, horizon)}>
        <path d={bands(0, w, rungSpans(3.2))} fill={PINK} opacity={0.22} />
        <path d={bands(0, w, rungSpans(1))} fill={PINK} />
        {celebrate && <path className="ez-synthwave-ignite" d={bands(0, w, rungSpans(1))} fill={CYAN} opacity={0} />}
      </g>
    </g>
  );
}

/** A half sun on the horizon, cut by the slits of a retro sunset, which run down and widen as they go during a touchdown. */
function Sun({ id, cx, horizon, r }: { id: string; cx: number; horizon: number; r: number }) {
  const zone = r * 0.6;
  const top = horizon - zone;
  const slits = recede(zone * STEP, 0.6).map((d) => [top + d * 0.6, top + d * 0.8] as const);
  const box = { x: num(cx - r * 1.5), y: num(horizon - r * 1.5), width: num(r * 3), height: num(r * 1.5) };
  return (
    <g>
      <defs>
        <linearGradient id={`${id}-sun`} gradientUnits="userSpaceOnUse" x1="0" y1={num(horizon - r)} x2="0" y2={num(horizon)}>
          <stop offset="0" stopColor={YELLOW} />
          <stop offset="0.5" stopColor={ORANGE} />
          <stop offset="1" stopColor={PINK} />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0.5" stopColor={PINK} stopOpacity={0.6} />
          <stop offset="1" stopColor={PINK} stopOpacity={0} />
        </radialGradient>
        <mask id={`${id}-slits`} maskUnits="userSpaceOnUse" {...box}>
          <rect {...box} fill="#fff" />
          <g className="ez-synthwave-slits" style={about(cx, top)}>
            <path d={bands(cx - r * 1.5, cx + r * 1.5, slits)} fill="#000" />
          </g>
        </mask>
      </defs>
      <circle className="ez-synthwave-halo" cx={num(cx)} cy={num(horizon)} r={num(r * 1.5)} style={{ fill: `url(#${id}-halo)` }} />
      <g className="ez-synthwave-sun">
        <g mask={`url(#${id}-slits)`}>
          <path d={`M${num(cx - r)} ${num(horizon)}A${num(r)} ${num(r)} 0 0 1 ${num(cx + r)} ${num(horizon)}Z`} fill={ORANGE} style={{ fill: `url(#${id}-sun)` }} />
        </g>
      </g>
    </g>
  );
}

function Star({ x, y, r, i }: { x: number; y: number; r: number; i: number }) {
  return <path className="ez-synthwave-star" d={sparkle(x, y, r, 0.26)} fill="#fff1fa" style={{ ...delay(-rand(i, 3) * 4), animationDuration: `${num(2.8 + rand(i, 4) * 2.4)}s` }} />;
}

/** A range of dark peaks along the horizon from x0 to x1, its ridge traced in neon. */
function Mountains({ x0, x1, horizon, tall, i }: { x0: number; x1: number; horizon: number; tall: number; i: number }) {
  const n = Math.max(2, Math.round((x1 - x0) / (tall * 6)));
  const ridge = Array.from({ length: n * 2 + 1 }, (_, k) => {
    const x = x0 + ((x1 - x0) * (k + (k % 2 ? rand(i * 16 + k, 11) - 0.5 : 0) * 0.8)) / (n * 2);
    // peaks on the odd points, saddles on the even ones, the ends down on the horizon
    const y = k === 0 || k === n * 2 ? horizon : horizon - tall * (k % 2 ? 0.5 + rand(i * 16 + k, 9) * 0.5 : 0.1 + rand(i * 16 + k, 10) * 0.25);
    return `${num(x)} ${num(y)}`;
  }).join(" ");
  return (
    <g>
      <polygon points={ridge} fill="#230a3c" />
      <polyline points={ridge} fill="none" stroke={PINK} strokeWidth={num(Math.max(0.9, tall * 0.1))} strokeLinejoin="round" />
    </g>
  );
}

/** A palm silhouette standing on `base` at `x`, `height` tall, its crown leaning by `lean`. */
function Palm({ x, base, height, lean, i }: { x: number; base: number; height: number; lean: number; i: number }) {
  const crown = { x: x + lean, y: base - height * 0.9 };
  const trunk = height * 0.035;
  const bend = { x: x + lean * 0.15, y: base - height * 0.5 };
  const trunkPath =
    `M${num(x - trunk * 1.3)} ${num(base)}Q${num(bend.x - trunk)} ${num(bend.y)} ${num(crown.x - trunk * 0.6)} ${num(crown.y)}` +
    `L${num(crown.x + trunk * 0.6)} ${num(crown.y)}Q${num(bend.x + trunk)} ${num(bend.y)} ${num(x + trunk * 1.3)} ${num(base)}Z`;
  const len = height * 0.42;
  // each frond an arched blade, drooping to its tip
  const fronds = [-172, -146, -118, -62, -34, -8].map((deg, k) => {
    const a = ((deg + (rand(i * 8 + k, 5) - 0.5) * 14) * Math.PI) / 180;
    const l = len * (0.8 + rand(i * 8 + k, 6) * 0.35);
    const tip = { x: crown.x + Math.cos(a) * l, y: crown.y + Math.sin(a) * l + l * 0.42 };
    const arch = { x: crown.x + Math.cos(a) * l * 0.55, y: crown.y + Math.sin(a) * l * 0.55 - l * 0.18 };
    return `M${num(crown.x)} ${num(crown.y)}Q${num(arch.x)} ${num(arch.y)} ${num(tip.x)} ${num(tip.y)}Q${num(arch.x)} ${num(arch.y + l * 0.26)} ${num(crown.x)} ${num(crown.y + l * 0.06)}Z`;
  });
  return (
    <g fill={SILHOUETTE}>
      <path d={trunkPath} />
      <g className="ez-synthwave-frond" style={{ ...about(crown.x, crown.y), ...delay(-rand(i, 7) * 5) }}>
        <path d={fronds.join("")} />
      </g>
    </g>
  );
}

/** Searchlights fanning up from behind the sun, only while a touchdown is celebrated. */
function Beams({ cx, horizon, reach }: { cx: number; horizon: number; reach: number }) {
  const beam = `M0 0L${num(-reach * 0.07)} ${num(-reach)}H${num(reach * 0.07)}Z`;
  return (
    <g transform={`translate(${num(cx)} ${num(horizon)})`}>
      {[CYAN, PINK, CYAN, PINK].map((c, k) => (
        <path key={k} className={`ez-synthwave-beam ez-synthwave-beam-${String(k)}`} d={beam} fill={c} opacity={0} />
      ))}
    </g>
  );
}

/**
 * The shooting stars: where each starts, as fractions of the width and of the sky, how steeply it
 * dives in degrees and when it sets off in seconds. The first three start a third of the width
 * apart, so between them their flights cross the whole sky; a tall sky gets the fourth, lower down.
 */
const METEORS = [
  { x: 0.03, y: 0.14, tilt: 7, at: 0 },
  { x: 0.36, y: 0.08, tilt: 5, at: 0.35 },
  { x: 0.66, y: 0.2, tilt: 6, at: 0.7 },
  { x: 0.16, y: 0.4, tilt: 6, at: 0.5 },
] as const;

/**
 * Shooting stars across the sky, only while a touchdown is celebrated. `scale` sizes them and their
 * flight (about 210 units at 1); drawn in the sky, they pass behind the sun, the peaks and the palms.
 */
function Meteors({ w, horizon, scale, count }: { w: number; horizon: number; scale: number; count: number }) {
  return (
    <g>
      {METEORS.slice(0, count).map((m) => (
        <g key={m.x} transform={`translate(${num(w * m.x)} ${num(horizon * m.y)}) rotate(${String(m.tilt)}) scale(${num(scale)})`}>
          <g className="ez-synthwave-meteor" style={delay(m.at)} opacity={0}>
            <path d="M0 -1.5L-64 0L0 1.5Z" fill="#ffffff" />
            <circle r={2.1} fill="#ffffff" />
          </g>
        </g>
      ))}
    </g>
  );
}

/** END ZONE in italic chrome, outlined in the night and haloed in pink neon. */
function Lettering({ id, x, y, fs }: { id: string; x: number; y: number; fs: number }) {
  const spacing = fs * 0.12;
  const common = { x: 0, y: 0, textAnchor: "middle", fontFamily: "var(--font-hand)", fontSize: fs, letterSpacing: spacing, strokeLinejoin: "round" } as const;
  // where the chrome catches the light: the last E's top corner, about 2.25 em right of the middle and pushed over by the slant
  const glint = { x: x + fs * (2.24 + CAP * SLANT), y: y - fs * (CAP + 0.06) };
  return (
    <g className="ez-synthwave-word">
      <g transform={`translate(${num(x + spacing / 2)} ${num(y)}) skewX(${num((-Math.atan(SLANT) * 180) / Math.PI)})`}>
        <defs>
          <linearGradient id={`${id}-chrome`} gradientUnits="userSpaceOnUse" x1="0" y1={num(-fs * CAP)} x2="0" y2="0">
            <stop offset="0" stopColor={CHROME[0]} />
            <stop offset="0.5" stopColor={CHROME[1]} />
            <stop offset="0.54" stopColor={CHROME[2]} />
            <stop offset="0.58" stopColor={CHROME[3]} />
            <stop offset="1" stopColor={CHROME[4]} />
          </linearGradient>
        </defs>
        <g className="ez-synthwave-glow">
          <text {...common} fill={PINK} stroke={PINK} strokeWidth={num(fs * 0.75)} opacity={0.2}>END ZONE</text>
          <text {...common} fill={PINK} stroke={PINK} strokeWidth={num(fs * 0.45)} opacity={0.45}>END ZONE</text>
        </g>
        <text {...common} fill={NIGHT} stroke={NIGHT} strokeWidth={num(fs * 0.24)}>END ZONE</text>
        <text {...common} fill={CHROME[1]} style={{ fill: `url(#${id}-chrome)` }}>END ZONE</text>
      </g>
      <path className="ez-synthwave-glint" d={sparkle(glint.x, glint.y, fs * 0.3, 0.17)} fill="#ffffff" />
    </g>
  );
}

/**
 * Synthwave '84: a neon sunset. A dusk sky over a half sun cut by slits, dark peaks and palms
 * either side, and a neon grid floor, cyan rails and pink rungs, rolling in towards the goal line
 * with END ZONE on it in italic chrome. The sun breathes, the grid rolls on and the stars twinkle;
 * a touchdown races the grid and swaps its neon, pulses the sun and runs its slits down, strobes the
 * lettering, swings searchlights up from the horizon and sends shooting stars over the sky.
 */
export function SynthwaveArt({ w, h, label, celebrate }: ArtProps) {
  const id = useArtId("synthwave");
  const cx = w / 2;
  const fs = Math.min(h * 0.46, 18.5 + (h - 44) * 0.19);
  const horizon = h * 0.6;
  const sun = Math.min(horizon * 0.92, w * 0.16);
  const tall = h >= 24;
  // the band's depth, a flatter rise past about 56 and the width's cap, so a crown's fronds keep
  // clear of the top edge in any band: 43 at 44, 102 at 132, 125 at 220
  const palm = Math.min(w * 0.19, h * 0.98, 20 + h * 0.62);
  const peaks = { x0: palm * 0.8, x1: cx - sun * 0.55, tall: horizon * 0.34 };
  return (
    <g className={celebrate ? "ez-synthwave-party" : undefined}>
      <defs>
        <linearGradient id={`${id}-sky`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={num(horizon)}>
          <stop offset="0" stopColor={NIGHT} />
          <stop offset="0.45" stopColor="#40156b" />
          <stop offset="0.8" stopColor="#b3207a" />
          <stop offset="1" stopColor={ORANGE} />
        </linearGradient>
        <linearGradient id={`${id}-floor`} gradientUnits="userSpaceOnUse" x1="0" y1={num(horizon)} x2="0" y2={num(h)}>
          <stop offset="0" stopColor="#3a0f4f" />
          <stop offset="1" stopColor="#12061f" />
        </linearGradient>
        <linearGradient id={`${id}-haze`} gradientUnits="userSpaceOnUse" x1="0" y1={num(horizon)} x2="0" y2={num(horizon + (h - horizon) * 0.45)}>
          <stop offset="0" stopColor={PINK} stopOpacity={0.5} />
          <stop offset="1" stopColor={PINK} stopOpacity={0} />
        </linearGradient>
        <linearGradient id={`${id}-flare`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={num(horizon)}>
          <stop offset="0" stopColor={PINK} stopOpacity={0} />
          <stop offset="1" stopColor={PINK} stopOpacity={0.75} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={NIGHT} style={{ fill: `url(#${id}-sky)` }} />
      {tall &&
        Array.from({ length: Math.round(w / 55) }, (_, i) => {
          // the stars keep to the sky either side of the sun
          const side = i % 2 ? 1 : -1;
          const x = cx + side * (sun * 1.5 + rand(i, 1) * (w / 2 - sun * 1.5 - palm * 0.5));
          return <Star key={i} i={i} x={x} y={horizon * (0.1 + rand(i, 2) * 0.42)} r={h * 0.05 * (0.65 + rand(i, 8) * 0.6)} />;
        })}
      {celebrate && (
        <>
          <rect className="ez-synthwave-afterglow" width={w} height={num(horizon)} fill="none" opacity={0} style={{ fill: `url(#${id}-flare)` }} />
          <Beams cx={cx} horizon={horizon} reach={Math.max(w * 0.45, h * 2)} />
          {/* sized to the band only so far: past about 62 deep they would swell into bars, so a tall sky gets one more instead */}
          {tall && <Meteors w={w} horizon={horizon} scale={Math.min(h / 44, 1.4)} count={h > 90 ? 4 : 3} />}
        </>
      )}
      <Sun id={id} cx={cx} horizon={horizon} r={sun} />
      {tall && (
        <>
          <Mountains x0={peaks.x0} x1={peaks.x1} horizon={horizon} tall={peaks.tall} i={0} />
          <Mountains x0={w - peaks.x1} x1={w - peaks.x0} horizon={horizon} tall={peaks.tall} i={1} />
        </>
      )}
      <rect y={num(horizon)} width={w} height={num(h - horizon)} fill="#2a0c40" style={{ fill: `url(#${id}-floor)` }} />
      <Grid w={w} h={h} cx={cx} horizon={horizon} celebrate={celebrate} />
      <rect y={num(horizon)} width={w} height={num(h - horizon)} fill="none" style={{ fill: `url(#${id}-haze)` }} />
      <rect y={num(horizon - 0.6)} width={w} height={1.2} fill="#ffd0a8" />
      {tall && (
        <>
          <Palm x={palm * 0.45} base={h} height={palm} lean={palm * 0.2} i={0} />
          <Palm x={palm * 1.3} base={h} height={palm * 0.78} lean={-palm * 0.12} i={1} />
          <Palm x={w - palm * 0.45} base={h} height={palm} lean={-palm * 0.2} i={2} />
          <Palm x={w - palm * 1.3} base={h} height={palm * 0.78} lean={palm * 0.12} i={3} />
        </>
      )}
      {label && <Lettering id={id} x={cx} y={horizon + (h - horizon + fs * CAP) / 2} fs={fs} />}
    </g>
  );
}

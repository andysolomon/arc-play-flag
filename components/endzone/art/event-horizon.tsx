import type { CSSProperties } from "react";
import { CAP, fitAttrs, fitText, num, px, rand, secs, sparkle, useArtId, type ArtProps, type Fit } from "./shared";

/** the void between the stars */
const VOID = "#0b0a1a";
/** warm starlight: the lettering, and the disk's glow */
const GOLD = "#ffd27f";
/** the disk at its hottest, and the photon ring */
const HOT = "#fff6e2";
const EMBER = "#ff9e4a";
const ROSE = "#e0457b";
const VIOLET = "#9d7bff";
const ICE = "#5ad1ff";
/** the pale violet of a cooler star */
const LILAC = "#cbbcff";
/** how far the disk is tipped towards us: its depth on screen for its width */
const TILT = 0.12;
/** the disk's inner edge, in shadow radii: gas any nearer falls straight in */
const ISCO = 1.2;
/** where the disk's hot heart gives way to its glow, in shadow radii */
const HEART_EDGE = 3.2;
/** The disk's hot heart, as rings in shadow radii and how bright each burns; its soft glow runs on far beyond. */
const HEART: readonly (readonly [inner: number, outer: number, glow: number])[] = [
  [ISCO, 1.9, 1],
  [1.9, HEART_EDGE, 0.7],
];

/** Clouds of the nebula washing the void, placed and sized as fractions of the band. */
const NEBULAE: readonly { color: string; alpha: number; x: number; y: number; rx: number; ry: number }[] = [
  { color: "#6a45c9", alpha: 0.5, x: 0.17, y: 0.3, rx: 0.24, ry: 1 },
  { color: "#1f6fae", alpha: 0.42, x: 0.85, y: 0.65, rx: 0.2, ry: 0.95 },
  { color: "#a0306f", alpha: 0.32, x: 0.5, y: 0.55, rx: 0.2, ry: 0.8 },
  { color: "#b0307a", alpha: 0.2, x: 0.3, y: 0.9, rx: 0.13, ry: 0.6 },
  { color: "#2a8a9e", alpha: 0.24, x: 0.67, y: 0.12, rx: 0.13, ry: 0.6 },
];

type Vars = CSSProperties & { [key: `--ez-event-horizon-${string}`]: string };

/** A twinkle's own period, `period` seconds, which a touchdown overrides, begun `delay` seconds in. */
const beat = (period: number, delay: number): Vars => ({ "--ez-event-horizon-beat": secs(period), animationDelay: secs(delay) });

/** The point `r` out from the origin at `deg` (clockwise from east, as SVG turns). */
function polar(r: number, deg: number): string {
  const a = (deg * Math.PI) / 180;
  return `${num(r * Math.cos(a))} ${num(r * Math.sin(a))}`;
}

/** A ring about the origin, from radius `r1` out to `r2` (fill it evenodd). */
const annulus = (r1: number, r2: number): string =>
  [r2, r1].map((r) => `M${num(-r)} 0A${num(r)} ${num(r)} 0 1 0 ${num(r)} 0A${num(r)} ${num(r)} 0 1 0 ${num(-r)} 0Z`).join("");

/**
 * A crescent of gas on the circle of radius `r` from `a0` to `a1` degrees, `thick` at its middle
 * and tapering to both tips: the arc itself and a flatter one through the same tips.
 */
function crescent(r: number, a0: number, a1: number, thick: number): string {
  const half = ((a1 - a0) * Math.PI) / 360;
  const chord = r * Math.sin(half);
  const sag = r - r * Math.cos(half) - Math.min(thick, r * (1 - Math.cos(half)) * 0.85);
  const flat = (sag * sag + chord * chord) / (2 * sag);
  return `M${polar(r, a0)}A${num(r)} ${num(r)} 0 0 1 ${polar(r, a1)}A${num(flat)} ${num(flat)} 0 0 0 ${polar(r, a0)}Z`;
}

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const inside = (x: number, y: number, b: Box): boolean => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;

/**
 * Streams of gas orbiting in the disk between `from` and `to` shadow radii: `light` ones and dark
 * dust lanes between. An empty circle at the outer edge centres its box on the hole, so the CSS can
 * turn it about its middle.
 */
function Swirl({ r, from, to, seed, light, alpha, className }: { r: number; from: number; to: number; seed: number; light: string; alpha: number; className: string }) {
  const streams = Array.from({ length: 7 }, (_, k) => {
    const radius = r * (from + (to - from) * (k + 0.5) / 7);
    const a0 = rand(k, seed) * 360;
    const sweep = 50 + rand(k, seed + 1) * 70;
    const dark = k % 3 === 2;
    return (
      <path
        key={k}
        d={crescent(radius, a0, a0 + sweep, r * (to - from) * (dark ? 0.1 : 0.07))}
        fill={dark ? VOID : light}
        opacity={dark ? 0.4 : alpha}
      />
    );
  });
  return (
    <g className={className}>
      <circle r={num(r * to)} fill="none" />
      {streams}
    </g>
  );
}

/**
 * The accretion disk, tipped nearly edge on: a hot heart of rings, brighter on the left where the
 * gas swings towards us, in a glow that fades far out, with streams orbiting in it, the inner ones
 * faster. The whole of it sits behind the shadow; a `near` copy of its heart, cut to the half nearer
 * us, passes in front and leaves the rest of the shadow black.
 */
function Disk({ id, cx, cy, r, reach, near, celebrate }: { id: string; cx: number; cy: number; r: number; reach: number; near: boolean; celebrate: boolean }) {
  const glow = <path d={annulus(r * ISCO, r * reach)} fillRule="evenodd" fill="none" style={{ fill: `url(#${id}-glow)` }} />;
  const heart = (flare: boolean) =>
    HEART.map(([a, b, alpha]) => (
      <path key={a} d={annulus(r * a, r * b)} fillRule="evenodd" fill={flare ? HOT : GOLD} style={flare ? undefined : { fill: `url(#${id}-disk)` }} opacity={flare ? 1 : alpha} />
    ));
  return (
    <g transform={`translate(${num(cx)} ${num(cy)}) scale(1 ${String(TILT)})`}>
      {!near && glow}
      {heart(false)}
      <g className="ez-event-horizon-spin">
        <Swirl r={r} from={ISCO} to={HEART_EDGE} seed={10} light={HOT} alpha={0.5} className="ez-event-horizon-swirl ez-event-horizon-inner" />
        {!near && <Swirl r={r} from={HEART_EDGE} to={Math.min(9, reach * 0.7)} seed={20} light={EMBER} alpha={0.35} className="ez-event-horizon-swirl" />}
      </g>
      {celebrate && (
        <g className="ez-event-horizon-flare" opacity={0}>
          {!near && glow}
          {heart(true)}
        </g>
      )}
    </g>
  );
}

/**
 * What light makes of the hole: the far side of the disk bent up over the shadow and its underside
 * bent round beneath it, a thin photon ring hugging the shadow, and the shadow itself. An empty
 * circle round the lot centres its box on the hole, so a touchdown can swell it in place.
 */
function Hole({ id, cx, cy, r }: { id: string; cx: number; cy: number; r: number }) {
  const a = r * 1.1;
  const over = (rx: number, ry: number): string =>
    `M${num(cx - rx)} ${num(cy)}A${num(rx)} ${num(ry)} 0 0 1 ${num(cx + rx)} ${num(cy)}L${num(cx + a)} ${num(cy)}A${num(a)} ${num(a)} 0 0 0 ${num(cx - a)} ${num(cy)}Z`;
  const under = `M${num(cx - a)} ${num(cy)}A${num(a)} ${num(a)} 0 0 0 ${num(cx + a)} ${num(cy)}L${num(cx + r * 1.26)} ${num(cy)}A${num(r * 1.26)} ${num(r * 1.3)} 0 0 1 ${num(cx - r * 1.26)} ${num(cy)}Z`;
  return (
    <g className="ez-event-horizon-hole">
      <circle cx={num(cx)} cy={num(cy)} r={num(r * 2.05)} fill="none" />
      <g className="ez-event-horizon-lens">
        <path d={over(r * 1.75, r * 2.05)} fill={EMBER} style={{ fill: `url(#${id}-lens)` }} opacity={0.3} />
        <path d={over(r * 1.45, r * 1.62)} fill={GOLD} style={{ fill: `url(#${id}-lens)` }} />
        <path d={over(r * 1.2, r * 1.3)} fill={HOT} opacity={0.75} />
      </g>
      <path d={under} fill={GOLD} style={{ fill: `url(#${id}-lens)` }} opacity={0.6} />
      <circle cx={num(cx)} cy={num(cy)} r={num(r * 1.05)} fill="none" stroke={HOT} strokeWidth={num(Math.max(0.7, r * 0.1))} />
      <circle cx={num(cx)} cy={num(cy)} r={num(r)} fill="#000000" />
    </g>
  );
}

/** The starfield: pinpricks in three twinkling sets and one still one, clear of the hole and the lettering. */
function Stars({ w, h, clear }: { w: number; h: number; clear: readonly Box[] }) {
  const count = Math.round((w * h) / 560);
  const size = Math.max(0.55, Math.min(h, 60) / 44);
  const stars: { x: number; y: number; r: number; fill: string }[] = [];
  for (let i = 0; stars.length < count && i < count * 4; i++) {
    const x = rand(i, 1) * w;
    const y = rand(i, 2) * h;
    if (clear.some((b) => inside(x, y, b))) continue;
    const tint = rand(i, 4);
    stars.push({ x, y, r: size * (0.45 + rand(i, 3) ** 3 * 0.85), fill: tint < 0.15 ? ICE : tint < 0.28 ? LILAC : tint < 0.45 ? "#ffe9c4" : "#ffffff" });
  }
  return (
    <g>
      {[0, 1, 2, 3].map((set) => (
        <g
          key={set}
          className={set ? "ez-event-horizon-twinkle" : undefined}
          style={set ? beat(2.6 + set * 1.3, -set * 0.9) : undefined}
        >
          {stars
            .filter((_, k) => k % 4 === set)
            .map((s) => (
              <circle key={`${num(s.x)},${num(s.y)}`} cx={num(s.x)} cy={num(s.y)} r={num(s.r)} fill={s.fill} />
            ))}
        </g>
      ))}
    </g>
  );
}

/** A few bright stars that glint, four-pointed. */
function Sparkles({ w, h, clear }: { w: number; h: number; clear: readonly Box[] }) {
  const n = Math.max(2, Math.round(w / 110));
  const size = Math.min(h, 56) * 0.085;
  return (
    <g>
      {Array.from({ length: n }, (_, k) => {
        const x = (w * (k + 0.25 + rand(k, 30) * 0.5)) / n;
        const y = h * (0.18 + rand(k, 31) * 0.64);
        if (clear.some((b) => inside(x, y, b))) return null;
        return <path key={k} className="ez-event-horizon-spark" style={beat(4 + rand(k, 33) * 3, -rand(k, 32) * 5)} d={sparkle(x, y, size * (0.75 + rand(k, 34) * 0.5), 0.2)} fill={k % 3 === 1 ? "#d9f3ff" : HOT} />;
      })}
    </g>
  );
}

/** A touchdown's warp: stars streaking in from across the band and down into the hole. */
function Warp({ w, h, cx, cy, r }: { w: number; h: number; cx: number; cy: number; r: number }) {
  const t = Math.max(0.5, h * 0.028);
  return (
    <g>
      {Array.from({ length: 16 }, (_, k) => {
        const side = k % 2 ? 1 : -1;
        const x = cx + side * (r * 4 + rand(k, 40) * (w / 2 - r * 4));
        const y = h * (0.06 + rand(k, 41) * 0.88);
        const d = Math.hypot(x - cx, y - cy);
        const deg = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
        const len = 8 + d * 0.16;
        const style: Vars = { "--ez-event-horizon-fall": px(r * 1.2 - d), animationDelay: secs(rand(k, 42) * 0.9) };
        return (
          <g key={k} transform={`translate(${num(cx)} ${num(cy)}) rotate(${num(deg)})`}>
            <path
              className="ez-event-horizon-warp"
              style={style}
              opacity={0}
              d={`M${num(d)} ${num(-t)}L${num(d + len)} 0L${num(d)} ${num(t)}A${num(t)} ${num(t)} 0 0 1 ${num(d)} ${num(-t)}Z`}
              fill={[HOT, ICE, HOT, LILAC][Math.floor(rand(k, 43) * 4)] ?? HOT}
            />
          </g>
        );
      })}
    </g>
  );
}

/** A touchdown's ripples in spacetime: rings running out from the hole, one after another. */
function Ripples({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g fill="none" strokeWidth={num(r * 0.05)}>
      {[HOT, VIOLET, HOT].map((stroke, k) => (
        <circle key={k} className="ez-event-horizon-ripple" style={{ animationDelay: secs(k * 0.45) }} opacity={0} cx={num(cx)} cy={num(cy)} r={num(r * 1.1)} stroke={stroke} />
      ))}
    </g>
  );
}

/** A word of the name set beside the hole: its text, the side it sits on and how it fits the room there. */
interface Word {
  text: string;
  side: -1 | 1;
  fit: Fit;
}

/**
 * The name split either side of the hole: its words shared out as evenly as they go (a single
 * word sits on the right), each side sized into `room`.
 */
function words(name: string, size: number, room: number): Word[] {
  const parts = name.split(" ");
  // the cut between words that leaves the two sides nearest the same length; a single word is all right side
  const lopsided = (k: number): number => Math.abs(parts.slice(0, k).join(" ").length - parts.slice(k).join(" ").length);
  let cut = parts.length < 2 ? 0 : 1;
  for (let k = 2; k < parts.length; k++) if (lopsided(k) < lopsided(cut)) cut = k;
  const sides: [string, -1 | 1][] = [[parts.slice(0, cut).join(" "), -1], [parts.slice(cut).join(" "), 1]];
  return sides.filter(([text]) => text).map(([text, side]) => ({ text, side, fit: fitText(text, size, room, size * 3) }));
}

/** The name either side of the hole in warm starlight, outlined in the void, each side tugged towards the hole in a touchdown. */
function Lettering({ cx, cy, gap, name, list }: { cx: number; cy: number; gap: number; name: string; list: readonly Word[] }) {
  return (
    <g data-ez-name={name}>
      {list.map(({ text, side, fit }) => {
        const y = cy + (fit.fs * CAP) / 2;
        // an end-anchored word carries its trailing letter spacing past its last letter: give it back
        const x = side < 0 ? cx - gap + fit.spacing : cx + gap;
        const style: Vars = { "--ez-event-horizon-pull": px(-side * fit.fs * 0.2), transformOrigin: side < 0 ? "0% 50%" : "100% 50%" };
        const at = { ...fitAttrs(fit), x: num(x), y: num(y), textAnchor: side < 0 ? "end" : "start", strokeLinejoin: "round" } as const;
        return (
          <g key={side} className="ez-event-horizon-word" style={style}>
            <text {...at} fill={VOID} stroke={VOID} strokeWidth={num(fit.fs * 0.3)}>{text}</text>
            <text {...at} fill={GOLD}>{text}</text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Event Horizon: deep space with a black hole at its heart, after Interstellar's Gargantua. A
 * violet void washed with nebulae and scattered with stars; an accretion disk tipped nearly edge on,
 * blazing brighter on the side that swings towards us; its far side bent up over the shadow by the
 * hole's gravity, a thin photon ring round the pure black shadow, and the team's name either side
 * in starlight. The disk swirls, inner streams faster, and the stars twinkle; a touchdown flares
 * the disk and spins it up, streaks the stars inwards at warp, ripples rings out from the hole and
 * tugs the lettering towards it.
 */
export function EventHorizonArt({ w, h, label, celebrate, name }: ArtProps) {
  const id = useArtId("event-horizon");
  const cx = w / 2;
  const cy = h * 0.52;
  const r = Math.min(h * 0.26, w * 0.057);
  const reach = Math.min(15, (w * 0.42) / r);
  const fs = Math.min(h * 0.46, 17 + (h - 44) * 0.18);
  const gap = r * 2.9;
  const clear: Box[] = [{ x0: cx - r * 2.4, x1: cx + r * 2.4, y0: cy - r * 2.3, y1: cy + r * 1.6 }];
  // each side of the name has the room from the hole's gap to a little short of the edge
  const lettered = label && name ? words(name, fs, w / 2 - gap - fs * 0.4) : [];
  for (const { side, fit } of lettered) {
    const [top, bottom] = [cy - fit.fs * 0.55, cy + fit.fs * 0.55];
    const near = cx + side * (gap - fit.fs * 0.1);
    const far = cx + side * (gap + fit.width + fit.fs * 0.1);
    clear.push({ x0: Math.min(near, far), x1: Math.max(near, far), y0: top, y1: bottom });
  }
  return (
    <g className={celebrate ? "ez-event-horizon-party" : undefined}>
      <defs>
        <linearGradient id={`${id}-disk`}>
          <stop offset="0" stopColor="#ffc46e" />
          <stop offset="0.32" stopColor={HOT} />
          <stop offset="0.5" stopColor={GOLD} />
          <stop offset="0.7" stopColor={EMBER} />
          <stop offset="1" stopColor={ROSE} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} gradientUnits="userSpaceOnUse" cx={num(-r * 0.8)} cy="0" r={num(r * reach)}>
          <stop offset="0" stopColor={HOT} />
          <stop offset="0.14" stopColor={GOLD} stopOpacity={0.95} />
          <stop offset="0.3" stopColor={EMBER} stopOpacity={0.65} />
          <stop offset="0.55" stopColor={ROSE} stopOpacity={0.3} />
          <stop offset="0.8" stopColor="#7a2b6a" stopOpacity={0.1} />
          <stop offset="1" stopColor="#7a2b6a" stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${id}-lens`}>
          <stop offset="0" stopColor={HOT} />
          <stop offset="0.5" stopColor="#ffe0a0" />
          <stop offset="1" stopColor="#ff7a5a" />
        </linearGradient>
        <radialGradient id={`${id}-halo`}>
          <stop offset="0" stopColor="#ffb867" stopOpacity={0.55} />
          <stop offset="0.45" stopColor="#ff7a4d" stopOpacity={0.2} />
          <stop offset="1" stopColor="#ff7a4d" stopOpacity={0} />
        </radialGradient>
        {NEBULAE.map(({ color, alpha }, k) => (
          <radialGradient key={color} id={`${id}-cloud-${String(k)}`}>
            <stop offset="0" stopColor={color} stopOpacity={alpha} />
            <stop offset="1" stopColor={color} stopOpacity={0} />
          </radialGradient>
        ))}
        <clipPath id={`${id}-near`}>
          <rect y={num(cy)} width={num(w)} height={num(h - cy)} />
        </clipPath>
      </defs>
      <rect width={w} height={h} fill={VOID} />
      {NEBULAE.map(({ x, y, rx, ry }, k) => (
        <ellipse key={k} cx={num(w * x)} cy={num(h * y)} rx={num(w * rx)} ry={num(h * ry)} fill="none" style={{ fill: `url(#${id}-cloud-${String(k)})` }} />
      ))}
      <Stars w={w} h={h} clear={clear} />
      <Sparkles w={w} h={h} clear={clear} />
      <ellipse className="ez-event-horizon-halo" cx={num(cx)} cy={num(cy)} rx={num(r * 4.6)} ry={num(r * 2.7)} fill="none" style={{ fill: `url(#${id}-halo)` }} />
      <Disk id={id} cx={cx} cy={cy} r={r} reach={reach} near={false} celebrate={celebrate} />
      <Hole id={id} cx={cx} cy={cy} r={r} />
      <g clipPath={`url(#${id}-near)`}>
        <Disk id={id} cx={cx} cy={cy} r={r} reach={reach} near celebrate={celebrate} />
      </g>
      {celebrate && (
        <>
          <Warp w={w} h={h} cx={cx} cy={cy} r={r} />
          <Ripples cx={cx} cy={cy} r={r} />
        </>
      )}
      {lettered.length > 0 && <Lettering cx={cx} cy={cy} gap={gap} name={name} list={lettered} />}
    </g>
  );
}

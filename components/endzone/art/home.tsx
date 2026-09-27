import type { CSSProperties } from "react";
import { contrast, inkOn, luminance, useArtId, type ArtProps } from "./shared";

const INK = "#1b1a17";
const CREAM = "#fffdf6";
const BULB = "#fff3b0";
const FALLBACK = "#f2b705";
/** the diagonal the stripes are painted at, degrees off vertical */
const SLANT = 35;

/** Patrick Hand's capitals, digits and space, and each one's advance in hundredths of an em, to measure a name before it is drawn */
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
const ADVANCE = [49, 51, 55, 48, 44, 38, 48, 47, 24, 37, 52, 37, 60, 53, 56, 48, 66, 45, 46, 47, 55, 56, 62, 60, 44, 51, 45, 36, 47, 45, 38, 42, 40, 50, 43, 37, 23];
// anything else is taken as wide (a whole em past Latin, where a fallback font draws it), so a name is never underestimated
const advance = (c: string): number => ADVANCE[GLYPHS.indexOf(c)] ?? (c > "\u024f" ? 100 : 60);
const ems = (text: string): number => Array.from(text).reduce((sum, c) => sum + advance(c) / 100, 0);

const channels = (hex: string): [number, number, number] => {
  const n = /^#?([0-9a-f]{6})$/i.exec(hex.trim())?.[1] ?? FALLBACK.slice(1);
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16));
  return [r, g, b];
};

/** `a` moved `t` of the way to `b`. */
const mix = (a: string, b: string, t: number): string => {
  const [x, y] = [channels(a), channels(b)];
  return `#${x.map((c, i) => Math.round(c + ((y[i] ?? c) - c) * t).toString(16).padStart(2, "0")).join("")}`;
};

const num = (n: number): string => String(Math.round(n * 100) / 100);
const pts = (...xy: number[]): string => xy.map(num).join(" ");

/** The paint pot for one team colour, pale or dark: every shade the design uses. */
function paints(color: string) {
  const base = /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : FALLBACK;
  const light = luminance(base) > 0.3;
  // letters in whichever of ink or cream reads on the colour, tinted towards it; the outline is the other one
  const darkLetters = inkOn(base) === INK;
  const letter = darkLetters ? mix(base, INK, 0.84) : CREAM;
  const edge = darkLetters ? CREAM : mix(base, INK, 0.72);
  return {
    base,
    stripe: mix(base, light ? INK : CREAM, light ? 0.13 : 0.15),
    shadow: mix(base, INK, 0.6),
    letter,
    edge: contrast(letter, edge) >= 4.5 ? edge : inkOn(letter),
    // a white paint line on all but the palest colours, where it goes dark
    trim: contrast(base, CREAM) >= 1.45 ? CREAM : mix(base, INK, 0.7),
  };
}
type Paints = ReturnType<typeof paints>;

interface Fit {
  fs: number;
  spacing: number;
  /** the lettering's width as laid out, first letter to last */
  width: number;
  /** condensed to `width` with textLength: the name is too long even at its smallest size */
  squeeze: boolean;
}

/** Sizes a name into `room`: a long one gets smaller, then condensed; a short one is spaced out towards `span`, as end zone lettering is. */
function fitName(text: string, size: number, room: number, span: number): Fit {
  const [n, em] = [Array.from(text).length, ems(text)];
  const fs = Math.max(size * 0.62, Math.min(size, room / (em + (n - 1) * 0.05)));
  const spacing = Math.max(fs * 0.05, Math.min(fs * 0.45, (Math.min(span, room) - em * fs) / n));
  const width = em * fs + (n - 1) * spacing;
  return width > room ? { fs, spacing: 0, width: room, squeeze: true } : { fs, spacing, width, squeeze: false };
}

/** The name in painted block letters: a drop shadow, an outline, and letters thickened with their own paint. */
function Name({ text, x, y, fit, paint, celebrate }: { text: string; x: number; y: number; fit: Fit; paint: Paints; celebrate: boolean }) {
  const { fs, spacing, squeeze } = fit;
  // letter-spacing trails the last letter too, so the anchor moves half a space right to keep the letters centred
  const common = {
    x: x + spacing / 2, y, textAnchor: "middle", fontFamily: "var(--font-hand)", fontSize: fs, letterSpacing: spacing,
    strokeLinejoin: "round", ...(squeeze ? { textLength: fit.width, lengthAdjust: "spacingAndGlyphs" } : {}),
  } as const;
  const outline = fs * 0.3;
  const bold = fs * 0.05;
  const drop = Math.max(1, fs * 0.09);
  return (
    <g className="ez-home-name">
      <g transform={`translate(${num(drop)} ${num(drop)})`}>
        <text {...common} fill={paint.shadow} stroke={paint.shadow} strokeWidth={outline}>{text}</text>
      </g>
      <text {...common} fill={paint.edge} stroke={paint.edge} strokeWidth={outline}>{text}</text>
      <text {...common} fill={paint.letter} stroke={paint.letter} strokeWidth={bold}>{text}</text>
      {/* a touchdown flashes the name in reverse, like a scoreboard; hidden at rest, so with motion off the name holds still */}
      {celebrate && (
        <g className="ez-home-flash" opacity={0}>
          <text {...common} fill={paint.letter} stroke={paint.letter} strokeWidth={outline}>{text}</text>
          <text {...common} fill={paint.edge} stroke={paint.edge} strokeWidth={bold}>{text}</text>
        </g>
      )}
    </g>
  );
}

/** A five-pointed star painted like the lettering beside it, in reverse: cream on the team's dark. */
function Star({ x, y, r, paint }: { x: number; y: number; r: number; paint: Paints }) {
  const points = pts(...Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const d = i % 2 ? r * 0.46 : r;
    return [x + Math.cos(a) * d, y + Math.sin(a) * d];
  }).flat());
  const drop = Math.max(1, r * 0.22);
  return (
    <g className="ez-home-star">
      <polygon points={points} transform={`translate(${num(drop)} ${num(drop)})`} fill={paint.shadow} stroke={paint.shadow} strokeWidth={r * 0.36} strokeLinejoin="round" />
      <polygon points={points} fill={paint.trim} stroke={paint.letter} strokeWidth={r * 0.3} strokeLinejoin="round" style={{ paintOrder: "stroke" }} />
    </g>
  );
}

/** A felt pennant on a short pole, hoist on the left, standing from top to bottom; the caller mirrors it for the right side. */
function Pennant({ x, top, bottom, paint }: { x: number; top: number; bottom: number; paint: Paints }) {
  const tall = bottom - top;
  const depth = tall * 0.62;
  const length = tall * 1.85;
  const band = tall * 0.24;
  const y = top + tall * 0.05;
  // where the flag's top and bottom edges are at the band's inner end
  const [bandTop, bandBottom] = [y + (depth * 0.5 * band) / length, y + depth - (depth * 0.5 * band) / length];
  // the edges billow a little, so it reads as cloth rather than a paper triangle
  const cloth = `M${pts(x, y)} Q${pts(x + length * 0.45, y + depth * 0.08, x + length, y + depth * 0.5)} Q${pts(x + length * 0.5, y + depth * 0.98, x, y + depth)} Z`;
  return (
    <g>
      <line x1={x} y1={top} x2={x} y2={bottom} stroke={paint.shadow} strokeWidth={Math.max(1.4, tall * 0.08)} style={{ strokeLinecap: "round" }} />
      <g className="ez-home-flag">
        <path d={cloth} fill={paint.letter} stroke={paint.letter} strokeWidth={tall * 0.04} strokeLinejoin="round" />
        <polygon points={pts(x, y, x + band, bandTop, x + band, bandBottom, x, y + depth)} fill={paint.trim} />
      </g>
      <circle cx={x} cy={top} r={Math.max(1.3, tall * 0.08)} fill={paint.trim} stroke={paint.shadow} strokeWidth={Math.max(0.7, tall * 0.035)} />
    </g>
  );
}

/** Scoreboard bulbs along the border for a touchdown: dark sockets, and three sets of lit bulbs over them that light in turn, so they chase. */
function Marquee({ w, h, inset, line, paint }: { w: number; h: number; inset: number; line: number; paint: Paints }) {
  const across = Math.max(2, Math.round((w - inset * 2) / Math.max(18, h * 0.6)));
  const step = (w - inset * 2) / across;
  const r = Math.max(1.6, line * 0.85);
  const bulbs = Array.from({ length: across + 1 }, (_, i) => inset + i * step).flatMap((x, i) => [
    { x, y: inset, set: i % 3 },
    // the bottom row runs the other way round, so the lights circle the border
    { x, y: h - inset, set: (3 - (i % 3)) % 3 },
  ]);
  return (
    <g>
      <g fill={paint.shadow}>
        {bulbs.map((b) => <circle key={`${num(b.x)}-${num(b.y)}`} cx={b.x} cy={b.y} r={r} />)}
      </g>
      {[0, 1, 2].map((set) => (
        <g key={set} className={`ez-home-bulbs ez-home-bulbs-${String(set)}`} fill={CREAM} stroke={BULB} strokeOpacity={0.6} strokeWidth={r * 1.5}>
          {bulbs.filter((b) => b.set === set).map((b) => <circle key={`${num(b.x)}-${num(b.y)}`} cx={b.x} cy={b.y} r={r} />)}
        </g>
      ))}
    </g>
  );
}

/**
 * Home Team: the coach's own colour painted in bold diagonal stripes inside a white border, the
 * team's name in outlined block letters across the middle between two stars, and a pennant flying
 * on each side. Every shade comes from the team colour, so it works for any of them, pale or dark.
 * A glossy sheen passes now and then; a touchdown chases bulbs round the border like a
 * scoreboard, runs the stripes, flashes the name, spins the stars and whips the pennants.
 */
export function HomeArt({ w, h, label, celebrate, team }: ArtProps) {
  const id = useArtId("home");
  const paint = paints(team.color);
  const period = Math.min(40, Math.max(12, h * 0.62));
  const run = period / Math.cos((SLANT * Math.PI) / 180); // one stripe pair, measured along the band
  const inset = Math.max(1.5, Math.min(7, h * 0.12));
  const line = Math.max(1.2, Math.min(4, h * 0.07));
  const vars = { "--ez-home-run": `${num(run)}px`, "--ez-home-travel": `${num(w + h * 3)}px` } as CSSProperties;

  // the lettering: pennants at the ends, then the name between two stars when it has the room for them
  const flagTall = Math.min(h - (inset + line) * 2 - 2, w * 0.075);
  const flagTop = (h - flagTall) / 2;
  const poleX = inset + line * 2.6 + flagTall * 0.25;
  const room = w - (poleX + flagTall * 2.25) * 2;
  const text = team.name.trim().toUpperCase() || "HOME";
  const size = Math.min(h * 0.54, 22 + (h - 44) * 0.3);
  const star = size * 0.36;
  const starGap = size * 0.5;
  const starred = fitName(text, size, room - (starGap + star * 2) * 2, w * 0.3);
  const stars = starred.fs >= size * 0.9 && !starred.squeeze;
  const fit = stars ? starred : fitName(text, size, room, w * 0.3);

  return (
    <g className={celebrate ? "ez-home-party" : undefined} style={vars}>
      <defs>
        <pattern id={`${id}-stripes`} patternUnits="userSpaceOnUse" width={period} height={period} patternTransform={`rotate(${String(SLANT)})`}>
          <rect width={period} height={period} fill={paint.base} />
          <rect width={period / 2} height={period} fill={paint.stripe} />
        </pattern>
        <linearGradient id={`${id}-sheen`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor={CREAM} stopOpacity={0} />
          <stop offset="0.5" stopColor={CREAM} stopOpacity={0.32} />
          <stop offset="1" stopColor={CREAM} stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill={paint.base} />
      <rect className="ez-home-stripes" x={-run} width={w + run} height={h} style={{ fill: `url(#${id}-stripes)` }} />
      <polygon className="ez-home-sheen" points={pts(-h * 2, 0, -h * 1.2, 0, -h * 1.7, h, -h * 2.5, h)} style={{ fill: `url(#${id}-sheen)` }} />
      <rect x={inset} y={inset} width={w - inset * 2} height={h - inset * 2} fill="none" stroke={paint.trim} strokeWidth={line} />
      {label && (
        <>
          <Pennant x={poleX} top={flagTop} bottom={flagTop + flagTall} paint={paint} />
          <g className="ez-home-flip" transform={`translate(${num(w)} 0) scale(-1 1)`}>
            <Pennant x={poleX} top={flagTop} bottom={flagTop + flagTall} paint={paint} />
          </g>
          {stars && [-1, 1].map((side) => (
            <Star key={side} x={w / 2 + side * (fit.width / 2 + starGap + star)} y={h / 2} r={star} paint={paint} />
          ))}
          <Name text={text} x={w / 2} y={h / 2 + fit.fs * 0.34} fit={fit} paint={paint} celebrate={celebrate} />
        </>
      )}
      {/* on a sliver the bulbs would bury the stripes */}
      {celebrate && h >= 20 && <Marquee w={w} h={h} inset={inset} line={line} paint={paint} />}
    </g>
  );
}

"use client";

import { memo, useMemo, type CSSProperties } from "react";
import { END_ZONES, endZoneById, type ConfettiMotion, type ConfettiShape, type EndZone, type EndZoneId } from "@/lib/endzone";
import { inkOn } from "./art/shared";

/** How long a celebration lasts on screen, pieces and banner together. */
export const CELEBRATION_MS = 3400;

/** Pieces per celebration: a rain of glyphs or a drift of petals needs fewer than a confetti fall. */
const COUNT: Readonly<Record<ConfettiMotion, number>> = { fall: 90, drift: 48, rain: 64, burst: 84 };

/** A small seeded generator, so a celebration draws the same pieces every time it is replayed from the same seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Piece {
  shape: ConfettiShape;
  color: string;
  glyph: string;
  style: CSSProperties;
}

const pick = <T,>(list: readonly T[], r: number): T => list[Math.min(list.length - 1, Math.floor(r * list.length))] as T;

function pieces(zone: EndZone, team: string, seed: number, originY: number): Piece[] {
  const rand = mulberry32(seed * 7919 + END_ZONES.findIndex((z) => z.id === zone.id) * 104729 + 1);
  const { motion, shapes, colors, glyphs = "01" } = zone.confetti;
  return Array.from({ length: COUNT[motion] }, () => {
    const shape = pick(shapes, rand());
    const color = pick(colors, rand());
    const glyph = glyphs.charAt(Math.floor(rand() * glyphs.length));
    const spin = (rand() * 2 - 1) * (motion === "drift" ? 260 : 720);
    const vars: CSSProperties & Record<`--ez-${string}`, string> = {
      "--ez-x": `${(rand() * 100).toFixed(1)}%`,
      "--ez-delay": `${(motion === "rain" ? rand() * 1.4 : rand() * 0.6).toFixed(2)}s`,
      "--ez-time": `${(motion === "rain" ? 0.9 + rand() * 0.8 : motion === "drift" ? 2.3 + rand() * 0.9 : 1.8 + rand() * 1.1).toFixed(2)}s`,
      "--ez-sway": `${((rand() * 2 - 1) * (motion === "drift" ? 22 : 8)).toFixed(1)}cqw`,
      "--ez-spin": `${spin.toFixed(0)}deg`,
      // a burst sprays out and down from the end zone, and falls a little as it fades
      "--ez-dx": `${((rand() * 2 - 1) * 48).toFixed(1)}cqw`,
      "--ez-dy": `${(8 + rand() * 62).toFixed(1)}cqh`,
      "--ez-origin": `${(originY * 100).toFixed(1)}%`,
      "--ez-size": (motion === "burst" ? 0.8 + rand() * 0.6 : 0.8 + rand() * 0.5).toFixed(2),
    };
    return { shape, color: color === "team" ? team : color, glyph, style: vars };
  });
}

interface Props {
  zone: EndZoneId;
  /** the team's colour, for the designs that wear it */
  teamColor: string;
  /** a new number for each touchdown, so the next one scatters differently */
  seed: number;
  /** the end zone this touchdown just opened, if any */
  unlocked: EndZone | null;
  /** the middle of the end zone band, as a fraction of the field's height, where a burst starts */
  originY: number;
}

/**
 * TOUCHDOWN! over the field: confetti in the end zone's own colours and shapes, moving its own
 * way (a fall, a drift of petals, a rain of glyphs, a burst from the end zone), and a banner that
 * names any end zone the touchdown opened. Decoration only: aria-hidden, never catches a tap,
 * never printed. Under reduced motion the pieces stay away and the banner simply shows.
 */
function CelebrationImpl({ zone, teamColor, seed, unlocked, originY }: Props) {
  const z = endZoneById(zone);
  const list = useMemo(() => pieces(z, teamColor, seed, originY), [z, teamColor, seed, originY]);
  const fill = z.banner.fill === "team" ? teamColor : z.banner.fill;
  const ink = z.banner.ink === "auto" ? inkOn(fill) : z.banner.ink === "team" ? teamColor : z.banner.ink;
  const edge = z.banner.edge === "team" ? teamColor : z.banner.edge;
  return (
    <div
      data-celebration={zone}
      data-motion={z.confetti.motion}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-field [container-type:size] print:hidden"
    >
      {list.map((p, i) => (
        <span key={i} data-confetti={p.shape} className="ez-piece" style={{ ...p.style, color: p.color }}>
          {p.shape === "glyph" ? p.glyph : null}
        </span>
      ))}
      <div
        data-touchdown
        className="ez-banner absolute left-1/2 top-[38%] flex max-w-[92%] flex-col items-center gap-0.5 rounded-tile border-[3px] px-4 pb-2 pt-1.5 text-center shadow-tile"
        style={{ background: fill, color: ink, borderColor: edge }}
      >
        <span className="ez-banner-word whitespace-nowrap leading-tight">TOUCHDOWN!</span>
        {unlocked && <span data-unlocked={unlocked.id} className="text-small leading-tight">New end zone: {unlocked.name}</span>}
      </div>
    </div>
  );
}

export const Celebration = memo(CelebrationImpl);

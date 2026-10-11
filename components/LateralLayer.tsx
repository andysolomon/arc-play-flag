"use client";

import { memo, type KeyboardEvent, type PointerEvent } from "react";
import { VW, type LateralArc } from "@/lib/play/geometry";
import { INK } from "@/lib/play/routes";
import { FIELD, fieldInk } from "./fieldPaint";

interface Props {
  arcs: readonly LateralArc[];
  /** arcs: the dashed tosses and their footballs, under the players; handles: the catch points, over them */
  part: "arcs" | "handles";
  /** each player's name by id, for "Z catches" */
  names?: Readonly<Record<string, string>>;
  /** the lateral (by hop) whose catch handle is shaking off a clamp */
  shake?: number | null;
  /** the lateral (by hop) whose release handle is shaking off a clamp */
  shakeRelease?: number | null;
  /** the other team's chain, faded like its players */
  faded?: boolean;
  onHandleDown?: (hop: number, e: PointerEvent<SVGGElement>) => void;
  onHandleKey?: (hop: number, e: KeyboardEvent<SVGGElement>) => void;
  /** the release handle of a pitch on the run (ADR 006), dragged or nudged */
  onReleaseDown?: (hop: number, e: PointerEvent<SVGGElement>) => void;
  onReleaseKey?: (hop: number, e: KeyboardEvent<SVGGElement>) => void;
}

const centred = { transformBox: "fill-box", transformOrigin: "center" } as const;
/** How near a sideline, in SVG units, a handle's label turns to run inward so it stays on the field. */
const EDGE = 64;

/**
 * Laterals on the live field (see lib/play/lateral.ts). Each is a dashed arc from where the ball is
 * let go to where it is caught, bowing back, with the football sticker at the curve's midpoint; the
 * catch point is a diamond the coach drags, clamped as it moves behind the release and the line. A
 * pitch on the run (ADR 006) first draws the carrier's run with the ball as a solid line to the
 * release, a round handle the coach drags, kept behind the line.
 */
function LateralLayerImpl({
  arcs, part, names = {}, shake = null, shakeRelease = null, faded = false, onHandleDown, onHandleKey, onReleaseDown, onReleaseKey,
}: Props) {
  const ink = { stroke: fieldInk(INK.route) };
  if (part === "arcs") {
    return (
      <g aria-hidden="true" pointerEvents="none" className={faded ? "opacity-40" : undefined}>
        {arcs.map((a) => (
          <g key={a.hop} data-lateral={a.hop} data-from={a.from} data-target={a.target}>
            {a.run && <path data-run={a.hop} d={a.run.d} fill="none" stroke={INK.route} style={ink} strokeWidth={5} strokeLinecap="round" />}
            <path d={a.d} fill="none" stroke={INK.route} style={ink} strokeWidth={4} strokeDasharray="5 7" />
            <image
              href="/icons/football.png" x={-11} y={-11} width={22} height={22}
              transform={`translate(${a.ball.x.toFixed(1)},${a.ball.y.toFixed(1)}) rotate(${a.ball.angle.toFixed(1)})`}
            />
          </g>
        ))}
      </g>
    );
  }
  const anchorAt = (x: number): "start" | "end" | "middle" => (x < EDGE ? "start" : x > VW - EDGE ? "end" : "middle");
  const labelX = (anchor: string): number => (anchor === "start" ? -10 : anchor === "end" ? 10 : 0);
  return (
    <g className={faded ? "opacity-40" : undefined}>
      {arcs.map((a) => {
        const from = names[a.from] ?? "";
        if (!a.run) return null;
        const anchor = anchorAt(a.run.handle.x);
        return (
          <g
            key={a.hop}
            transform={`translate(${a.run.handle.x.toFixed(1)},${a.run.handle.y.toFixed(1)})`}
            role="button"
            tabIndex={0}
            aria-label={`Where ${from} pitches from, after running with the ball. Arrow keys move it; it stays behind the line.`}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            data-release={a.hop}
            onPointerDown={(e) => { onReleaseDown?.(a.hop, e); }}
            onClick={(e) => { e.stopPropagation(); }}
            onKeyDown={(e) => { onReleaseKey?.(a.hop, e); }}
            className="group cursor-grab touch-none outline-none"
            data-export="skip"
          >
            <circle r={22} fill="transparent" />
            <circle r={17} fill="none" stroke="#f2b705" style={{ stroke: FIELD.ring }} strokeWidth={4} className="opacity-0 group-focus-visible:opacity-100" />
            <g style={centred} className={shakeRelease === a.hop ? "animate-shake motion-reduce:animate-none" : undefined}>
              <circle r={9} fill="#fffdf6" stroke={INK.route} style={{ fill: FIELD.waypoint, ...ink }} strokeWidth={3} />
            </g>
            <text
              x={labelX(anchor)} y={-19} textAnchor={anchor} fontSize={15} fill={INK.route} paintOrder="stroke" stroke="#c1f0c1" strokeWidth={4} strokeLinejoin="round"
              style={{ fill: fieldInk(INK.route), stroke: FIELD.turf }} className="pointer-events-none select-none"
            >
              {from} pitches
            </text>
          </g>
        );
      })}
      {arcs.map((a) => {
        const who = names[a.target] ?? "";
        const from = names[a.from] ?? "";
        const anchor = anchorAt(a.handle.x);
        return (
          <g
            key={a.hop}
            transform={`translate(${a.handle.x.toFixed(1)},${a.handle.y.toFixed(1)})`}
            role="button"
            tabIndex={0}
            aria-label={`Where ${who} catches the lateral from ${from}. Arrow keys move it; it stays behind the line and never ahead of where ${from} lets it go.`}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
            data-catch={a.hop}
            onPointerDown={(e) => { onHandleDown?.(a.hop, e); }}
            onClick={(e) => { e.stopPropagation(); }}
            onKeyDown={(e) => { onHandleKey?.(a.hop, e); }}
            className="group cursor-grab touch-none outline-none"
            data-export="skip"
          >
            {/* a 44px target at the common phone field width, like a player's */}
            <circle r={22} fill="transparent" />
            <circle r={17} fill="none" stroke="#f2b705" style={{ stroke: FIELD.ring }} strokeWidth={4} className="opacity-0 group-focus-visible:opacity-100" />
            <g style={centred} className={shake === a.hop ? "animate-shake motion-reduce:animate-none" : undefined}>
              <rect
                x={-8} y={-8} width={16} height={16} rx={3} transform="rotate(45)"
                fill="#fffdf6" stroke={INK.route} style={{ fill: FIELD.waypoint, ...ink }} strokeWidth={3}
              />
            </g>
            <text
              x={labelX(anchor)} y={-19} textAnchor={anchor} fontSize={15} fill={INK.route} paintOrder="stroke" stroke="#c1f0c1" strokeWidth={4} strokeLinejoin="round"
              style={{ fill: fieldInk(INK.route), stroke: FIELD.turf }} className="pointer-events-none select-none"
            >
              {who} catches
            </text>
          </g>
        );
      })}
    </g>
  );
}

export const LateralLayer = memo(LateralLayerImpl);

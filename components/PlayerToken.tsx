"use client";

import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { teamFill } from "@/lib/play/geometry";
import type { Player } from "@/lib/play/types";
import { FIELD, teamPaint } from "./fieldPaint";

interface Props {
  player: Player;
  x: number;
  y: number;
  selected: boolean;
  /** dashed ring while "Man", a blitz's "Pick a player" or "Lateral" is waiting for a red player this one can answer */
  target: "man" | "blitz" | "lateral" | null;
  /** move focus to the first eligible player when target selection begins */
  focusOnTarget: boolean;
  boing: boolean;
  dragging: boolean;
  /** read-only rendering (share page): no handlers, not focusable */
  readOnly?: boolean;
  /** While drawing, taps over a token add path points rather than changing selection. */
  drawing?: boolean;
  /** the opposite team, shown as faded context on the field */
  faded?: boolean;
  /**
   * who plays this position, under the token (docs/adr/008-roster-depth-chart.md): the starter's name, or,
   * in roster mode, that nobody is down for it yet. Above the token for a player lined up at the bottom edge.
   */
  caption?: { text: string; muted?: boolean; above?: boolean } | null;
  onPointerDown: (id: string, e: PointerEvent<SVGGElement>) => void;
  onKeyDown: (id: string, e: KeyboardEvent<SVGGElement>) => void;
}

const centred = { transformBox: "fill-box", transformOrigin: "center" } as const;

function PlayerTokenImpl({
  player: p, x, y, selected, target, focusOnTarget, boing, dragging, readOnly = false, drawing = false, faded = false, caption = null, onPointerDown, onKeyDown,
}: Props) {
  const tokenRef = useRef<SVGGElement>(null);
  useEffect(() => {
    if (focusOnTarget) tokenRef.current?.focus();
  }, [focusOnTarget]);
  const ringR = selected ? 33 : target ? 31 : 0;
  return (
    <g
      ref={tokenRef}
      transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
      pointerEvents={drawing ? "none" : undefined}
      tabIndex={readOnly ? undefined : 0}
      role={readOnly ? "img" : "button"}
      aria-label={(p.team === "offense" ? "Offense " : "Defense ") + (p.label || p.id) + (target === "man" ? ", man coverage target" : target === "blitz" ? ", blitz target" : target === "lateral" ? ", can take the lateral" : "")}
      aria-description={caption && !caption.muted ? `Played by ${caption.text}` : undefined}
      aria-pressed={readOnly ? undefined : selected}
      aria-keyshortcuts={readOnly ? undefined : "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space"}
      onPointerDown={readOnly ? undefined : (e) => { onPointerDown(p.id, e); }}
      onClick={readOnly ? undefined : (e) => { e.stopPropagation(); }}
      onKeyDown={readOnly ? undefined : (e) => { onKeyDown(p.id, e); }}
      className={[
        faded ? "opacity-40" : "",
        readOnly ? "" : `group touch-none outline-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`,
      ].filter(Boolean).join(" ") || undefined}
    >
      <g style={{ ...centred, transform: selected ? "scale(1.1)" : "none" }}>
        <g style={centred} className={boing ? "animate-boing motion-reduce:animate-none" : undefined}>
          {/* 68 SVG units gives the token an approximately 44px target at the common phone field width. */}
          <circle r={34} fill="transparent" stroke="none" />
          {/* keyboard focus shows the same yellow ring as selection */}
          <circle r={33} fill="none" stroke="#f2b705" style={{ stroke: FIELD.ring }} strokeWidth={5} className="opacity-0 group-focus-visible:opacity-100" data-export="skip" />
          {ringR > 0 && (
            <circle
              r={ringR}
              fill="none"
              stroke="#f2b705"
              strokeWidth={5}
              strokeDasharray={target && !selected ? "6 6" : undefined}
              style={{ ...centred, stroke: FIELD.ring }}
              className={selected ? "motion-loop animate-pulse-ring" : undefined}
            />
          )}
          <circle r={23} fill={teamFill(p.team)} stroke="#1b1a17" style={{ fill: teamPaint(p.team), stroke: FIELD.outline }} strokeWidth={2.5} />
          {p.label && (
            <text
              y={1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={p.label.length > 2 ? 15 : 18}
              fill="#1b1a17"
              style={{ fill: FIELD.label }}
              className="pointer-events-none select-none"
            >
              {p.label}
            </text>
          )}
        </g>
      </g>
      {/* the name rides outside the selection scale, on a turf-coloured halo so it reads over a line; never in a picture */}
      {caption && (
        <text
          data-caption
          y={caption.above ? -44 : 46}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--font-hand)"
          fontSize={15}
          fill="#1b1a17"
          stroke="#c1f0c1"
          strokeWidth={4}
          strokeLinejoin="round"
          paintOrder="stroke"
          style={{ fill: FIELD.line, stroke: FIELD.turf }}
          className={`pointer-events-none select-none ${caption.muted ? "opacity-55" : ""}`}
          data-export="skip"
        >
          {caption.text}
        </text>
      )}
    </g>
  );
}

export const PlayerToken = memo(PlayerTokenImpl);

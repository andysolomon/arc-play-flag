"use client";

import { memo, useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { teamFill } from "@/lib/play/geometry";
import type { Player } from "@/lib/play/types";

interface Props {
  player: Player;
  x: number;
  y: number;
  selected: boolean;
  /** dashed ring while "Man" is waiting for a red player */
  target: boolean;
  /** move focus to the first eligible player when man-target selection begins */
  focusOnTarget: boolean;
  boing: boolean;
  dragging: boolean;
  /** read-only rendering (share page): no handlers, not focusable */
  readOnly?: boolean;
  onPointerDown: (id: string, e: PointerEvent<SVGGElement>) => void;
  onKeyDown: (id: string, e: KeyboardEvent<SVGGElement>) => void;
}

const centred = { transformBox: "fill-box", transformOrigin: "center" } as const;

function PlayerTokenImpl({ player: p, x, y, selected, target, focusOnTarget, boing, dragging, readOnly = false, onPointerDown, onKeyDown }: Props) {
  const tokenRef = useRef<SVGGElement>(null);
  useEffect(() => {
    if (focusOnTarget) tokenRef.current?.focus();
  }, [focusOnTarget]);
  const ringR = selected ? 33 : target ? 31 : 0;
  return (
    <g
      ref={tokenRef}
      transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
      tabIndex={readOnly ? undefined : 0}
      role={readOnly ? "img" : "button"}
      aria-label={(p.team === "offense" ? "Offense " : "Defense ") + (p.label || p.id) + (target ? ", man coverage target" : "")}
      aria-pressed={readOnly ? undefined : selected}
      aria-keyshortcuts={readOnly ? undefined : "ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space"}
      onPointerDown={readOnly ? undefined : (e) => { onPointerDown(p.id, e); }}
      onClick={readOnly ? undefined : (e) => { e.stopPropagation(); }}
      onKeyDown={readOnly ? undefined : (e) => { onKeyDown(p.id, e); }}
      className={readOnly ? undefined : `group touch-none outline-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      <g style={{ ...centred, transform: selected ? "scale(1.1)" : "none" }}>
        <g style={centred} className={boing ? "animate-boing motion-reduce:animate-none" : undefined}>
          {/* 68 SVG units gives the token an approximately 44px target at the common phone field width. */}
          <circle r={34} fill="transparent" stroke="none" />
          {/* keyboard focus shows the same yellow ring as selection */}
          <circle r={33} fill="none" stroke="#f2b705" strokeWidth={5} className="opacity-0 group-focus-visible:opacity-100" data-export="skip" />
          {ringR > 0 && (
            <circle
              r={ringR}
              fill="none"
              stroke="#f2b705"
              strokeWidth={5}
              strokeDasharray={target && !selected ? "6 6" : undefined}
              style={centred}
              className={selected ? "motion-loop animate-pulse-ring" : undefined}
            />
          )}
          <circle r={23} fill={teamFill(p.team)} stroke="#1b1a17" strokeWidth={2.5} />
          {p.label && (
            <text
              y={1}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={p.label.length > 2 ? 15 : 18}
              fill="#1b1a17"
              className="pointer-events-none select-none"
            >
              {p.label}
            </text>
          )}
        </g>
      </g>
    </g>
  );
}

export const PlayerToken = memo(PlayerTokenImpl);

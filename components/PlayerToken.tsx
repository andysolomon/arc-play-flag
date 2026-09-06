"use client";

import { memo, type KeyboardEvent, type PointerEvent } from "react";
import { teamFill } from "@/lib/play/geometry";
import type { Player } from "@/lib/play/types";

interface Props {
  player: Player;
  x: number;
  y: number;
  selected: boolean;
  /** dashed ring while "Man" is waiting for a red player */
  target: boolean;
  boing: boolean;
  dragging: boolean;
  onPointerDown: (id: string, e: PointerEvent<SVGGElement>) => void;
  onKeyDown: (id: string, e: KeyboardEvent<SVGGElement>) => void;
}

const centred = { transformBox: "fill-box", transformOrigin: "center" } as const;

function PlayerTokenImpl({ player: p, x, y, selected, target, boing, dragging, onPointerDown, onKeyDown }: Props) {
  const ringR = selected ? 33 : target ? 31 : 0;
  return (
    <g
      transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`}
      tabIndex={0}
      role="button"
      aria-label={(p.team === "offense" ? "Offense " : "Defense ") + (p.label || p.id)}
      aria-pressed={selected}
      onPointerDown={(e) => { onPointerDown(p.id, e); }}
      onClick={(e) => { e.stopPropagation(); }}
      onKeyDown={(e) => { onKeyDown(p.id, e); }}
      className={`group touch-none outline-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      <g style={{ ...centred, transform: selected ? "scale(1.1)" : "none" }}>
        <g style={centred} className={boing ? "animate-boing motion-reduce:animate-none" : undefined}>
          <circle r={30} fill="transparent" stroke="none" />
          {/* keyboard focus shows the same yellow ring as selection */}
          <circle r={33} fill="none" stroke="#f2b705" strokeWidth={5} className="opacity-0 group-focus-visible:opacity-100" />
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

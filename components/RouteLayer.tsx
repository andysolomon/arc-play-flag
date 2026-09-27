"use client";

import { memo } from "react";
import type { RouteGeom } from "@/lib/play/geometry";
import { FIELD, fieldInk, zoneFill } from "./fieldPaint";

interface Props {
  routes: readonly (RouteGeom & { id: string; faded?: boolean })[];
  draftD: string;
  /**
   * A clipPath id over a designed end zone, or null. Inside it every route runs in a lane of the
   * field's own turf, so its ink reads the same as anywhere else on the field whatever the design
   * under it. The lanes carry their paint in style, never in the attributes the routes are found by.
   */
  lane?: string | null;
}

const LANE = 6;

function RouteLayerImpl({ routes, draftD, lane = null }: Props) {
  const turf = { stroke: FIELD.turf, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <g>
      {routes.map((r) => (
        <g key={r.id} className={r.faded ? "opacity-40" : undefined}>
          {lane && (
            <g clipPath={`url(#${lane})`} data-lane>
              <path d={r.d} fill="none" stroke="#c1f0c1" style={turf} strokeWidth={r.width + LANE} />
              {r.arrow && <polygon points={r.arrow} fill="#c1f0c1" stroke="#c1f0c1" style={{ ...turf, fill: FIELD.turf }} strokeWidth={2.5 + LANE} />}
              {r.zone && (
                <ellipse cx={r.zone.cx} cy={r.zone.cy} rx={r.zone.rx.toFixed(1)} ry={r.zone.ry.toFixed(1)} fill="none" stroke="#c1f0c1" style={turf} strokeWidth={2.5 + LANE} />
              )}
            </g>
          )}
          <path
            d={r.d}
            fill="none"
            stroke={r.color}
            style={{ stroke: fieldInk(r.color) }}
            strokeWidth={r.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={r.dash}
            className={r.draw ? "animate-draw motion-reduce:animate-none" : undefined}
          />
          {r.arrow && (
            <polygon points={r.arrow} fill={r.color} stroke={r.color} style={{ fill: fieldInk(r.color), stroke: fieldInk(r.color) }} strokeWidth={2.5} strokeLinejoin="round" />
          )}
          {r.zone && (
            <ellipse
              cx={r.zone.cx} cy={r.zone.cy} rx={r.zone.rx.toFixed(1)} ry={r.zone.ry.toFixed(1)}
              fill={r.zone.fill} stroke={r.color} style={{ fill: zoneFill(r.color), stroke: fieldInk(r.color) }} strokeWidth={2.5} strokeDasharray="9 7"
            />
          )}
        </g>
      ))}
      {draftD && lane && (
        <path d={draftD} fill="none" stroke="#c1f0c1" style={turf} strokeWidth={3 + LANE} clipPath={`url(#${lane})`} data-lane />
      )}
      {draftD && (
        <path d={draftD} fill="none" stroke="#1b1a17" style={{ stroke: FIELD.line }} strokeWidth={3} strokeDasharray="7 7" strokeLinejoin="round" opacity={0.65} />
      )}
    </g>
  );
}

export const RouteLayer = memo(RouteLayerImpl);

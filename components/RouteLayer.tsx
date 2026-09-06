"use client";

import { memo } from "react";
import type { RouteGeom } from "@/lib/play/geometry";

interface Props {
  routes: readonly (RouteGeom & { id: string })[];
  draftD: string;
}

function RouteLayerImpl({ routes, draftD }: Props) {
  return (
    <g>
      {routes.map((r) => (
        <g key={r.id}>
          <path
            d={r.d}
            fill="none"
            stroke={r.color}
            strokeWidth={r.width}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={r.dash}
            className={r.draw ? "animate-draw motion-reduce:animate-none" : undefined}
          />
          {r.arrow && <polygon points={r.arrow} fill={r.color} />}
          {r.bar && (
            <line x1={r.bar.x1} y1={r.bar.y1} x2={r.bar.x2} y2={r.bar.y2} stroke={r.color} strokeWidth={5} strokeLinecap="round" />
          )}
          {r.zone && (
            <ellipse
              cx={r.zone.cx} cy={r.zone.cy} rx={r.zone.rx.toFixed(1)} ry={r.zone.ry.toFixed(1)}
              fill={r.zone.fill} stroke={r.color} strokeWidth={2.5} strokeDasharray="9 7"
            />
          )}
        </g>
      ))}
      {draftD && (
        <path d={draftD} fill="none" stroke="#1b1a17" strokeWidth={3} strokeDasharray="7 7" strokeLinejoin="round" opacity={0.65} />
      )}
    </g>
  );
}

export const RouteLayer = memo(RouteLayerImpl);

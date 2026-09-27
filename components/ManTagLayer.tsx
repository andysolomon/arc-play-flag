"use client";

import { memo } from "react";
import { TAG_FONT, type ManTag } from "@/lib/play/marks";
import { INK } from "@/lib/play/routes";
import { FIELD, fieldInk } from "./fieldPaint";

/**
 * The name tags man defenders wear on the live field while the receiver they cover is off
 * it: the man ink with the turf showing through the letters, the same pair every themed
 * field already keeps readable for a deep route on its turf.
 */
function ManTagLayerImpl({ tags }: { tags: readonly ManTag[] }) {
  return (
    <g aria-hidden="true" pointerEvents="none">
      {tags.map((t) => (
        <g key={t.id} data-man-tag={t.id} data-place={t.place}>
          <rect
            x={t.x.toFixed(1)} y={t.y.toFixed(1)} width={t.w.toFixed(1)} height={t.h.toFixed(1)} rx={(t.h / 2).toFixed(1)}
            fill={INK.man} style={{ fill: fieldInk(INK.man) }}
          />
          <text
            x={(t.x + t.w / 2).toFixed(1)} y={(t.y + t.h / 2 + 1).toFixed(1)} textAnchor="middle" dominantBaseline="central"
            fontSize={TAG_FONT} fill="#c1f0c1" style={{ fill: FIELD.turf }} className="select-none"
          >
            {t.text}
          </text>
        </g>
      ))}
    </g>
  );
}

export const ManTagLayer = memo(ManTagLayerImpl);

import { FIELD } from "../../fieldPaint";
import type { ArtProps } from "./shared";

/** The end zone the field has always had: flat turf, a shade deeper than the field. Only the picker draws it; the field's own band is this. */
export function ClassicArt({ w, h, label }: ArtProps) {
  return (
    <g>
      <rect width={w} height={h} fill="#a7e5a7" style={{ fill: FIELD.endzone }} />
      {label && (
        <text x={w / 2} y={h / 2 + 6} textAnchor="middle" fontFamily="var(--font-hand)" fontSize={17} letterSpacing={2.5} fill="#1b1a17" style={{ fill: FIELD.line }} fillOpacity={0.5}>
          END ZONE
        </text>
      )}
    </g>
  );
}

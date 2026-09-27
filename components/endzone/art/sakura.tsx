import type { ArtProps } from "./shared";

/** Placeholder: a flat band in the design's base colour until its art lands. */
export function SakuraArt({ w, h, label }: ArtProps) {
  return (
    <g>
      <rect width={w} height={h} fill="#fde2e4" />
      {label && (
        <text x={w / 2} y={h / 2 + 6} textAnchor="middle" fontFamily="var(--font-hand)" fontSize={17} letterSpacing={2.5} fill="#7a2e44">
          END ZONE
        </text>
      )}
    </g>
  );
}

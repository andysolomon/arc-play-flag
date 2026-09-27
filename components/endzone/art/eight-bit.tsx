import type { ArtProps } from "./shared";

/** Placeholder: a flat band in the design's base colour until its art lands. */
export function EightBitArt({ w, h, label }: ArtProps) {
  return (
    <g>
      <rect width={w} height={h} fill="#5c94fc" />
      {label && (
        <text x={w / 2} y={h / 2 + 6} textAnchor="middle" fontFamily="var(--font-hand)" fontSize={17} letterSpacing={2.5} fill="#fcfcfc">
          END ZONE
        </text>
      )}
    </g>
  );
}

import { inkOn, type ArtProps } from "./shared";

/** Placeholder: the team's colour, its name across it, until the art lands. */
export function HomeArt({ w, h, label, team }: ArtProps) {
  return (
    <g>
      <rect width={w} height={h} fill={team.color} />
      {label && (
        <text x={w / 2} y={h / 2 + 6} textAnchor="middle" fontFamily="var(--font-hand)" fontSize={17} letterSpacing={2.5} fill={inkOn(team.color)}>
          {team.name.trim().toUpperCase() || "HOME"}
        </text>
      )}
    </g>
  );
}

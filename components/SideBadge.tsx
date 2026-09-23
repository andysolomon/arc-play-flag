import type { Team } from "@/lib/play/types";

const LABEL: Record<Team, string> = { offense: "Offense", defense: "Defense" };
const DOT: Record<Team, string> = { offense: "bg-offense", defense: "bg-defense" };

/** Which side of the ball a saved play is for: a dot in that team's colour and the word. */
export function SideBadge({ side, className = "" }: { side: Team; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 self-start text-caption text-ink-muted ${className}`}>
      <span aria-hidden className={`block h-3.5 w-3.5 shrink-0 rounded-full border-2 border-ink ${DOT[side]}`} />
      {LABEL[side]}
    </span>
  );
}

import Image from "next/image";
import type { Team } from "@/lib/play/types";

const LABEL: Record<Team, string> = { offense: "Offense", defense: "Defense" };

/** Which side of the ball a saved play is for, as a small sticker and word. */
export function SideBadge({ side, className = "" }: { side: Team; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 self-start text-caption text-ink-muted ${className}`}>
      <Image src={`/icons/${side}.png`} alt="" width={16} height={16} sizes="16px" className="block shrink-0" />
      {LABEL[side]}
    </span>
  );
}

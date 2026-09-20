"use client";

import { memo, useMemo } from "react";
import type { Player, Team } from "@/lib/play/types";
import { playArt } from "@/lib/render/play-svg";

interface Props {
  players: readonly Player[];
  name: string;
  /** the play's own side: the other team is left off playbook pictures */
  side: Team;
  className?: string;
}

/** A small static picture of a play, drawn from the same geometry as the field. */
function PlayThumbImpl({ players, name, side, className = "" }: Props) {
  const art = useMemo(() => playArt(players, { showYardNumbers: false, show: side }), [players, side]);
  return (
    <svg
      viewBox={art.viewBox}
      role="img"
      aria-label={name}
      className={`block h-auto w-full rounded-field border-2 border-ink bg-turf ${className}`}
      dangerouslySetInnerHTML={{ __html: art.body }}
    />
  );
}

export const PlayThumb = memo(PlayThumbImpl);

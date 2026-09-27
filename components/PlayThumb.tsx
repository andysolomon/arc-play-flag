"use client";

import { memo, useMemo, useSyncExternalStore } from "react";
import { getServerTeam, getTeam, subscribe } from "@/lib/play/library";
import { hasNoRunZones } from "@/lib/play/storage";
import type { Player, Team } from "@/lib/play/types";
import { playArt } from "@/lib/render/play-svg";

interface Props {
  players: readonly Player[];
  name: string;
  /** the play's own side: the other team is left off playbook pictures */
  side: Team;
  /** where the play's ball is (SavedPlay.los); undefined is the own 5. Never optional, so no picture falls back to the 5 by accident */
  los: number | undefined;
  className?: string;
}

/** A small static picture of a play, drawn from the same geometry as the field. */
function PlayThumbImpl({ players, name, side, los, className = "" }: Props) {
  const noRunZones = hasNoRunZones(useSyncExternalStore(subscribe, getTeam, getServerTeam));
  const art = useMemo(() => playArt(players, { showYardNumbers: false, noRunZones, los, show: side }), [players, side, noRunZones, los]);
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

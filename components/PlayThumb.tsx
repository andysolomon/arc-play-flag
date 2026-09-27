"use client";

import { memo, useMemo, useSyncExternalStore } from "react";
import { getServerTeam, getTeam, subscribe } from "@/lib/play/library";
import { COVERAGE_WORDS, coverageOf } from "@/lib/play/coverage";
import { hasNoRunZones } from "@/lib/play/storage";
import type { Player, Team } from "@/lib/play/types";
import { playArt } from "@/lib/render/play-svg";

interface Props {
  players: readonly Player[];
  name: string;
  /** the play's own side: the other team is left off playbook pictures, unless the play includes it */
  side: Team;
  /** the play draws the other team, faded, on its pictures */
  artShadow?: boolean;
  className?: string;
}

/** A small static picture of a play, drawn from the same geometry as the field. */
function PlayThumbImpl({ players, name, side, artShadow = false, className = "" }: Props) {
  const noRunZones = hasNoRunZones(useSyncExternalStore(subscribe, getTeam, getServerTeam));
  const art = useMemo(
    () => playArt(players, { showYardNumbers: false, noRunZones, show: artShadow ? "both" : side, side }),
    [players, side, artShadow, noRunZones],
  );
  // what the stamp and the fade show, in words, for a named picture
  const cover = side === "defense" ? coverageOf(players) : null;
  const label = !name ? name : [
    name,
    cover ? `${COVERAGE_WORDS[cover]} coverage` : null,
    artShadow ? `the ${side === "defense" ? "offense" : "defense"} faded` : null,
  ].filter(Boolean).join(", ");
  return (
    <svg
      viewBox={art.viewBox}
      role="img"
      aria-label={label}
      className={`block h-auto w-full rounded-field border-2 border-ink bg-turf ${className}`}
      dangerouslySetInnerHTML={{ __html: art.body }}
    />
  );
}

export const PlayThumb = memo(PlayThumbImpl);

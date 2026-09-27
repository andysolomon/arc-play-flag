"use client";

import { memo, useSyncExternalStore, type ComponentType } from "react";
import type { EndZoneId } from "@/lib/endzone";
import { getServerTeam, getTeam, subscribe } from "@/lib/play/library";
import { ClassicArt } from "./art/classic";
import { EightBitArt } from "./art/eight-bit";
import { EventHorizonArt } from "./art/event-horizon";
import { GreatWaveArt } from "./art/great-wave";
import { HomeArt } from "./art/home";
import { MatrixArt } from "./art/matrix";
import { SakuraArt } from "./art/sakura";
import type { ArtProps } from "./art/shared";
import { SynthwaveArt } from "./art/synthwave";

/** One design per end zone in lib/endzone.ts. */
const ART: Readonly<Record<EndZoneId, ComponentType<ArtProps>>> = {
  classic: ClassicArt,
  home: HomeArt,
  synthwave: SynthwaveArt,
  sakura: SakuraArt,
  matrix: MatrixArt,
  "great-wave": GreatWaveArt,
  "eight-bit": EightBitArt,
  "event-horizon": EventHorizonArt,
};

interface Props {
  id: EndZoneId;
  w: number;
  h: number;
  label: boolean;
  celebrate: boolean;
  /** hold every animation still, as a picker swatch does */
  still?: boolean;
}

/** An end zone's design, in the box (0, 0)–(w, h). The caller clips it and keeps it off print and exports. */
function EndZoneArtImpl({ id, w, h, label, celebrate, still = false }: Props) {
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const Art = ART[id];
  return (
    <g data-ez-art={id} className={still ? "ez-still" : undefined}>
      <Art w={w} h={h} label={label} celebrate={celebrate} team={team} />
    </g>
  );
}

export const EndZoneArt = memo(EndZoneArtImpl);

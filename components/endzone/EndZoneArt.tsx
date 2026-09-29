"use client";

import { lazy, memo, Suspense, useSyncExternalStore, type ComponentType } from "react";
import type { EndZoneId } from "@/lib/endzone";
import { getServerTeam, getTeam, subscribe } from "@/lib/play/library";
import { ClassicArt } from "./art/classic";
import type { ArtProps } from "./art/shared";

/**
 * One design per end zone in lib/endzone.ts. Classic is the band the field has always drawn and
 * comes with the app; each of the others is a chunk of its own, fetched the first time it is
 * drawn (a pick, or the picker coming into view), so none of them weighs on the app's first
 * load. They are part of the offline shell all the same: lib/offline/sw.js reads the chunks a
 * script imports on demand out of the script itself.
 */
const ART: Readonly<Record<EndZoneId, ComponentType<ArtProps>>> = {
  classic: ClassicArt,
  home: lazy(() => import("./art/home").then((m) => ({ default: m.HomeArt }))),
  synthwave: lazy(() => import("./art/synthwave").then((m) => ({ default: m.SynthwaveArt }))),
  sakura: lazy(() => import("./art/sakura").then((m) => ({ default: m.SakuraArt }))),
  matrix: lazy(() => import("./art/matrix").then((m) => ({ default: m.MatrixArt }))),
  "great-wave": lazy(() => import("./art/great-wave").then((m) => ({ default: m.GreatWaveArt }))),
  "eight-bit": lazy(() => import("./art/eight-bit").then((m) => ({ default: m.EightBitArt }))),
  "event-horizon": lazy(() => import("./art/event-horizon").then((m) => ({ default: m.EventHorizonArt }))),
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

/**
 * An end zone's design, in the box (0, 0)–(w, h). The caller clips it and keeps it off print and
 * exports. Until a design's chunk has arrived the box is empty, and the classic band shows through.
 */
function EndZoneArtImpl({ id, w, h, label, celebrate, still = false }: Props) {
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const Art = ART[id];
  return (
    <g data-ez-art={id} className={still ? "ez-still" : undefined}>
      <Suspense fallback={null}>
        <Art w={w} h={h} label={label} celebrate={celebrate} team={team} />
      </Suspense>
    </g>
  );
}

export const EndZoneArt = memo(EndZoneArtImpl);

"use client";

import { useId, useSyncExternalStore } from "react";
import {
  END_ZONES, getEndZone, getTouchdowns, isUnlocked, nextLocked, serverEndZone, serverTouchdowns, setEndZone, subscribeEndZone,
  subscribeTouchdowns,
} from "@/lib/endzone";
import { Lock } from "../ThemePicker";
import { segmentInput, swatch } from "../ui";
import { EndZoneArt } from "./EndZoneArt";

/** A swatch's preview box, in the design's own units: wider than tall, like the band it previews. */
const PREVIEW_W = 300;
const PREVIEW_H = 84;

/**
 * The end zone's look, kept on this device. Some are open from the start; every touchdown pass
 * thrown on ▶ opens the next, and the swatch says how many touchdowns each one needs. An end
 * zone already in use stays checked and drawn even if the count is later lost.
 */
export function EndZonePicker({ className = "" }: { className?: string }) {
  const name = useId();
  const hint = useId();
  const choice = useSyncExternalStore(subscribeEndZone, getEndZone, serverEndZone);
  const touchdowns = useSyncExternalStore(subscribeTouchdowns, getTouchdowns, serverTouchdowns);
  const open = END_ZONES.filter((z) => isUnlocked(z, touchdowns)).length;
  const next = nextLocked(touchdowns);
  const scored = touchdowns === 1 ? "1 touchdown pass" : `${String(touchdowns)} touchdown passes`;
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div role="radiogroup" aria-label="End zone" className="grid grid-cols-2 gap-2">
        {END_ZONES.map((z) => {
          const locked = !isUnlocked(z, touchdowns) && choice !== z.id;
          const needs = z.unlock === 1 ? "1 touchdown pass" : `${String(z.unlock)} touchdown passes`;
          return (
            <label key={z.id} title={locked ? `${z.blurb}. Opens at ${needs}.` : z.blurb} className={swatch}>
              <input
                type="radio" name={name} value={z.id} checked={choice === z.id} disabled={locked}
                aria-describedby={locked ? hint : undefined}
                onChange={() => { setEndZone(z.id); }}
                className={`${segmentInput} disabled:cursor-not-allowed`}
              />
              <svg aria-hidden viewBox={`0 0 ${String(PREVIEW_W)} ${String(PREVIEW_H)}`} className="block h-auto w-full">
                <EndZoneArt id={z.id} w={PREVIEW_W} h={PREVIEW_H} label celebrate={false} still />
              </svg>
              <span className="flex items-center gap-1 border-t-2 border-divider bg-cream px-2 pb-1.5 pt-1 text-small leading-tight text-ink">
                <span className="truncate">{z.name}</span>
                {choice === z.id && <span aria-hidden className="ml-auto">✓</span>}
                {locked && (
                  <span aria-hidden className="ml-auto inline-flex flex-none items-center gap-0.5 text-caption text-ink-muted">
                    <Lock />{z.unlock}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
      <span id={hint} className="text-caption leading-note text-ink-muted">
        {next
          ? `${String(open)} of ${String(END_ZONES.length)} open. Throw a touchdown pass on ▶ to open ${next.name}: a catch in the end zone, or one carried in.`
          : `All ${String(END_ZONES.length)} open.`}
        {touchdowns > 0 && ` ${scored} on this device.`}
        {" "}It sits past the 40, at the top of a full-length field. Printed pages and exports keep the classic green.
      </span>
    </div>
  );
}

"use client";

import { useId, useSyncExternalStore } from "react";
import {
  END_ZONES, getEndZone, getTouchdowns, isUnlocked, nextLocked, serverEndZone, serverTouchdowns, setEndZone, subscribeEndZone,
  subscribeTouchdowns,
} from "@/lib/endzone";
import { Lock } from "../ThemePicker";
import { segmentInput, swatch } from "../ui";
import { EndZoneArt } from "./EndZoneArt";

/** The tick on the chosen swatch, or the lock and its count on a locked one, in the preview's corner. */
const chip = "absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-pill border-2 border-ink bg-cream px-1 text-caption leading-tight text-ink";

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
                aria-describedby={locked ? `${hint}-${z.id} ${hint}` : undefined}
                onChange={() => { setEndZone(z.id); }}
                className={`${segmentInput} disabled:cursor-not-allowed`}
              />
              {/* one string, so a screen reader hears "Opens at 5 touchdown passes." whole */}
              {locked && <span id={`${hint}-${z.id}`} hidden>{`Opens at ${needs}.`}</span>}
              {/* the tick or the lock sits on the preview, leaving the name its whole row; taps pass through to the radio */}
              <span className="pointer-events-none relative block">
                <svg aria-hidden viewBox={`0 0 ${String(PREVIEW_W)} ${String(PREVIEW_H)}`} className="block h-auto w-full">
                  <EndZoneArt id={z.id} w={PREVIEW_W} h={PREVIEW_H} label celebrate={false} still />
                </svg>
                {(locked || choice === z.id) && (
                  <span aria-hidden className={chip}>
                    {locked ? <><Lock /><span data-lock>{z.unlock}</span></> : "✓"}
                  </span>
                )}
              </span>
              <span className="truncate border-t-2 border-divider bg-cream px-2 pb-1.5 pt-1 text-small leading-tight text-ink">{z.name}</span>
            </label>
          );
        })}
      </div>
      <span id={hint} className="text-caption leading-note text-ink-muted">
        {next
          ? `${String(open)} of ${String(END_ZONES.length)} open. Throw a touchdown pass on ▶ to open ${next.name}: a catch in the end zone, or one carried in.`
          : `All ${String(END_ZONES.length)} open.`}
        {touchdowns > 0 && ` ${scored} on this device.`}
        {" It comes into view with the ball near their goal (Line of scrimmage). Printed pages and exports keep the classic green."}
      </span>
    </div>
  );
}

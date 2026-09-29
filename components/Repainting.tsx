"use client";

import { createPortal } from "react-dom";
import { useSyncExternalStore } from "react";
import { getRepaint, serverRepaint, subscribeRepaint } from "@/lib/repaint";

/**
 * What a picker shows as picked: its pick from the tap on, while the switch is under way,
 * and the stored choice (`settled`) the rest of the time.
 */
export function usePicked<T extends string>(picker: string, settled: T): T {
  const pick = useSyncExternalStore(subscribeRepaint, getRepaint, serverRepaint);
  return pick?.picker === picker ? (pick.value as T) : settled;
}

/**
 * The interstitial lib/repaint.ts puts up while a theme, an end zone or the themed field is being
 * switched: a scrim over the page, so a tap can't land mid-switch, and a card with a spinner.
 * The scrim fades in after a beat, so a quick switch barely shows it; the fade and the spinner
 * are transform and opacity only, so they keep moving while the page itself is busy redrawing.
 * Drawn inside an open modal dialog (playbook settings) when there is one, or it would sit under it.
 */
export function Repainting() {
  const pick = useSyncExternalStore(subscribeRepaint, getRepaint, serverRepaint);
  if (pick === null) return null;
  const host = document.querySelector("dialog:modal") ?? document.body;
  return createPortal(
    <div data-repainting className="fixed inset-0 z-[60] flex items-center justify-center bg-scrim p-3 animate-repaint-in print:hidden">
      {/* a <p>: e2e/support/designer.ts finds the toast as the one div[role=status] */}
      <p role="status" className="m-0 flex max-w-full items-center gap-3 rounded-tile border-2 border-ink bg-cream px-4 py-3 text-base leading-tight text-ink shadow-toast">
        <span aria-hidden className="h-6 w-6 flex-none animate-spin rounded-full border-[3px] border-ink-faint border-t-ink motion-reduce:animate-none" />
        <span className="min-w-0">Switching to {pick.what}…</span>
      </p>
    </div>,
    host,
  );
}

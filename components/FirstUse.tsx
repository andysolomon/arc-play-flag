"use client";

import { pill } from "./ui";

export const FIRST_USE_KEY = "ffpd.first-use.v1";

interface Props {
  onDismiss: () => void;
  onExample: () => void;
}

/** A compact field overlay: enough direction to make the first route, never a wizard. */
export function FirstUse({ onDismiss, onExample }: Props) {
  return (
    <section
      aria-label="Getting started"
      className="pointer-events-none absolute left-1/2 top-2 z-20 flex w-[calc(100%-16px)] max-w-[590px] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-tile border-2 border-ink bg-cream px-2.5 py-2 shadow-toast"
    >
      <p className="m-0 min-w-[110px] flex-1 text-center text-small leading-body sm:text-left">
        <span className="max-[479px]:hidden">Your first play: </span>
        Tap a player → pick a route → press ▶
      </p>
      <button type="button" onClick={onExample} className={`${pill} pointer-events-auto min-h-10 px-3 py-1 text-small`}>
        Try an example
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss getting started"
        title="Dismiss"
        className={`${pill} pointer-events-auto min-h-10 min-w-10 px-2 py-1 text-base`}
      >
        ×
      </button>
    </section>
  );
}

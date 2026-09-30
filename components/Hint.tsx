"use client";

import { useLayoutEffect, useState } from "react";

/** The gap between the toast and whatever it sits under. */
const GAP = 6;

/**
 * Ink pill that floats centred under the header with a one-line instruction. Given `below`, the
 * id of an element on the page (the designer's play name), it sits just under that instead, so a
 * "Saved" never covers the name it is about.
 */
export function Hint({ text, below }: { text: string | null; below?: string }) {
  const [top, setTop] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!text || !below) return;
    const place = () => {
      const el = document.getElementById(below);
      const r = el?.getBoundingClientRect();
      setTop(r && r.height > 0 ? Math.round(r.bottom + GAP) : null);
    };
    place();
    // the name moves when a sidebar opens or folds beside the field, and the field resizes with it
    const el = document.getElementById(below);
    const ro = new ResizeObserver(place);
    if (el) ro.observe(el);
    window.addEventListener("resize", place);
    return () => { ro.disconnect(); window.removeEventListener("resize", place); };
  }, [text, below]);
  if (!text) return null;
  return (
    <div
      role="status"
      style={below && top !== null ? { top } : undefined}
      className="pointer-events-none fixed left-1/2 top-[58px] z-[15] max-w-[calc(100%-24px)] -translate-x-1/2 truncate rounded-pill bg-ink px-4 py-1.5 text-base text-cream shadow-toast"
    >
      {text}
    </div>
  );
}

/** Yellow sticky note used for the same hint inside the Routes panel. */
export function Note({ text }: { text: string }) {
  return (
    <span className="flex-none rounded-note border-2 border-ink bg-yellow on-yellow px-[10px] py-1.5 text-base leading-note">{text}</span>
  );
}

import type { ReactNode } from "react";

/**
 * The one way to keep part of the field off paper: a handle, a focus ring, a roster name, the
 * playback ball. Print hides whatever this wraps, so a printout never carries an editing mark or a
 * name the coach did not mean to hand out (2cc67f7).
 */
export function ScreenOnly({ children }: { children: ReactNode }) {
  return <g className="print:hidden">{children}</g>;
}

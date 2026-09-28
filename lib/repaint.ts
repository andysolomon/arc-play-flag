/**
 * A pick that redraws the whole page (a theme, an end zone, the themed field) can hold the main
 * thread for a moment, long enough on a phone for the tap to look ignored. repaint() puts up the
 * "Switching to …" interstitial (components/Repainting.tsx) first, makes the change once that has
 * been painted, and takes it down once the new look has been. Picks made while one is on screen
 * (arrow keys along a picker) replace the one still waiting: the last pick is the one made. The
 * picker shows its pick as made from the tap on (getRepaint), so it never reads as unchecked.
 */

export interface Repaint {
  /** which picker it came from: "theme", "field" or "end-zone" */
  readonly picker: string;
  /** the value picked there */
  readonly value: string;
  /** what the interstitial names, as in "Switching to Tokyo Night…" */
  readonly what: string;
}

let current: Repaint | null = null;
let pending: (() => void) | null = null;
const listeners = new Set<() => void>();

const notify = (): void => { listeners.forEach((l) => { l(); }); };

/** After the next frame has been drawn, or soon anyway if the tab is hidden and frames have stopped. */
function afterFrame(run: () => void): void {
  let done = false;
  const go = (): void => {
    if (done) return;
    done = true;
    run();
  };
  requestAnimationFrame(() => { setTimeout(go); });
  setTimeout(go, 250);
}

function cycle(): void {
  // the interstitial is committed before the first frame and on screen after it
  afterFrame(() => {
    const apply = pending;
    pending = null;
    apply?.();
    afterFrame(() => {
      if (pending) {
        cycle();
        return;
      }
      current = null;
      notify();
    });
  });
}

/** Shows the pick on the interstitial, then runs `apply`, the change itself. */
export function repaint(pick: Repaint, apply: () => void): void {
  const idle = current === null;
  current = pick;
  pending = apply;
  notify();
  if (idle) cycle();
}

/** For useSyncExternalStore: the pick being switched to, or null while nothing is. */
export const getRepaint = (): Repaint | null => current;
export const serverRepaint = (): Repaint | null => null;
export function subscribeRepaint(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

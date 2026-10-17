/**
 * Where the board puts the ball (docs/adr/014-line-of-scrimmage-setting.md): one of the four spots
 * of lib/play/field.ts, chosen in Play tools. It is the board's, not a play's: a new play, a play
 * opened from a book or a link, a switch of playbook and a restored draft are all drawn from here,
 * and a play is saved from here (its stored spot is where it was last drawn, so pictures and
 * printouts keep each play's own field). Kept on the device and, signed in, in the coach's account
 * with the rest of their look (ADR 013). Ways this could go wrong, written down before the code:
 *
 * - L1 junk in storage (a word, a yard line the picker no longer offers): read as the nearest of the
 *   four spots, as a stored play's spot is (readLos).
 * - L2 storage is blocked (a private window): the choice holds for the visit, in memory.
 * - L3 the drive start is the default and leaves no key behind, so a device that never chose reads
 *   the same as one that chose the 40.
 * - L4 another tab moves the ball: this tab follows, through the storage event, as it does for a theme.
 * - L5 opening a play stored from the 5 while the board is on the 40: the board stays on the 40, and
 *   the play's stored spot stands until it is saved again from the board.
 */
import { deviceWritten } from "@/lib/device-writes";
import { LOS_YARD, readLos } from "@/lib/play/field";

export const LOS_KEY = "ffpd.los.v1";

const listeners = new Set<() => void>();
// storage can be blocked (private mode, site data off); the choice then lasts until the page closes (L2)
let unsaved: number | null = null;

/** The board's spot, as stored (L1, L3). */
export function getLosChoice(): number {
  if (unsaved !== null) return unsaved;
  try {
    const raw = localStorage.getItem(LOS_KEY);
    return raw === null ? LOS_YARD : readLos(Number(raw));
  } catch {
    return LOS_YARD;
  }
}

/** The server draws every board from the drive start; a device that chose otherwise redraws once it has read so. */
export const serverLosChoice = (): number => LOS_YARD;

/** Puts the ball on a spot for every play on this board; the drive start forgets the key (L3). */
export function setLosChoice(los: number): void {
  const spot = readLos(los);
  try {
    if (spot === LOS_YARD) localStorage.removeItem(LOS_KEY);
    else localStorage.setItem(LOS_KEY, String(spot));
    unsaved = null;
  } catch {
    unsaved = spot;
  }
  listeners.forEach((l) => { l(); });
  deviceWritten();
}

/** For useSyncExternalStore: this tab's choices and other tabs' (L4). */
export function subscribeLosChoice(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent): void => { if (e.key === LOS_KEY || e.key === null) onChange(); };
  listeners.add(onChange);
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    removeEventListener("storage", onStorage);
  };
}

/**
 * Deep field, chosen per device. The designer's card normally shows as much field as the pane's
 * shape gives and the play needs, which on a laptop is 16 yards past the line of scrimmage; with
 * Deep field on it shows as far downfield as the card goes (to the end line when that comes first).
 * It is a way of looking at the field, never part of a play: no draft, save, link or picture holds it.
 */
export const DEEP_FIELD_KEY = "ffpd.deepfield.v1";

const listeners = new Set<() => void>();
// storage can be blocked (private mode, site data off); the choice then lasts until the page closes
let unsaved: boolean | null = null;

export function getDeepField(): boolean {
  if (unsaved !== null) return unsaved;
  try { return localStorage.getItem(DEEP_FIELD_KEY) === "on"; } catch { return false; }
}

/** The server draws the fitted field; a device that chose Deep field redraws once it has read so. */
export const serverDeepField = (): boolean => false;

/** Keeps the choice on this device; off forgets it. */
export function setDeepField(on: boolean): void {
  try {
    if (on) localStorage.setItem(DEEP_FIELD_KEY, "on");
    else localStorage.removeItem(DEEP_FIELD_KEY);
    unsaved = null;
  } catch {
    unsaved = on;
  }
  listeners.forEach((l) => { l(); });
}

/** For useSyncExternalStore: this tab's choices and other tabs'. */
export function subscribeDeepField(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent): void => { if (e.key === DEEP_FIELD_KEY || e.key === null) onChange(); };
  listeners.add(onChange);
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    removeEventListener("storage", onStorage);
  };
}

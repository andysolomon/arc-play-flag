/**
 * Every write a screen makes to the device outside the library (lib/play/library.ts), announced:
 * the draft on the chalkboard, the reader's place, a share link kept, a theme, field, end zone or
 * Deep field picked, a touchdown counted, the getting-started guide dismissed. The account engine
 * (lib/account/sync.ts) listens, so each of them goes up to the account like a save does
 * (docs/adr/014-whole-desk-in-account.md). Nothing here throws, and nothing here depends on
 * anything, so any module can announce without a cycle.
 */
const listeners = new Set<() => void>();

/** A write landed on the device. Listeners run at once; one that throws doesn't stop the others. */
export function deviceWritten(): void {
  for (const cb of listeners) {
    try { cb(); } catch { /* a listener's failure is its own */ }
  }
}

export function subscribeDeviceWrites(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

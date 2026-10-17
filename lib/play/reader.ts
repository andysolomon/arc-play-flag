import { deviceWritten } from "@/lib/device-writes";
import type { Numbered } from "@/lib/export/numbered";

/**
 * The game-day reader's place in a book, its search and its memory (issue #111). The place is the
 * play's number in the book, the number its wristbands and printouts give it, so a coach who hears
 * "seven" types 7. It lives in the address, so Back from the designer and a reload come back to it.
 */

/** The play to show for the address's `read`: the first when it is missing or junk, never past the last. */
export function readAt(raw: string | null, count: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, Math.max(count, 1));
}

/** The reader's address for a book, open on play `n`. */
export function readerHref(bookId: string, n: number): string {
  return `/playbooks?book=${encodeURIComponent(bookId)}&read=${String(n)}`;
}

/**
 * The calls a search finds, best first: the play with that number, then every play whose name or
 * notes hold the words, in book order. A code a coach puts in a name ("O07") is found the same way.
 */
export function findCalls(items: readonly Numbered[], query: string, limit = 8): Numbered[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  const byNumber = /^\d+$/.test(q) ? items.filter((it) => it.n === Number(q)) : [];
  const byWords = items.filter((it) => !byNumber.includes(it) && `${it.play.name}\n${it.play.notes}`.toLocaleLowerCase().includes(q));
  return [...byNumber, ...byWords].slice(0, limit);
}

/**
 * Where each book was last read on this device, so the reader opens there again; signed in, kept in
 * the account with the team, so another device opens there too (docs/adr/014-whole-desk-in-account.md).
 * A convenience: never a reason to fail.
 */
export const READER_KEY = "ffpd.reader.v1";
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
/** Books a reader can remember a place in, at most: as many as a team may hold. */
export const MAX_PLACES = 1_000;

/** The places from any JSON-ish value: a whole number from 1 under each book id that is one, and nothing else. */
export function parsePlaces(raw: unknown): Record<string, number> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, number> = {};
  for (const [id, n] of Object.entries(raw as Record<string, unknown>).slice(0, MAX_PLACES)) {
    if (UNSAFE.has(id) || !id || typeof n !== "number" || !Number.isInteger(n) || n < 1) continue;
    out[id] = n;
  }
  return out;
}

/** Every book's place on this device. */
export function readPlaces(): Record<string, number> {
  try {
    return parsePlaces(JSON.parse(localStorage.getItem(READER_KEY) ?? "{}"));
  } catch {
    return {};
  }
}

/** The play this book was last read on, or the first. */
export function lastRead(bookId: string): number {
  return readPlaces()[bookId] ?? 1;
}

export function rememberRead(bookId: string, n: number): void {
  if (UNSAFE.has(bookId)) return;
  try {
    localStorage.setItem(READER_KEY, JSON.stringify({ ...readPlaces(), [bookId]: n }));
  } catch {
    /* a full or blocked storage only costs the reader its memory */
  }
  deviceWritten();
}

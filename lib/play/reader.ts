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

/** Where each book was last read on this device, so the reader opens there again. A convenience: never a reason to fail. */
const KEY = "ffpd.reader.v1";
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

function places(): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** The play this book was last read on, or the first. */
export function lastRead(bookId: string): number {
  const n = UNSAFE.has(bookId) ? undefined : places()[bookId];
  return typeof n === "number" && Number.isInteger(n) && n >= 1 ? n : 1;
}

export function rememberRead(bookId: string, n: number): void {
  if (UNSAFE.has(bookId)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...places(), [bookId]: n }));
  } catch {
    /* a full or blocked storage only costs the reader its memory */
  }
}

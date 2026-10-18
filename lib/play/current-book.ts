/**
 * The playbook the designer is working in on this device (docs/adr/009-playbook-switcher.md): the
 * one the play name's list draws its plays from, and the one marked in the Playbooks tile's menu.
 * A convenience kept beside the library, like the game-day reader's place: never a reason to fail,
 * never in a backup or a file. Ways this could go wrong, written down before the code:
 *
 * - C1 the stored id names a playbook that was deleted: it reads as none, and the first playbook
 *   on the device stands in (lib/play/library.ts, getCurrentBookId).
 * - C2 junk in storage (not a string, not JSON) reads as none.
 * - C3 storage is blocked (a private window, a full quota): the pick holds for the visit, in
 *   memory, and the write is never reported as a failure. A later write to the books (a play
 *   added, a book renamed) must not drop it back to the stored pick (lib/play/library.ts, pickedId).
 * - C4 a primary that names a play off the book is dropped on write and on read; the first play
 *   stands in (lib/play/storage.ts, normalizePlaybook and settleBook).
 * - C5 a primary whose play is gone from the library while its id is still in the book: the first
 *   play in the book that exists stands in (lib/play/library.ts, primaryPlay).
 * - C6 the primary play is taken out of its book, or deleted: the first play left takes over; an
 *   empty book has no primary, and a switch to it clears the board.
 * - C7 a book from before the choice reads with no primary and its first play stands in; the next
 *   write stores that, so the first play added stays primary through a reorder from then on.
 * - C8 a playbook file or device backup from before the choice imports or restores unchanged: no
 *   primary is made up on read, so a backup still reads back exactly as stored.
 * - C9 the primary travels in a playbook file and, when its play comes onto the other device as a
 *   copy under a new id, follows the copy (lib/export/playbook-file.ts, planImport). A file whose
 *   book differs here only in its primary is not taken as already here and dropped: it lands as a copy.
 * - C10 a switch to the book whose primary is already open leaves the board as it is, its undo
 *   history included; picking the current nonempty book from another play opens its primary.
 *   Picking the current empty book leaves its draft alone.
 */
const KEY = "ffpd.current-book.v1";
const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);

/** The id picked on this device, or null for none (never picked, junk, or storage blocked). */
export function readCurrentBook(): string | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return typeof v === "string" && v && !UNSAFE.has(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeCurrentBook(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(id));
  } catch {
    /* a full or blocked storage only costs the pick its memory past this visit (C3) */
  }
}

export const CURRENT_BOOK_KEY = KEY;

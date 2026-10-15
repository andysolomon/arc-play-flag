# ADR 008: a playbook switcher in the designer

Status: implemented. It adds to the playbooks of [ADR 001](001-short-playbook-links.md) and [ADR 002](002-playbook-slides.md) without changing what a playbook is on paper: a named, ordered list of plays, numbered by that order on every export.

## Why

A coach with two or three books (the offense, the defense, a scout team's looks) moved between them by leaving the designer for `/playbooks`, finding the book, finding the play, and opening it. Every change of play meant that trip. And a play drawn in the designer had no idea which book it belonged to, so the sidebar could not offer the plays around it.

This change gives the designer a **current playbook**: the play name drops that book's plays down beside it, and the Playbooks tile drops every playbook down, so a coach switches books and plays without leaving the field.

## Rules

1. The designer has one **current playbook** on each device: the one last picked there, while it still exists, else the first playbook on the device, else none. It is a convenience kept beside the library (`ffpd.current-book.v1`), never in a backup or a file: a blocked storage costs it only its memory past the visit.
2. Every playbook has a **primary play**: one of its plays, the one the designer opens on a switch to that book. **The first play added to a book is its primary** until the coach makes another one primary, in the book (**Make primary** on its card). A reorder leaves it. Taking the primary out of the book, or deleting that play, hands the choice to the first play left; an empty book has none.
3. **Switching books** opens the new book's primary play, whole, as **Open** from the gallery does. A book with no primary (an empty one) **clears the board**: a fresh, unsaved play on the default formation, on the side the coach was drawing. A switch to the book whose primary is already on the board leaves the board as it is, undo history included, and picking the book already current changes nothing.
4. **Opening a play from inside a book** (Open in designer, from a card or the play modal) makes that book the current one, so the list beside the play name shows its neighbours.
5. The play name's list numbers the plays as the book does, marks the primary, and checks the play on the board. A saved play that isn't in the book can be added to it from there; an unsaved one is told to save first.

## Data model

```ts
interface Playbook { id: string; name: string; plays: string[]; primary?: string }
```

- `primary` is one of `plays`, stored once the book has a play. Storage drops a primary that names a play off the book (on read and on write) and the first play stands in, so no book ever has an invalid one. A book written without a primary keeps the one it had or, for a book from before this change, takes the first play it had before the write: so the first play added stays primary through a reorder from then on.
- A book from before this change reads with no primary and its first play stands in. **No primary is made up on read**, so a playbook file or a device backup from before this change imports or restores byte for byte as it was written, and a backup still reads back exactly as stored.
- The primary travels in a playbook file and, when its play comes onto another device as a copy under a new id, follows the copy.

`lib/play/current-book.ts` writes down the ways this could fail before the code (C1–C10): a deleted current book, junk in storage, a blocked storage, a primary off the book or gone from the library, the primary taken out, books and files from before the change, and a switch to the book already open.

## In the designer

- The **play name** keeps its text box and gains a chevron that drops the current book's plays down: `n. Name`, the primary wearing a **Primary** chip, the play on the board checked. The arrow keys, Home and End walk the rows, Enter or a tap opens one, Escape closes the list and gives focus back. With no playbook on the device the list says so and leads to **All playbooks ›**.
- The **Playbooks** tile drops every playbook down with its play count, the current one checked; a tap switches. **Edit “<current>” ›** and **All playbooks ›** lead to the playbooks screen. The tile used to be a plain link to that screen; the link is now one row down.
- A switch says what it did under the play name: `Switched to “Road Book” · opened “Cover Two”`, `Switched to “Scout Book” · board cleared`, or `Already in “Road Book”`.
- In a book, each card says **Primary** or offers **Make primary**, and the caption under the name says what the primary is for.

## Verification

`e2e/journeys/playbook-switch.journey.ts` opens the play name's list on a new play (the first book stands in, numbered as the book is, the primary marked), picks a play by keyboard and by tap, and checks the play on the board; switches to a book whose primary is its second play, to an empty book (board cleared), to the book already current (nothing changes), reloads (the pick holds) and back to a book that never had a primary picked (its first play opens); goes from the Playbooks tile to the playbooks screen and back into the designer from inside a book; makes the first play added primary through a reorder, picks another, removes it, adds a later play, exports the file with the primary and imports it whole on a second device; adds a saved play to the current book from the play name; and on a bare device reads what both menus say. Each test leaves `test-results/playbook-switch-<device>-<test>.json` and pictures of both menus, uploaded as `playbook-switch`. The playbooks, history, library-discovery and share-repair journeys still pass, so adding, ordering, importing and opening plays are unchanged.

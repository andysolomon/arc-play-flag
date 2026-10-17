"use client";

import Link from "next/link";
import { useSyncExternalStore, type RefObject } from "react";
import { numbered } from "@/lib/export/numbered";
import {
  getCurrentBookId, getPlaybooks, getPlays, getServerCurrentBookId, getServerPlaybooks, getServerPlays, primaryPlay, subscribe,
} from "@/lib/play/library";
import { Menu, MenuHeading, MenuNote } from "./Menu";
import { SideBadge } from "./SideBadge";
import { chip, menuChoice, menuItem } from "./ui";

/**
 * The current playbook as the designer's menus see it: the book, its plays numbered as it numbers
 * them, its primary, and whether the play on the board (`playId`) is one of them.
 */
export function useCurrentBook(playId: string | null) {
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const currentId = useSyncExternalStore(subscribe, getCurrentBookId, getServerCurrentBookId);
  const book = books.find((b) => b.id === currentId) ?? null;
  const items = book ? numbered(book, plays) : [];
  const primaryId = book ? primaryPlay(book)?.id ?? null : null;
  const inBook = book !== null && playId !== null && book.plays.includes(playId);
  return { book, items, primaryId, inBook };
}

interface Props {
  /** the menu's id, which its trigger names in aria-controls */
  id: string;
  label: string;
  /** the element holding the trigger and the menu: a tap outside it closes the menu */
  root: RefObject<HTMLElement | null>;
  /** the button that opened the menu: focus goes back to it after a pick */
  trigger: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  className?: string;
  /** the name on the board, for the row that adds it to the book */
  name: string;
  /** the saved play on the board, when it is one */
  playId: string | null;
  /** opens a play of the current playbook on the board */
  onOpenPlay: (id: string) => void;
  /** adds the saved play on the board to the current playbook */
  onAddToBook: () => void;
}

/**
 * The current playbook's plays, dropped down from the play name in Play tools and from the name
 * over the field: each numbered as the book numbers it, each marked Offense or Defense, the primary
 * marked, the play on the board checked. Picking one opens it. A saved play that isn't in the book
 * can be added from here; an unsaved one is told to save first (docs/adr/009-playbook-switcher.md).
 */
export function PlaysMenu({ id, label, root, trigger, onClose, className, name, playId, onOpenPlay, onAddToBook }: Props) {
  const { book, items, primaryId, inBook } = useCurrentBook(playId);
  const pick = (playId: string) => { onClose(); trigger.current?.focus(); onOpenPlay(playId); };
  const add = () => { onClose(); trigger.current?.focus(); onAddToBook(); };
  return (
    <Menu id={id} label={label} root={root} trigger={trigger} onClose={onClose} className={className}>
      {book ? (
        <>
          <MenuHeading>IN “{book.name}”</MenuHeading>
          {items.length === 0 && <MenuNote>No plays in this playbook yet.</MenuNote>}
          {items.map((it) => (
            <button
              key={it.play.id}
              type="button"
              role="menuitemradio"
              aria-checked={it.play.id === playId}
              aria-label={it.play.name}
              title={`${it.play.id === playId ? `${it.play.name} is on the board` : `Open ${it.play.name}`}, ${it.play.side === "defense" ? "a defensive call" : "an offensive play"}`}
              onClick={() => { pick(it.play.id); }}
              className={`${menuChoice} py-1.5`}
            >
              <span className="w-6 flex-none text-caption text-ink-muted">{it.n}.</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{it.play.name}</span>
                <SideBadge side={it.play.side} />
              </span>
              {it.play.id === primaryId && <span className={chip}>Primary</span>}
            </button>
          ))}
          {playId !== null && !inBook && (
            <>
              <span className="mx-2 my-0.5 h-0.5 bg-divider" aria-hidden />
              <button type="button" role="menuitem" onClick={add} className={menuItem}>
                <span className="min-w-0 truncate">+ Add “{name.trim() || "Untitled play"}” to this playbook</span>
              </button>
            </>
          )}
          {playId === null && <MenuNote>Save the play on the board to add it to “{book.name}”.</MenuNote>}
        </>
      ) : (
        <>
          <MenuNote>No playbook on this device yet. Make one, and its plays show up here.</MenuNote>
          <Link href="/playbooks" role="menuitem" className={`${menuItem} !text-ink no-underline`}>All playbooks ›</Link>
        </>
      )}
    </Menu>
  );
}

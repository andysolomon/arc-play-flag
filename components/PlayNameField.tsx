"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { numbered } from "@/lib/export/numbered";
import {
  getCurrentBookId, getPlaybooks, getPlays, getServerCurrentBookId, getServerPlaybooks, getServerPlays, primaryPlay, subscribe,
} from "@/lib/play/library";
import { getAccountState, getServerAccountState, subscribeAccount } from "@/lib/account/sync";
import { Chevron, Menu, MenuHeading, MenuNote } from "./Menu";
import { SideBadge } from "./SideBadge";
import { chip, input, menuChoice, menuItem } from "./ui";

interface Props {
  name: string;
  /** the saved play on the board, when it is one */
  playId: string | null;
  onName: (name: string) => void;
  /** opens a play of the current playbook on the board */
  onOpenPlay: (id: string) => void;
  /** adds the saved play on the board to the current playbook */
  onAddToBook: () => void;
}

/**
 * The play name, with the current playbook's plays dropped down beside it: each numbered as the
 * book numbers it, each marked Offense or Defense, the primary marked, the play on the board checked.
 * Picking one opens it. A saved play that isn't in the book can be added from here
 * (docs/adr/009-playbook-switcher.md).
 */
export function PlayNameField({ name, playId, onName, onOpenPlay, onAddToBook }: Props) {
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const currentId = useSyncExternalStore(subscribe, getCurrentBookId, getServerCurrentBookId);
  // the other coaches of the organization on a play right now wear their names on its row (ADR 013, rule 8)
  const presence = useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState).presence;
  const book = books.find((b) => b.id === currentId) ?? null;
  const items = book ? numbered(book, plays) : [];
  const primaryId = book ? primaryPlay(book)?.id ?? null : null;
  const inBook = book !== null && playId !== null && book.plays.includes(playId);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => { setOpen(false); }, []);
  const pick = (id: string) => { close(); trigger.current?.focus(); onOpenPlay(id); };
  const add = () => { close(); trigger.current?.focus(); onAddToBook(); };
  return (
    <div ref={root} className="relative flex-none">
      <input
        value={name}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onName(e.target.value); }}
        placeholder="Play name"
        aria-label="Play name"
        className={`${input} pr-12`}
      />
      <button
        ref={trigger}
        type="button"
        aria-label="Plays in this playbook"
        title={book ? `Plays in “${book.name}”` : "Plays in this playbook"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => { setOpen((o) => !o); }}
        className="pressable absolute inset-y-0.5 right-0.5 flex w-11 cursor-pointer items-center justify-center rounded-pill text-ink hover:bg-yellow-soft data-[open=true]:bg-yellow-soft"
        data-open={open}
      >
        <Chevron open={open} />
      </button>
      {open && (
        <Menu id={menuId} label="Plays in this playbook" root={root} trigger={trigger} onClose={close}
          className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-[min(50vh,420px)] overflow-y-auto">
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
                  {presence.filter((p) => p.play === it.play.id).map((p) => <span key={p.coach} className={chip} data-here>{p.name}</span>)}
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
      )}
    </div>
  );
}

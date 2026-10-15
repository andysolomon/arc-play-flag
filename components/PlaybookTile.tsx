"use client";

import Link from "next/link";
import { useCallback, useId, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { getCurrentBookId, getPlaybooks, getServerCurrentBookId, getServerPlaybooks, subscribe } from "@/lib/play/library";
import { IconTile } from "./IconTile";
import { Menu, MenuHeading, MenuNote } from "./Menu";
import { menuChoice, menuItem } from "./ui";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

interface Props {
  /** switches the designer to a playbook: its primary play opens, or an empty book clears the board */
  onSwitchBook: (id: string) => void;
  /**
   * The positioned element around the tile grid: the menu drops down under all of it, the full
   * width of the sidebar, and a tap outside it closes the menu.
   */
  root: RefObject<HTMLDivElement | null>;
}

/**
 * The Playbooks tile in Play tools, with every playbook on the device dropped down under it: the
 * current one checked, a tap on another switches to it, and the way on to the playbooks screen at
 * the end (docs/adr/008-playbook-switcher.md). The menu is a sibling of the tile in its grid, so it
 * takes no cell and is placed against `root`.
 */
export function PlaybookTile({ onSwitchBook, root }: Props) {
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const currentId = useSyncExternalStore(subscribe, getCurrentBookId, getServerCurrentBookId);
  const current = books.find((b) => b.id === currentId) ?? null;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => { setOpen(false); }, []);
  const pick = (id: string) => { close(); trigger.current?.focus(); onSwitchBook(id); };
  return (
    <>
      <IconTile
        ref={trigger}
        icon="playbook"
        label="Playbooks"
        title={current ? `Playbooks · in “${current.name}”` : "Playbooks"}
        menu={open ? menuId : "closed"}
        onClick={() => { setOpen((o) => !o); }}
      />
      {open && (
        <Menu id={menuId} label="Playbooks" root={root} trigger={trigger} onClose={close}
          className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-[min(50vh,420px)] overflow-y-auto">
          {books.length === 0 ? (
            <MenuNote>No playbooks yet. Make one under All playbooks, then switch between them here.</MenuNote>
          ) : (
            <>
              <MenuHeading>SWITCH TO</MenuHeading>
              {books.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={b.id === currentId}
                  aria-label={b.name}
                  title={b.id === currentId ? `${b.name} is the current playbook` : `Switch to ${b.name}`}
                  onClick={() => { pick(b.id); }}
                  className={menuChoice}
                >
                  <span className="min-w-0 flex-1 truncate">{b.name}</span>
                  <span className="flex-none text-caption text-ink-muted">{b.plays.length ? plural(b.plays.length, "play") : "Empty"}</span>
                </button>
              ))}
            </>
          )}
          <span className="mx-2 my-0.5 h-0.5 bg-divider" aria-hidden />
          {current && (
            <Link href={`/playbooks?book=${encodeURIComponent(current.id)}`} role="menuitem" className={`${menuItem} !text-ink no-underline`}>
              <span className="min-w-0 truncate">Edit “{current.name}” ›</span>
            </Link>
          )}
          <Link href="/playbooks" role="menuitem" className={`${menuItem} !text-ink no-underline`}>All playbooks ›</Link>
        </Menu>
      )}
    </>
  );
}

"use client";

import { useCallback, useId, useRef, useState } from "react";
import { Chevron } from "./Menu";
import { PlaysMenu, useCurrentBook } from "./PlaysMenu";

interface Props {
  name: string;
  /** the saved play on the board, when it is one */
  playId: string | null;
  /** opens a play of the current playbook on the board */
  onOpenPlay: (id: string) => void;
  /** adds the saved play on the board to the current playbook */
  onAddToBook: () => void;
}

/**
 * The chevron beside the play's name over the field: it drops the current playbook's plays down,
 * the same list as the play name's in Play tools, so a coach switches plays with both sidebars
 * folded away (docs/adr/009-playbook-switcher.md). The list spans the field under the name. The
 * button is as tall as the name's line, so the field keeps its room, and reaches 44px around it
 * for a thumb. It sits in the title row without a box of its own (`contents`), so the list is laid
 * out against the row, and a tap anywhere else in the page closes it.
 */
export function PlaySwitcher({ name, playId, onOpenPlay, onAddToBook }: Props) {
  const { book } = useCurrentBook(playId);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => { setOpen(false); }, []);
  return (
    <span ref={root} className="contents">
      <button
        ref={trigger}
        type="button"
        aria-label="Switch play"
        title={book ? `Switch play: the plays in “${book.name}”` : "Switch play"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => { setOpen((o) => !o); }}
        className="pressable relative z-[1] flex h-5 w-7 flex-none cursor-pointer items-center justify-center self-center rounded-pill text-ink hover:bg-yellow-soft data-[open=true]:bg-yellow-soft before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] print:hidden"
        data-open={open}
      >
        <Chevron open={open} />
      </button>
      {open && (
        <PlaysMenu
          id={menuId}
          label="Switch play"
          root={root}
          trigger={trigger}
          onClose={close}
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-[min(50vh,420px)] overflow-y-auto print:hidden"
          name={name}
          playId={playId}
          onOpenPlay={onOpenPlay}
          onAddToBook={onAddToBook}
        />
      )}
    </span>
  );
}

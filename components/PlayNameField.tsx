"use client";

import { useCallback, useId, useRef, useState, type ChangeEvent } from "react";
import { Chevron } from "./Menu";
import { PlaysMenu, useCurrentBook } from "./PlaysMenu";
import { input } from "./ui";

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
 * The play name, with the current playbook's plays dropped down beside it (`PlaysMenu`): picking
 * one opens it. The same list drops down from the name over the field (`PlaySwitcher`), so a coach
 * switches plays with Play tools folded away too (docs/adr/009-playbook-switcher.md).
 */
export function PlayNameField({ name, playId, onName, onOpenPlay, onAddToBook }: Props) {
  const { book } = useCurrentBook(playId);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => { setOpen(false); }, []);
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
        <PlaysMenu
          id={menuId}
          label="Plays in this playbook"
          root={root}
          trigger={trigger}
          onClose={close}
          className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-[min(50vh,420px)] overflow-y-auto"
          name={name}
          playId={playId}
          onOpenPlay={onOpenPlay}
          onAddToBook={onAddToBook}
        />
      )}
    </div>
  );
}

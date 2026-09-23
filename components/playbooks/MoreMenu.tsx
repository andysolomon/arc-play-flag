"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { pill } from "../ui";

/** Menu row style: full-width, thumb-sized, left-aligned. */
export const menuItem =
  "flex min-h-11 w-full cursor-pointer items-center rounded-note px-3 text-left text-small hover:bg-yellow-soft " +
  "data-[active=true]:bg-rose-soft";
/** A row that removes something: red so it reads as different before it's tapped. */
export const menuItemDanger = `${menuItem} text-offense data-[active=true]:text-ink`;

/**
 * A "⋯" button that drops down the less-used actions of a card.
 * Closes on outside tap, Escape, or once an item asks it to via `close`.
 */
export function MoreMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const close = () => { setOpen(false); };
  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => { setOpen((o) => !o); }}
        className={`${pill} flex h-11 w-11 items-center justify-center text-title leading-none data-[open=true]:bg-yellow-soft`}
        data-open={open}
      >
        ⋯
      </button>
      {open && (
        <div
          id={menuId}
          role="group"
          aria-label={label}
          className="absolute right-0 top-full z-10 mt-1.5 flex w-max min-w-[200px] flex-col gap-0.5 rounded-tile border-2 border-ink bg-white p-1.5 shadow-toast"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

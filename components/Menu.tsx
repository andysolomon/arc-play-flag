"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { menuPanel } from "./ui";

interface Props {
  /** the menu's id, which its trigger names in aria-controls */
  id: string;
  label: string;
  /** the element holding the trigger and the menu: a tap outside it closes the menu */
  root: RefObject<HTMLElement | null>;
  /** the button that opened the menu: focus goes back to it on Escape and after a pick */
  trigger: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}

const ITEMS = "[role='menuitem'],[role='menuitemradio']";

/**
 * A menu dropped down from a button in the sidebar (the Playbooks tile, the play name's list).
 * It opens with focus on the choice in force (or the first row, or the menu itself when it has no
 * rows to pick), the arrow keys, Home and End walk the rows, Escape and a tap outside close it, and
 * focus goes back to the button that opened it. Rows are the children: buttons or links with role
 * menuitem or menuitemradio.
 */
export function Menu({ id, label, root, trigger, onClose, className = "", children }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const items = panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [];
    const checked = [...items].find((el) => el.getAttribute("aria-checked") === "true");
    // a menu with nothing to pick (an empty book, an unsaved play) takes focus itself, so Escape still reaches it
    (checked ?? items[0] ?? panel.current)?.focus();
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("pointerdown", onDown); };
  }, [onClose, root]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); trigger.current?.focus(); return; }
    if (e.key === "Tab") { onClose(); return; }
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    if (!items.length) return;
    const at = items.findIndex((el) => el === document.activeElement);
    const to = e.key === "ArrowDown" ? (at + 1) % items.length
      : e.key === "ArrowUp" ? (at - 1 + items.length) % items.length
      : e.key === "Home" ? 0
      : e.key === "End" ? items.length - 1
      : null;
    if (to === null) return;
    e.preventDefault();
    items[to]?.focus();
  };
  return (
    <div ref={panel} id={id} role="menu" aria-label={label} tabIndex={-1} onKeyDown={onKey} className={`${menuPanel} outline-none ${className}`}>
      {children}
    </div>
  );
}

/** A heading row inside a menu, for the thing the rows belong to. */
export function MenuHeading({ children }: { children: ReactNode }) {
  return <span role="presentation" className="truncate px-3 pb-0.5 pt-1.5 text-eyebrow tracking-eyebrow text-ink-muted">{children}</span>;
}

/** A line of words inside a menu, when there is nothing to pick. */
export function MenuNote({ children }: { children: ReactNode }) {
  return <span role="presentation" className="px-3 py-2 text-caption leading-note text-ink-muted">{children}</span>;
}

/** A small chevron for a button that drops a menu down. */
export function Chevron({ open, className = "" }: { open: boolean; className?: string }) {
  return (
    <svg
      aria-hidden viewBox="0 0 16 16" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round"
      className={`h-4 w-4 flex-none fill-none stroke-current transition-transform duration-[120ms] motion-reduce:transition-none ${open ? "rotate-180" : ""} ${className}`}
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

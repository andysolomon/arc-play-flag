"use client";

import { useId, useState, type ReactNode } from "react";
import { eyebrow } from "./ui";

/**
 * A section folded away behind its heading, which still says what is inside it. Folded on every
 * visit: what it holds is rarely touched, so it shouldn't sit between a coach and the play.
 * Its contents mount only while open, so a folded end zone picker fetches none of its designs;
 * `keep` keeps them mounted and only hides them, for a section whose state must outlast a fold
 * (a share link's revoke control not yet saved, the export options a coach set).
 */
export function Fold({ label, says, keep = false, children }: { label: string; says?: ReactNode; keep?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        data-fold={label}
        onClick={() => { setOpen((o) => !o); }}
        className="flex min-h-11 flex-none cursor-pointer items-center gap-2 rounded-note text-left hover:bg-yellow-soft"
      >
        <span className={`${eyebrow} uppercase`}>{label}</span>
        <span className="min-w-0 flex-1 truncate text-right text-small text-ink">{says}</span>
        <svg
          aria-hidden viewBox="0 0 16 16" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
          className={`h-4 w-4 flex-none fill-none stroke-current text-ink-muted transition-transform duration-[120ms] motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      <div id={id} hidden={!open} className="flex flex-none flex-col gap-[10px]">
        {(open || keep) && children}
      </div>
    </>
  );
}

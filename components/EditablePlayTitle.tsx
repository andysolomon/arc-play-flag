"use client";

import { useEffect, useRef, useState } from "react";

/** Rename in place above the field; Enter or leaving the input keeps it, Escape cancels. */
export function EditablePlayTitle({ name, onName }: { name: string; onName: (name: string) => void }) {
  const [original, setOriginal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const editing = original !== null;
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      button.current?.focus();
    }
    // Focus only when opening or closing, never again as the coach types.
  }, [editing]);
  const finish = (keep: boolean, keyboard = false) => {
    if (!keep && original !== null) onName(original);
    returnFocus.current = keyboard;
    setOriginal(null);
  };
  return (
    <>
      <span className="hidden print:inline">{name || "Untitled play"}</span>
      {!editing ? (
        <button
          ref={button}
          type="button"
          aria-label="Edit play name"
          title="Edit play name"
          onClick={() => { setOriginal(name); }}
          className="flex min-h-11 max-w-full cursor-pointer items-center gap-1.5 rounded-note px-1 text-left hover:bg-yellow-soft print:hidden"
        >
          <span className="truncate">{name || "Untitled play"}</span>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" className="shrink-0">
            <path d="m10.5 2.5 3 3M2 14l1-4L11.5 1.5a1 1 0 0 1 1.5 0L14.5 3a1 1 0 0 1 0 1.5L6 13Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <input
          ref={input}
          value={name}
          aria-label="Edit play name"
          onChange={(e) => { onName(e.target.value); }}
          onBlur={() => { finish(true); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter" || e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              finish(e.key === "Enter", true);
            }
          }}
          className="min-h-11 w-full min-w-0 rounded-note border-2 border-ink bg-white px-1 text-base text-ink print:hidden"
        />
      )}
    </>
  );
}

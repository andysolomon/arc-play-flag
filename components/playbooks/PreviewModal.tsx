"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { pill } from "../ui";

/** Native modal supplies focus trapping, Escape dismissal and an inert background. */
export function PreviewModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element?.showModal();
    return () => { element?.close(); if (previous instanceof HTMLElement) previous.focus(); };
  }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto max-h-[calc(100dvh-24px)] w-[calc(100%-24px)] max-w-[760px] overflow-y-auto rounded-tile border-2 border-ink bg-cream p-4 text-ink shadow-tile backdrop:bg-scrim">
    <div className="mb-3 flex items-start gap-3">
      <h2 id={titleId} className="text-header font-normal">{title}</h2>
      <button type="button" className={`${pill} ml-auto flex h-11 w-11 flex-none items-center justify-center text-header`} onClick={onClose} aria-label="Close preview">×</button>
    </div>
    {children}
  </dialog>;
}

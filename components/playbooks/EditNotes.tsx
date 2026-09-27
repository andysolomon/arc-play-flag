"use client";

import { useState } from "react";
import type { Numbered } from "@/lib/export/numbered";
import { savePlay } from "@/lib/play/library";
import { MAX_NOTES, failureMessage } from "@/lib/play/storage";
import type { SavedPlay } from "@/lib/play/types";
import { pillDark } from "../ui";
import type { Say } from "./PlaybooksScreen";
import { PreviewModal } from "./PreviewModal";

/**
 * Every play's notes in the book, editable in one place before a meeting. A note is the
 * play's own, so each change is saved with the play and every export shows it.
 *
 * - A save that fails (the device is full) says so, and the words stay in the box to try again.
 * - Only the notes change: the name, players and side go back exactly as stored.
 * - The box stops at the play's own limit, as in the designer.
 * - A play taken out of the book or deleted meanwhile simply drops out of the list.
 */
export function EditNotesModal({ bookName, items, onClose, say }: { bookName: string; items: readonly Numbered[]; onClose: () => void; say: Say }) {
  return (
    <PreviewModal title={`Notes in “${bookName}”`} closeLabel="Close notes" onClose={onClose}>
      <p className="mb-3 text-caption leading-note text-ink-muted">Each note saves with its play, so the designer, binder and postcards show it too.</p>
      <ol className="flex flex-col gap-3">
        {items.map((it) => <NoteRow key={it.play.id} n={it.n} play={it.play} say={say} />)}
      </ol>
      <div className="sticky bottom-[-16px] -mx-4 -mb-4 mt-3 flex items-center gap-2 border-t-2 border-divider bg-cream px-4 py-3">
        <button type="button" onClick={onClose} className={`${pillDark} ml-auto min-h-11 px-5 text-small`}>Done</button>
      </div>
    </PreviewModal>
  );
}

function NoteRow({ n, play, say }: { n: number; play: SavedPlay; say: Say }) {
  // the box keeps what was typed even when a save fails, so nothing is lost
  const [value, setValue] = useState(play.notes);
  const [state, setState] = useState<"idle" | "saved" | "failed">("idle");
  const onChange = (next: string) => {
    setValue(next);
    const r = savePlay({ ...play, notes: next });
    setState(r.ok ? "saved" : "failed");
    if (!r.ok) say(failureMessage(r.error), 3200);
  };
  return (
    <li className="flex flex-col gap-1.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 border-ink bg-yellow on-yellow text-small" aria-hidden="true">{n}</span>
        <span className="truncate text-base" title={play.name}>{play.name}</span>
      </span>
      <textarea
        value={value}
        maxLength={MAX_NOTES}
        rows={3}
        onChange={(e) => { onChange(e.target.value); }}
        placeholder="Coaching points for this play."
        aria-label={`Notes for ${String(n)} · ${play.name}`}
        className="w-full resize-y rounded-note border-2 border-ink bg-white px-3 py-2 text-base leading-note text-ink placeholder:text-ink-muted"
      />
      <span className="text-caption leading-note text-ink-muted" aria-live="polite">
        {state === "saved" ? "Saved with the play." : state === "failed" ? "Not saved. Your words are still here; try again." : ""}
      </span>
    </li>
  );
}

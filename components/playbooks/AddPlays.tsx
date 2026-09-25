"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  addPlayToPlaybook, createPlaybook, discoverPlays, getPlaybooks, getPlays, getServerPlaybooks, getServerPlays,
  subscribe, updatePlaybook,
} from "@/lib/play/library";
import type { PlayFilter, PlaySort } from "@/lib/play/library";
import { failureMessage } from "@/lib/play/storage";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import { PlayThumb } from "../PlayThumb";
import { card, input, pill, pillDark } from "../ui";
import type { Say } from "./PlaybooksScreen";
import { PreviewModal } from "./PreviewModal";
import { TypeFilter } from "./TypeFilter";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/** Adds the play to the end of the book, or takes it out if it's already there. */
function togglePlay(book: Playbook, playId: string, say: Say): void {
  const r = book.plays.includes(playId)
    ? updatePlaybook({ ...book, plays: book.plays.filter((id) => id !== playId) })
    : addPlayToPlaybook(book.id, playId);
  if (!r.ok) say(failureMessage(r.error), 3200);
}

const doneRow = "sticky bottom-[-16px] -mx-4 -mb-4 mt-3 flex items-center gap-2 border-t-2 border-divider bg-cream px-4 py-3";

/** Every saved play as a tap-to-toggle tile, so a coach can fill a book without leaving where they are. */
export function AddPlaysModal({ bookId, onClose, say }: { bookId: string; onClose: () => void; say: Say }) {
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const book = books.find((b) => b.id === bookId) ?? null;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlayFilter>("all");
  const [sort, setSort] = useState<PlaySort>("recent");
  const visible = useMemo(() => discoverPlays(plays, { query, filter, sort }), [filter, plays, query, sort]);
  if (!book) return null;
  const inBook = new Set(book.plays);

  return (
    <PreviewModal title={`Add plays to “${book.name}”`} closeLabel="Close add plays" onClose={onClose}>
      {plays.length === 0 ? (
        <span className="text-base text-ink-muted">Save a play in the designer first.</span>
      ) : (<div className="flex flex-col gap-3">
        <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(180px,1fr)_auto_auto]">
          <input value={query} onChange={(e) => { setQuery(e.target.value); }} placeholder="Search names and notes" aria-label="Search plays to add" className={`${input} col-span-2 sm:col-span-1`} />
          <TypeFilter value={filter} onChange={setFilter} label="Filter plays to add" />
          <select value={sort} onChange={(e) => { setSort(e.target.value as PlaySort); }} aria-label="Sort plays to add" className={input}>
            <option value="recent">Recent</option><option value="name">Name</option>
          </select>
        </div>
        {visible.length === 0 ? (
          <div className="rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base text-ink-muted">No plays match. Try another search or filter.</div>
        ) : <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {visible.map((p) => <PlayToggle key={p.id} play={p} added={inBook.has(p.id)} onToggle={() => { togglePlay(book, p.id, say); }} />)}
        </div>}
      </div>)}
      <div className={doneRow}>
        <span className="text-caption text-ink-muted">{book.plays.length ? `${plural(book.plays.length, "play")} in this playbook` : "No plays yet"}</span>
        <button type="button" onClick={onClose} className={`${pillDark} ml-auto min-h-11 px-5 text-small`}>Done</button>
      </div>
    </PreviewModal>
  );
}

function PlayToggle({ play: p, added, onToggle }: { play: SavedPlay; added: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={added}
      title={added ? `Remove ${p.name}` : `Add ${p.name}`}
      className={`${card} flex cursor-pointer flex-col gap-2 text-left transition-transform duration-[120ms] hover:-translate-y-0.5 hover:bg-yellow-soft aria-pressed:bg-yellow-soft motion-reduce:transition-none`}
    >
      <PlayThumb players={p.players} name={p.name} side={p.side} />
      <span className="truncate text-base">{p.name}</span>
      <span className="text-caption text-ink-muted">{added ? "✓ In playbook" : "+ Add"}</span>
    </button>
  );
}

/** Every playbook as a tap-to-toggle row for one play, plus a new book that starts with it. */
export function AddToPlaybookModal({ play, onClose, say }: { play: SavedPlay; onClose: () => void; say: Say }) {
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const onNew = () => {
    const name = `Playbook ${String(books.length + 1)}`;
    const r = createPlaybook(name, [play.id]);
    say(r.ok ? `Added to “${name}”` : failureMessage(r.error), r.ok ? undefined : 3200);
  };
  return (
    <PreviewModal title={`Add “${play.name}” to a playbook`} closeLabel="Close add to playbook" onClose={onClose}>
      <div className="flex flex-col gap-2">
        {books.length === 0 && <span className="text-base text-ink-muted">No playbooks yet. Start one with this play.</span>}
        {books.map((b) => {
          const added = b.plays.includes(play.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => { togglePlay(b, play.id, say); }}
              aria-pressed={added}
              aria-label={b.name}
              className={`${pill} flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left aria-pressed:bg-yellow-soft`}
            >
              <span className="min-w-0 flex-1 truncate text-base">{b.name}</span>
              <span className="text-caption text-ink-muted">{b.plays.length ? plural(b.plays.length, "play") : "Empty"}</span>
              <span className="w-[92px] text-right text-small">{added ? "✓ Added" : "+ Add"}</span>
            </button>
          );
        })}
        <button type="button" onClick={onNew} className={`${pill} min-h-11 self-start px-4 text-small`}>+ New playbook with this play</button>
      </div>
      <div className={doneRow}>
        <button type="button" onClick={onClose} className={`${pillDark} ml-auto min-h-11 px-5 text-small`}>Done</button>
      </div>
    </PreviewModal>
  );
}

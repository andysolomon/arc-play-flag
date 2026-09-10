"use client";

import { memo, useMemo, useState, useSyncExternalStore, type ReactNode, type ChangeEvent } from "react";
import {
  addPlayToPlaybook, discoverPlays, formationTemplate, getPlaybooks, getServerPlaybooks, subscribe,
} from "@/lib/play/library";
import { encodeShare } from "@/lib/play/share";
import type { PlayFilter, PlaySort } from "@/lib/play/library";
import { MAX_NOTES } from "@/lib/play/storage";
import type { SavedPlay, Team, Vis } from "@/lib/play/types";
import { IconTile, LinkTile } from "./IconTile";
import { Support } from "./Support";
import { divider, eyebrow, input, pill, tileGrid } from "./ui";

interface Props {
  name: string;
  notes: string;
  notesOpen: boolean;
  vis: Vis;
  plays: readonly SavedPlay[];
  onName: (name: string) => void;
  onNotes: (notes: string) => void;
  onToggleNotes: () => void;
  onNew: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  exportOpen: boolean;
  exportPanel: ReactNode;
  /** what to do about a save that didn't land, while it hasn't */
  savePanel: ReactNode;
  onLoad: (id: string) => void;
  onShare: () => void;
  onFlip: () => void;
  onClear: (team: Team | null) => void;
  onReset: (team: Team | null) => void;
  onVis: (vis: Vis) => void;
}

function PlaySidebarImpl({
  name, notes, notesOpen, vis, plays, onName, onNotes, onToggleNotes, onNew, onSave, onDuplicate, onExport, onLoad, onShare,
  exportOpen, exportPanel, savePanel, onFlip, onClear, onReset, onVis,
}: Props) {
  const scope: Team | null = vis === "both" ? null : vis;
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlayFilter>("all");
  const [sort, setSort] = useState<PlaySort>("name");
  const [chosenId, setChosenId] = useState("");
  const [reuseStatus, setReuseStatus] = useState("");
  const visiblePlays = useMemo(() => discoverPlays(plays, { query, filter, sort }), [filter, plays, query, sort]);
  const chosenPlay = plays.find((play) => play.id === chosenId);
  const template = chosenPlay ? formationTemplate(chosenPlay) : null;
  const templatePayload = template ? encodeShare({ name: `${template.name} formation`, players: template.players }) : "";
  return (
    <>
      <span className={eyebrow}>PLAY</span>
      <input
        value={name}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onName(e.target.value); }}
        placeholder="Play name"
        aria-label="Play name"
        className={`flex-none ${input}`}
      />
      <div className={tileGrid}>
        <IconTile icon="new" label="New play" title="Start a fresh play on the default formation" onClick={onNew} />
        <IconTile icon="save" label="Save" onClick={onSave} />
        <IconTile icon="duplicate" label="Duplicate" onClick={onDuplicate} />
        <IconTile icon="export" label="Export" title="Save a picture card or video clip" active={exportOpen} onClick={onExport} />
        <IconTile icon="notes" label="Notes" title="Coaching points for this play" active={notesOpen} dot={notes.trim().length > 0} onClick={onToggleNotes} />
        <LinkTile icon="playbook" label="Playbooks" href="/playbooks" title="Build playbooks and print them" />
        <LinkTile icon="demo" label="Demo" href="/demo" title="Watch the complete feature tour" />
      </div>
      {savePanel}
      {exportPanel}
      {notesOpen && (
        <textarea
          value={notes}
          maxLength={MAX_NOTES}
          rows={4}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { onNotes(e.target.value); }}
          placeholder="Coaching points. Shown on the binder page."
          aria-label="Coaching points"
          className="w-full flex-none resize-y rounded-note border-2 border-ink bg-white px-3 py-2 text-base leading-note text-ink placeholder:text-ink-muted"
        />
      )}
      {plays.length > 0 && <div className="flex w-full flex-none flex-col gap-2" aria-label="Saved play library">
        <input
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { setQuery(e.target.value); }}
          placeholder="Search names and notes"
          aria-label="Search saved plays"
          className={input}
        />
        <div className="grid grid-cols-2 gap-2">
          <select value={filter} onChange={(e) => { setFilter(e.target.value as PlayFilter); }} aria-label="Filter saved plays" className={input}>
            <option value="all">All types</option><option value="run">Run</option><option value="pass">Pass</option><option value="defense">Defense</option>
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as PlaySort); }} aria-label="Sort saved plays" className={input}>
            <option value="recent">Recent</option><option value="name">Name</option>
          </select>
        </div>
        {visiblePlays.length === 0 ? (
          <span className="rounded-note border-2 border-dashed border-ink px-3 py-3 text-center text-small text-ink-muted">No plays match.</span>
        ) : <>
          <select
            value=""
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              if (!e.target.value) return;
              setChosenId(e.target.value);
              setReuseStatus("");
              onLoad(e.target.value);
            }}
            aria-label="Open a saved play"
            className="w-full flex-none cursor-pointer rounded-pill border-2 border-ink bg-white px-3 py-1.5 text-base"
          >
            <option value="">Open a saved play…</option>
            {visiblePlays.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <form action="/" method="get">
            <input type="hidden" name="p" value={templatePayload} />
            <button
              type="submit"
              disabled={!template}
              title="Start a new unsaved play from these positions, with every route removed"
              className={`${pill} self-start px-3 py-1 text-small`}
            >
              New from formation
            </button>
          </form>
          {books.length > 0 && chosenId && <select
            value=""
            onChange={(e: ChangeEvent<HTMLSelectElement>) => {
              const book = books.find((candidate) => candidate.id === e.target.value);
              if (!book) return;
              const alreadyThere = book.plays.includes(chosenId);
              const result = addPlayToPlaybook(book.id, chosenId);
              setReuseStatus(result.ok ? (alreadyThere ? `Already in ${book.name}` : `Added to ${book.name}`) : "Couldn’t add that play");
            }}
            aria-label="Add opened play to a playbook"
            className="w-full flex-none cursor-pointer rounded-pill border-2 border-ink bg-white px-3 py-1.5 text-base"
          >
            <option value="">Add opened play to…</option>
            {books.map((book) => <option key={book.id} value={book.id}>{book.name}</option>)}
          </select>}
          {reuseStatus && <span className="text-caption text-ink-muted" role="status">{reuseStatus}</span>}
        </>}
      </div>}
      <button type="button" onClick={onShare} title="Copy a link that opens this play read-only" className={`${pill} flex-none self-start px-3 py-1 text-small`}>
        Copy share link
      </button>
      <span className={divider} />
      <span className={eyebrow}>FIELD</span>
      <div className={tileGrid}>
        <IconTile icon="flip" label="Flip play" onClick={onFlip} />
        <IconTile icon="clear" label="Clear routes" onClick={() => { onClear(scope); }} />
        <IconTile icon="reset" label="Reset spots" onClick={() => { onReset(scope); }} />
      </div>
      <span className={divider} />
      <span className={eyebrow}>SHOW</span>
      <div className={tileGrid} role="group" aria-label="Show">
        <IconTile icon="football" label="Both" active={vis === "both"} onClick={() => { onVis("both"); }} />
        <IconTile icon="offOnly" label="Offense" active={vis === "offense"} onClick={() => { onVis("offense"); }} />
        <IconTile icon="defOnly" label="Defense" active={vis === "defense"} onClick={() => { onVis("defense"); }} />
      </div>
      <span className="flex-none text-caption leading-note text-ink-muted">Clear and reset only touch the team you&apos;re showing.</span>
      <span className={divider} />
      <Support />
    </>
  );
}

export const PlaySidebar = memo(PlaySidebarImpl);

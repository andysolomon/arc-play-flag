"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { numbered } from "@/lib/export/numbered";
import {
  addPlayToPlaybook, deletePlaybook, discoverPlays, getPlaybooks, getPlays, getServerPlaybooks, getServerPlays, getServerTeam, getTeam,
  subscribe, swapPlaybookReferences, updatePlaybook,
} from "@/lib/play/library";
import type { PlayFilter, PlaySort } from "@/lib/play/library";
import { failureMessage } from "@/lib/play/storage";
import type { Vis } from "@/lib/play/types";
import { PlayThumb } from "../PlayThumb";
import { card, divider, eyebrow, input, pill, pillSm } from "../ui";
import { ExportPanel } from "./ExportPanel";
import type { Say } from "./PlaybooksScreen";
import { ShowToggle } from "./ShowToggle";
import { TwoStep } from "./TwoStep";

export function BookEditor({ id, say, show, onShow }: { id: string; say: Say; show: Vis; onShow: (v: Vis) => void }) {
  const router = useRouter();
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const book = books.find((b) => b.id === id) ?? null;
  const items = useMemo(() => (book ? numbered(book, plays) : []), [book, plays]);
  const inBook = useMemo(() => new Set(items.map((i) => i.play.id)), [items]);
  const others = plays.filter((p) => !inBook.has(p.id));
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlayFilter>("all");
  const [sort, setSort] = useState<PlaySort>("recent");
  const visibleOthers = useMemo(() => discoverPlays(others, { query, filter, sort }), [filter, others, query, sort]);

  if (!book) {
    return (
      <div className="flex flex-col items-start gap-3">
        <span className="text-base text-ink-muted">That playbook isn&apos;t on this device.</span>
        <Link href="/playbooks" className={`${pillSm} inline-block !text-ink no-underline`}>‹ All playbooks</Link>
      </div>
    );
  }

  const update = (next: typeof book) => {
    const r = updatePlaybook(next);
    if (!r.ok) say(failureMessage(r.error), 3200);
  };
  const setPlays = (ids: string[]) => { update({ ...book, plays: ids }); };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const a = items[i]?.play.id, b = items[j]?.play.id;
    if (a === undefined || b === undefined) return;
    update(swapPlaybookReferences(book, a, b));
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/playbooks" className={`${pillSm} inline-block !text-ink no-underline`}>‹ All playbooks</Link>
        <input
          value={book.name}
          maxLength={80}
          placeholder="Playbook name"
          aria-label="Playbook name"
          onChange={(e) => { update({ ...book, name: e.target.value }); }}
          className={`${input} min-w-[200px] flex-1`}
        />
        <TwoStep
          label="Delete playbook"
          confirm="Delete this playbook?"
          onConfirm={() => {
            const r = deletePlaybook(book.id);
            if (!r.ok) { say(failureMessage(r.error), 3200); return; }
            say(`Deleted “${book.name}”`);
            router.push("/playbooks");
          }}
        />
      </div>
      <span className="text-caption leading-note text-ink-muted">Plays are numbered by their order here. Deleting a playbook keeps the plays.</span>

      <span className={divider} />
      <div className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>PLAYS IN THIS PLAYBOOK</span>
        <span className="flex-1" />
        {plays.length > 0 && <ShowToggle value={show} onChange={onShow} />}
      </div>
      {items.length === 0 ? (
        <div className="rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base leading-body text-ink-muted">
          Empty. Add plays from the list below.
        </div>
      ) : (
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3">
          {items.map((it, i) => (
            <li key={it.play.id} className={`${card} flex items-center gap-3`}>
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 border-ink bg-yellow text-base" aria-label={`Play ${String(it.n)}`}>
                {it.n}
              </span>
              <div className="w-[84px] flex-none"><PlayThumb players={it.play.players} name={it.play.name} show={show} /></div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-base" title={it.play.name}>{it.play.name}</span>
                <Link href={`/?open=${it.play.id}`} className="text-caption !text-ink-muted underline">Open in designer</Link>
              </div>
              <div className="flex flex-none flex-col gap-1">
                <button type="button" onClick={() => { move(i, -1); }} disabled={i === 0} aria-label="Move up" className={`${pill} px-2 py-0 text-small`}>↑</button>
                <button type="button" onClick={() => { move(i, 1); }} disabled={i === items.length - 1} aria-label="Move down" className={`${pill} px-2 py-0 text-small`}>↓</button>
              </div>
              <button type="button" onClick={() => { setPlays(book.plays.filter((playId) => playId !== it.play.id)); }} aria-label={`Remove ${it.play.name}`} className={`${pill} px-2 py-0 text-small`}>✕</button>
            </li>
          ))}
        </ol>
      )}

      <span className={divider} />
      <span className={eyebrow}>ADD PLAYS</span>
      {others.length === 0 ? (
        <span className="text-base text-ink-muted">
          {plays.length === 0 ? "Save a play in the designer first." : "Every saved play is already in this playbook."}
        </span>
      ) : (<>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(180px,1fr)_auto_auto]">
          <input value={query} onChange={(e) => { setQuery(e.target.value); }} placeholder="Search names and notes" aria-label="Search plays to add" className={input} />
          <select value={filter} onChange={(e) => { setFilter(e.target.value as PlayFilter); }} aria-label="Filter plays to add" className={input}>
            <option value="all">All types</option><option value="run">Run</option><option value="pass">Pass</option><option value="defense">Defense</option>
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as PlaySort); }} aria-label="Sort plays to add" className={input}>
            <option value="recent">Recent</option><option value="name">Name</option>
          </select>
        </div>
        {visibleOthers.length === 0 ? (
          <div className="rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base text-ink-muted">No plays match. Try another search or filter.</div>
        ) : <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {visibleOthers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => { const r = addPlayToPlaybook(book.id, p.id); if (!r.ok) say(failureMessage(r.error), 3200); }}
              title={`Add ${p.name}`}
              className={`${card} flex cursor-pointer flex-col gap-2 text-left transition-transform duration-[120ms] hover:-translate-y-0.5 hover:bg-yellow-soft motion-reduce:transition-none`}
            >
              <PlayThumb players={p.players} name={p.name} show={show} />
              <span className="truncate text-base">{p.name}</span>
              <span className="text-caption text-ink-muted">+ Add</span>
            </button>
          ))}
        </div>}
      </>)}

      <span className={divider} />
      <span className={eyebrow}>EXPORT</span>
      <ExportPanel book={book} items={items} team={team} say={say} />
    </>
  );
}

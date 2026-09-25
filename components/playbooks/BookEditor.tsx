"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useSyncExternalStore } from "react";
import { numbered } from "@/lib/export/numbered";
import {
  deletePlaybook, getPlaybooks, getPlays, getServerPlaybooks, getServerPlays, getServerTeam, getTeam,
  subscribe, swapPlaybookReferences, updatePlaybook,
} from "@/lib/play/library";
import { failureMessage } from "@/lib/play/storage";
import { PlayThumb } from "../PlayThumb";
import { SideBadge } from "../SideBadge";
import { card, divider, eyebrow, input, pill, pillDark, pillSm } from "../ui";
import { AddPlaysModal } from "./AddPlays";
import { ShareBook } from "./ShareBook";
import { ExportPanel } from "./ExportPanel";
import type { Say } from "./PlaybooksScreen";
import { TwoStep } from "./TwoStep";

export function BookEditor({ id, say }: { id: string; say: Say }) {
  const router = useRouter();
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const book = books.find((b) => b.id === id) ?? null;
  const items = useMemo(() => (book ? numbered(book, plays) : []), [book, plays]);
  const [adding, setAdding] = useState(false);

  if (!book) {
    return (
      <div className="flex flex-col items-start gap-3">
        <span className="text-base text-ink-muted">That playbook isn&apos;t on this device.</span>
        <Link href="/playbooks" className={`${pillSm} inline-flex items-center !text-ink no-underline`}>‹ All playbooks</Link>
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
        <Link href="/playbooks" className={`${pillSm} inline-flex items-center !text-ink no-underline`}>‹ All playbooks</Link>
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

      <ShareBook key={book.id} book={book} plays={plays} team={team} />
      <span className={divider} />
      <div className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>PLAYS IN THIS PLAYBOOK</span>
        <span className="flex-1" />
        <button type="button" onClick={() => { setAdding(true); }} className={`${pillDark} min-h-11 px-4 text-small`}>+ Add plays</button>
      </div>
      {adding && <AddPlaysModal bookId={book.id} say={say} onClose={() => { setAdding(false); }} />}
      {items.length === 0 ? (
        <div className="rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base leading-body text-ink-muted">
          {plays.length === 0 ? "Empty. Save a play in the designer, then add it here." : "Empty. Tap + Add plays to pick from your saved plays."}
        </div>
      ) : (
        <ol className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3">
          {items.map((it, i) => (
            <li key={it.play.id} className={`${card} flex items-center gap-3`}>
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full border-2 border-ink bg-yellow text-base" aria-label={`Play ${String(it.n)}`}>
                {it.n}
              </span>
              <div className="w-[84px] flex-none"><PlayThumb players={it.play.players} name={it.play.name} side={it.play.side} /></div>
              <div className="min-w-0 flex-1">
                <span className="block truncate text-base" title={it.play.name}>{it.play.name}</span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <SideBadge side={it.play.side} />
                  <Link href={`/?open=${it.play.id}`} className="text-caption !text-ink-muted underline">Open in designer</Link>
                </span>
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
      <span className={eyebrow}>EXPORT</span>
      <ExportPanel book={book} items={items} team={team} say={say} />
    </>
  );
}

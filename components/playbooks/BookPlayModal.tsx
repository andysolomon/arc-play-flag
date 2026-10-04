"use client";

import Link from "next/link";
import { useEffect } from "react";
import type { Numbered } from "@/lib/export/numbered";
import { NO_RUN_FLAG, runInNoRunZone } from "@/lib/play/call";
import { readerHref } from "@/lib/play/reader";
import { PlayThumb } from "../PlayThumb";
import { SideBadge } from "../SideBadge";
import { chip, flagChip, pill, pillDark } from "../ui";
import { kindOf } from "./BookReader";
import { PreviewModal } from "./PreviewModal";

/**
 * One play of a book, big, without leaving the book: its picture, what it is, its notes, and the way
 * on to the designer or the game-day reader at this play. Previous and Next (and the arrow keys) step
 * through the book in its order.
 */
export function BookPlayModal({ bookId, items, at, noRunZones, onGo, onClose }: {
  bookId: string;
  items: readonly Numbered[];
  /** index into items */
  at: number;
  noRunZones: boolean;
  onGo: (index: number) => void;
  onClose: () => void;
}) {
  const item = items[at];
  const count = items.length;
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const to = { ArrowRight: at + 1, ArrowLeft: at - 1 }[e.key];
      if (to === undefined || to < 0 || to >= count) return;
      e.preventDefault();
      onGo(to);
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); };
  }, [at, count, onGo]);
  if (!item) return null;

  const { play, n } = item;
  const kind = kindOf(play);
  const notes = play.notes.trim();
  return (
    <PreviewModal title={play.name} closeLabel="Close play" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex h-8 min-w-8 flex-none items-center justify-center rounded-full border-2 border-ink bg-yellow on-yellow px-1 text-base">{n}</span>
          <span className="text-caption text-ink-muted">{`Play ${String(n)} of ${String(count)}`}</span>
          <SideBadge side={play.side} className="self-center" />
          {kind && <span className={chip}>{kind}</span>}
          {runInNoRunZone(play, noRunZones) && <span className={flagChip}>{NO_RUN_FLAG}</span>}
        </div>
        {/* as big as the screen allows while the notes and the buttons below stay in view */}
        <PlayThumb players={play.players} name={play.name} side={play.side} artShadow={play.artShadow} los={play.los}
          className="mx-auto max-h-[min(52dvh,560px)] max-w-full !w-auto" />
        {notes && (
          <section aria-label="Coaching notes" className="rounded-tile border-2 border-ink bg-white px-3 py-2">
            <h3 className="text-eyebrow tracking-eyebrow text-ink-muted">COACHING NOTES</h3>
            <p className="whitespace-pre-line break-words text-base leading-note text-ink">{notes}</p>
          </section>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Plays in this playbook" className="flex min-w-[220px] flex-1 items-center gap-2">
            <button type="button" onClick={() => { onGo(at - 1); }} disabled={at <= 0} aria-label="Previous play" className={`${pill} min-h-11 flex-1 px-4 text-base`}>‹ Previous</button>
            <button type="button" onClick={() => { onGo(at + 1); }} disabled={at >= count - 1} aria-label="Next play" className={`${pill} min-h-11 flex-1 px-4 text-base`}>Next ›</button>
          </nav>
          <Link href={readerHref(bookId, n)} className={`${pill} inline-flex min-h-11 items-center px-4 text-small !text-ink no-underline`}>
            Game-day reader at this play
          </Link>
          <Link href={`/?open=${encodeURIComponent(play.id)}`} className={`${pillDark} inline-flex min-h-11 items-center px-4 text-small !text-cream no-underline`}>
            Open in designer ›
          </Link>
        </div>
      </div>
    </PreviewModal>
  );
}

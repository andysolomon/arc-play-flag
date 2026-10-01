"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { numbered } from "@/lib/export/numbered";
import { CALL_LABEL, NO_RUN_FLAG, callOf, runInNoRunZone } from "@/lib/play/call";
import { COVERAGE_WORDS, coverageOf } from "@/lib/play/coverage";
import { losOf } from "@/lib/play/field";
import { getPlaybooks, getPlays, getServerPlaybooks, getServerPlays, getServerTeam, getTeam, subscribe } from "@/lib/play/library";
import { findCalls, readAt, readerHref, rememberRead } from "@/lib/play/reader";
import { hasNoRunZones } from "@/lib/play/storage";
import type { SavedPlay } from "@/lib/play/types";
import { Field } from "../Field";
import { SideBadge } from "../SideBadge";
import { chip, flagChip, input, pill, pillSm } from "../ui";

const noop = (): void => undefined;

/** Typing in a field (the search) keeps the arrow keys for the caret. */
const typing = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** What the play is, in a word or two: the call for an offensive play, the coverage for a defensive one. */
function kindOf(play: SavedPlay): string | null {
  if (play.side === "defense") {
    const cover = coverageOf(play.players);
    return cover ? `${COVERAGE_WORDS[cover].charAt(0).toUpperCase()}${COVERAGE_WORDS[cover].slice(1)} coverage` : null;
  }
  const call = callOf(play.players);
  return call ? CALL_LABEL[call] : null;
}

const big = `${pill} min-h-16 min-w-[120px] flex-1 px-4 text-header`;

/**
 * The game-day reader (issue #111): one play of a book at a time, read-only, for a sideline tablet.
 * Large Previous and Next, the arrow keys, Home and End step through the book in its order; a search
 * finds a call by its number, a code in its name or a word in its notes; Full screen clears the screen
 * down to the play. The place is the address's `read`, the play's number in the book, rewritten in
 * place on every step so it needs no network and Back from the designer returns to it.
 */
export function BookReader({ id, read }: { id: string; read: string }) {
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const book = books.find((b) => b.id === id) ?? null;
  const items = useMemo(() => (book ? numbered(book, plays) : []), [book, plays]);
  const count = items.length;
  const n = readAt(read, count);
  const item = items[n - 1] ?? null;
  const svgRef = useRef<SVGSVGElement>(null);
  const [query, setQuery] = useState("");
  const [full, setFull] = useState(false);
  const viaBrowser = useRef(false);
  const found = useMemo(() => findCalls(items, query), [items, query]);

  const go = useCallback((k: number) => {
    if (!count) return;
    const to = Math.min(Math.max(k, 1), count);
    // the address is the place; rewriting it in place needs no network and keeps Back where it was
    window.history.replaceState(null, "", readerHref(id, to));
  }, [id, count]);

  // a number past the end or junk in the address reads as the nearest play, and the address says so
  useEffect(() => {
    if (count && read !== String(n)) window.history.replaceState(null, "", readerHref(id, n));
  }, [id, read, n, count]);
  useEffect(() => {
    if (count) rememberRead(id, n);
  }, [id, n, count]);

  const leave = useCallback(() => {
    setFull(false);
    viaBrowser.current = false;
    if (document.fullscreenElement) void document.exitFullscreen().catch(noop);
  }, []);
  const enter = (): void => {
    setFull(true);
    // the browser's own full screen where there is one; elsewhere (an iPhone) the page alone clears down
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      viaBrowser.current = true;
      document.documentElement.requestFullscreen().catch(() => { viaBrowser.current = false; });
    }
  };
  useEffect(() => {
    const changed = (): void => {
      if (!document.fullscreenElement && viaBrowser.current) {
        viaBrowser.current = false;
        setFull(false);
      }
    };
    document.addEventListener("fullscreenchange", changed);
    return () => { document.removeEventListener("fullscreenchange", changed); };
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && full) { leave(); return; }
      if (typing(e.target)) return;
      const to = { ArrowRight: n + 1, PageDown: n + 1, ArrowLeft: n - 1, PageUp: n - 1, Home: 1, End: count }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      go(to);
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); };
  }, [n, count, full, go, leave]);

  const pick = (k: number): void => {
    setQuery("");
    go(k);
  };
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const first = found[0];
    if (first) pick(first.n);
  };

  if (!book) {
    return (
      <div className="app-root flex h-full flex-col items-start gap-3 p-4">
        <span className="text-base text-ink-muted">That playbook isn&apos;t on this device.</span>
        <Link href="/playbooks" className={`${pillSm} inline-flex items-center !text-ink no-underline`}>‹ All playbooks</Link>
      </div>
    );
  }
  const back = <Link href={`/playbooks?book=${encodeURIComponent(book.id)}`} className={`${pillSm} inline-flex flex-none items-center !text-ink no-underline`}>‹ Book</Link>;
  if (!item) {
    return (
      <div className="app-root flex h-full flex-col items-start gap-3 p-4">
        <span className="text-base text-ink-muted">This playbook has no plays yet.</span>
        {back}
      </div>
    );
  }

  const { play } = item;
  const kind = kindOf(play);
  const flagged = runInNoRunZone(play, hasNoRunZones(team));
  const notes = play.notes.trim();
  const q = query.trim();
  return (
    <div className="app-root flex h-full flex-col overflow-hidden" data-full-screen={full || undefined}>
      {!full && (
        <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5">
          {back}
          <h1 className="min-w-0 truncate text-header font-normal">{book.name}</h1>
          <span className="whitespace-nowrap text-caption text-ink-muted max-[599px]:hidden">Game-day reader</span>
          <span className="flex-1" />
          <button type="button" onClick={enter} aria-pressed={false} className={`${pillSm} flex-none`}>Full screen</button>
        </header>
      )}
      {!full && (
        <div className="relative z-10 flex-none border-b-2 border-ink bg-cream px-3 py-2">
          <input
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            onKeyDown={onSearchKey}
            aria-label="Find a call"
            aria-describedby="reader-search-help"
            placeholder="Find a call: its number, or a word in its name or notes"
            enterKeyHint="go"
            className={input}
          />
          <span id="reader-search-help" className="sr-only">Enter opens the first call found.</span>
          {q && (
            <div className="absolute inset-x-3 top-full mt-1 rounded-tile border-2 border-ink bg-white p-1 shadow-tile">
              {found.length ? (
                <ul aria-label="Matching calls" className="flex max-h-[50vh] flex-col overflow-y-auto">
                  {found.map((it) => (
                    <li key={it.play.id}>
                      <button
                        type="button"
                        onClick={() => { pick(it.n); }}
                        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-pill px-2 text-left text-base hover:bg-yellow-soft"
                      >
                        <span className="inline-flex h-7 min-w-7 flex-none items-center justify-center rounded-full border-2 border-ink bg-yellow on-yellow px-1 text-small">{it.n}</span>{" "}
                        <span className="min-w-0 truncate">{it.play.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p role="status" className="px-2 py-2 text-base text-ink-muted">No call matches “{q}”.</p>
              )}
            </div>
          )}
        </div>
      )}
      <div className="flex flex-none flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-2">
        <span aria-hidden className="flex h-10 min-w-10 flex-none items-center justify-center rounded-full border-2 border-ink bg-yellow on-yellow px-1 text-header">{item.n}</span>
        <h2 className="min-w-[14ch] flex-1 break-words text-header font-normal leading-tight">{play.name}</h2>
        <span className="flex flex-wrap items-center gap-2">
          <SideBadge side={play.side} className="self-center" />
          {kind && <span className={chip}>{kind}</span>}
          {flagged && <span className={flagChip}>{NO_RUN_FLAG}</span>}
          {full ? (
            <button type="button" onClick={leave} className={`${pillSm} flex-none`}>Exit full screen</button>
          ) : (
            <Link href={`/?open=${encodeURIComponent(play.id)}`} className="text-caption !text-ink-muted underline">Open in designer</Link>
          )}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 items-stretch">
        <Field
          key={play.id}
          players={play.players}
          vis={play.artShadow ? "both" : play.side}
          side={play.side}
          selectedId={null}
          targeting={null}
          draft={null}
          dispatch={noop}
          onSelect={noop}
          svgRef={svgRef}
          readOnly
          noRunZones={hasNoRunZones(team)}
          los={losOf(play)}
          title={play.name}
        />
      </div>
      {notes && (
        <section aria-label="Coaching notes" className="max-h-[30%] flex-none overflow-y-auto border-t-2 border-ink bg-cream px-3 py-2">
          <h3 className="text-eyebrow tracking-eyebrow text-ink-muted">COACHING NOTES</h3>
          <p className="whitespace-pre-line break-words text-title leading-note text-ink sm:text-header">{notes}</p>
        </section>
      )}
      {/* the offline badge is pinned to the bottom left of every screen: the controls stand above it, never under it */}
      <nav aria-label="Plays in this book" className="flex flex-none items-center gap-2 border-t-2 border-ink bg-cream px-2 pb-10 pt-2">
        <button type="button" onClick={() => { go(n - 1); }} disabled={n <= 1} aria-label="Previous play" className={big}>‹ Previous</button>
        <span aria-live="polite" className="min-w-[88px] flex-none text-center text-base text-ink">{`Play ${String(n)} of ${String(count)}`}</span>
        <button type="button" onClick={() => { go(n + 1); }} disabled={n >= count} aria-label="Next play" className={big}>Next ›</button>
      </nav>
    </div>
  );
}

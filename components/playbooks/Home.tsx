"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { MAX_FILE_BYTES, importMessage } from "@/lib/export/playbook-file";
import { readTransfer, type Transfer, type TransferRead } from "@/lib/export/transfer";
import { ImportPreview } from "./ImportPreview";
import { ImportLink } from "./ImportLink";
import { TypeFilter } from "./TypeFilter";
import { PlayCard } from "./PlayCard";
import { BookCard } from "./BookCard";
import { SettingsButton } from "./Settings";
import {
  createPlaybook, discoverPlays, getPlaybooks, getPlays, getServerPlaybooks, getServerPlays,
  getServerTeam, getTeam, subscribe,
} from "@/lib/play/library";
import type { PlayFilter, PlaySort } from "@/lib/play/library";
import { failureMessage } from "@/lib/play/storage";
import { divider, eyebrow, input, pill, pillDark } from "../ui";
import type { Say } from "./PlaybooksScreen";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;
type ImportKind = Transfer["kind"];
const MISMATCH: Record<ImportKind, string> = {
  "ffpd.play": "That file is a playbook. Use Import playbook… instead.",
  "ffpd.playbook": "That file is a single play. Use Import play… under All plays instead.",
};

export function Home({ say }: { say: Say }) {
  const router = useRouter();
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const bookFileRef = useRef<HTMLInputElement>(null);
  const playFileRef = useRef<HTMLInputElement>(null);
  const [importPreview, setImportPreview] = useState<Extract<TransferRead, { ok: true }> | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlayFilter>("all");
  const [sort, setSort] = useState<PlaySort>("recent");
  const visiblePlays = useMemo(() => discoverPlays(plays, { query, filter, sort }), [filter, plays, query, sort]);

  const onNew = () => {
    const r = createPlaybook(`Playbook ${String(books.length + 1)}`);
    if (!r.ok) { say(failureMessage(r.error), 3200); return; }
    router.push(`/playbooks?book=${r.value.id}`);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>, want: ImportKind) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setImportPreview(null);
    try {
      const read = f.size > MAX_FILE_BYTES ? { ok: false as const, error: "tooLarge" as const } : readTransfer(await f.text());
      if (!read.ok) { say(importMessage(read.error), 3200); return; }
      if (read.file.kind !== want) { say(MISMATCH[want], 3200); return; }
      setImportPreview(read);
    } catch { say("That file could not be read. Try again.", 3200); }
  };

  const preview = importPreview && <ImportPreview file={importPreview.file} skipped={importPreview.skipped} normalized={importPreview.normalized}
    onCancel={() => { setImportPreview(null); }} onImported={(id, message) => {
      setImportPreview(null); say(message, 3200); if (id) router.push(`/playbooks?book=${id}`);
    }} />;

  return (
    <>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className={eyebrow}>PLAYBOOKS</span>
          {books.length > 0 && <span className="text-caption text-ink-muted">{plural(books.length, "playbook")}</span>}
        </div>
        <SettingsButton />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onNew} className={`${pillDark} min-h-11 px-4 text-small`}>+ New playbook</button>
        <button type="button" onClick={() => bookFileRef.current?.click()} className={`${pill} min-h-11 px-3 text-small`}>Import playbook…</button>
        <input ref={bookFileRef} type="file" accept="application/json,.json" onChange={(e) => { void onFile(e, "ffpd.playbook"); }} className="hidden" aria-label="Import a playbook file" />
      </div>
      <ImportLink />
      {importPreview?.file.kind === "ffpd.playbook" && preview}
      {books.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base leading-body text-ink-muted">
          <span>No playbooks yet.</span>
          <span>Make one, add your saved plays, then print wristbands or a binder.</span>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(230px,100%),1fr))] gap-3">
          {books.map((b) => <BookCard key={b.id} book={b} plays={plays} team={team} say={say} />)}
        </div>
      )}

      <span className={divider} />
      <div className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>ALL PLAYS</span>
        {plays.length > 0 && <span className="text-caption text-ink-muted">{plural(plays.length, "play")}</span>}
        <span className="flex-1" />
        <button type="button" onClick={() => playFileRef.current?.click()} className={`${pill} min-h-11 px-3 text-small`}>Import play…</button>
        <input ref={playFileRef} type="file" accept="application/json,.json" onChange={(e) => { void onFile(e, "ffpd.play"); }} className="hidden" aria-label="Import a play file" />
      </div>
      {importPreview?.file.kind === "ffpd.play" && preview}
      {plays.length === 0 ? (
        <span className="text-base text-ink-muted">Save a play in the designer and it shows up here.</span>
      ) : (<>
        <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(180px,1fr)_auto_auto]">
          <input value={query} onChange={(e) => { setQuery(e.target.value); }} placeholder="Search names and notes" aria-label="Search saved plays" className={`${input} col-span-2 sm:col-span-1`} />
          <TypeFilter value={filter} onChange={setFilter} label="Filter saved plays" />
          <select value={sort} onChange={(e) => { setSort(e.target.value as PlaySort); }} aria-label="Sort saved plays" className={input}>
            <option value="recent">Recent</option><option value="name">Name</option>
          </select>
        </div>
        {visiblePlays.length === 0 ? (
          <div className="rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base text-ink-muted">
            No plays match. Try another search or filter.
          </div>
        ) : <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {visiblePlays.map((p) => <PlayCard key={p.id} play={p} say={say} />)}
        </div>}
      </>)}
    </>
  );
}

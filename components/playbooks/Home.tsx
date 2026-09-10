"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import {
  MAX_BACKUP_BYTES, applyBackupRestore, backupMessage, encodeBackupFile, planBackupRestore, readBackupFile, readBackupState,
  type BackupFile, type RestoreMode,
} from "@/lib/export/backup";
import { MAX_FILE_BYTES, importMessage, planImport, readPlaybookFile } from "@/lib/export/playbook-file";
import { download } from "@/lib/export/raster";
import {
  applyImport, booksHolding, createPlaybook, deletePlay, discoverPlays, getPlaybooks, getPlays, getServerPlaybooks, getServerPlays,
  getServerTeam, getTeam, refresh, setTeam, subscribe,
} from "@/lib/play/library";
import type { PlayFilter, PlaySort } from "@/lib/play/library";
import { StorageError, failureMessage } from "@/lib/play/storage";
import type { Vis } from "@/lib/play/types";
import { PlayThumb } from "../PlayThumb";
import { card, divider, eyebrow, input, pill } from "../ui";
import type { Say } from "./PlaybooksScreen";
import { ShowToggle } from "./ShowToggle";
import { TwoStep } from "./TwoStep";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

export function Home({ say, show, onShow }: { say: Say; show: Vis; onShow: (v: Vis) => void }) {
  const router = useRouter();
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const fileRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [backupPreview, setBackupPreview] = useState<BackupFile | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PlayFilter>("all");
  const [sort, setSort] = useState<PlaySort>("recent");
  const visiblePlays = useMemo(() => discoverPlays(plays, { query, filter, sort }), [filter, plays, query, sort]);

  const onNew = () => {
    const r = createPlaybook(`Playbook ${String(books.length + 1)}`);
    if (!r.ok) { say(failureMessage(r.error), 3200); return; }
    router.push(`/playbooks?book=${r.value.id}`);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    // the whole file is checked before anything is written; a refused file changes nothing
    const read = f.size > MAX_FILE_BYTES ? { ok: false as const, error: "tooLarge" as const } : readPlaybookFile(await f.text());
    if (!read.ok) { say(importMessage(read.error), 3200); return; }
    const file = read.file;
    const plan = planImport(file, getPlays(), getPlaybooks());
    const r = applyImport(plan, file.team);
    if (!r.ok) { say(`Nothing was imported · ${failureMessage(r.error)}`, 3200); return; }
    const bits = [
      plan.added ? `${plural(plan.added, "play")} added` : "",
      plan.copied ? `${plural(plan.copied, "play")} copied` : "",
      plan.reused ? `${plural(plan.reused, "play")} already here` : "",
      read.skipped ? `${plural(read.skipped, "unreadable play")} left out` : "",
    ].filter(Boolean);
    say(plan.book ? `Imported “${plan.book.name}”${bits.length ? " · " + bits.join(" · ") : ""}` : "That playbook is already here.", 3200);
    if (plan.book) router.push(`/playbooks?book=${plan.book.id}`);
  };

  const onBackup = () => {
    const file = encodeBackupFile();
    download(new Blob([file.json], { type: "application/json" }), file.filename);
    say("Device backup downloaded");
  };

  const onBackupFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const read = f.size > MAX_BACKUP_BYTES ? { ok: false as const, error: "tooLarge" as const } : readBackupFile(await f.text());
    if (!read.ok) { setBackupPreview(null); say(backupMessage(read.error), 3600); return; }
    setBackupPreview(read.file);
  };

  const restoreBackup = (mode: RestoreMode) => {
    if (!backupPreview) return;
    const plan = planBackupRestore(backupPreview, readBackupState(), mode);
    try {
      applyBackupRestore(plan);
      refresh();
      setBackupPreview(null);
      say(`${mode === "merge" ? "Merged" : "Replaced with"} backup · ${plural(plan.incomingPlays, "play")} · ${plural(plan.incomingPlaybooks, "playbook")}`, 3200);
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      say(`Nothing was restored · ${failureMessage(e)}`, 3600);
    }
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <span className={eyebrow}>PLAYBOOKS</span>
        <span className="flex-1" />
        <button type="button" onClick={onNew} className={`${pill} px-3 py-1 text-small`}>+ New playbook</button>
        <button type="button" onClick={() => fileRef.current?.click()} className={`${pill} px-3 py-1 text-small`}>Import a file…</button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => { void onFile(e); }} className="hidden" aria-label="Import a playbook file" />
      </div>
      {books.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base leading-body text-ink-muted">
          <span>No playbooks yet.</span>
          <span>Make one, add your saved plays, then print wristbands or a binder.</span>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {books.map((b) => (
            <Link key={b.id} href={`/playbooks?book=${b.id}`} className={`${card} flex flex-col gap-1 !text-ink no-underline transition-transform duration-[120ms] hover:-translate-y-0.5 motion-reduce:transition-none`}>
              <span className="truncate text-title">{b.name}</span>
              <span className="text-caption text-ink-muted">{plural(b.plays.length, "play")}</span>
            </Link>
          ))}
        </div>
      )}

      <span className={divider} />
      <span className={eyebrow}>TEAM</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={team.name}
          maxLength={40}
          placeholder="Team name"
          aria-label="Team name"
          onChange={(e) => { const r = setTeam({ ...team, name: e.target.value }); if (!r.ok) say(failureMessage(r.error), 3200); }}
          className={`${input} max-w-[280px]`}
        />
        <label className={`${pill} flex cursor-pointer items-center gap-2 px-3 py-1 text-small`}>
          <span className="h-5 w-5 rounded-full border-2 border-ink" style={{ background: team.color }} aria-hidden />
          Team colour
          <input type="color" value={team.color} aria-label="Team colour" onChange={(e) => { const r = setTeam({ ...team, color: e.target.value }); if (!r.ok) say(failureMessage(r.error), 3200); }} className="h-0 w-0 opacity-0" />
        </label>
      </div>
      <span className="text-caption leading-note text-ink-muted">Shown on cards and printed pages. Nothing else changes.</span>

      <span className={divider} />
      <div className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>ON-DEVICE BACKUP</span>
        <span className="flex-1" />
        <button type="button" onClick={onBackup} className={`${pill} px-3 py-1 text-small`}>Download backup</button>
        <button type="button" onClick={() => backupRef.current?.click()} className={`${pill} px-3 py-1 text-small`}>Restore backup…</button>
        <input ref={backupRef} type="file" accept="application/json,.json" onChange={(e) => { void onBackupFile(e); }} className="hidden" aria-label="Restore a device backup" />
      </div>
      <span className="text-caption leading-note text-ink-muted">
        Plays, playbooks, team settings and your current draft live only on this device. Download a backup before clearing site data or changing devices.
      </span>
      {backupPreview && (() => {
        const localPlayIds = new Set(plays.map((p) => p.id));
        const localBookIds = new Set(books.map((b) => b.id));
        const backupPlayIds = new Set(backupPreview.plays.map((p) => p.id));
        const backupBookIds = new Set(backupPreview.playbooks.map((b) => b.id));
        const matchingPlays = backupPreview.plays.filter((p) => localPlayIds.has(p.id)).length;
        const matchingBooks = backupPreview.playbooks.filter((b) => localBookIds.has(b.id)).length;
        const localOnlyPlays = plays.filter((p) => !backupPlayIds.has(p.id)).length;
        const localOnlyBooks = books.filter((b) => !backupBookIds.has(b.id)).length;
        return (
          <div role="region" aria-label="Restore preview" className={`${card} flex flex-col gap-2`}>
            <span className="text-title">Restore preview</span>
            <span className="text-base">
              Backup from {new Date(backupPreview.exported).toLocaleString()} · {plural(backupPreview.plays.length, "play")} · {plural(backupPreview.playbooks.length, "playbook")}
            </span>
            <span className="text-caption leading-note text-ink-muted">
              Merge keeps {plural(localOnlyPlays, "current-only play")} and {plural(localOnlyBooks, "current-only playbook")}; {plural(matchingPlays, "matching play")} and {plural(matchingBooks, "matching playbook")} use the backup version.
            </span>
            <span className="text-caption leading-note text-ink-muted">
              Replace removes those current-only items. Either choice restores the backup&apos;s team settings and {backupPreview.draft ? "current draft" : "empty draft"}.
            </span>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => { restoreBackup("merge"); }} className={`${pill} px-3 py-1 text-small`}>Merge backup</button>
              <button type="button" onClick={() => { restoreBackup("replace"); }} className={`${pill} px-3 py-1 text-small`}>Replace device data</button>
              <button type="button" onClick={() => { setBackupPreview(null); }} className={`${pill} px-3 py-1 text-small`}>Cancel</button>
            </div>
          </div>
        );
      })()}

      <span className={divider} />
      <div className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>ALL PLAYS</span>
        <span className="flex-1" />
        {plays.length > 0 && <ShowToggle value={show} onChange={onShow} />}
      </div>
      {plays.length === 0 ? (
        <span className="text-base text-ink-muted">Save a play in the designer and it shows up here.</span>
      ) : (<>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(180px,1fr)_auto_auto]">
          <input value={query} onChange={(e) => { setQuery(e.target.value); }} placeholder="Search names and notes" aria-label="Search saved plays" className={input} />
          <select value={filter} onChange={(e) => { setFilter(e.target.value as PlayFilter); }} aria-label="Filter saved plays" className={input}>
            <option value="all">All types</option><option value="run">Run</option><option value="pass">Pass</option><option value="defense">Defense</option>
          </select>
          <select value={sort} onChange={(e) => { setSort(e.target.value as PlaySort); }} aria-label="Sort saved plays" className={input}>
            <option value="recent">Recent</option><option value="name">Name</option>
          </select>
        </div>
        {visiblePlays.length === 0 ? (
          <div className="rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base text-ink-muted">
            No plays match. Try another search or filter.
          </div>
        ) : <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {visiblePlays.map((p) => {
            const holding = booksHolding(p.id).length;
            return (
              <div key={p.id} className={`${card} flex flex-col gap-2`}>
                <PlayThumb players={p.players} name={p.name} show={show} />
                <span className="truncate text-base" title={p.name}>{p.name}</span>
                <div className="flex flex-wrap gap-1.5">
                  <Link href={`/?open=${p.id}`} className={`${pill} inline-block px-3 py-1 text-small !text-ink no-underline`}>Open ›</Link>
                  <TwoStep
                    label="Delete"
                    confirm={holding ? `Delete? It's in ${plural(holding, "playbook")}` : "Delete?"}
                    onConfirm={() => { const r = deletePlay(p.id); say(r.ok ? `Deleted “${p.name}”` : failureMessage(r.error), r.ok ? undefined : 3200); }}
                  />
                </div>
              </div>
            );
          })}
        </div>}
      </>)}
    </>
  );
}

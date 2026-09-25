"use client";

import { useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import {
  MAX_BACKUP_BYTES, applyBackupRestore, backupMessage, encodeBackupFile, planBackupRestore, readBackupFile, readBackupState,
  type BackupFile, type RestoreMode,
} from "@/lib/export/backup";
import { download } from "@/lib/export/raster";
import { getPlaybooks, getPlays, getServerPlaybooks, getServerPlays, getServerTeam, getTeam, refresh, setTeam, subscribe } from "@/lib/play/library";
import { StorageError, failureMessage } from "@/lib/play/storage";
import { ThemePicker } from "../ThemePicker";
import { card, divider, eyebrow, input, pill, pillDark } from "../ui";
import { PreviewModal } from "./PreviewModal";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/**
 * Team identity, theme and device backup: set once, rarely touched, so they live behind one button
 * instead of above the plays. The button shows the team's colour and name so it still reads as "you".
 */
export function SettingsButton() {
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); }}
        className={`${pill} inline-flex min-h-11 max-w-[220px] items-center gap-2 px-3 text-small`}>
        <span aria-hidden className="h-4 w-4 flex-none rounded-full border-2 border-ink" style={{ background: team.color }} />
        <span className="truncate">{team.name || "Team"}</span>
        <span className="sr-only"> · team, theme &amp; backup settings</span>
        <span aria-hidden className="text-ink-muted">⚙</span>
      </button>
      {open && <PreviewModal title="Team, theme & backup" onClose={() => { setOpen(false); }}><SettingsPanel /></PreviewModal>}
    </>
  );
}

function SettingsPanel() {
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const backupRef = useRef<HTMLInputElement>(null);
  const [backupPreview, setBackupPreview] = useState<BackupFile | null>(null);
  // the page toast sits under the modal, so this dialog reports in place
  const [message, setMessage] = useState("");

  const onBackup = () => {
    const file = encodeBackupFile();
    download(new Blob([file.json], { type: "application/json" }), file.filename);
    setMessage("Device backup downloaded");
  };

  const onBackupFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const read = f.size > MAX_BACKUP_BYTES ? { ok: false as const, error: "tooLarge" as const } : readBackupFile(await f.text());
    if (!read.ok) { setBackupPreview(null); setMessage(backupMessage(read.error)); return; }
    setMessage("");
    setBackupPreview(read.file);
  };

  const restoreBackup = (mode: RestoreMode) => {
    if (!backupPreview) return;
    const plan = planBackupRestore(backupPreview, readBackupState(), mode);
    try {
      applyBackupRestore(plan);
      refresh();
      setBackupPreview(null);
      setMessage(`${mode === "merge" ? "Merged" : "Replaced with"} backup · ${plural(plan.incomingPlays, "play")} · ${plural(plan.incomingPlaybooks, "playbook")}`);
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      setMessage(`Nothing was restored · ${failureMessage(e)}`);
    }
  };

  const onTeam = (next: typeof team) => { const r = setTeam(next); if (!r.ok) setMessage(failureMessage(r.error)); };

  return (
    <div className="flex flex-col gap-3">
      <span className={eyebrow}>TEAM</span>
      <div className="flex flex-wrap items-center gap-2">
        <input value={team.name} maxLength={40} placeholder="Team name" aria-label="Team name"
          onChange={(e) => { onTeam({ ...team, name: e.target.value }); }} className={`${input} min-w-0 flex-1 basis-[220px]`} />
        <label className={`${pill} relative flex min-h-11 cursor-pointer items-center gap-2 px-3 text-small`}>
          <span className="h-5 w-5 rounded-full border-2 border-ink" style={{ background: team.color }} aria-hidden />
          Team colour
          <input type="color" value={team.color} aria-label="Team colour" onChange={(e) => { onTeam({ ...team, color: e.target.value }); }} className="absolute h-0 w-0 opacity-0" />
        </label>
      </div>
      <span className="text-caption leading-note text-ink-muted">Shown on cards and printed pages. Nothing else changes.</span>

      <span className={divider} />
      <span className={eyebrow}>THEME</span>
      <ThemePicker className="max-w-[320px]" />
      <span className="text-caption leading-note text-ink-muted">Auto follows this device. Printed pages and exports stay ink on paper.</span>

      <span className={divider} />
      <span className={eyebrow}>ON-DEVICE BACKUP</span>
      <span className="text-caption leading-note text-ink-muted">
        Plays, playbooks, team settings and your current draft are saved on this device. Download a backup before clearing site data or changing devices.
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBackup} className={`${pillDark} min-h-11 px-4 text-small`}>Download backup</button>
        <button type="button" onClick={() => backupRef.current?.click()} className={`${pill} min-h-11 px-3 text-small`}>Restore backup…</button>
        <input ref={backupRef} type="file" accept="application/json,.json" onChange={(e) => { void onBackupFile(e); }} className="hidden" aria-label="Restore a device backup" />
      </div>
      {message && <div role="status" className="text-small">{message}</div>}
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
              <button type="button" onClick={() => { restoreBackup("merge"); }} className={`${pill} min-h-11 px-3 text-small`}>Merge backup</button>
              <button type="button" onClick={() => { restoreBackup("replace"); }} className={`${pill} min-h-11 px-3 text-small`}>Replace device data</button>
              <button type="button" onClick={() => { setBackupPreview(null); }} className={`${pill} min-h-11 px-3 text-small`}>Cancel</button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { RELEASE, record, scrubText } from "@/lib/diagnostics";
import { encodeRecoveryFile } from "@/lib/export/playbook-file";
import { download } from "@/lib/export/raster";
import { DRAFT_KEY, newId, readDraft, type DraftRecord } from "@/lib/play/storage";
import { ReportLink, StorageNote } from "./Support";
import { card, eyebrow, pill } from "./ui";

interface Props {
  error: unknown;
  /** re-renders what broke; Next's error boundaries hand this in */
  retry: () => void;
}

/** The draft the designer autosaves, when this browser has one and can still read it. */
function safeDraft(): DraftRecord | null {
  try {
    return readDraft();
  } catch {
    return null;
  }
}

// the draft as an external store: the same object comes back until the stored text changes
let cache: { raw: string | null; draft: DraftRecord | null } | null = null;
function draftSnapshot(): DraftRecord | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(DRAFT_KEY);
  } catch {
    raw = null;
  }
  if (!cache || cache.raw !== raw) cache = { raw, draft: safeDraft() };
  return cache.draft;
}
const noDraft = (): DraftRecord | null => null;
function subscribeDraft(cb: () => void): () => void {
  window.addEventListener("storage", cb);
  return () => { window.removeEventListener("storage", cb); };
}

/** A short label for the error, safe to show and to quote in a report. */
function label(error: unknown): string {
  const name = error instanceof Error ? scrubText(error.name || "Error") : typeof error;
  const digest = typeof error === "object" && error !== null && "digest" in error && typeof error.digest === "string" ? ` · ${scrubText(error.digest)}` : "";
  return `${name}${digest} · ${RELEASE}`;
}

/**
 * What a coach sees when the screen itself broke: the work is probably still in this
 * browser's autosave, so there is a way to download it before trying again or reloading.
 * Everything here is wrapped so a second failure still leaves the buttons working.
 */
export function ErrorRecovery({ error, retry }: Props) {
  const draft = useSyncExternalStore(subscribeDraft, draftSnapshot, noDraft);
  const [status, setStatus] = useState<string | null>(null);
  const id = label(error);

  // remembered once per error, on this device only, for "Report a problem"
  useEffect(() => { record("boundary", error); }, [error]);

  const onDownload = () => {
    const d = draft ?? safeDraft();
    if (!d) { setStatus("Nothing to download: no play was in progress."); return; }
    const play = { id: d.id ?? newId(), name: d.name, notes: d.notes ?? "", players: [...d.players] };
    Promise.resolve()
      .then(() => {
        const file = encodeRecoveryFile(play);
        download(new Blob([file.json], { type: "application/json" }), file.filename);
        setStatus(`Downloaded ${file.filename}. Import it from Playbooks when you're back.`);
      })
      .catch(() => { setStatus("Couldn't build the file. Try again once you're online."); });
  };

  return (
    <main className="flex h-full flex-col items-center justify-center overflow-y-auto bg-paper p-4">
      <div role="alert" className={`${card} flex w-full max-w-[420px] flex-col gap-3 leading-body`}>
        <span className={eyebrow}>SOMETHING BROKE</span>
        <h1 className="m-0 text-header font-normal">This screen stopped working.</h1>
        <div className="rounded-note border-2 border-ink bg-yellow px-[10px] py-2 text-base leading-note">
          {draft
            ? <>The play you were drawing (“{draft.name || "Untitled play"}”) is still in this browser&apos;s autosave, but it may not be saved to your plays. Download it first, just in case.</>
            : <>Unsaved work may be at risk. Plays you saved are still in this browser.</>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onDownload} className={`${pill} px-3 py-1 text-small`}>Download play</button>
          <button type="button" onClick={retry} className={`${pill} px-3 py-1 text-small`}>Try again</button>
          <button type="button" onClick={() => { window.location.reload(); }} className={`${pill} px-3 py-1 text-small`}>Reload</button>
        </div>
        {status && <span role="status" className="text-caption leading-note text-ink-muted">{status}</span>}
        <span className="text-caption leading-note text-ink-muted">
          Still stuck? <ReportLink /> — it opens a GitHub issue with the error, app version and browser, and never your plays or notes.
          {" "}Error: {id}.
        </span>
        <StorageNote />
      </div>
    </main>
  );
}

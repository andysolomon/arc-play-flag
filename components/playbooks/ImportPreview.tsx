"use client";

import { useState, useSyncExternalStore } from "react";
import { planTransfer, transferPlays, type Transfer } from "@/lib/export/transfer";
import { applyImport, getPlaybooks, getPlays, getServerPlaybooks, getServerPlays, subscribe } from "@/lib/play/library";
import { failureMessage } from "@/lib/play/storage";
import { PlayThumb } from "../PlayThumb";
import { card, pill } from "../ui";

export function ImportPreview({ file, skipped = 0, normalized = false, onCancel, onImported }: {
  file: Transfer; skipped?: number; normalized?: boolean; onCancel?: () => void;
  onImported: (bookId: string | null, message: string) => void;
}) {
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const plan = planTransfer(file, plays, books);
  const isBook = file.kind === "ffpd.playbook";
  const title = isBook ? file.playbook.name : file.play.name;
  const items = transferPlays(file);
  const confirm = () => {
    // Recompute at confirmation so a concurrent local edit is never overwritten.
    const current = planTransfer(file, getPlays(), getPlaybooks());
    const result = applyImport(current, isBook ? file.team : null);
    if (!result.ok) { setError(`Nothing was imported · ${failureMessage(result.error)}`); return; }
    const count = (n: number) => `${String(n)} ${n === 1 ? "play" : "plays"}`;
    const bits = [current.added ? `${count(current.added)} added` : "", current.copied ? `${count(current.copied)} copied` : "", current.reused ? `${count(current.reused)} already here` : ""].filter(Boolean);
    onImported(current.bookId, `Imported “${title}”${bits.length ? " · " + bits.join(" · ") : ""}`);
  };
  return (
    <section aria-label="Import preview" className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title">{title}</h2>
      <p>{items.length} {items.length === 1 ? "play" : "plays"} · {plan.added} added · {plan.copied} copied · {plan.reused} already here</p>
      <p className="text-caption">Your existing plays stay intact. Imported copies can be edited on this device.</p>
      {!!skipped && <p role="status">{skipped} unreadable plays will be left out.</p>}
      {normalized && <p role="status">Some fields or missing references were repaired or removed. Review the resulting plays before importing.</p>}
      {isBook && file.team && <p className="text-caption">Team: {file.team.name}. Applied only if this device has no team settings.</p>}
      <details onToggle={event => { setExpanded(event.currentTarget.open); }}>
        <summary className="cursor-pointer py-2">Preview plays and notes</summary>
        {expanded && <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-3 py-2">
          {items.map((play, i) => <li key={play.id} className="min-w-0">
            <PlayThumb players={play.players} name={play.name} side={play.side} />
            <p className="break-words">{i + 1}. {play.name}</p><p className="whitespace-pre-wrap break-words text-caption">{play.notes}</p>
          </li>)}
        </ol>}
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={confirm} className={`${pill} min-h-11 px-3`}>{isBook ? "Import playbook" : "Import play"}</button>
        {onCancel && <button type="button" onClick={onCancel} className={`${pill} min-h-11 px-3`}>Cancel</button>}
      </div>
    </section>
  );
}

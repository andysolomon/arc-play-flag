"use client";

import { memo, type ReactNode, type ChangeEvent } from "react";
import { MAX_NOTES } from "@/lib/play/storage";
import type { SavedPlay, Team, Vis } from "@/lib/play/types";
import { IconTile, LinkTile } from "./IconTile";
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
  onLoad: (id: string) => void;
  onShare: () => void;
  onFlip: () => void;
  onClear: (team: Team | null) => void;
  onReset: (team: Team | null) => void;
  onVis: (vis: Vis) => void;
}

function PlaySidebarImpl({
  name, notes, notesOpen, vis, plays, onName, onNotes, onToggleNotes, onNew, onSave, onDuplicate, onExport, onLoad, onShare,
  exportOpen, exportPanel, onFlip, onClear, onReset, onVis,
}: Props) {
  const scope: Team | null = vis === "both" ? null : vis;
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
      {plays.length > 0 && (
        <select
          value=""
          onChange={(e: ChangeEvent<HTMLSelectElement>) => { if (e.target.value) onLoad(e.target.value); }}
          aria-label="Open a saved play"
          className="w-full flex-none cursor-pointer rounded-pill border-2 border-ink bg-white px-3 py-1.5 text-base"
        >
          <option value="">Open a saved play…</option>
          {plays.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
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
    </>
  );
}

export const PlaySidebar = memo(PlaySidebarImpl);

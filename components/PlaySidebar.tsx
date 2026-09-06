"use client";

import { memo, type ChangeEvent } from "react";
import type { Team, Vis } from "@/lib/play/types";
import { IconTile } from "./IconTile";
import { divider, eyebrow, input, tileGrid } from "./ui";

interface Props {
  name: string;
  vis: Vis;
  savedNames: readonly string[];
  onName: (name: string) => void;
  onSave: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onLoad: (name: string) => void;
  onFlip: () => void;
  onClear: (team: Team | null) => void;
  onReset: (team: Team | null) => void;
  onVis: (vis: Vis) => void;
}

function PlaySidebarImpl({
  name, vis, savedNames, onName, onSave, onDuplicate, onExport, onLoad, onFlip, onClear, onReset, onVis,
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
        <IconTile icon="save" label="Save" onClick={onSave} />
        <IconTile icon="duplicate" label="Duplicate" onClick={onDuplicate} />
        <IconTile icon="export" label="Export" title="Download the field as a PNG" onClick={onExport} />
      </div>
      {savedNames.length > 0 && (
        <select
          value=""
          onChange={(e: ChangeEvent<HTMLSelectElement>) => { if (e.target.value) onLoad(e.target.value); }}
          aria-label="Open a saved play"
          className="w-full flex-none cursor-pointer rounded-pill border-2 border-ink bg-white px-3 py-1.5 text-base"
        >
          <option value="">Open a saved play…</option>
          {savedNames.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      )}
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

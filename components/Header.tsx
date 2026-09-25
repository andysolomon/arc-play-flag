"use client";

import { memo } from "react";
import type { Team } from "@/lib/play/types";
import { pillMd, pillSm } from "./ui";
import { Sticker } from "./Sticker";

interface Props {
  /** offensive play or defensive call */
  side: Team;
  leftOpen: boolean;
  rightOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** something is drawn on this play's team */
  canClear: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

const SIDE: Record<Team, { label: string; title: string }> = {
  offense: { label: "Offense", title: "This is an offensive play" },
  defense: { label: "Defense", title: "This is a defensive call" },
};

/** Icon-only on phones: a 44px circle with the glyph centred, instead of a tall oval round a bare character. */
const round = "inline-flex shrink-0 items-center justify-center gap-1 max-[479px]:w-11 max-[479px]:px-0";

/** Three-line menu mark for Play tools, so it reads as a menu instead of a panel chevron. */
function MenuIcon() {
  return (
    <svg aria-hidden="true" width="16" height="14" viewBox="0 0 16 14" className="block shrink-0">
      <path d="M1 2h14M1 7h14M1 12h14" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  );
}

/** A drawn chevron, so the Routes toggle centres exactly instead of sitting on the font's baseline. */
function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" className="block shrink-0">
      <path d={dir === "left" ? "M9 2 4 7l5 5" : "M5 2l5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeaderImpl({ side, leftOpen, rightOpen, canUndo, canRedo, canClear, onToggleLeft, onToggleRight, onUndo, onRedo, onClear }: Props) {
  const kind = SIDE[side];
  return (
    <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5 max-[1023px]:gap-1.5">
      <button
        type="button"
        onClick={onToggleLeft}
        title="Play tools"
        aria-label="Play tools"
        aria-expanded={leftOpen}
        aria-controls="play-sidebar"
        data-active={leftOpen}
        className={`${pillSm} ${round} data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
      >
        <MenuIcon /><span className="max-[479px]:hidden">Play</span>
      </button>
      <div className="min-w-0 flex-1" />
      <div className="flex gap-1.5">
        <span
          role="img"
          aria-label={`${kind.label} play`}
          title={kind.title}
          className={`${pillSm} ${round} pointer-events-none inline-flex bg-white`}
        >
          <Sticker icon={side} size={22} className="shrink-0" />
          <span className="max-[479px]:hidden">{kind.label}</span>
        </span>
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo" className={`${pillMd} ${round}`}>
          <Sticker icon="undo" size={24} className={`shrink-0 ${canUndo ? "" : "opacity-40"}`} />
          <span className="max-[479px]:hidden">Undo</span>
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo" className={`${pillMd} ${round}`}>
          <span className="max-[479px]:hidden">Redo</span>
          <Sticker icon="redo" size={24} className={`shrink-0 ${canRedo ? "" : "opacity-40"}`} />
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!canClear}
          title="Clear routes (undoable)"
          aria-label="Clear routes"
          className={`${pillMd} ${round}`}
        >
          <Sticker icon="clear" size={22} className={`shrink-0 ${canClear ? "" : "opacity-40"}`} />
          <span className="max-[479px]:hidden">Clear</span>
        </button>
      </div>
      <button
        type="button"
        onClick={onToggleRight}
        title="Route palette"
        aria-label="Route palette"
        aria-expanded={rightOpen}
        aria-controls="route-sidebar"
        data-active={rightOpen}
        className={`${pillSm} ${round} data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
      >
        <span className="max-[479px]:hidden">Routes</span><Chevron dir={rightOpen ? "right" : "left"} />
      </button>
    </header>
  );
}

export const Header = memo(HeaderImpl);

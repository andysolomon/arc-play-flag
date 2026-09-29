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

/**
 * On phones each control is a 44px-tall key with its glyph over a small name, so a coach can tell
 * Clear from Undo without trying them; from 480px up the name sits beside the glyph.
 */
const round =
  "inline-flex shrink-0 items-center justify-center gap-1 max-[479px]:min-w-11 max-[479px]:flex-col max-[479px]:gap-0.5 " +
  "max-[479px]:rounded-[14px] max-[479px]:px-1 max-[479px]:py-0.5";
/** The same key for a control whose name comes before its glyph on wider screens (Redo, Routes). */
const roundAfter = round.replace("max-[479px]:flex-col ", "max-[479px]:flex-col-reverse ");
/** Stickers shrink a little on phones to leave room for the name under them. */
const glyph = "shrink-0 max-[479px]:h-5 max-[479px]:w-5";
/** The name under the glyph on phones. */
const name = "max-[479px]:text-[11px] max-[479px]:leading-none";

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
        <MenuIcon /><span className={name}>Play</span>
      </button>
      <div className="min-w-0 flex-1" />
      <div className="flex gap-1.5">
        <span
          role="img"
          aria-label={`${kind.label} play`}
          title={kind.title}
          className={`${pillSm} ${round} pointer-events-none inline-flex bg-white`}
        >
          <Sticker icon={side} size={22} className={glyph} />
          <span className={name}>{kind.label}</span>
        </span>
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo" className={`${pillMd} ${round}`}>
          <Sticker icon="undo" size={24} className={`${glyph} ${canUndo ? "" : "opacity-40"}`} />
          <span className={name}>Undo</span>
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo" className={`${pillMd} ${roundAfter}`}>
          <span className={name}>Redo</span>
          <Sticker icon="redo" size={24} className={`${glyph} ${canRedo ? "" : "opacity-40"}`} />
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!canClear}
          title="Clear routes (undoable)"
          aria-label="Clear routes"
          className={`${pillMd} ${round}`}
        >
          <Sticker icon="clear" size={22} className={`${glyph} ${canClear ? "" : "opacity-40"}`} />
          <span className={name}>Clear</span>
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
        className={`${pillSm} ${roundAfter} data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
      >
        <span className={name}>Routes</span><Chevron dir={rightOpen ? "right" : "left"} />
      </button>
    </header>
  );
}

export const Header = memo(HeaderImpl);

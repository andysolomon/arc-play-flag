"use client";

import { memo } from "react";
import type { Vis } from "@/lib/play/types";
import { pillMd, pillSm } from "./ui";
import { Sticker } from "./Sticker";

export type Mode = "play" | "roster";

interface Props {
  /** drawing the play, or laying out the roster (docs/adr/008-roster-depth-chart.md) */
  mode: Mode;
  /** roster mode: which side of the roster is on the field, or both */
  view: Vis;
  /** the badge tapped in roster mode: the next view, offense, defense, both and round again */
  onView: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** something is drawn on this play's team */
  canClear: boolean;
  /** the play differs from its last Save, so the Save key wears a dot */
  unsaved: boolean;
  onSave: () => void;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  /**
   * roster mode's way out at the top: back to the play, as the Roster tile in Play tools goes
   * (docs/adr/008-roster-depth-chart.md); `keyboard` when Enter or Space pressed it, not a tap or a click
   */
  onBack: (keyboard: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

/** The roster view the badge shows and the one a tap goes to next: offense, defense, both and round again. */
export const VIEW: Record<Vis, { label: string; icon: string; next: Vis; title: string }> = {
  offense: { label: "Offense", icon: "offense", next: "defense", title: "Showing the offense. Tap for the defense." },
  defense: { label: "Defense", icon: "defense", next: "both", title: "Showing the defense. Tap for both sides." },
  both: { label: "Both", icon: "roster", next: "offense", title: "Showing both sides. Tap for the offense." },
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

/** A drawn arrow with a shaft, so Back reads apart from the panel toggle's chevron and Undo's curl. */
function BackIcon() {
  return (
    <svg aria-hidden="true" width="16" height="14" viewBox="0 0 16 14" className="block shrink-0">
      <path d="M15 7H2M7 1.5 1.5 7 7 12.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
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

function HeaderImpl({
  mode, view, onView, leftOpen, rightOpen, canUndo, canRedo, canClear, unsaved, onSave, onToggleLeft, onToggleRight, onBack, onUndo, onRedo, onClear,
}: Props) {
  const rostering = mode === "roster";
  const showing = VIEW[view];
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
      {rostering && (
        // nothing in roster mode is the play's to undo or clear, so the way back to it has their room, where a back key goes
        <button type="button" onClick={(e) => { onBack(e.detail === 0); }} title="Back to play" aria-label="Back to play" className={`${pillSm} ${round}`}>
          <BackIcon />
          <span className={`${name} min-[479px]:hidden`}>Back</span>
          <span className="max-[479px]:hidden">Back to play</span>
        </button>
      )}
      <div className="min-w-0 flex-1" />
      <div className="flex gap-1.5">
        {rostering ? (
          // the roster has both sides and no play to save: the badge is the way between them, and to both at once
          <button
            type="button"
            onClick={onView}
            title={showing.title}
            aria-label={`Showing ${showing.label.toLowerCase()}`}
            className={`${pillSm} ${round} bg-white`}
          >
            <Sticker icon={showing.icon} size={22} className={glyph} />
            <span className={name}>{showing.label}</span>
          </button>
        ) : (
          // Save, one tap from the field: the play's own colours already say whose play it is
          <button
            type="button"
            onClick={onSave}
            title={unsaved ? "Save changes to this play (⌘S)" : "Save this play (⌘S)"}
            aria-label="Save play"
            aria-keyshortcuts="Control+S Meta+S"
            className={`${pillMd} ${round}`}
          >
            <span className="relative inline-flex shrink-0">
              <Sticker icon="save" size={22} className={glyph} />
              {unsaved && <span aria-hidden className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-ink bg-yellow" />}
            </span>
            <span className={name}>Save</span>
          </button>
        )}
        {!rostering && (
          <>
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
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onToggleRight}
        title={rostering ? "Roster panel" : "Route palette"}
        aria-label={rostering ? "Roster panel" : "Route palette"}
        aria-expanded={rightOpen}
        aria-controls="route-sidebar"
        data-active={rightOpen}
        className={`${pillSm} ${roundAfter} data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
      >
        <span className={name}>{rostering ? "Roster" : "Routes"}</span><Chevron dir={rightOpen ? "right" : "left"} />
      </button>
    </header>
  );
}

export const Header = memo(HeaderImpl);

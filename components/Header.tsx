"use client";

import Image from "next/image";
import { memo } from "react";
import { pillMd, pillSm } from "./ui";

interface Props {
  leftOpen: boolean;
  rightOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  /** something is drawn on the team being shown */
  canClear: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

function HeaderImpl({ leftOpen, rightOpen, canUndo, canRedo, canClear, onToggleLeft, onToggleRight, onUndo, onRedo, onClear }: Props) {
  return (
    <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5">
      <button
        type="button"
        onClick={onToggleLeft}
        title="Play tools"
        aria-expanded={leftOpen}
        aria-controls="play-sidebar"
        data-active={leftOpen}
        className={`${pillSm} data-[active=true]:bg-yellow`}
      >
        {leftOpen ? "‹" : "›"} Play
      </button>
      <h1 className="whitespace-nowrap text-caption font-normal text-ink-muted max-[479px]:hidden">5v5 flag</h1>
      <span className="flex-1" />
      <div className="flex gap-1.5">
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo" className={pillMd}>
          ↶<span className="max-[479px]:hidden"> Undo</span>
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo" className={pillMd}>
          <span className="max-[479px]:hidden">Redo </span>↷
        </button>
        <button
          type="button"
          onClick={onClear}
          disabled={!canClear}
          title="Clear routes (undoable)"
          aria-label="Clear routes"
          className={`${pillMd} flex shrink-0 items-center gap-1`}
        >
          <Image src="/icons/clear.png" alt="" width={18} height={18} sizes="18px" className={`block shrink-0 ${canClear ? "" : "opacity-40"}`} />
          Clear
        </button>
      </div>
      <button
        type="button"
        onClick={onToggleRight}
        title="Route palette"
        aria-expanded={rightOpen}
        aria-controls="route-sidebar"
        data-active={rightOpen}
        className={`${pillSm} data-[active=true]:bg-yellow`}
      >
        Routes {rightOpen ? "›" : "‹"}
      </button>
    </header>
  );
}

export const Header = memo(HeaderImpl);

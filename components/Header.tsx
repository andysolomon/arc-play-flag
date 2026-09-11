"use client";

import Image from "next/image";
import Link from "next/link";
import { memo } from "react";
import { pillMd, pillSm } from "./ui";

interface Props {
  name: string;
  persistence: "saved" | "unsaved" | "autosaved" | "failed";
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

const persistenceLabel: Record<Props["persistence"], string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  autosaved: "Draft autosaved",
  failed: "Saving failed",
};

function HeaderImpl({ name, persistence, leftOpen, rightOpen, canUndo, canRedo, canClear, onToggleLeft, onToggleRight, onUndo, onRedo, onClear }: Props) {
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
        className={`${pillSm} data-[active=true]:bg-yellow`}
      >
        {leftOpen ? "‹" : "›"}<span className="max-[479px]:hidden"> Play</span>
      </button>
      <div className="min-w-0 flex-1 leading-none">
        <h1 className="truncate text-base font-normal text-ink" title={name}>{name}</h1>
        <span className={`whitespace-nowrap text-caption ${persistence === "failed" ? "text-offense" : "text-ink-muted"}`} aria-live="polite">
          {persistenceLabel[persistence]}
        </span>
      </div>
      <div className="flex gap-1.5">
        <Link
          href="/demo"
          title="Demo: watch the feature tour"
          aria-label="Demo"
          className={`${pillMd} flex shrink-0 items-center gap-1 !text-ink no-underline`}
        >
          <Image src="/icons/demo.png" alt="" width={18} height={18} sizes="18px" className="block shrink-0" />
          <span className="max-[479px]:hidden">Demo</span>
        </Link>
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
        className={`${pillSm} data-[active=true]:bg-yellow`}
      >
        <span className="max-[479px]:hidden">Routes </span>{rightOpen ? "›" : "‹"}
      </button>
    </header>
  );
}

export const Header = memo(HeaderImpl);

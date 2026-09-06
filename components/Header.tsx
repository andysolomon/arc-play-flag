"use client";

import Image from "next/image";
import { memo } from "react";
import { pillMd, pillSm } from "./ui";

interface Props {
  name: string;
  leftOpen: boolean;
  rightOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

function HeaderImpl({ name, leftOpen, rightOpen, canUndo, canRedo, onToggleLeft, onToggleRight, onUndo, onRedo }: Props) {
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
      <Image src="/icons/football.png" alt="" width={26} height={26} sizes="26px" className="block flex-none" priority />
      <h1 className="min-w-0 truncate text-header font-normal">{name}</h1>
      <span className="whitespace-nowrap text-caption text-ink-muted max-[479px]:hidden">5v5 flag</span>
      <span className="flex-1" />
      <div className="flex gap-1.5">
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo" className={pillMd}>
          ↶<span className="max-[479px]:hidden"> Undo</span>
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo" className={pillMd}>
          <span className="max-[479px]:hidden">Redo </span>↷
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

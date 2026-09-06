"use client";

import Image from "next/image";
import { memo } from "react";
import type { Player } from "@/lib/play/types";
import { Note } from "./Hint";
import { eyebrow } from "./ui";

interface Props {
  selected: Player | null;
  hint: string | null;
}

function RouteSidebarImpl({ selected, hint }: Props) {
  return (
    <>
      <span className={eyebrow}>ROUTES</span>
      {!selected && (
        <div className="flex flex-none flex-col items-center gap-[10px] rounded-tile border-2 border-dashed border-ink px-[10px] py-[18px]">
          <Image src="/icons/football.png" alt="" width={56} height={56} sizes="56px" className="block opacity-75" />
          <span className="text-center text-base leading-body text-ink-muted">
            Tap a player to give them a route.
            <br />
            Drag to move them.
          </span>
        </div>
      )}
      {hint && <Note text={hint} />}
    </>
  );
}

export const RouteSidebar = memo(RouteSidebarImpl);

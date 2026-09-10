"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import type { Player, Vis } from "@/lib/play/types";
import { Field } from "./Field";
import { pillSm } from "./ui";

interface Props {
  id: string;
  name: string;
  players: Player[];
  vis: Vis;
}

const noop = (): void => undefined;

/** Read-only view of a shared play, with a way back into the designer. */
export function SharedPlay({ id, name, players, vis }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const shown = vis === "both" ? "Both teams" : vis === "offense" ? "Offense only" : "Defense only";
  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5 print:hidden">
        <Image src="/icons/football.png" alt="" width={26} height={26} sizes="26px" className="block flex-none" priority />
        <h1 className="min-w-0 truncate text-header font-normal">{name}</h1>
        <span className="whitespace-nowrap text-caption text-ink-muted max-[479px]:hidden">Snapshot · {shown}</span>
        <span className="flex-1" />
        <Link href={`/?p=${id}`} className={`${pillSm} inline-block !text-ink no-underline`}>
          Open in designer ›
        </Link>
      </header>
      <p className="flex-none border-b-2 border-ink bg-yellow-soft px-3 py-1 text-center text-caption text-ink-muted print:hidden">
        This link is a snapshot, not a live view. Changes made in the designer later do not update it.
      </p>
      <div className="flex min-h-0 flex-1 items-stretch">
        <Field
          players={players}
          vis={vis}
          selectedId={null}
          targeting={false}
          draft={null}
          dispatch={noop}
          onSelect={noop}
          svgRef={svgRef}
          readOnly
          title={name}
        />
      </div>
    </div>
  );
}

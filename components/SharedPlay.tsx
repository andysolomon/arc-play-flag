"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef } from "react";
import type { Player } from "@/lib/play/types";
import { Field } from "./Field";
import { pillSm } from "./ui";

interface Props {
  id: string;
  name: string;
  players: Player[];
}

const noop = (): void => undefined;

/** Read-only view of a shared play, with a way back into the designer. */
export function SharedPlay({ id, name, players }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5 print:hidden">
        <Image src="/icons/football.png" alt="" width={26} height={26} sizes="26px" className="block flex-none" priority />
        <h1 className="min-w-0 truncate text-header font-normal">{name}</h1>
        <span className="whitespace-nowrap text-caption text-ink-muted max-[479px]:hidden">5v5 flag</span>
        <span className="flex-1" />
        <Link href={`/?p=${id}`} className={`${pillSm} inline-block !text-ink no-underline`}>
          Open in designer ›
        </Link>
      </header>
      <div className="flex min-h-0 flex-1 items-stretch">
        <Field
          players={players}
          vis="both"
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

"use client";

import Link from "next/link";
import { useRef } from "react";
import { COVERAGE_WORDS, coverageOf } from "@/lib/play/coverage";
import { ballPlanLine } from "@/lib/play/ball-plan";
import type { Player, Team } from "@/lib/play/types";
import { Field } from "./Field";
import { pillSm } from "./ui";
import { Sticker } from "./Sticker";

interface Props {
  ballPlan?: import("@/lib/play/types").BallStep[];
  id: string;
  name: string;
  players: Player[];
  /** offensive play or defensive call */
  side: Team;
  /** as the coach's field had them when they shared */
  noRunZones: boolean;
  /** the play includes the other team, faded, in its pictures, so the snapshot does too */
  artShadow?: boolean;
  /** the yard line the shared play's ball is on */
  los: number;
  /** the coach's notes, as they were when the link was made; empty when there were none */
  notes?: string;
}

const noop = (): void => undefined;

/** Read-only view of a shared play, with a way back into the designer. */
export function SharedPlay({ id, name, players, side, noRunZones, artShadow = false, los, notes = "", ballPlan }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const cover = side === "defense" ? coverageOf(players) : null;
  // a defensive call says its coverage, as the stamp on its pictures does
  const words = cover ? COVERAGE_WORDS[cover] : "";
  const kind = side === "defense" ? `Defensive call${words ? ` · ${words.charAt(0).toUpperCase()}${words.slice(1)} coverage` : ""}` : "Offensive play";
  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5 print:hidden">
        <Sticker icon="football" size={26} className="flex-none" priority />
        <h1 className="min-w-0 truncate text-header font-normal">{name}</h1>
        <span className="min-w-0 shrink-[100] truncate whitespace-nowrap text-caption text-ink-muted max-[479px]:hidden">{kind} · Snapshot</span>
        <span className="flex-1" />
        <Link href={`/?p=${id}`} className={`${pillSm} inline-flex items-center !text-ink no-underline`}>
          Open in designer ›
        </Link>
      </header>
      <p className="flex-none border-b-2 border-ink bg-yellow-soft px-3 py-1 text-center text-caption text-ink-muted print:hidden">
        This link is a snapshot, not a live view. Changes made in the designer later do not update it.
      </p>
      <div className="flex min-h-0 flex-1 items-stretch">
        <Field
          players={players}
          ballPlan={ballPlan}
          vis={artShadow ? "both" : side}
          side={side}
          selectedId={null}
          targeting={false}
          draft={null}
          dispatch={noop}
          onSelect={noop}
          svgRef={svgRef}
          readOnly
          noRunZones={noRunZones}
          los={los}
          title={name}
        />
      </div>
      {!!ballPlan?.length && side === "offense" && <p className="max-h-[24%] flex-none overflow-y-auto border-t-2 border-ink bg-cream px-3 py-2 text-small leading-note">{ballPlanLine(players, ballPlan)}</p>}
      {notes.trim() && (
        <section
          aria-labelledby="shared-notes-title"
          className="max-h-[32%] flex-none overflow-y-auto border-t-2 border-ink bg-cream px-3 py-2 print:max-h-none print:overflow-visible print:border-t-0"
        >
          <h2 id="shared-notes-title" className="text-eyebrow tracking-eyebrow text-ink-muted">COACHING NOTES</h2>
          <p className="whitespace-pre-line break-words text-base leading-note text-ink">{notes}</p>
        </section>
      )}
    </div>
  );
}

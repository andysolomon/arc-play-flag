"use client";

import Link from "next/link";
import { useState } from "react";
import { encodePlaybookFile } from "@/lib/export/playbook-file";
import { download } from "@/lib/export/raster";
import { deletePlaybook } from "@/lib/play/library";
import { failureMessage, kebab } from "@/lib/play/storage";
import type { Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";
import { PlayThumb } from "../PlayThumb";
import { card, chip, pillDark } from "../ui";
import { AddPlaysModal } from "./AddPlays";
import { MoreMenu, menuItem, menuItemDanger } from "./MoreMenu";
import type { Say } from "./PlaybooksScreen";
import { ShareBookButton, useShareCount } from "./ShareBook";
import { TwoStep } from "./TwoStep";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;
/** the two pages peeking out behind the cover, like a stack of play cards */
const behind = ["-rotate-[5deg] -translate-x-1", "rotate-[4deg] translate-x-1"] as const;

type Props = { book: Playbook; plays: readonly SavedPlay[]; team: TeamSettings; say: Say };

/** One playbook on the list: a stack of its first plays, name and count, then Open · Share · ⋯ */
export function BookCard({ book: b, plays, team, say }: Props) {
  const links = useShareCount(b.id);
  const [adding, setAdding] = useState(false);
  const inBook = b.plays.flatMap((id) => plays.find((p) => p.id === id) ?? []);
  const [cover, ...rest] = inBook;
  const href = `/playbooks?book=${b.id}`;
  return (
    <div className={`${card} flex flex-col gap-2.5`}>
      {/* a compact row on phones, a cover on top from sm up */}
      <Link href={href} className="group grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3 !text-ink no-underline sm:flex sm:flex-col sm:items-stretch sm:gap-2">
        <div className="relative m-1 transition-transform duration-[120ms] group-hover:-translate-y-0.5 motion-reduce:transition-none">
          {rest.slice(0, 2).map((p, i) => (
            <div key={p.id} aria-hidden className={`absolute inset-0 ${behind[i] ?? ""}`}>
              <PlayThumb players={p.players} name="" side={p.side} className="opacity-90" />
            </div>
          ))}
          {cover ? (
            <PlayThumb players={cover.players} name={cover.name} side={cover.side} className="relative" />
          ) : (
            <div className="relative">
              {/* an empty field keeps the cover the same size as a full one */}
              <PlayThumb players={[]} name="" side="offense" className="opacity-40" />
              <span className="absolute inset-0 flex items-center justify-center rounded-field border-2 border-dashed border-ink text-caption text-ink">Empty</span>
            </div>
          )}
        </div>
        <span className="flex flex-col gap-0.5">
          <span className="truncate text-title leading-tight" title={b.name}>{b.name}</span>
          <span className="text-caption text-ink-muted">{b.plays.length ? plural(b.plays.length, "play") : "No plays yet"}</span>
        </span>
      </Link>
      {links > 0 && <div className="flex"><span className={chip}>Shared</span></div>}
      {/* pinned to the bottom so every card in a row lines up */}
      <div className="mt-auto flex items-center gap-2">
        <Link href={href} className={`${pillDark} inline-flex min-h-11 flex-1 items-center justify-center px-3 text-small !text-cream no-underline`}>Open</Link>
        <ShareBookButton book={b} plays={plays} team={team} />
        <MoreMenu label={`More actions for ${b.name}`}>
          {(close) => (<>
            <button type="button" className={menuItem} onClick={() => { close(); setAdding(true); }}>Add plays…</button>
            <button type="button" className={menuItem} onClick={() => {
              close();
              download(new Blob([encodePlaybookFile(b, inBook, team.name ? team : null)], { type: "application/json" }), `${kebab(b.name)}.playbook.json`);
            }}>Export playbook file</button>
            <span className="mx-2 my-0.5 h-0.5 bg-divider" aria-hidden />
            <TwoStep
              label="Delete playbook"
              base={menuItemDanger}
              confirm="Tap again · plays stay saved"
              onConfirm={() => { close(); const r = deletePlaybook(b.id); say(r.ok ? `Deleted “${b.name}”` : failureMessage(r.error), r.ok ? undefined : 3200); }}
            />
          </>)}
        </MoreMenu>
      </div>
      {adding && <AddPlaysModal bookId={b.id} say={say} onClose={() => { setAdding(false); }} />}
    </div>
  );
}

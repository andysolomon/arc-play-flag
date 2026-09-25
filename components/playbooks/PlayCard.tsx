"use client";

import Link from "next/link";
import { useState } from "react";
import { encodePlayFile } from "@/lib/export/transfer";
import { download } from "@/lib/export/raster";
import { booksHolding, deletePlay } from "@/lib/play/library";
import { failureMessage, kebab } from "@/lib/play/storage";
import type { SavedPlay } from "@/lib/play/types";
import { PlayThumb } from "../PlayThumb";
import { SideBadge } from "../SideBadge";
import { card, chip, pillDark } from "../ui";
import { AddToPlaybookModal } from "./AddPlays";
import { MoreMenu, menuItem, menuItemDanger } from "./MoreMenu";
import type { Say } from "./PlaybooksScreen";
import { SharePlayButton, useShareCount } from "./ShareBook";
import { TwoStep } from "./TwoStep";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/** One saved play in the gallery: picture, name, side, then Open · Share · ⋯ */
export function PlayCard({ play: p, say }: { play: SavedPlay; say: Say }) {
  const links = useShareCount(`play:${p.id}`);
  const holding = booksHolding(p.id).length;
  const [adding, setAdding] = useState(false);
  return (
    <div className={`${card} flex flex-col gap-2.5`}>
      <Link href={`/?open=${p.id}`} aria-label={`Open ${p.name} in the designer`} className="group flex flex-col gap-2 !text-ink no-underline">
        <PlayThumb players={p.players} name={p.name} side={p.side}
          className="transition-transform duration-[120ms] group-hover:-translate-y-0.5 motion-reduce:transition-none" />
        <span className="truncate text-title leading-tight" title={p.name}>{p.name}</span>
      </Link>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SideBadge side={p.side} />
        {links > 0 && <span className={chip}>Shared</span>}
      </div>
      {/* pinned to the bottom so every card in a row lines up */}
      <div className="mt-auto flex items-center gap-2">
        <Link href={`/?open=${p.id}`} className={`${pillDark} inline-flex min-h-11 flex-1 items-center justify-center px-3 text-small !text-cream no-underline`}>Open</Link>
        <SharePlayButton play={p}>
          {(share) => (
            <MoreMenu label={`More actions for ${p.name}`}>
              {(close) => (<>
                <button type="button" className={menuItem} onClick={() => { close(); setAdding(true); }}>Add to playbook…</button>
                <button type="button" className={menuItem} onClick={() => {
                  close();
                  download(new Blob([encodePlayFile(p)], { type: "application/json" }), `${kebab(p.name)}.play.json`);
                }}>Export play file</button>
                {share.links > 0 && (
                  <button type="button" className={menuItem} onClick={() => { close(); share.manage(); }}>Share link details…</button>
                )}
                <span className="mx-2 my-0.5 h-0.5 bg-divider" aria-hidden />
                <TwoStep
                  label="Delete play"
                  base={menuItemDanger}
                  confirm={holding ? `Delete? It's in ${plural(holding, "playbook")}` : "Tap again to delete"}
                  onConfirm={() => { close(); const r = deletePlay(p.id); say(r.ok ? `Deleted “${p.name}”` : failureMessage(r.error), r.ok ? undefined : 3200); }}
                />
              </>)}
            </MoreMenu>
          )}
        </SharePlayButton>
      </div>
      {adding && <AddToPlaybookModal play={p} say={say} onClose={() => { setAdding(false); }} />}
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { getAccountState, getServerAccountState, subscribeAccount } from "@/lib/account/sync";
import { copyTargets, copyTo } from "@/lib/org/sync";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import { menuItem, pill } from "../ui";
import { PreviewModal } from "./PreviewModal";
import type { Say } from "./PlaybooksScreen";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/**
 * "Copy to…" on a play's or a book's menu (ADR 013, rule 10): the teams the coach can draw on, their
 * own and the organizations', other than the one open here; the copies are new records that say where
 * they came from. Shown only when there is somewhere to copy to.
 */
export function CopyToItem({ onPick }: { onPick: () => void }) {
  const s = useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState);
  if (!s.user || copyTargets().length === 0) return null;
  return <button type="button" className={menuItem} onClick={onPick}>Copy to another team…</button>;
}

/** The dialog the item opens, rendered by the card itself so it outlives the menu. */
export function CopyToModal({ plays, books = [], say, onClose }: { plays: readonly SavedPlay[]; books?: readonly Playbook[]; say: Say; onClose: () => void }) {
  const targets = copyTargets();
  const what = books.length ? `“${books[0]?.name ?? "playbook"}” and its ${plural(plays.length, "play")}` : `“${plays[0]?.name ?? "play"}”`;
  return (
    <PreviewModal title={`Copy ${what} to`} onClose={onClose} closeLabel="Close">
      <div className="flex flex-col gap-2" role="group" aria-label="Teams to copy to">
        {[...new Set(targets.map((t) => t.group))].map((group) => (
          <div key={group} className="flex flex-col gap-1.5">
            <span className="text-eyebrow tracking-eyebrow text-ink-muted">{group.toUpperCase()}</span>
            {targets.filter((t) => t.group === group).map((t) => (
              <button key={`${t.target.kind}:${t.target.kind === "org" ? t.target.org : ""}:${t.target.team}`} type="button" className={`${pill} min-h-11 justify-start px-3 text-left text-small`}
                onClick={() => {
                  onClose();
                  copyTo(t.target, plays, books).then(() => { say(`Copied to “${t.label}”`); }, (e: unknown) => { say(e instanceof Error ? e.message : "Couldn't copy.", 3200); });
                }}>
                {t.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </PreviewModal>
  );
}

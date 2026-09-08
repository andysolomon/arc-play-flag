"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useSyncExternalStore, type ChangeEvent } from "react";
import {
  applyImport, booksHolding, createPlaybook, deletePlay, getPlaybooks, getPlays, getServerPlaybooks, getServerPlays,
  getServerTeam, getTeam, setTeam, subscribe,
} from "@/lib/play/library";
import type { Vis } from "@/lib/play/types";
import { PlayThumb } from "../PlayThumb";
import { card, divider, eyebrow, input, pill } from "../ui";
import type { Say } from "./PlaybooksScreen";
import { ShowToggle } from "./ShowToggle";
import { TwoStep } from "./TwoStep";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

export function Home({ say, show, onShow }: { say: Say; show: Vis; onShow: (v: Vis) => void }) {
  const router = useRouter();
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const fileRef = useRef<HTMLInputElement>(null);

  const onNew = () => {
    const book = createPlaybook(`Playbook ${String(books.length + 1)}`);
    router.push(`/playbooks?book=${book.id}`);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const { decodePlaybookFile, planImport } = await import("@/lib/export/playbook-file");
    const file = decodePlaybookFile(await f.text());
    if (!file) { say("That file isn't a playbook."); return; }
    const plan = planImport(file, getPlays(), getPlaybooks());
    applyImport(plan, file.team);
    const bits = [
      plan.added ? `${plural(plan.added, "play")} added` : "",
      plan.copied ? `${plural(plan.copied, "play")} copied` : "",
      plan.reused ? `${plural(plan.reused, "play")} already here` : "",
    ].filter(Boolean);
    say(plan.book ? `Imported “${plan.book.name}”${bits.length ? " · " + bits.join(" · ") : ""}` : "That playbook is already here.", 3200);
    if (plan.book) router.push(`/playbooks?book=${plan.book.id}`);
  };

  return (
    <>
      <div className="flex items-center gap-2">
        <span className={eyebrow}>PLAYBOOKS</span>
        <span className="flex-1" />
        <button type="button" onClick={onNew} className={`${pill} px-3 py-1 text-small`}>+ New playbook</button>
        <button type="button" onClick={() => fileRef.current?.click()} className={`${pill} px-3 py-1 text-small`}>Import a file…</button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={(e) => { void onFile(e); }} className="hidden" aria-label="Import a playbook file" />
      </div>
      {books.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-tile border-2 border-dashed border-ink px-3 py-5 text-center text-base leading-body text-ink-muted">
          <span>No playbooks yet.</span>
          <span>Make one, add your saved plays, then print wristbands or a binder.</span>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
          {books.map((b) => (
            <Link key={b.id} href={`/playbooks?book=${b.id}`} className={`${card} flex flex-col gap-1 !text-ink no-underline transition-transform duration-[120ms] hover:-translate-y-0.5 motion-reduce:transition-none`}>
              <span className="truncate text-title">{b.name}</span>
              <span className="text-caption text-ink-muted">{plural(b.plays.length, "play")}</span>
            </Link>
          ))}
        </div>
      )}

      <span className={divider} />
      <span className={eyebrow}>TEAM</span>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={team.name}
          maxLength={40}
          placeholder="Team name"
          aria-label="Team name"
          onChange={(e) => { setTeam({ ...team, name: e.target.value }); }}
          className={`${input} max-w-[280px]`}
        />
        <label className={`${pill} flex cursor-pointer items-center gap-2 px-3 py-1 text-small`}>
          <span className="h-5 w-5 rounded-full border-2 border-ink" style={{ background: team.color }} aria-hidden />
          Team colour
          <input type="color" value={team.color} aria-label="Team colour" onChange={(e) => { setTeam({ ...team, color: e.target.value }); }} className="h-0 w-0 opacity-0" />
        </label>
      </div>
      <span className="text-caption leading-note text-ink-muted">Shown on cards and printed pages. Nothing else changes.</span>

      <span className={divider} />
      <div className="flex flex-wrap items-center gap-2">
        <span className={eyebrow}>ALL PLAYS</span>
        <span className="flex-1" />
        {plays.length > 0 && <ShowToggle value={show} onChange={onShow} />}
      </div>
      {plays.length === 0 ? (
        <span className="text-base text-ink-muted">Save a play in the designer and it shows up here.</span>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {plays.map((p) => {
            const holding = booksHolding(p.id).length;
            return (
              <div key={p.id} className={`${card} flex flex-col gap-2`}>
                <PlayThumb players={p.players} name={p.name} show={show} />
                <span className="truncate text-base" title={p.name}>{p.name}</span>
                <div className="flex flex-wrap gap-1.5">
                  <Link href={`/?open=${p.id}`} className={`${pill} inline-block px-3 py-1 text-small !text-ink no-underline`}>Open ›</Link>
                  <TwoStep
                    label="Delete"
                    confirm={holding ? `Delete? It's in ${plural(holding, "playbook")}` : "Delete?"}
                    onConfirm={() => { deletePlay(p.id); say(`Deleted “${p.name}”`); }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

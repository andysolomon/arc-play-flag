"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { record } from "@/lib/diagnostics";
import { getPlaybooks, getPlays, getServerPlaybooks, getServerPlays, getTeam, subscribe } from "@/lib/play/library";
import { numbered } from "@/lib/export/numbered";
import type { Player } from "@/lib/play/types";
import { pill, select } from "./ui";

interface Props { id: string | null; name: string; players: readonly Player[] }

export function PlayExport({ id, name, players }: Props) {
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const [bookId, setBookId] = useState("");
  const [busy, setBusy] = useState<"video" | "card" | null>(null);
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const holding = books.filter((b) => id && b.plays.includes(id));
  const book = holding.find((b) => b.id === bookId) ?? holding[0];
  const n = book ? numbered(book, plays).find((it) => it.play.id === id)?.n : undefined;

  const save = async (video: boolean): Promise<void> => {
    if (controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(video ? "video" : "card");
    setStatus(video ? "Recording… keep this tab visible." : "Drawing the card…");
    const options = { name: name || "Untitled play", players, team: getTeam(), n };
    try {
      if (video) await (await import("@/lib/export/video")).exportVideo(options, abort.signal);
      else await (await import("@/lib/export/card")).exportCardPng(options);
      setStatus(video ? "Clip saved" : "Card saved");
    } catch (error) {
      if (!abort.signal.aborted) record("export", error);
      setStatus(abort.signal.aborted ? "Export cancelled" : error instanceof Error ? error.message : "Export failed. Please try again.");
    } finally {
      controller.current = null;
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-none flex-col gap-2 rounded-note border-2 border-ink bg-white p-3" aria-label="Export play">
      {holding.length > 1 ? (
        <label className="text-small">Number from playbook
          <select className={`w-full ${select}`} value={book?.id ?? ""} disabled={busy !== null} onChange={(e) => { setBookId(e.target.value); }}>
            {holding.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      ) : book ? <span className="text-small">{book.name} · Play {n}</span> : null}
      <button type="button" className={pill} disabled={busy !== null} onClick={() => { void save(false); }}>Save picture card</button>
      <button type="button" className={pill} disabled={busy !== null} onClick={() => { void save(true); }}>Save video clip</button>
      {busy === "video" && <button type="button" className={pill} onClick={() => { controller.current?.abort(); }}>Cancel export</button>}
      <span className="text-caption leading-note text-ink-muted" role="status">{status || "Portrait clip: formation, run, then a final hold."}</span>
    </div>
  );
}

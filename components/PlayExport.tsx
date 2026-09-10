"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { record } from "@/lib/diagnostics";
import { exportCardPng } from "@/lib/export/card";
import { getPlaybooks, getPlays, getServerPlaybooks, getServerPlays, getTeam, subscribe } from "@/lib/play/library";
import { numbered } from "@/lib/export/numbered";
import { exportVideo } from "@/lib/export/video";
import type { Player, Vis } from "@/lib/play/types";
import { playSvg } from "@/lib/render/play-svg";
import { pill, select } from "./ui";

interface Props { id: string | null; name: string; players: readonly Player[] }

const visibilityChoices: readonly { value: Vis; label: string }[] = [
  { value: "offense", label: "Offense" },
  { value: "defense", label: "Defense" },
  { value: "both", label: "Both teams" },
];

export function PlayExport({ id, name, players }: Props) {
  const books = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks);
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const [bookId, setBookId] = useState("");
  const [vis, setVis] = useState<Vis>("both");
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
    const options = { name: name || "Untitled play", players, team: getTeam(), n, vis };
    try {
      if (video) await exportVideo(options, abort.signal);
      else await exportCardPng(options);
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
      <fieldset className="flex flex-wrap gap-2" aria-label="Teams visible in picture and video exports">
        <legend className="mb-1 w-full text-small">Visible teams</legend>
        {visibilityChoices.map((choice) => (
          <label key={choice.value} className={`${pill} flex cursor-pointer items-center gap-1.5 px-2 py-0.5 text-small has-[:checked]:bg-yellow`}>
            <input
              type="radio"
              name="play-export-visibility"
              value={choice.value}
              checked={vis === choice.value}
              disabled={busy !== null}
              onChange={() => { setVis(choice.value); }}
            />
            {choice.label}
          </label>
        ))}
      </fieldset>
      <div
        role="img"
        aria-label={`${visibilityChoices.find((choice) => choice.value === vis)?.label ?? "Both teams"} export preview`}
        className="mx-auto w-full max-w-[250px] overflow-hidden rounded-field border-2 border-ink bg-turf [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: playSvg(players, { show: vis, box: { pw: 660, ph: 300 } }) }}
      />
      <button type="button" className={pill} disabled={busy !== null} onClick={() => { void save(false); }}>Save picture card</button>
      <button type="button" className={pill} disabled={busy !== null} onClick={() => { void save(true); }}>Save video clip</button>
      {busy === "video" && <button type="button" className={pill} onClick={() => { controller.current?.abort(); }}>Cancel export</button>}
      <span className="text-caption leading-note text-ink-muted" role="status">{status || "Portrait clip: formation, run, then a final hold."}</span>
    </div>
  );
}

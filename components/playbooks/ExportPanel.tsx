"use client";

import { useMemo, useState } from "react";
import { record } from "@/lib/diagnostics";
import { binderPages } from "@/lib/export/binder";
import { flyerDefault, flyerPage } from "@/lib/export/flyer";
import type { Numbered } from "@/lib/export/numbered";
import { PAPERS, defaultPaper, type PaperKey } from "@/lib/export/pages";
import { encodePlaybookFile } from "@/lib/export/playbook-file";
import { POSTCARD_SIZES, postcardPages, type PostcardSize } from "@/lib/export/postcard";
import { download } from "@/lib/export/raster";
import { exportPdf } from "@/lib/export/run";
import { BAND_PRESETS, wristbandPages, type BandSize } from "@/lib/export/wristband";
import { kebab } from "@/lib/play/storage";
import type { Playbook, TeamSettings, Vis } from "@/lib/play/types";
import { playSvg } from "@/lib/render/play-svg";
import { card, eyebrow, input, pill, select } from "../ui";
import type { Say } from "./PlaybooksScreen";

interface Props {
  book: Playbook;
  items: readonly Numbered[];
  team: TeamSettings;
  say: Say;
}

const numberField = `${input} w-[76px] px-2 text-center`;
const first = BAND_PRESETS[0];
const visibilityChoices: readonly { value: Vis; label: string }[] = [
  { value: "offense", label: "Offense" },
  { value: "defense", label: "Defense" },
  { value: "both", label: "Both teams" },
];

export function ExportPanel({ book, items, team, say }: Props) {
  const [paper, setPaper] = useState<PaperKey>(() => defaultPaper());
  const [presetKey, setPresetKey] = useState(first?.key ?? "custom");
  const [size, setSize] = useState<BandSize>(first ?? { w: 4.5, h: 2.25, rows: 2, cols: 3 });
  const [layout, setLayout] = useState<"one" | "four">("one");
  const [postcardSize, setPostcardSize] = useState<PostcardSize>("twoUp");
  const [postcardPlay, setPostcardPlay] = useState("");
  // null until the coach picks: the flyer follows the book's first six until then
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [vis, setVis] = useState<Vis>("both");
  const [busy, setBusy] = useState(false);
  const none = items.length === 0;
  const slots = useMemo(() => flyerDefault(items).map((i) => i?.play.id ?? ""), [items]);
  const featured = chosen ?? slots;
  const flyerPicks = featured.map((id) => items.find((it) => it.play.id === id) ?? null);

  const pickPreset = (key: string) => {
    setPresetKey(key);
    const p = BAND_PRESETS.find((b) => b.key === key);
    if (p) setSize({ w: p.w, h: p.h, rows: p.rows, cols: p.cols });
  };
  const setDim = (k: keyof BandSize, v: number, lo: number, hi: number) => {
    setPresetKey("custom");
    setSize((s) => ({ ...s, [k]: Math.max(lo, Math.min(hi, v)) }));
  };

  const run = (label: string, job: (progress: (done: number, total: number) => void) => Promise<void> | void) => {
    if (busy || none) return;
    setBusy(true);
    say(`${label}…`, 0);
    Promise.resolve().then(() => { return job((done, total) => { say(`${label}… page ${String(Math.min(done + 1, total))} of ${String(total)}`, 0); }); })
      .then(() => { say("Saved"); }, (e: unknown) => { record("export", e); say("That export failed. Try again on a bigger screen."); })
      .finally(() => { setBusy(false); });
  };

  const onWristbands = () => {
    run("Drawing wristbands", async (progress) => {
      const pages = wristbandPages(items, { size, paper, bookName: book.name, team, vis });
      await exportPdf(pages, `${kebab(book.name)}-wristbands.pdf`, `${book.name} - wristbands`, { dpi: 300, onProgress: progress });
    });
  };
  const onBinder = () => {
    run("Drawing binder pages", async (progress) => {
      const pages = binderPages(items, { layout, paper, bookName: book.name, team, vis });
      await exportPdf(pages, `${kebab(book.name)}-binder.pdf`, `${book.name} - binder`, { dpi: 220, onProgress: progress });
    });
  };
  const onPostcards = () => {
    run("Drawing postcards", async (progress) => {
      const picked = postcardPlay ? items.filter((it) => it.play.id === postcardPlay) : items;
      const pages = postcardPages(picked, { size: postcardSize, paper, bookName: book.name, team, vis });
      const one = picked.length === 1 ? picked[0] : undefined;
      const base = one ? `${kebab(one.play.name)}-postcard` : `${kebab(book.name)}-postcards`;
      await exportPdf(pages, `${base}.pdf`, `${book.name} - postcards`, { dpi: 300, onProgress: progress });
    });
  };
  const onFlyer = () => {
    run("Drawing the flyer", async (progress) => {
      const sheet = flyerPage(flyerPicks, { paper, bookName: book.name, team, vis });
      await exportPdf([sheet], `${kebab(book.name)}-flyer.pdf`, `${book.name} - flyer`, { dpi: 220, onProgress: progress });
    });
  };
  const onFile = () => {
    run("Writing the file", () => {
      const json = encodePlaybookFile(book, items.map((i) => i.play), team.name ? team : null);
      download(new Blob([json], { type: "application/json" }), `${kebab(book.name)}.playbook.json`);
    });
  };

  const perCard = size.rows * size.cols;
  const inserts = Math.max(1, Math.ceil(items.length / perCard));

  return (
    <div className="flex flex-col gap-3" aria-label="Export playbook">
      <div className={`${card} flex flex-col gap-2`}>
        <fieldset className="flex flex-wrap gap-2" aria-label="Teams visible in PDF exports">
          <legend className="mb-1 w-full text-small">Visible teams in every PDF</legend>
          {visibilityChoices.map((choice) => (
            <label key={choice.value} className={`${pill} flex cursor-pointer items-center gap-1.5 px-2 py-0.5 text-small has-[:checked]:bg-yellow`}>
              <input
                type="radio"
                name="playbook-export-visibility"
                value={choice.value}
                checked={vis === choice.value}
                disabled={busy || none}
                onChange={() => { setVis(choice.value); }}
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
        {items[0] && (
          <div className="flex flex-wrap items-center gap-3">
            <div
              role="img"
              aria-label={`${visibilityChoices.find((choice) => choice.value === vis)?.label ?? "Both teams"} PDF preview`}
              className="w-full max-w-[240px] overflow-hidden rounded-field border-2 border-ink bg-turf [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: playSvg(items[0].play.players, { show: vis, box: { pw: 660, ph: 280 } }) }}
            />
            <span className="text-caption leading-note text-ink-muted">Preview: {items[0].play.name}. The same choice applies to every play in every PDF below.</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
      <div className={`${card} flex flex-col gap-2`}>
        <span className={eyebrow}>WRISTBANDS</span>
        <span className="text-caption leading-note text-ink-muted">One insert per position with that route bold, plus one for the quarterback and coach.</span>
        <select value={presetKey} onChange={(e) => { pickPreset(e.target.value); }} aria-label="Wristband size" className={select}>
          {BAND_PRESETS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          <option value="custom">Custom size…</option>
        </select>
        <div className="flex flex-wrap items-center gap-2 text-small">
          <label className="flex items-center gap-1">Width <input type="number" step="0.05" min="1" max="8" value={size.w} onChange={(e) => { setDim("w", Number(e.target.value), 1, 8); }} className={numberField} aria-label="Insert width in inches" /> in</label>
          <label className="flex items-center gap-1">Height <input type="number" step="0.05" min="1" max="8" value={size.h} onChange={(e) => { setDim("h", Number(e.target.value), 1, 8); }} className={numberField} aria-label="Insert height in inches" /> in</label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-small">
          <label className="flex items-center gap-1">Rows <input type="number" min="1" max="6" value={size.rows} onChange={(e) => { setDim("rows", Math.round(Number(e.target.value)), 1, 6); }} className={numberField} aria-label="Rows of plays per insert" /></label>
          <label className="flex items-center gap-1">Columns <input type="number" min="1" max="8" value={size.cols} onChange={(e) => { setDim("cols", Math.round(Number(e.target.value)), 1, 8); }} className={numberField} aria-label="Columns of plays per insert" /></label>
        </div>
        <span className="text-caption text-ink-muted">
          {String(perCard)} plays per insert{items.length > perCard ? ` · ${String(inserts)} inserts per player` : ""}
        </span>
        <button type="button" onClick={onWristbands} disabled={busy || none} className={`${pill} self-start px-3 py-1 text-small`}>Download wristbands PDF</button>
      </div>

      <div className={`${card} flex flex-col gap-2`}>
        <span className={eyebrow}>BINDER</span>
        <span className="text-caption leading-note text-ink-muted">Detailed pages name every route, mark the read and carry your notes.</span>
        <select value={layout} onChange={(e) => { setLayout(e.target.value === "four" ? "four" : "one"); }} aria-label="Binder layout" className={select}>
          <option value="one">One play per page · detailed</option>
          <option value="four">Four per page · simple</option>
        </select>
        <button type="button" onClick={onBinder} disabled={busy || none} className={`${pill} self-start px-3 py-1 text-small`}>Download binder PDF</button>
      </div>

      <div className={`${card} flex flex-col gap-2`}>
        <span className={eyebrow}>POSTCARDS</span>
        <span className="text-caption leading-note text-ink-muted">
          The picture card on the front, the coaching points and a name line on the back. Print double-sided, flipping on the long edge.
        </span>
        <select value={postcardSize} onChange={(e) => { setPostcardSize(e.target.value === "card46" ? "card46" : "twoUp"); }} aria-label="Postcard size" className={select}>
          {POSTCARD_SIZES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={postcardPlay} onChange={(e) => { setPostcardPlay(e.target.value); }} aria-label="Plays to print as postcards" className={select}>
          <option value="">Every play in this book</option>
          {items.map((it) => <option key={it.play.id} value={it.play.id}>{it.n} · {it.play.name}</option>)}
        </select>
        <button type="button" onClick={onPostcards} disabled={busy || none} className={`${pill} self-start px-3 py-1 text-small`}>Download postcards PDF</button>
      </div>

      <div className={`${card} flex flex-col gap-2`}>
        <span className={eyebrow}>FLYER</span>
        <span className="text-caption leading-note text-ink-muted">One page of six plays for parents and players. Starts with the first six in this book.</span>
        <fieldset className="grid grid-cols-2 gap-1.5" aria-label="Featured plays">
          {featured.map((id, i) => (
            <label key={`slot-${String(i)}`} className="flex min-w-0 items-center gap-1 text-small">
              {i + 1}
              <select
                value={id}
                aria-label={`Flyer slot ${String(i + 1)}`}
                disabled={busy || none}
                onChange={(e) => { setChosen(featured.map((v, k) => (k === i ? e.target.value : v))); }}
                className={`${select} min-w-0 flex-1 px-2 text-small`}
              >
                <option value="">Empty</option>
                {items.map((it) => <option key={it.play.id} value={it.play.id}>{it.n} · {it.play.name}</option>)}
              </select>
            </label>
          ))}
        </fieldset>
        <button
          type="button"
          onClick={onFlyer}
          disabled={busy || none || flyerPicks.every((i) => i === null)}
          className={`${pill} self-start px-3 py-1 text-small`}
        >
          Download flyer PDF
        </button>
      </div>

      <div className={`${card} flex flex-col gap-2`}>
        <span className={eyebrow}>PAPER &amp; FILE</span>
        <select value={paper} onChange={(e) => { setPaper(e.target.value === "a4" ? "a4" : "letter"); }} aria-label="Paper size" className={select}>
          {Object.values(PAPERS).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <span className="text-caption leading-note text-ink-muted">A playbook file carries the plays too. Send it to an assistant coach, or keep it as a backup.</span>
        <button type="button" onClick={onFile} disabled={busy || none} className={`${pill} self-start px-3 py-1 text-small`}>Download playbook file</button>
      </div>
      </div>
    </div>
  );
}

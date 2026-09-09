"use client";

import { useState } from "react";
import { record } from "@/lib/diagnostics";
import type { Numbered } from "@/lib/export/numbered";
import { PAPERS, defaultPaper, type PaperKey } from "@/lib/export/pages";
import { BAND_PRESETS, type BandSize } from "@/lib/export/wristband";
import { kebab } from "@/lib/play/storage";
import type { Playbook, TeamSettings } from "@/lib/play/types";
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

export function ExportPanel({ book, items, team, say }: Props) {
  const [paper, setPaper] = useState<PaperKey>(() => defaultPaper());
  const [presetKey, setPresetKey] = useState(first?.key ?? "custom");
  const [size, setSize] = useState<BandSize>(first ?? { w: 4.5, h: 2.25, rows: 2, cols: 3 });
  const [layout, setLayout] = useState<"one" | "four">("one");
  const [busy, setBusy] = useState(false);
  const none = items.length === 0;

  const pickPreset = (key: string) => {
    setPresetKey(key);
    const p = BAND_PRESETS.find((b) => b.key === key);
    if (p) setSize({ w: p.w, h: p.h, rows: p.rows, cols: p.cols });
  };
  const setDim = (k: keyof BandSize, v: number, lo: number, hi: number) => {
    setPresetKey("custom");
    setSize((s) => ({ ...s, [k]: Math.max(lo, Math.min(hi, v)) }));
  };

  const run = (label: string, job: (progress: (done: number, total: number) => void) => Promise<void>) => {
    if (busy || none) return;
    setBusy(true);
    say(`${label}…`, 0);
    job((done, total) => { say(`${label}… page ${String(Math.min(done + 1, total))} of ${String(total)}`, 0); })
      .then(() => { say("Saved"); }, (e: unknown) => { record("export", e); say("That export failed. Try again on a bigger screen."); })
      .finally(() => { setBusy(false); });
  };

  const onWristbands = () => {
    run("Drawing wristbands", async (progress) => {
      const [{ wristbandPages }, { exportPdf }] = await Promise.all([import("@/lib/export/wristband"), import("@/lib/export/run")]);
      const pages = wristbandPages(items, { size, paper, bookName: book.name, team });
      await exportPdf(pages, `${kebab(book.name)}-wristbands.pdf`, `${book.name} - wristbands`, { dpi: 300, onProgress: progress });
    });
  };
  const onBinder = () => {
    run("Drawing binder pages", async (progress) => {
      const [{ binderPages }, { exportPdf }] = await Promise.all([import("@/lib/export/binder"), import("@/lib/export/run")]);
      const pages = binderPages(items, { layout, paper, bookName: book.name, team });
      await exportPdf(pages, `${kebab(book.name)}-binder.pdf`, `${book.name} - binder`, { dpi: 220, onProgress: progress });
    });
  };
  const onFile = () => {
    run("Writing the file", async () => {
      const [{ encodePlaybookFile }, { download }] = await Promise.all([import("@/lib/export/playbook-file"), import("@/lib/export/raster")]);
      const json = encodePlaybookFile(book, items.map((i) => i.play), team.name ? team : null);
      download(new Blob([json], { type: "application/json" }), `${kebab(book.name)}.playbook.json`);
    });
  };

  const perCard = size.rows * size.cols;
  const inserts = Math.max(1, Math.ceil(items.length / perCard));

  return (
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
        <span className={eyebrow}>PAPER &amp; FILE</span>
        <select value={paper} onChange={(e) => { setPaper(e.target.value === "a4" ? "a4" : "letter"); }} aria-label="Paper size" className={select}>
          {Object.values(PAPERS).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <span className="text-caption leading-note text-ink-muted">A playbook file carries the plays too. Send it to an assistant coach, or keep it as a backup.</span>
        <button type="button" onClick={onFile} disabled={busy || none} className={`${pill} self-start px-3 py-1 text-small`}>Download playbook file</button>
      </div>
    </div>
  );
}

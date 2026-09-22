import { normalizeSavedPlay } from "@/lib/play/storage";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import { FILE_KIND, MAX_FILE_BYTES, planImport, readPlaybookFile, type ImportError, type PlaybookFile } from "./playbook-file";

export interface PlayFile { kind: "ffpd.play"; version: 1; play: SavedPlay }
export type Transfer = PlayFile | PlaybookFile;
export type TransferRead = { ok: true; file: Transfer; skipped: number; normalized: boolean } | { ok: false; error: ImportError };
export const encodePlayFile = (play: SavedPlay): string => JSON.stringify({ kind: "ffpd.play", version: 1, play }, null, 2);

// Compare JSON values irrespective of object key order, without walking hostile deep input.
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

export function readTransfer(json: string): TransferRead {
  if (new TextEncoder().encode(json).byteLength > MAX_FILE_BYTES) return { ok: false, error: "tooLarge" };
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return { ok: false, error: "notJson" }; }
  if (!raw || typeof raw !== "object") return { ok: false, error: "notPlaybook" };
  const r = raw as Record<string, unknown>;
  try {
    const unsafe = (id: unknown) => typeof id === "string" && ["__proto__", "constructor", "prototype"].includes(id);
    const records = r.kind === "ffpd.play" ? [r.play] : [...(Array.isArray(r.plays) ? r.plays as unknown[] : []), r.playbook];
    if (records.some((v: unknown) => v && typeof v === "object" && "id" in v && unsafe(v.id))) return { ok: false, error: "notPlaybook" };
    if (r.kind === "ffpd.play") {
      if (typeof r.version === "number" && r.version > 1) return { ok: false, error: "newerVersion" };
      if (r.version !== 1) return { ok: false, error: "unknownVersion" };
      const play = normalizeSavedPlay(r.play);
      if (!play) return { ok: false, error: "notPlaybook" };
      return { ok: true, file: { kind: "ffpd.play", version: 1, play }, skipped: 0, normalized: canonical(r.play) !== canonical(play) };
    }
    const read = readPlaybookFile(json);
    if (!read.ok) return read;
    return { ...read, normalized: canonical(r.plays) !== canonical(read.file.plays) || canonical(r.playbook) !== canonical(read.file.playbook) || canonical(r.team ?? null) !== canonical(read.file.team) };
  } catch { return { ok: false, error: "notPlaybook" }; }
}

export function planTransfer(file: Transfer, plays: readonly SavedPlay[], books: readonly Playbook[]) {
  if (file.kind === FILE_KIND) return planImport(file, plays, books);
  const plan = planImport({ kind: FILE_KIND, version: 1, exported: "", team: null,
    playbook: { id: "standalone", name: "", plays: [file.play.id] }, plays: [file.play] }, plays, []);
  return { ...plan, book: null, bookId: null };
}

export function transferPlays(file: Transfer): SavedPlay[] {
  if (file.kind === "ffpd.play") return [file.play];
  const byId = new Map(file.plays.map(p => [p.id, p]));
  return file.playbook.plays.flatMap(id => { const p = byId.get(id); return p ? [p] : []; });
}

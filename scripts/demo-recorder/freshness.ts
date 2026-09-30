import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/**
 * The clips show the UI as it was when they were recorded. The recorder's coverage check
 * proves each chapter did what its card promises, but not that the UI has not moved on since:
 * a removed tile or a renamed toggle can go on playing in the tour for weeks. So an `all`
 * run writes `recorded-from.json` beside the clips it recorded, a fingerprint of the UI they
 * show; it is published to `components/demo/`, beside the tour's manifest (not into
 * `public/demos/`, which holds only what the app serves and precaches), and
 * `components/demo/demos.test.ts` fails as soon as that UI changes and the clips do not.
 *
 * Watched: everything a clip can show, which is every component (every UI change so far has
 * touched one) and the stylesheet the themes live in. Not watched: tests, and the /demo page
 * itself (`components/demo/`), which never appears in a clip.
 */
export const WATCHED = ["components", "app/globals.css"] as const;
const UNWATCHED_DIRECTORY = "components/demo";
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

export const STAMP_FILE = "recorded-from.json";
/** Where the published stamp lives, from the checkout's root. */
export const STAMP_PATH = `components/demo/${STAMP_FILE}`;

/** Each watched file's path (with forward slashes) and the sha256 of its text, line endings normalised. */
export type Fingerprint = Readonly<Record<string, string>>;

export interface Stamp {
  note: string;
  watched: readonly string[];
  files: Fingerprint;
  /** set when the stamp was moved on without re-recording: why, and what it waved through */
  restamped?: { reason: string; files: readonly string[] };
}

const NOTE = "The UI the /demo clips were recorded from. Written by `bun run demo:record --chapter all`; see DEMO_WORKFLOW.md.";

const HOW_TO_FIX =
  "Re-record the tour against a build of this checkout " +
  "(`bun run demo:record --chapter all --output-dir <dir> --contact-sheets`, DEMO_WORKFLOW.md) " +
  `and publish the whole set, its ${STAMP_FILE} to ${STAMP_PATH}. ` +
  "If you have watched every clip and none of them shows the change, say so instead: " +
  '`bun run demo:restamp --reason "<why the clips still match>"`.';

async function walk(root: string, path: string, into: string[]): Promise<void> {
  const full = join(root, path);
  let info;
  try { info = await stat(full); } catch { return; }
  if (info.isFile()) { into.push(path); return; }
  if (!info.isDirectory()) return;
  for (const entry of await readdir(full)) await walk(root, join(path, entry), into);
}

const posix = (path: string): string => path.split(sep).join("/");

/** Fingerprints the watched UI under `root`, in a stable order on every OS. */
export async function fingerprint(root: string): Promise<Fingerprint> {
  const paths: string[] = [];
  for (const watched of WATCHED) await walk(root, watched, paths);
  const files: Record<string, string> = {};
  for (const path of paths.map((p) => posix(relative(root, join(root, p)))).sort()) {
    if (path.startsWith(`${UNWATCHED_DIRECTORY}/`) || TEST_FILE.test(path)) continue;
    const text = (await readFile(join(root, path), "utf8")).replace(/\r\n/g, "\n");
    files[path] = createHash("sha256").update(text).digest("hex");
  }
  return files;
}

/** Every difference between what was recorded and what is here now, one line per file. */
export function drift(recorded: Fingerprint, current: Fingerprint): string[] {
  const paths = [...new Set([...Object.keys(recorded), ...Object.keys(current)])].sort();
  return paths.flatMap((path) => {
    if (!(path in current)) return [`${path} (removed)`];
    if (!(path in recorded)) return [`${path} (added)`];
    return recorded[path] === current[path] ? [] : [`${path} (changed)`];
  });
}

/** A stamp for a recording of the UI as it is now. */
export function stampFor(current: Fingerprint): Stamp {
  return { note: NOTE, watched: WATCHED, files: current };
}

/** The recorded fingerprint in a stamp's text, or a reason it has none. */
function readStamp(json: string | null): { stamp: Stamp } | { problem: string } {
  if (json === null) return { problem: `${STAMP_PATH} is missing, so nothing says which UI the clips show.` };
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return { problem: `${STAMP_PATH} is not JSON.` }; }
  const files = (parsed as { files?: unknown } | null)?.files;
  if (!files || typeof files !== "object" || Array.isArray(files) || !Object.values(files).every((hash) => typeof hash === "string")) {
    return { problem: `${STAMP_PATH} has no fingerprint of the recorded UI.` };
  }
  return { stamp: parsed as Stamp };
}

/** Why the committed clips can no longer be trusted to show this UI, or null when they can. */
export function freshnessProblem(stampJson: string | null, current: Fingerprint): string | null {
  const read = readStamp(stampJson);
  if ("problem" in read) return `${read.problem} ${HOW_TO_FIX}`;
  const lines = drift(read.stamp.files, current);
  if (!lines.length) return null;
  const shown = lines.slice(0, 12).join(", ");
  const more = lines.length > 12 ? ` and ${String(lines.length - 12)} more` : "";
  return `The /demo clips were recorded from a different UI: ${shown}${more}. ${HOW_TO_FIX}`;
}

/**
 * Moves the stamp on to the UI as it is now without re-recording, for a change no clip shows.
 * The reason and the files it waved through stay in the stamp, so a reviewer sees both.
 */
export function restamp(stampJson: string | null, current: Fingerprint, reason: string): Stamp {
  const why = reason.trim();
  if (!why) throw new Error("a restamp needs a --reason: say why the clips still match the UI");
  const read = readStamp(stampJson);
  if ("problem" in read) throw new Error(`${read.problem} Record the tour instead; a restamp only moves an existing recording on.`);
  const files = drift(read.stamp.files, current);
  if (!files.length) throw new Error("nothing to restamp: the clips were recorded from this UI");
  return { ...stampFor(current), restamped: { reason: why, files } };
}

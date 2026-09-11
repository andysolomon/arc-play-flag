import { resolve } from "node:path";

export const CHAPTER_SLUGS = ["build-play", "run-play", "build-defense", "save-export", "playbooks"] as const;
export type ChapterSlug = (typeof CHAPTER_SLUGS)[number];

export interface RecorderOptions {
  chapter: ChapterSlug | "all";
  outputDir: string;
  baseUrl: string;
  dryRun: boolean;
  force: boolean;
  headed: boolean;
  keepRaw: boolean;
  contactSheets: boolean;
  trace: boolean;
}

export const DEFAULT_BASE_URL = "http://127.0.0.1:3000";

export const HELP = `Development-only Demo recorder

Usage:
  bun run demo:record --chapter <slug|all> --output-dir <directory> [options]

Required:
  --chapter <slug|all>     One of ${CHAPTER_SLUGS.join(", ")}, or all
  --output-dir <directory> Explicit destination (there is deliberately no default)

Options:
  --base-url <url>         Running production app URL (default: ${DEFAULT_BASE_URL})
  --force                  Replace matching files already in the output directory
  --headed                 Show Chromium while recording
  --keep-raw               Keep <slug>.raw.webm beside the encoded assets
  --contact-sheets         Also write <slug>.sheet.png (full width) and <slug>.sheet-390.png
  --trace                  Print each beat with its elapsed time, for tuning chapter length
  --dry-run                Validate arguments, output directory and profile cleanup only
  --help                   Show this help

Outputs per chapter: <slug>.webm, <slug>.mp4, <slug>.webp. A failed chapter leaves only
<slug>.failure.png (a screenshot of the beat that failed) in the output directory.

The recorder never opens a normal browser profile. It seeds only the fictional
Riverside Otters fixtures in a temporary Chromium profile and removes that profile
after success or failure.`;

export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

const valueAfter = (args: readonly string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new UsageError(`${flag} requires a value`);
  return value;
};

export function parseArgs(args: readonly string[], cwd = process.cwd()): RecorderOptions | "help" {
  let chapter: string | undefined;
  let outputDir: string | undefined;
  let baseUrl = DEFAULT_BASE_URL;
  let dryRun = false;
  let force = false;
  let headed = false;
  let keepRaw = false;
  let contactSheets = false;
  let trace = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") return "help";
    if (arg === "--chapter") { chapter = valueAfter(args, i, arg); i += 1; continue; }
    if (arg === "--output-dir") { outputDir = valueAfter(args, i, arg); i += 1; continue; }
    if (arg === "--base-url") { baseUrl = valueAfter(args, i, arg); i += 1; continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--force") { force = true; continue; }
    if (arg === "--headed") { headed = true; continue; }
    if (arg === "--keep-raw") { keepRaw = true; continue; }
    if (arg === "--contact-sheets") { contactSheets = true; continue; }
    if (arg === "--trace") { trace = true; continue; }
    throw new UsageError(`unknown argument: ${arg ?? ""}`);
  }

  if (!chapter) throw new UsageError("--chapter is required");
  if (chapter !== "all" && !CHAPTER_SLUGS.includes(chapter as ChapterSlug)) {
    throw new UsageError(`unknown chapter: ${chapter}`);
  }
  if (!outputDir) throw new UsageError("--output-dir is required");
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new UsageError(`invalid --base-url: ${baseUrl}`); }
  if (!/^https?:$/.test(parsed.protocol)) throw new UsageError("--base-url must use http or https");

  return {
    chapter: chapter as ChapterSlug | "all",
    outputDir: resolve(cwd, outputDir),
    baseUrl: parsed.toString().replace(/\/$/, ""),
    dryRun,
    force,
    headed,
    keepRaw,
    contactSheets,
    trace,
  };
}

export function selectedChapters(chapter: ChapterSlug | "all"): readonly ChapterSlug[] {
  return chapter === "all" ? CHAPTER_SLUGS : [chapter];
}

/** The delivery set for one chapter, in the order the tour lists them, plus any opted-in extras. */
export function outputNames(slug: ChapterSlug, extras: { keepRaw?: boolean; contactSheets?: boolean } = {}): readonly string[] {
  return [
    `${slug}.webm`,
    `${slug}.mp4`,
    `${slug}.webp`,
    ...(extras.keepRaw ? [`${slug}.raw.webm`] : []),
    ...(extras.contactSheets ? [`${slug}.sheet.png`, `${slug}.sheet-390.png`] : []),
  ];
}

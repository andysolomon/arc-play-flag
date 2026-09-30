#!/usr/bin/env bun
/**
 * Development-only Demo recorder. Records the /demo chapters from fictional fixtures
 * in a disposable Chromium profile, encodes them, and verifies the asset contract. An
 * `all` run also writes recorded-from.json, the UI it recorded, for the freshness check.
 * See DEMO_WORKFLOW.md for setup, commands and how to extend coverage.
 */
import { rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { ChapterBeatError } from "./demo-recorder/chapters";
import { fingerprint, STAMP_FILE, stampFor } from "./demo-recorder/freshness";
import { MAX_SET_BYTES } from "./demo-recorder/media";
import { HELP, UsageError, parseArgs, selectedChapters } from "./demo-recorder/options";
import { dryRunProfileCheck, prepareOutputDirectory, recordOne, validateTools, verifyOutputSet, warmUp } from "./demo-recorder/runtime";

/** The checkout the running app is expected to be built from: the one this script is in. */
const CHECKOUT = resolve(import.meta.dir, "..");

export async function main(args = process.argv.slice(2)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Demo recorder: ${error.message}\n\n${HELP}`);
      return 2;
    }
    throw error;
  }
  if (parsed === "help") {
    console.log(HELP);
    return 0;
  }

  const slugs = selectedChapters(parsed.chapter);
  // only a whole set says which UI the tour shows; a single chapter never writes the stamp
  const whole = parsed.chapter === "all";
  await prepareOutputDirectory(parsed, slugs, whole ? [STAMP_FILE] : []);
  if (parsed.dryRun) {
    const profile = await dryRunProfileCheck();
    console.log(`Dry run OK: ${slugs.join(", ")} -> ${parsed.outputDir}`);
    console.log(`Disposable profile created and removed: ${profile}`);
    return 0;
  }

  for (const line of await validateTools()) console.log(`Using ${line}`);
  // taken before the first chapter: the UI the app was built from, not whatever is edited mid-run
  const recordedFrom = await fingerprint(CHECKOUT);
  // a stamp from an earlier run must not sit beside a set this run fails to finish
  if (whole) await rm(join(parsed.outputDir, STAMP_FILE), { force: true });
  console.log(`Recording from ${parsed.baseUrl} into ${parsed.outputDir}`);
  await warmUp(parsed.baseUrl);
  for (const slug of slugs) {
    console.log(`Recording ${slug}...`);
    const { files, seconds } = await recordOne(slug, parsed);
    console.log(`Recorded ${slug} in ${seconds.toFixed(1)}s: ${files.map((file) => file.slice(parsed.outputDir.length + 1)).join(", ")}`);
  }
  if (whole) {
    const bytes = await verifyOutputSet(parsed.outputDir, slugs);
    console.log(`Complete Demo set: ${String(bytes)} bytes (limit ${String(MAX_SET_BYTES)})`);
    await writeFile(join(parsed.outputDir, STAMP_FILE), `${JSON.stringify(stampFor(recordedFrom), null, 2)}\n`);
    console.log(`Recorded from ${String(Object.keys(recordedFrom).length)} UI files: ${STAMP_FILE}`);
  }
  return 0;
}

if (import.meta.main) {
  main().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      if (error instanceof ChapterBeatError) {
        console.error(`Demo recorder failed: ${error.message}`);
      } else {
        console.error(`Demo recorder failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      process.exitCode = 1;
    },
  );
}

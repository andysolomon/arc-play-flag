#!/usr/bin/env bun
/**
 * Development-only Demo recorder. Records the five /demo chapters from fictional
 * fixtures in a disposable Chromium profile, encodes them, and verifies the asset
 * contract. See DEMO_WORKFLOW.md for setup, commands and how to extend coverage.
 */
import { ChapterBeatError } from "./demo-recorder/chapters";
import { HELP, UsageError, parseArgs, selectedChapters } from "./demo-recorder/options";
import { dryRunProfileCheck, prepareOutputDirectory, recordOne, validateTools, verifyOutputSet } from "./demo-recorder/runtime";

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
  await prepareOutputDirectory(parsed, slugs);
  if (parsed.dryRun) {
    const profile = await dryRunProfileCheck();
    console.log(`Dry run OK: ${slugs.join(", ")} -> ${parsed.outputDir}`);
    console.log(`Disposable profile created and removed: ${profile}`);
    return 0;
  }

  for (const line of await validateTools()) console.log(`Using ${line}`);
  console.log(`Recording from ${parsed.baseUrl} into ${parsed.outputDir}`);
  for (const slug of slugs) {
    console.log(`Recording ${slug}...`);
    const { files, seconds } = await recordOne(slug, parsed);
    console.log(`Recorded ${slug} in ${seconds.toFixed(1)}s: ${files.map((file) => file.slice(parsed.outputDir.length + 1)).join(", ")}`);
  }
  if (parsed.chapter === "all") {
    const bytes = await verifyOutputSet(parsed.outputDir, slugs);
    console.log(`Complete Demo set: ${String(bytes)} bytes (limit 1250000)`);
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

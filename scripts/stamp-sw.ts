// Writes public/sw.js from lib/offline/sw.js with this build's release stamped in.
// `bun run build` runs it before `next build` (locally and on Vercel); the output is
// gitignored, so the worker is edited in lib/offline/ and tested from there.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveRelease, stampWorker } from "../lib/offline/release";

const root = path.resolve(import.meta.dir, "..");
const release = resolveRelease();
const source = await readFile(path.join(root, "lib/offline/sw.js"), "utf8");
await writeFile(path.join(root, "public/sw.js"), stampWorker(source, release));
console.log(`public/sw.js stamped with release ${release}`);

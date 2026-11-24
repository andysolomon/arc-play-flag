/**
 * A formal model only protects the code it still describes. Each `.claude/skills/<name>/SKILL.md` with a
 * `model:` line names the code it mirrors under `watches:`; a PR that changes that code without touching
 * the model or its skill fails here.
 *
 *   BASE=<sha> HEAD=<sha> bun run scripts/check-model-drift.ts
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { BASE, HEAD } = process.env;
if (!BASE || !HEAD) throw new Error("BASE and HEAD are required");

const diff = Bun.spawnSync(["git", "diff", "--name-only", `${BASE}...${HEAD}`]);
if (diff.exitCode !== 0) throw new Error(diff.stderr.toString());
const changed = diff.stdout.toString().split("\n").filter(Boolean);

const SKILLS = ".claude/skills";
let failed = false;
for (const name of readdirSync(SKILLS)) {
  const path = join(SKILLS, name, "SKILL.md");
  if (!existsSync(path)) continue;
  const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, "utf8"))?.[1] ?? "";
  const model = /^model: (.+)$/m.exec(front)?.[1]?.trim();
  if (!model) continue;
  const watches = (/^watches: (.+)$/m.exec(front)?.[1] ?? "").split(/\s+/).filter(Boolean);
  const touched = changed.filter((f) => watches.includes(f));
  const kept = changed.some((f) => f.startsWith(`${model}/`) || f.startsWith(`${SKILLS}/${name}/`));
  if (touched.length > 0 && !kept) {
    console.error(`::error::${touched.join(", ")} changed but ${model} did not: walk the code table in ${path}, then update the model, or touch ${path} to record that it still matches`);
    failed = true;
  }
}
if (!failed) console.log("Every changed protocol file kept its model in step.");
process.exit(failed ? 1 : 0);

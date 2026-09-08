/**
 * Regenerates docs/workflows/<slug>/progress.txt and gantt.mmd from
 * .arc/workflows/<slug>/workflow.yaml with the arc-pi-gantt-workflow renderer,
 * so the projections are byte-identical to what the tool itself would write.
 *
 *   node scripts/render-workflow.mjs <path-to-arc-pi-gantt-workflow-checkout> <slug> [YYYY-MM-DD]
 *
 * Needs Node 22.19+ (it imports the tool's TypeScript sources directly) and an
 * `npm install` inside the tool checkout. Fails closed on any validation diagnostic.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const [tool, slug, generatedAt = new Date().toISOString().slice(0, 10)] = process.argv.slice(2);
if (!tool || !slug) {
  console.error("usage: node scripts/render-workflow.mjs <tool-checkout> <slug> [YYYY-MM-DD]");
  process.exit(2);
}
const core = await import(pathToFileURL(resolve(tool, "packages/workflow-core/src/index.ts")).href);
const { parse } = await import(pathToFileURL(resolve(tool, "node_modules/yaml/dist/index.js")).href);

const source = `.arc/workflows/${slug}/workflow.yaml`;
const workflow = parse(await readFile(source, "utf8"));
const result = core.validateWorkflow(workflow);
for (const d of result.diagnostics) console.error(`${d.code} at ${d.path}: ${d.message}`);
if (!result.structurally_valid || result.diagnostics.length) process.exit(1);
for (const r of result.readiness) {
  if (!r.ready) console.error(`leaf ${r.leaf_id} is not activatable: missing ${r.missing_fields.join(", ")}`);
}

const rendered = core.renderWorkflow(workflow, { generated_at: generatedAt, source });
const dir = `docs/workflows/${slug}`;
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/progress.txt`, rendered.progress.text);
await writeFile(`${dir}/gantt.mmd`, rendered.gantt.text);
console.log(`wrote ${dir}/progress.txt and ${dir}/gantt.mmd`);

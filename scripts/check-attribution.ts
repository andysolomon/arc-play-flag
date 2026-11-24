/**
 * Fails a PR whose commits are authored as an agent or whose description credits one.
 *
 *   BASE=<sha> HEAD=<sha> BODY="<pr body>" bun run scripts/check-attribution.ts
 */
import { ATTRIBUTION } from "./attribution.js";

const AGENT_AUTHOR = /noreply@anthropic\.com|cursoragent@cursor\.com|^claude\b|^cursor agent\b/i;

const { BASE, HEAD, BODY = "" } = process.env;
if (!BASE || !HEAD) throw new Error("BASE and HEAD are required");

const log = Bun.spawnSync(["git", "log", "--format=%h%x09%an <%ae>", `${BASE}..${HEAD}`]);
if (log.exitCode !== 0) throw new Error(log.stderr.toString());
const agents = log.stdout.toString().split("\n").filter((line) => AGENT_AUTHOR.test(line.split("\t")[1] ?? ""));

let failed = false;
for (const line of agents) {
  console.error(`::error::commit ${line} is authored by an agent; rewrite it with your own identity: git rebase --exec "git commit --amend --no-edit --reset-author" ${BASE}`);
  failed = true;
}
if (ATTRIBUTION.test(BODY)) {
  console.error('::error::the PR description credits an agent; remove its Co-Authored-By, Claude-Session or "Generated with" line');
  failed = true;
}
if (!failed) console.log("No agent authorship or attribution.");
process.exit(failed ? 1 : 0);

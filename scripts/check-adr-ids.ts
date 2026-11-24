/** Fails when two ADRs in docs/adr/ share a number, as parallel branches that each took the next one do. */
import { readdirSync } from "node:fs";

const byId = new Map<string, string[]>();
for (const file of readdirSync("docs/adr")) {
  const id = /^(\d{3})-/.exec(file)?.[1];
  if (!id) continue;
  byId.set(id, [...(byId.get(id) ?? []), file]);
}
const clashes = [...byId].filter(([, files]) => files.length > 1);
for (const [id, files] of clashes) {
  console.error(`::error::ADR ${id} is taken by ${files.join(" and ")}; renumber yours to ${String(Math.max(...[...byId.keys()].map(Number)) + 1).padStart(3, "0")} and update the links to it`);
}
if (!clashes.length) console.log(`${String(byId.size)} ADRs, every number used once.`);
process.exit(clashes.length ? 1 : 0);

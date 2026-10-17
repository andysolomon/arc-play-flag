/**
 * Applies db/migrations/*.sql to DATABASE_URL, in name order, each once (docs/runbook/organizations.md).
 * A migration runs in its own transaction and is remembered in `migrations`; a failure rolls that
 * one back and stops. Safe to run again: applied files are skipped. `bun run db:migrate`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
const dir = join(import.meta.dir, "..", "db", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
try {
  await sql`create table if not exists migrations (name text primary key, applied timestamptz not null default now())`;
  const done = new Set((await sql<{ name: string }[]>`select name from migrations`).map((r) => r.name));
  for (const file of files) {
    if (done.has(file)) continue;
    await sql.begin(async (t) => {
      const tx = t as unknown as typeof sql;
      await tx.unsafe(readFileSync(join(dir, file), "utf8"));
      await tx`insert into migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }
  console.log(`${String(files.length)} migration(s), ${String(files.length - done.size)} applied now`);
} finally {
  await sql.end();
}

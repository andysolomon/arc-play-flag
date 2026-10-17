import postgres, { type Sql } from "postgres";

/**
 * The server's one connection to Postgres (docs/adr/013-organizations.md), holding the organizations;
 * a coach's own teams and the share links stay in Redis (lib/redis/command.ts). Read on the server
 * only; DATABASE_URL never reaches a client component. Made on first use, so a deployment without a
 * database builds and runs, and says organizations are off (ADR 013, tier 1 and 2 need nothing here).
 */
export type DbFailure = "unconfigured" | "unavailable";

/** The database could not be reached: not set up on this deployment, or down. */
export class DbError extends Error {
  readonly reason: DbFailure;
  constructor(reason: DbFailure, cause?: unknown) {
    super(`database ${reason}`, cause === undefined ? undefined : { cause });
    this.name = "DbError";
    this.reason = reason;
  }
}

export const databaseUrl = (env: Record<string, string | undefined> = process.env): string | null => env.DATABASE_URL || null;

let client: Sql | null = null;

/** The connection, pooled small for serverless functions and without prepared statements, which a transaction pooler (Neon's pooled endpoint) refuses. */
export function sql(): Sql {
  const url = databaseUrl();
  if (!url) throw new DbError("unconfigured");
  client ??= postgres(url, { max: 3, idle_timeout: 20, connect_timeout: 10, prepare: false, onnotice: () => undefined });
  return client;
}

/** Runs a query, turning a connection or server failure into a DbError; a thrown non-database error passes through. */
export async function query<T>(run: (db: Sql) => Promise<T>): Promise<T> {
  const db = sql();
  try {
    return await run(db);
  } catch (e) {
    if (isDbFailure(e)) throw new DbError("unavailable", e);
    throw e;
  }
}

/**
 * Runs a transaction: one connection, committed when `run` returns, rolled back when it throws. The
 * callback gets the plain Sql type: postgres.js types the transaction handle through Omit, which loses
 * the call signature, though the handle is the same tagged-template function.
 */
export function transact<T>(run: (tx: Sql) => Promise<T>): Promise<T> {
  return query((db) => db.begin((tx) => run(tx as unknown as Sql)) as Promise<T>);
}

/** postgres.js throws plain Errors for connection trouble and PostgresError for the server's own; both are the store's fault, not the request's. */
function isDbFailure(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  if (e.name === "PostgresError") return true;
  const code = (e as { code?: unknown }).code;
  return typeof code === "string" && /^(ECONN|ETIMEDOUT|ENOTFOUND|CONNECT_TIMEOUT|CONNECTION_)/.test(code);
}

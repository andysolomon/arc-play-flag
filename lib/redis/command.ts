/**
 * The server's one connection to Redis: the REST adapter the share links use (docs/runbook/sharing.md),
 * now shared with the accounts (docs/adr/011-coach-accounts.md). Credentials are read on the server
 * only and never reach a client component.
 */

/**
 * Server-only Redis REST credentials. Accepts the documented `UPSTASH_REDIS_REST_*` names and,
 * as a fallback, the `KV_REST_API_*` names that the Vercel Marketplace "Upstash for Redis"
 * store injects when connected to the project.
 */
export function credentials(env: Record<string, string | undefined> = process.env): { url: string; token: string } | null {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

export type RedisFailure = "unconfigured" | "unavailable";

/** The store could not be reached: not set up on this deployment, or down. */
export class RedisError extends Error {
  readonly reason: RedisFailure;
  constructor(reason: RedisFailure) {
    super(`redis ${reason}`);
    this.name = "RedisError";
    this.reason = reason;
  }
}

/** One Redis command over REST. Throws a RedisError when the store is not configured or does not answer. */
export async function command(...args: (string | number)[]): Promise<unknown> {
  const config = credentials();
  if (!config) throw new RedisError("unconfigured");
  const { url, token } = config;
  let response: Response;
  let data: { result?: unknown; error?: unknown };
  try {
    response = await fetch(url, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args),
      cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    data = await response.json() as { result?: unknown; error?: unknown };
  } catch {
    throw new RedisError("unavailable");
  }
  if (!response.ok || data.error) throw new RedisError("unavailable");
  return data.result;
}

// An atomic counter that expires with its window. No client IPs or bearer tokens are stored verbatim.
const LIMIT = `local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n`;

/** Counts one hit against a bucket and returns how many it has taken this window (`seconds`). */
export async function countHit(bucket: string, seconds: number): Promise<number> {
  const result = await command("EVAL", LIMIT, 1, bucket, seconds);
  return typeof result === "number" ? result : Number.POSITIVE_INFINITY;
}

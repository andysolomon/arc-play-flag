/**
 * The share API allows 20 writes and 600 reads an hour per client address (lib/sharing/store.ts).
 * Off Vercel every request counts against one shared bucket, so in a journey run every test would
 * draw on the same budget and whether a test could share would depend on which tests ran before it.
 * In production each coach has their own, so each test that writes through the API starts with a
 * fresh budget instead: this removes the rate-limit counters, and nothing else, from the disposable
 * Redis through its test adapter (support/redis-rest.ts). Snapshots stay, so a test running alongside
 * keeps its links. Without the adapter configured it does nothing, like the tests that need it.
 */
const CLEAR_LIMITS = "local n = 0 for _, k in ipairs(redis.call('KEYS', ARGV[1])) do n = n + redis.call('DEL', k) end return n";

export async function freshShareBudget(): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!process.env.SHARING_TEST_REDIS_URL || !url || !token) return;
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new Error(`freshShareBudget talks only to the loopback test adapter, not ${host}`);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(["EVAL", CLEAR_LIMITS, 0, "ffpd:limit:*"]),
  });
  const data = await response.json() as { result?: unknown; error?: unknown };
  if (!response.ok || data.error !== undefined) throw new Error(`could not reset the share budget: ${JSON.stringify(data.error ?? response.status)}`);
}

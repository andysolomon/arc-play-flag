import { createHash, randomBytes } from "node:crypto";
import { RedisError, command as redis, countHit, credentials } from "@/lib/redis/command";
import { SHARE_TTL_SECONDS } from "./links";

export class ShareError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export { credentials };

/** Server-only REST adapter; a store that is missing or down becomes a ShareError a coach can read. */
async function command(...args: (string | number)[]): Promise<unknown> {
  try {
    return await redis(...args);
  } catch (e) {
    if (e instanceof RedisError && e.reason === "unconfigured") throw new ShareError(503, "Link sharing is not configured yet. You can still export a file.");
    throw new ShareError(503, "Link sharing is temporarily unavailable. Try again.");
  }
}

// Atomic rate limiting. No client IPs or bearer tokens are stored verbatim.
export async function limit(request: Request, write: boolean): Promise<void> {
  // Vercel overwrites this header; elsewhere use a shared bucket instead of trusting X-Forwarded-For.
  const ip = process.env.VERCEL ? request.headers.get("x-vercel-forwarded-for") ?? "unknown" : "local";
  const digest = createHash("sha256").update(`${credentials()?.token ?? ""}:${ip}`).digest("hex");
  let hits: number;
  try {
    hits = await countHit(`ffpd:limit:${write ? "write" : "read"}:${digest}`, 3600);
  } catch (e) {
    throw e instanceof RedisError && e.reason === "unconfigured"
      ? new ShareError(503, "Link sharing is not configured yet. You can still export a file.")
      : new ShareError(503, "Link sharing is temporarily unavailable. Try again.");
  }
  if (hits > (write ? 20 : 600)) throw new ShareError(429, "Too many sharing requests. Try again later.");
}

// Global active-snapshot cap + NX insertion in one operation. Expired entries are swept on writes.
const CREATE = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
for _, key in ipairs(expired) do redis.call('HDEL', KEYS[3], key) end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if redis.call('EXISTS', KEYS[1]) == 1 then return 0 end
if redis.call('ZCARD', KEYS[2]) >= tonumber(ARGV[5]) then return -1 end
local used = 0
for _, size in ipairs(redis.call('HVALS', KEYS[3])) do used = used + tonumber(size) end
if used + tonumber(ARGV[7]) > tonumber(ARGV[6]) then return -1 end
redis.call('SET', KEYS[1], ARGV[3], 'EX', ARGV[4])
redis.call('HSET', KEYS[3], KEYS[1], ARGV[7])
redis.call('ZADD', KEYS[2], ARGV[2], KEYS[1])
return 1`;
export async function createSnapshot(json: string): Promise<{ token: string; revokeKey: string; expiresAt: string }> {
  const expires = Date.now() + SHARE_TTL_SECONDS * 1000;
  const revokeKey = randomBytes(24).toString("base64url");
  const revokeHash = createHash("sha256").update(revokeKey).digest("hex");
  const value = JSON.stringify({ json, revokeHash });
  for (let i = 0; i < 3; i++) {
    const token = randomBytes(12).toString("base64url");
    const result = await command("EVAL", CREATE, 3, `ffpd:share:${token}`, "ffpd:shares", "ffpd:shares:sizes", Date.now(), expires, value, SHARE_TTL_SECONDS, 1000, 64 * 1024 * 1024, Buffer.byteLength(value));
    if (result === -1) throw new ShareError(503, "Shared storage is full. Export a file or try again later.");
    if (result === 1) return { token, revokeKey, expiresAt: new Date(expires).toISOString() };
  }
  throw new ShareError(503, "Could not create a unique link. Try again.");
}

export async function readSnapshot(token: string): Promise<string> {
  const raw = await command("GET", `ffpd:share:${token}`);
  if (typeof raw !== "string") throw new ShareError(404, "This link is missing, expired, or revoked.");
  const value = JSON.parse(raw) as { json: string };
  return value.json;
}
const REVOKE = `
local raw = redis.call('GET', KEYS[1])
if not raw then redis.call('ZREM', KEYS[2], KEYS[1]); redis.call('HDEL', KEYS[3], KEYS[1]); return 1 end
if cjson.decode(raw).revokeHash ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1]); redis.call('ZREM', KEYS[2], KEYS[1]); redis.call('HDEL', KEYS[3], KEYS[1]); return 1`;
export async function revokeSnapshot(token: string, key: string): Promise<void> {
  const hash = createHash("sha256").update(key).digest("hex");
  if (await command("EVAL", REVOKE, 3, `ffpd:share:${token}`, "ffpd:shares", "ffpd:shares:sizes", hash) !== 1) throw new ShareError(403, "Only the creator can revoke this link.");
}

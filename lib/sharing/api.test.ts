import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { redisRest } from "@/e2e/support/redis-rest";
import { POST } from "@/app/api/shares/route";
import { GET, DELETE } from "@/app/api/shares/[token]/route";
import { encodePlaybookFile, MAX_FILE_BYTES } from "@/lib/export/playbook-file";
import { defaults } from "@/lib/play/routes";
import { boundedBody } from "./http";
import { SHARE_TTL_SECONDS } from "./links";

// Opt-in because these tests flush ONLY the explicitly supplied disposable database.
const url = process.env.SHARING_TEST_REDIS_URL;
describe.skipIf(!url)("share API with real Redis", () => {
  let bridge: ReturnType<typeof redisRest>;
  const previous = { url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN };
  beforeAll(() => {
    if (!url || !/^redis:\/\/(127\.0\.0\.1|localhost):/.test(url)) throw new Error("Disposable loopback Redis required");
    bridge = redisRest(url);
    process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${String(bridge.server.port)}`;
    process.env.UPSTASH_REDIS_REST_TOKEN = "fixture-only";
  });
  beforeEach(async () => { await bridge.redis.send("FLUSHDB", []); });
  afterAll(async () => {
    await bridge.server.stop(true); bridge.redis.close();
    if (previous.url === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = previous.url;
    if (previous.token === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
  });
  const play = { id: "one", name: "Wheel", notes: "Private coaching note", side: "offense" as const, players: defaults() };
  const json = encodePlaybookFile({ id: "book", name: "Sunday", plays: [play.id] }, [play], null);
  const post = (body = json, origin = "https://app.test") => POST(new Request("https://app.test/api/shares", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body }));
  const context = (token: string) => ({ params: Promise.resolve({ token }) });
  const get = (token: string) => GET(new Request(`https://app.test/api/shares/${token}`), context(token));
  const remove = (token: string, key: string) => DELETE(new Request(`https://app.test/api/shares/${token}`, { method: "DELETE", headers: { Origin: "https://app.test", Authorization: `Bearer ${key}` } }), context(token));

  test("durable immutable snapshot, bounded URL, expiry and separate revocation capability", async () => {
    const response = await post();
    expect(response.status).toBe(201);
    const created = await response.json() as { token: string; revokeKey: string };
    expect(`https://arc-play-flag.vercel.app/s/${created.token}`.length).toBeLessThan(60);
    expect(created.token.length).toBe(16);
    const ttl: unknown = await bridge.redis.send("TTL", [`ffpd:share:${created.token}`]);
    expect(ttl).toBeGreaterThan(SHARE_TTL_SECONDS - 10);
    const read = await get(created.token);
    expect(read.headers.get("cache-control")).toBe("no-store");
    const text = await read.text();
    expect(JSON.parse(text)).toEqual(JSON.parse(json));
    expect(text).not.toContain(created.revokeKey);
    // A different REST adapter (simulating an app process restart) sees the same data.
    const second = redisRest(url ?? "");
    process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${String(second.server.port)}`;
    expect(await (await get(created.token)).text()).toBe(text);
    await second.server.stop(true); second.redis.close();
    process.env.UPSTASH_REDIS_REST_URL = `http://127.0.0.1:${String(bridge.server.port)}`;
    expect((await remove(created.token, "x".repeat(32))).status).toBe(403);
    expect((await get(created.token)).status).toBe(200);
    expect((await remove(created.token, created.revokeKey)).status).toBe(204);
    expect((await get(created.token)).status).toBe(404);
    const sizes: unknown = await bridge.redis.send("HLEN", ["ffpd:shares:sizes"]);
    expect(sizes).toBe(0);
  });
  test("refuses malformed, normalized, unrelated and future payloads before storing", async () => {
    expect((await post("{bad")).status).toBe(400);
    const future = JSON.parse(json) as { version: number; playbook: { plays: string[] } };
    future.version = 99;
    expect((await post(JSON.stringify(future))).status).toBe(400);
    future.version = 1; future.playbook.plays.push("missing");
    expect((await post(JSON.stringify(future))).status).toBe(400);
    future.playbook.plays = [];
    expect((await post(JSON.stringify(future))).status).toBe(400);
    expect((await post(json, "https://evil.test")).status).toBe(403);
    const count: unknown = await bridge.redis.send("ZCARD", ["ffpd:shares"]);
    expect(count).toBe(0);
  });
  test("rate and global storage limits fail closed; expired capacity is reclaimed", async () => {
    for (let i = 0; i < 20; i++) expect((await post()).status).toBe(201);
    expect((await post()).status).toBe(429);
    await bridge.redis.send("FLUSHDB", []);
    await bridge.redis.send("ZADD", ["ffpd:shares", ...Array.from({ length: 1000 }, (_, i) => [String(Date.now() + 10000), `entry${String(i)}`]).flat()]);
    expect((await post()).status).toBe(503);
    await bridge.redis.send("FLUSHDB", []);
    await bridge.redis.send("HSET", ["ffpd:shares:sizes", "old", String(64 * 1024 * 1024)]);
    await bridge.redis.send("ZADD", ["ffpd:shares", String(Date.now() + 10000), "old"]);
    expect((await post()).status).toBe(503);
    await bridge.redis.send("ZADD", ["ffpd:shares", "0", "old"]);
    expect((await post()).status).toBe(201);
  });
  test("500-play books still have a 16-character token and expiry removes access", async () => {
    const plays = Array.from({ length: 500 }, (_, i) => ({ ...play, id: `p${String(i)}`, name: `Call ${String(i)}` }));
    const body = encodePlaybookFile({ id: "big", name: "Season", plays: plays.map(p => p.id) }, plays, null);
    const result = await post(body);
    expect(result.status).toBe(201);
    const created = await result.json() as { token: string };
    expect(created.token.length).toBe(16);
    await bridge.redis.send("EXPIRE", [`ffpd:share:${created.token}`, "0"]);
    expect((await get(created.token)).status).toBe(404);
  });
});

test("streamed uploads cannot bypass the UTF-8 byte bound by omitting Content-Length", async () => {
  const request = new Request("https://app.test/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_FILE_BYTES + 1)); controller.close(); } }) });
  const error: unknown = await boundedBody(request).catch((e: unknown) => e);
  expect(error).toMatchObject({ status: 413 });
});

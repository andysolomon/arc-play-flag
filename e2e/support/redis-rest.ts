/** Test-only HTTP adapter against a disposable REAL Redis, exercising the production Lua. */
import { RedisClient } from "bun";

export function redisRest(url: string, port = 0) {
  const redis = new RedisClient(url);
  const server = Bun.serve({
    hostname: "127.0.0.1", port, maxRequestBodySize: 12_000_000,
    async fetch(request) {
      if (request.method === "GET") return new Response("Redis test adapter");
      if (request.headers.get("authorization") !== "Bearer fixture-only") return new Response(null, { status: 401 });
      try {
        const [command, ...args] = await request.json() as (string | number)[];
        if (typeof command !== "string") return new Response(null, { status: 400 });
        const result: unknown = await redis.send(command, args.map(String));
        return Response.json({ result });
      } catch (error) { return Response.json({ error: String(error) }, { status: 400 }); }
    },
  });
  return { redis, server };
}
if (import.meta.main) {
  const url = process.env.SHARING_TEST_REDIS_URL;
  if (!url || !/^redis:\/\/(127\.0\.0\.1|localhost):/.test(url)) throw new Error("A disposable loopback SHARING_TEST_REDIS_URL is required");
  redisRest(url, 3134);
}

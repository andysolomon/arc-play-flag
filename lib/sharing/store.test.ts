import { describe, expect, test } from "bun:test";
import { credentials } from "./store";

describe("Redis REST credentials", () => {
  test("uses the documented Upstash names", () => {
    expect(credentials({ UPSTASH_REDIS_REST_URL: "https://a.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t1" })).toEqual({ url: "https://a.upstash.io", token: "t1" });
  });
  test("falls back to the Vercel Marketplace KV names", () => {
    expect(credentials({ KV_REST_API_URL: "https://b.upstash.io", KV_REST_API_TOKEN: "t2" })).toEqual({ url: "https://b.upstash.io", token: "t2" });
  });
  test("prefers the Upstash names when both are present", () => {
    const env = { UPSTASH_REDIS_REST_URL: "https://a.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t1", KV_REST_API_URL: "https://b.upstash.io", KV_REST_API_TOKEN: "t2" };
    expect(credentials(env)).toEqual({ url: "https://a.upstash.io", token: "t1" });
  });
  test("is unconfigured when either half is missing or empty", () => {
    expect(credentials({})).toBeNull();
    expect(credentials({ KV_REST_API_URL: "https://b.upstash.io" })).toBeNull();
    expect(credentials({ UPSTASH_REDIS_REST_URL: "", UPSTASH_REDIS_REST_TOKEN: "t1" })).toBeNull();
  });
});

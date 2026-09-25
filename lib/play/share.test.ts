import { describe, expect, test } from "bun:test";
import { defaults } from "./routes";
import { decodeShare, encodeShare } from "./share";

describe("share links", () => {
  test("round-trips the play and the other team", () => {
    const players = defaults().map((p) =>
      p.id === "o3" ? { ...p, route: { type: "post" as const, primary: true, mirror: true } } : p,
    );
    const id = encodeShare({ name: "Trips right — go!", players });
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeShare(id)).toEqual({ name: "Trips right — go!", players, side: "offense" });
    expect(decodeShare(id)?.players.filter((p) => p.team === "defense")).toHaveLength(5);
  });
  test("rejects garbage", () => {
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("not*base64")).toBeNull();
    expect(decodeShare(Buffer.from("[]").toString("base64url"))).toBeNull();
    expect(decodeShare(Buffer.from('{"players":"x"}').toString("base64url"))).toBeNull();
  });
});

describe("play side in links", () => {
  test("an old link to a defense-only diagram opens as a defensive call", () => {
    const players = defaults().map((p) => (p.team === "defense" ? { ...p, route: { type: "man" as const, target: "o3" } } : p));
    const legacy = Buffer.from(JSON.stringify({ name: "Man", players })).toString("base64url");
    expect(decodeShare(legacy)?.side).toBe("defense");
  });
});

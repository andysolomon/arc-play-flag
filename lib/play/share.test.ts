import { describe, expect, test } from "bun:test";
import { defaults } from "./routes";
import { decodeShare, encodeShare } from "./share";

describe("share links", () => {
  test("round-trips offense, defense and both snapshot choices", () => {
    const players = defaults().map((p) =>
      p.id === "o3" ? { ...p, route: { type: "post" as const, primary: true, mirror: true } } : p,
    );
    for (const vis of ["offense", "defense", "both"] as const) {
      const id = encodeShare({ name: "Trips right — go!", players }, vis);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeShare(id)).toEqual({ name: "Trips right — go!", players, vis });
    }
  });
  test("decodes old links and unknown visibility as both teams", () => {
    const players = defaults();
    const legacy = Buffer.from(JSON.stringify({ name: "Old play", players })).toString("base64url");
    const unknown = Buffer.from(JSON.stringify({ name: "Future play", players, vis: "coaches" })).toString("base64url");
    expect(decodeShare(legacy)).toEqual({ name: "Old play", players, vis: "both" });
    expect(decodeShare(unknown)).toEqual({ name: "Future play", players, vis: "both" });
  });
  test("rejects garbage", () => {
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("not*base64")).toBeNull();
    expect(decodeShare(Buffer.from("[]").toString("base64url"))).toBeNull();
    expect(decodeShare(Buffer.from('{"players":"x"}').toString("base64url"))).toBeNull();
  });
});

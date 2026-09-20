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
      expect(decodeShare(id)).toEqual({ name: "Trips right — go!", players, side: "offense", vis });
    }
  });
  test("decodes old links and unknown visibility as both teams", () => {
    const players = defaults();
    const legacy = Buffer.from(JSON.stringify({ name: "Old play", players })).toString("base64url");
    const unknown = Buffer.from(JSON.stringify({ name: "Future play", players, vis: "coaches" })).toString("base64url");
    expect(decodeShare(legacy)).toEqual({ name: "Old play", players, side: "offense", vis: "both" });
    expect(decodeShare(unknown)).toEqual({ name: "Future play", players, side: "offense", vis: "both" });
  });
  test("rejects garbage", () => {
    expect(decodeShare("")).toBeNull();
    expect(decodeShare("not*base64")).toBeNull();
    expect(decodeShare(Buffer.from("[]").toString("base64url"))).toBeNull();
    expect(decodeShare(Buffer.from('{"players":"x"}').toString("base64url"))).toBeNull();
  });
});

describe("play side in links", () => {
  test("a defensive call travels in the link; an offensive play's link is the same bytes as before", () => {
    const players = defaults();
    const offense = encodeShare({ name: "Trips", players, side: "offense" });
    expect(offense).toBe(encodeShare({ name: "Trips", players }));
    const defense = encodeShare({ name: "Cover 2", players, side: "defense" });
    expect(decodeShare(defense)).toEqual({ name: "Cover 2", players, side: "defense", vis: "both" });
  });
  test("an old link to a defense-only diagram opens as a defensive call", () => {
    const players = defaults().map((p) => (p.team === "defense" ? { ...p, route: { type: "man" as const, target: "o3" } } : p));
    const legacy = Buffer.from(JSON.stringify({ name: "Man", players })).toString("base64url");
    expect(decodeShare(legacy)?.side).toBe("defense");
  });
});

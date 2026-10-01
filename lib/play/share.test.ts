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
    expect(decodeShare(id)).toEqual({ name: "Trips right — go!", players, side: "offense", noRunZones: true });
    expect(decodeShare(id)?.players.filter((p) => p.team === "defense")).toHaveLength(5);
  });
  test("keeps every player from older links that chose a visible side", () => {
    const players = defaults();
    const legacy = Buffer.from(JSON.stringify({ name: "Old play", players })).toString("base64url");
    const offenseOnly = Buffer.from(JSON.stringify({ name: "Future play", players, vis: "offense" })).toString("base64url");
    const unknown = Buffer.from(JSON.stringify({ name: "Future play", players, vis: "coaches" })).toString("base64url");
    expect(decodeShare(legacy)).toEqual({ name: "Old play", players, side: "offense", noRunZones: true });
    expect(decodeShare(offenseOnly)?.players).toEqual(players);
    expect(decodeShare(unknown)?.players).toEqual(players);
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
    expect(decodeShare(defense)).toEqual({ name: "Cover 2", players, side: "defense", noRunZones: true });
    expect(decodeShare(defense)?.players.filter((p) => p.team === "offense")).toHaveLength(5);
  });
  test("an old link to a defense-only diagram opens as a defensive call", () => {
    const players = defaults().map((p) => (p.team === "defense" ? { ...p, route: { type: "man" as const, target: "o3" } } : p));
    const legacy = Buffer.from(JSON.stringify({ name: "Man", players })).toString("base64url");
    expect(decodeShare(legacy)?.side).toBe("defense");
  });
});

describe("lateral chains in links", () => {
  const chain = (catches: { o2?: readonly [number, number]; o5?: readonly [number, number] }) => defaults().map((p) => {
    if (p.id === "o2") return { ...p, route: { type: "lateral" as const, target: "o5", ...(catches.o2 ? { catch: catches.o2 } : {}) } };
    if (p.id === "o5") return { ...p, route: { type: "lateral" as const, target: "o3", ...(catches.o5 ? { catch: catches.o5 } : {}) } };
    if (p.id === "o3") return { ...p, route: { type: "throw" as const } };
    return p;
  });
  test("a catch the coach moved travels with the link, so the recipient sees the same tosses", () => {
    const players = chain({ o2: [20, 7], o5: [9, 7.4] });
    expect(decodeShare(encodeShare({ name: "Trick", players }))?.players).toEqual(players);
  });
  test("a lateral with no catch of its own gets none on the way", () => {
    const players = chain({});
    const back = decodeShare(encodeShare({ name: "Trick", players }))?.players;
    expect(back).toEqual(players);
    expect(back?.find((p) => p.id === "o2")?.route).not.toHaveProperty("catch");
  });
  test("a link carrying a catch ahead of its release opens with it snapped back behind it", () => {
    const players = chain({ o2: [20, 2] });
    const tampered = Buffer.from(JSON.stringify({ name: "Trick", players })).toString("base64url");
    expect(decodeShare(tampered)?.players.find((p) => p.id === "o2")?.route?.catch).toEqual([20, 5]);
  });
});

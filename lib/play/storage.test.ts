import { describe, expect, test } from "bun:test";
import { defaults } from "./routes";
import {
  DRAFT_KEY, LEGACY_PLAYS_KEY, PLAYBOOKS_KEY, PLAYS_KEY, TEAM_KEY, kebab, newId, normalizePlayers, readAll,
  readDraft, readPlaybooks, readTeam, remove, store, storePlaybook, writeDraft, writeTeam, type StorageLike,
} from "./storage";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

describe("storage", () => {
  test("round-trips a play under ffpd.plays.v2 keyed by id", () => {
    const s = memory();
    const players = defaults().map((p) => (p.id === "o3" ? { ...p, route: { type: "go" as const, primary: true } } : p));
    const play = { id: "abc", name: "Trips right", players, notes: "Watch the flat." };
    store(play, s);
    const raw: unknown = JSON.parse(s.data.get(PLAYS_KEY) ?? "");
    expect(raw).toEqual({ abc: play });
    expect(readAll(s)).toEqual({ abc: play });
    store({ id: "def", name: "Trips right", players: defaults(), notes: "" }, s);
    expect(Object.keys(readAll(s))).toEqual(["abc", "def"]);
  });
  test("migrates the prototype's name-keyed library once, clamping players onto the field", () => {
    const s = memory();
    s.setItem(
      LEGACY_PLAYS_KEY,
      JSON.stringify({
        Old: {
          players: [
            { id: "o1", team: "offense", label: "C", x: -3, y: -2 },
            { id: "d1", team: "defense", x: 40, y: -50, route: { type: "man", target: "o1" } },
            { id: "d2", team: "defense", label: "LB", x: 10, y: 2, route: { type: "bogus" } },
            "junk",
          ],
        },
        Broken: "nope",
      }),
    );
    const lib = readAll(s);
    const [rec] = Object.values(lib);
    expect(Object.keys(lib)).toHaveLength(1);
    expect(rec?.name).toBe("Old");
    expect(rec?.notes).toBe("");
    expect(rec?.players).toEqual([
      { id: "o1", team: "offense", label: "C", x: 1.2, y: 0.9, route: null },
      { id: "d1", team: "defense", label: "", x: 28.8, y: -36, route: { type: "man", target: "o1" } },
      { id: "d2", team: "defense", label: "LB", x: 10, y: -0.9, route: null },
    ]);
    // written through as v2, and the legacy key is left alone
    expect(s.data.has(PLAYS_KEY)).toBe(true);
    expect(s.data.has(LEGACY_PLAYS_KEY)).toBe(true);
    expect(readAll(s)).toEqual(lib);
  });
  test("survives corrupt JSON", () => {
    const s = memory();
    s.setItem(PLAYS_KEY, "{not json");
    expect(readAll(s)).toEqual({});
    s.setItem(DRAFT_KEY, "[]");
    expect(readDraft(s)).toBeNull();
    s.setItem(PLAYBOOKS_KEY, "42");
    expect(readPlaybooks(s)).toEqual({});
    s.setItem(TEAM_KEY, "null");
    expect(readTeam(s)).toEqual({ name: "", color: "#f2b705" });
  });
  test("normalizes custom waypoints and drops bad ones", () => {
    const [p] = normalizePlayers([{ id: "o5", team: "offense", x: 19, y: 5, route: { type: "custom", pts: [[19, 2], "x", [1]] } }]);
    expect(p?.route).toEqual({ type: "custom", pts: [[19, 2]] });
  });
  test("draft autosave round-trips under ffpd.draft.v1 with its id and notes", () => {
    const s = memory();
    writeDraft({ name: "Work in progress", players: defaults(), id: "abc", notes: "hi" }, s);
    expect(readDraft(s)).toEqual({ name: "Work in progress", players: defaults(), id: "abc", notes: "hi" });
    writeDraft({ name: "Loose", players: defaults() }, s);
    expect(readDraft(s)).toEqual({ name: "Loose", players: defaults(), id: null, notes: "" });
  });
  test("playbooks round-trip and deleting a play drops it from every book", () => {
    const s = memory();
    store({ id: "a", name: "A", players: defaults(), notes: "" }, s);
    store({ id: "b", name: "B", players: defaults(), notes: "" }, s);
    storePlaybook({ id: "wk1", name: "Week 1", plays: ["a", "b", "a"] }, s);
    expect(readPlaybooks(s)).toEqual({ wk1: { id: "wk1", name: "Week 1", plays: ["a", "b"] } });
    const after = remove("a", s);
    expect(Object.keys(after.plays)).toEqual(["b"]);
    expect(after.playbooks.wk1?.plays).toEqual(["b"]);
    expect(readPlaybooks(s).wk1?.plays).toEqual(["b"]);
  });
  test("team settings validate the colour", () => {
    const s = memory();
    writeTeam({ name: "Sharks", color: "#123ABC" }, s);
    expect(readTeam(s)).toEqual({ name: "Sharks", color: "#123abc" });
    s.setItem(TEAM_KEY, JSON.stringify({ name: "X", color: "red" }));
    expect(readTeam(s).color).toBe("#f2b705");
  });
  test("ids are short, url-safe and distinct", () => {
    const ids = new Set(Array.from({ length: 200 }, newId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{10,12}$/);
  });
  test("kebab-cases export filenames", () => {
    expect(kebab("Trips Right — Go!")).toBe("trips-right-go");
    expect(kebab("   ")).toBe("play");
  });
});

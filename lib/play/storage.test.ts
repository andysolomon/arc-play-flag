import { describe, expect, test } from "bun:test";
import { defaults } from "./routes";
import {
  DRAFT_KEY, LEGACY_PLAYS_KEY, PLAYBOOKS_KEY, PLAYS_KEY, StorageError, TEAM_KEY, failureMessage, kebab, newId,
  normalizePlayers, readAll, readDraft, readPlaybooks, readTeam, remove, store, storePlaybook, writeDraft, writeTeam,
  type StorageLike,
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
  test("a write that throws on quota is a typed quota failure, and nothing is reported stored", () => {
    const s = memory();
    const quota = Object.assign(new Error("full"), { name: "QuotaExceededError", code: 22 });
    const failing: StorageLike = { getItem: (k) => s.getItem(k), setItem: () => { throw quota; } };
    const play = { id: "abc", name: "Trips right", players: defaults(), notes: "" };
    let caught: unknown;
    try { store(play, failing); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(StorageError);
    const err = caught as StorageError;
    expect(err.reason).toBe("quota");
    expect(err.key).toBe(PLAYS_KEY);
    expect(err.cause).toBe(quota);
    expect(readAll(failing)).toEqual({});
    expect(failureMessage(err)).toBe("Couldn't save: this browser's storage is full.");
    // every writer reports the same way
    expect(() => storePlaybook({ id: "wk1", name: "Week 1", plays: [] }, failing)).toThrow(StorageError);
    expect(() => { writeTeam({ name: "Sharks", color: "#123abc" }, failing); }).toThrow(StorageError);
    expect(() => { writeDraft({ name: "d", players: defaults() }, failing); }).toThrow(StorageError);
    expect(() => remove("abc", failing)).not.toThrow();
  });
  test("no storage at all is an unavailable failure, and reads still answer empty", () => {
    expect(() => store({ id: "abc", name: "A", players: defaults(), notes: "" }, null)).toThrow(StorageError);
    try { writeDraft({ name: "d", players: defaults() }, null); } catch (e) { expect((e as StorageError).reason).toBe("unavailable"); }
    expect(readAll(null)).toEqual({});
    expect(readDraft(null)).toBeNull();
  });
  test("a storage that drops writes on the floor is caught by the read-back", () => {
    const dropping: StorageLike = { getItem: () => null, setItem: () => { /* dropped */ } };
    try { store({ id: "abc", name: "A", players: defaults(), notes: "" }, dropping); throw new Error("stored"); }
    catch (e) { expect((e as StorageError).reason).toBe("write"); }
    const other = Object.assign(new Error("nope"), { name: "SecurityError" });
    const refusing: StorageLike = { getItem: () => null, setItem: () => { throw other; } };
    try { store({ id: "abc", name: "A", players: defaults(), notes: "" }, refusing); throw new Error("stored"); }
    catch (e) { expect((e as StorageError).reason).toBe("write"); }
  });
  test("a failed update leaves the existing record as it was, and a retry lands", () => {
    const s = memory();
    const before = { id: "abc", name: "Trips right", players: defaults(), notes: "v1" };
    store(before, s);
    let full = true;
    const flaky: StorageLike = {
      getItem: (k) => s.getItem(k),
      setItem: (k, v) => { if (full) throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); s.setItem(k, v); },
    };
    const after = { ...before, notes: "v2" };
    expect(() => store(after, flaky)).toThrow(StorageError);
    expect(readAll(flaky)).toEqual({ abc: before });
    full = false;
    expect(store(after, flaky)).toEqual({ abc: after });
    expect(readAll(s)).toEqual({ abc: after });
  });
  test("the legacy migration never throws on the read path when it can't write through", () => {
    const legacy = JSON.stringify({ Old: { players: defaults() } });
    const readOnly: StorageLike = { getItem: (k) => (k === LEGACY_PLAYS_KEY ? legacy : null), setItem: () => { throw new Error("read only"); } };
    const lib = readAll(readOnly);
    expect(Object.values(lib).map((p) => p.name)).toEqual(["Old"]);
  });
  test("kebab-cases export filenames", () => {
    expect(kebab("Trips Right — Go!")).toBe("trips-right-go");
    expect(kebab("   ")).toBe("play");
  });
});

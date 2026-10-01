import { describe, expect, test } from "bun:test";
import { MAX_LATERALS } from "./lateral";
import { defaults } from "./routes";
import type { Player } from "./types";
import {
  DRAFT_KEY, LEGACY_PLAYS_KEY, PLAYBOOKS_KEY, PLAYS_KEY, StorageError, TEAM_KEY, failureMessage, importAll, kebab, newId,
  inferSide, normalizeDraft, normalizePlayers, normalizeSavedPlay, readAll, readDraft, readPlaybooks, readTeam, remove, store, storePlaybook, writeDraft, writeTeam,
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
    const play = { id: "abc", name: "Trips right", side: "offense" as const, players, notes: "Watch the flat." };
    store(play, s);
    const raw: unknown = JSON.parse(s.data.get(PLAYS_KEY) ?? "");
    expect(raw).toEqual({ abc: play });
    expect(readAll(s)).toEqual({ abc: play });
    store({ id: "def", name: "Trips right", side: "offense", players: defaults(), notes: "" }, s);
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
  test("routes must be finite, on the field, the right team's, and aimed at someone", () => {
    const players = normalizePlayers(JSON.parse(`[
      {"id":"o1","team":"offense","x":3,"y":1,"route":{"type":"custom","pts":[[1e400,2],[40,-99],[5,-5],[NaN]]}},
      {"id":"o2","team":"offense","x":15,"y":5,"route":{"type":"blitz"}},
      {"id":"d1","team":"defense","x":15,"y":-5,"route":{"type":"go"}},
      {"id":"d2","team":"defense","x":3,"y":-5,"route":{"type":"man","target":"nobody"}},
      {"id":"d3","team":"defense","x":27,"y":-5,"route":{"type":"man","target":"d1"}},
      {"id":"d4","team":"defense","x":20,"y":-5,"route":{"type":"man","target":"o1"}}
    ]`.replace("1e400", "1e400").replace("NaN", "null")));
    expect(players[0]?.route).toEqual({ type: "custom", pts: [[28.8, -36], [5, -5]] });
    expect(players[1]?.route).toBeNull();
    expect(players[2]?.route).toBeNull();
    expect(players[3]?.route).toBeNull();
    expect(players[4]?.route).toBeNull();
    expect(players[5]?.route).toEqual({ type: "man", target: "o1" });
  });
  test("player ids are unique, the roster is capped, and waypoints are capped", () => {
    const raw = Array.from({ length: 20 }, () => ({ id: "same", team: "offense", x: 5, y: 2 }));
    const players = normalizePlayers(raw);
    expect(players).toHaveLength(12);
    expect(new Set(players.map((p) => p.id)).size).toBe(12);
    expect(players[0]?.id).toBe("same");
    const pts = Array.from({ length: 100 }, (_, i) => [i % 28 + 1, -i % 30]);
    const [p] = normalizePlayers([{ id: "o1", team: "offense", x: 5, y: 2, route: { type: "custom", pts } }]);
    expect(p?.route?.pts).toHaveLength(60);
  });
  test("importAll writes plays and the book as one change and rolls back when the book can't be written", () => {
    const s = memory();
    store({ id: "keep", name: "Keep", side: "offense", players: defaults(), notes: "" }, s);
    const beforePlays = s.data.get(PLAYS_KEY);
    let writes = 0;
    const flaky: StorageLike = {
      getItem: (k) => s.getItem(k),
      setItem: (k, v) => { writes++; if (k === PLAYBOOKS_KEY) throw Object.assign(new Error("full"), { name: "QuotaExceededError" }); s.setItem(k, v); },
    };
    const plays = [{ id: "a", name: "A", side: "offense" as const, players: defaults(), notes: "" }, { id: "b", name: "B", side: "offense" as const, players: defaults(), notes: "" }];
    expect(() => { importAll(plays, { id: "wk1", name: "Week 1", plays: ["a", "b"] }, flaky); }).toThrow(StorageError);
    expect(s.data.get(PLAYS_KEY)).toBe(beforePlays);
    expect(Object.keys(readAll(s))).toEqual(["keep"]);
    expect(readPlaybooks(s)).toEqual({});
    // plays went in with one write, the book with one, the rollback with one
    expect(writes).toBe(3);
    importAll(plays, { id: "wk1", name: "Week 1", plays: ["a", "b"] }, s);
    expect(Object.keys(readAll(s))).toEqual(["keep", "a", "b"]);
    expect(readPlaybooks(s).wk1?.plays).toEqual(["a", "b"]);
  });
  test("draft autosave round-trips under ffpd.draft.v1 with its id and notes", () => {
    const s = memory();
    writeDraft({ name: "Work in progress", players: defaults(), id: "abc", notes: "hi" }, s);
    expect(readDraft(s)).toEqual({ name: "Work in progress", players: defaults(), id: "abc", notes: "hi", side: "offense" });
    writeDraft({ name: "Loose", players: defaults() }, s);
    expect(readDraft(s)).toEqual({ name: "Loose", players: defaults(), id: null, notes: "", side: "offense" });
  });
  test("playbooks round-trip and deleting a play drops it from every book", () => {
    const s = memory();
    store({ id: "a", name: "A", side: "offense", players: defaults(), notes: "" }, s);
    store({ id: "b", name: "B", side: "offense", players: defaults(), notes: "" }, s);
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
    const play = { id: "abc", name: "Trips right", side: "offense" as const, players: defaults(), notes: "" };
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
    expect(() => store({ id: "abc", name: "A", side: "offense", players: defaults(), notes: "" }, null)).toThrow(StorageError);
    try { writeDraft({ name: "d", players: defaults() }, null); } catch (e) { expect((e as StorageError).reason).toBe("unavailable"); }
    expect(readAll(null)).toEqual({});
    expect(readDraft(null)).toBeNull();
  });
  test("a storage that drops writes on the floor is caught by the read-back", () => {
    const dropping: StorageLike = { getItem: () => null, setItem: () => { /* dropped */ } };
    try { store({ id: "abc", name: "A", side: "offense", players: defaults(), notes: "" }, dropping); throw new Error("stored"); }
    catch (e) { expect((e as StorageError).reason).toBe("write"); }
    const other = Object.assign(new Error("nope"), { name: "SecurityError" });
    const refusing: StorageLike = { getItem: () => null, setItem: () => { throw other; } };
    try { store({ id: "abc", name: "A", side: "offense", players: defaults(), notes: "" }, refusing); throw new Error("stored"); }
    catch (e) { expect((e as StorageError).reason).toBe("write"); }
  });
  test("a failed update leaves the existing record as it was, and a retry lands", () => {
    const s = memory();
    const before = { id: "abc", name: "Trips right", side: "offense" as const, players: defaults(), notes: "v1" };
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

describe("play side", () => {
  test("a stored side is kept and anything else is read off the routes", () => {
    const defensive = defaults().map((p) => (p.team === "defense" ? { ...p, route: { type: "zoneDeep" as const } } : p));
    const offensive = defaults().map((p) => (p.id === "o3" ? { ...p, route: { type: "go" as const } } : p));
    expect(inferSide(defaults())).toBe("offense");
    expect(inferSide(defensive)).toBe("defense");
    expect(inferSide(defensive.map((p) => (p.id === "o3" ? { ...p, route: { type: "go" as const } } : p)))).toBe("offense");
    expect(inferSide(offensive)).toBe("offense");
    expect(normalizeSavedPlay({ id: "a", name: "A", players: defensive })?.side).toBe("defense");
    expect(normalizeSavedPlay({ id: "a", name: "A", players: defensive, side: "offense" })?.side).toBe("offense");
    expect(normalizeSavedPlay({ id: "a", name: "A", players: offensive, side: "coaches" })?.side).toBe("offense");
    expect(normalizeDraft({ name: "D", players: defensive })?.side).toBe("defense");
    expect(normalizeDraft({ name: "D", players: defensive, side: "offense" })?.side).toBe("offense");
  });
  test("a defensive call round-trips through the library", () => {
    const s = memory();
    store({ id: "abc", name: "Cover 2", players: defaults(), notes: "", side: "defense" }, s);
    expect(readAll(s).abc?.side).toBe("defense");
  });
});

describe("lateral chains in storage", () => {
  /** Stored players as JSON would give them back: the default formation with raw routes on the named players. */
  const raw = (routes: Record<string, unknown>, laterals?: unknown): unknown =>
    defaults().map((p) => ({ ...p, route: routes[p.id] ?? null, ...(p.id === "o2" && laterals !== undefined ? { laterals } : {}) }));
  const routeOf = (players: readonly { id: string; route: unknown }[], id: string): unknown => players.find((p) => p.id === id)?.route;
  const hopsOf = (players: readonly Player[]): unknown => players.find((p) => p.id === "o2")?.laterals;

  test("a pitch beside a receiver was an option, so the quarterback laterals to the runner, who throws (M1)", () => {
    const ps = normalizePlayers(raw({ o5: { type: "pitch" }, o4: { type: "corner" } }));
    expect(hopsOf(ps)).toEqual([{ to: "o5" }]);
    expect(routeOf(ps, "o2")).toBeNull();
    expect(routeOf(ps, "o5")).toEqual({ type: "throw" });
    expect(routeOf(ps, "o4")).toEqual({ type: "corner" });
    // the read on a receiver stays with them
    const read = normalizePlayers(raw({ o5: { type: "pitch" }, o3: { type: "go", primary: true } }));
    expect(routeOf(read, "o5")).toEqual({ type: "throw" });
    expect(routeOf(read, "o3")).toEqual({ type: "go", primary: true });
  });
  test("a pitch with nobody to throw to, or marked as the read, was a run: the runner keeps it (M2)", () => {
    const alone = normalizePlayers(raw({ o5: { type: "pitch" } }));
    expect(hopsOf(alone)).toEqual([{ to: "o5" }]);
    expect(routeOf(alone, "o5")).toEqual({ type: "stretch" });
    const read = normalizePlayers(raw({ o5: { type: "pitch", primary: true, mirror: true }, o3: { type: "go" } }));
    expect(hopsOf(read)).toEqual([{ to: "o5" }]);
    // the read went to the keep itself; a carrier is never the read
    expect(routeOf(read, "o5")).toEqual({ type: "stretch", mirror: true });
  });
  test("a pitch beside a runner marked as the read: the read still gets the ball, and the pitch runs as a decoy (M7)", () => {
    // before laterals the words and ▶ gave it to X, the primary Dive: no lateral may take it to Z
    const ps = normalizePlayers(raw({ o3: { type: "dive", primary: true }, o5: { type: "pitch" }, o4: { type: "corner" } }));
    expect(hopsOf(ps)).toBeUndefined();
    expect(routeOf(ps, "o2")).toBeNull();
    expect(routeOf(ps, "o3")).toEqual({ type: "dive", primary: true });
    expect(routeOf(ps, "o5")).toEqual({ type: "stretch" });
    expect(routeOf(ps, "o4")).toEqual({ type: "corner" });
  });
  test("with no read and nobody to throw to, the first runner left to right had it; the pitch is a lateral only if that was them (M8)", () => {
    // X (on the left) dives, Z pitches: X carried it
    const dive = normalizePlayers(raw({ o3: { type: "dive" }, o5: { type: "pitch" } }));
    expect(hopsOf(dive)).toBeUndefined();
    expect(routeOf(dive, "o3")).toEqual({ type: "dive" });
    expect(routeOf(dive, "o5")).toEqual({ type: "stretch" });
    // X pitches, Z dives: X carried it, so X takes the lateral and keeps it
    const pitch = normalizePlayers(raw({ o3: { type: "pitch" }, o5: { type: "dive" } }));
    expect(hopsOf(pitch)).toEqual([{ to: "o3" }]);
    expect(routeOf(pitch, "o3")).toEqual({ type: "stretch" });
    expect(routeOf(pitch, "o5")).toEqual({ type: "dive" });
  });
  test("a pitch on the quarterback was a rollout: they throw from it, or keep it (M3)", () => {
    expect(routeOf(normalizePlayers(raw({ o2: { type: "pitch" }, o3: { type: "go", primary: true } })), "o2")).toEqual({ type: "throw" });
    expect(routeOf(normalizePlayers(raw({ o2: { type: "pitch" } })), "o2")).toEqual({ type: "stretch" });
  });
  test("two pitches: the first, left to right, takes the lateral and the other keeps running (M4)", () => {
    const ps = normalizePlayers(raw({ o5: { type: "pitch" }, o3: { type: "pitch" }, o4: { type: "go" } }));
    expect(hopsOf(ps)).toEqual([{ to: "o3" }]);
    expect(routeOf(ps, "o3")).toEqual({ type: "throw" });
    expect(routeOf(ps, "o5")).toEqual({ type: "stretch" });
  });
  test("with no quarterback on the field a pitch keeps running (M5)", () => {
    const ps = normalizePlayers((raw({ o5: { type: "pitch" } }) as { id: string }[]).filter((p) => p.id !== "o2"));
    expect(routeOf(ps, "o5")).toEqual({ type: "stretch" });
  });
  test("a chain saved one lateral per carrier (before laterals could come back) reads as the same hops, the last job kept (R6)", () => {
    const ps = normalizePlayers(raw({
      o2: { type: "lateral", target: "o5", catch: [22, 6] }, o5: { type: "lateral", target: "o3" }, o3: { type: "throw" }, o4: { type: "go", primary: true },
    }));
    expect(hopsOf(ps)).toEqual([{ to: "o5", catch: [22, 6] }, { to: "o3" }]);
    expect(routeOf(ps, "o2")).toBeNull();
    expect(routeOf(ps, "o5")).toBeNull();
    expect(routeOf(ps, "o3")).toEqual({ type: "throw" });
    expect(routeOf(ps, "o4")).toEqual({ type: "go", primary: true });
    // a keep at the end stays the keep, and a lateral that went nowhere ends the chain at its thrower
    const keep = normalizePlayers(raw({ o2: { type: "lateral", target: "o5" }, o5: { type: "reverse" } }));
    expect(hopsOf(keep)).toEqual([{ to: "o5" }]);
    expect(routeOf(keep, "o5")).toEqual({ type: "reverse" });
    const dangling = normalizePlayers(raw({ o2: { type: "lateral", target: "o5" }, o5: { type: "lateral", target: "gone" } }));
    expect(hopsOf(dangling)).toEqual([{ to: "o5" }]);
    expect(routeOf(dangling, "o5")).toBeNull();
  });
  test("each hop must go to someone else on the offense; the chain ends at the first that doesn't (M6, R1, R3)", () => {
    expect(hopsOf(normalizePlayers(raw({}, [{ to: "gone" }])))).toBeUndefined();
    expect(hopsOf(normalizePlayers(raw({}, [{ to: "d1" }])))).toBeUndefined();
    expect(hopsOf(normalizePlayers(raw({}, [{ to: "o5" }, { to: "o5" }, { to: "o3" }])))).toEqual([{ to: "o5" }]);
    expect(hopsOf(normalizePlayers(raw({}, [{ to: "o5" }, "junk", { to: "o3" }])))).toEqual([{ to: "o5" }]);
    expect(hopsOf(normalizePlayers(raw({}, "not a list")))).toBeUndefined();
    // back to the quarterback is a hop like any other
    expect(hopsOf(normalizePlayers(raw({ o2: { type: "throw" } }, [{ to: "o5" }, { to: "o2" }])))).toEqual([{ to: "o5" }, { to: "o2" }]);
  });
  test("a stored catch is clamped behind its release and the line, and a broken one dropped (K8)", () => {
    expect(hopsOf(normalizePlayers(raw({ o5: { type: "throw" } }, [{ to: "o5", catch: [22, -4] }])))).toEqual([{ to: "o5", catch: [22, 5] }]);
    expect(hopsOf(normalizePlayers(raw({ o5: { type: "throw" } }, [{ to: "o5", catch: ["x", 3] }])))).toEqual([{ to: "o5" }]);
    // a throw nobody laterals to is no job at all, and laterals belong to the quarterback alone
    expect(routeOf(normalizePlayers(raw({ o4: { type: "throw" } })), "o4")).toBeNull();
    const stray = normalizePlayers(defaults().map((p) => (p.id === "o5" ? { ...p, laterals: [{ to: "o3" }] } : p)));
    expect(stray.find((p) => p.id === "o5")?.laterals).toBeUndefined();
  });
  test("keeps no more laterals than the cap (R4)", () => {
    const hops = Array.from({ length: MAX_LATERALS + 5 }, (_, i) => ({ to: i % 2 === 0 ? "o5" : "o2" }));
    expect(hopsOf(normalizePlayers(raw({}, hops)))).toHaveLength(MAX_LATERALS);
  });
  test("a migrated play reads back the same the second time, through the library", () => {
    const s = memory();
    s.setItem(PLAYS_KEY, JSON.stringify({ old: { id: "old", name: "Otter Pitch Option", notes: "", side: "offense", players: raw({ o5: { type: "pitch" }, o4: { type: "corner" } }) } }));
    const once = readAll(s);
    expect(hopsOf(once.old?.players ?? [])).toEqual([{ to: "o5" }]);
    store(once.old ?? { id: "x", name: "x", notes: "", side: "offense", players: [] }, s);
    expect(readAll(s)).toEqual(once);
    expect(normalizePlayers(once.old?.players)).toEqual(once.old?.players ?? []);
  });
});

import { describe, expect, test } from "bun:test";
import { defaults } from "./routes";
import {
  DRAFT_KEY, PLAYS_KEY, kebab, normalizePlayers, readAll, readDraft, store, writeDraft, type StorageLike,
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
  test("round-trips a play under ffpd.plays.v1 in the prototype's shape", () => {
    const s = memory();
    const players = defaults().map((p) => (p.id === "o3" ? { ...p, route: { type: "go" as const, primary: true } } : p));
    store("Trips right", players, s);
    const raw: unknown = JSON.parse(s.data.get(PLAYS_KEY) ?? "");
    expect(raw).toEqual({ "Trips right": { players } });
    expect(readAll(s)).toEqual({ "Trips right": { players } });
    store("Second", defaults(), s);
    expect(Object.keys(readAll(s))).toEqual(["Trips right", "Second"]);
  });
  test("loads the legacy shape written by the prototype and clamps it back onto the field", () => {
    const s = memory();
    s.setItem(
      PLAYS_KEY,
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
    expect(Object.keys(lib)).toEqual(["Old"]);
    expect(lib.Old?.players).toEqual([
      { id: "o1", team: "offense", label: "C", x: 1.2, y: 0.9, route: null },
      { id: "d1", team: "defense", label: "", x: 28.8, y: -36, route: { type: "man", target: "o1" } },
      { id: "d2", team: "defense", label: "LB", x: 10, y: -0.9, route: null },
    ]);
  });
  test("survives corrupt JSON", () => {
    const s = memory();
    s.setItem(PLAYS_KEY, "{not json");
    expect(readAll(s)).toEqual({});
    s.setItem(DRAFT_KEY, "[]");
    expect(readDraft(s)).toBeNull();
  });
  test("normalizes custom waypoints and drops bad ones", () => {
    const [p] = normalizePlayers([{ id: "o5", team: "offense", x: 19, y: 5, route: { type: "custom", pts: [[19, 2], "x", [1]] } }]);
    expect(p?.route).toEqual({ type: "custom", pts: [[19, 2]] });
  });
  test("draft autosave round-trips under ffpd.draft.v1", () => {
    const s = memory();
    writeDraft({ name: "Work in progress", players: defaults() }, s);
    expect(s.data.has(DRAFT_KEY)).toBe(true);
    expect(readDraft(s)).toEqual({ name: "Work in progress", players: defaults() });
  });
  test("kebab-cases export filenames", () => {
    expect(kebab("Trips Right — Go!")).toBe("trips-right-go");
    expect(kebab("   ")).toBe("play");
  });
});

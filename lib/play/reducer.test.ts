import { describe, expect, test } from "bun:test";
import { initialState, reducer, selected, type Action, type PlayState } from "./reducer";
import { defaults } from "./routes";

const run = (...actions: Action[]): PlayState => actions.reduce(reducer, initialState());
const find = (s: PlayState, id: string) => s.players.find((p) => p.id === id);

describe("reducer", () => {
  test("pick toggles a route and tapping it again clears it", () => {
    let s = run({ type: "select", id: "o3" }, { type: "pick", key: "go" });
    expect(find(s, "o3")?.route).toEqual({ type: "go" });
    expect(s.past).toHaveLength(1);
    s = reducer(s, { type: "pick", key: "go" });
    expect(find(s, "o3")?.route).toBeNull();
    expect(s.past).toHaveLength(2);
  });
  test("a blitz backs a shallow defender off to 7 yards, and leaves a deeper one alone", () => {
    let s = run({ type: "select", id: "d2" }, { type: "pick", key: "blitz" });
    expect(find(s, "d2")?.route).toEqual({ type: "blitz" });
    expect(find(s, "d2")?.y).toBe(-7);
    expect(s.past).toHaveLength(1);
    s = run({ type: "select", id: "d5" }, { type: "pick", key: "blitz" });
    expect(find(s, "d5")?.y).toBe(-11);
    s = run({ type: "setRoute", id: "d1", route: { type: "blitz" } });
    expect(find(s, "d1")?.y).toBe(-7);
  });
  test("reset formation keeps a blitzer on the blitz line", () => {
    let s = run({ type: "select", id: "d2" }, { type: "pick", key: "blitz" }, { type: "move", id: "d2", x: 11, y: -9, commit: true });
    s = reducer(s, { type: "resetFormation", team: "defense" });
    expect(find(s, "d2")?.y).toBe(-7);
    expect(find(s, "d1")?.y).toBe(-5);
    // already home: nothing to commit
    expect(reducer(s, { type: "resetFormation", team: "defense" })).toBe(s);
  });
  test("man enters targeting and the next red player becomes the target", () => {
    let s = run({ type: "select", id: "d1" }, { type: "pick", key: "man" });
    expect(s.targeting).toBe(true);
    s = reducer(s, { type: "target", id: "d2" });
    expect(s.targeting).toBe(true);
    s = reducer(s, { type: "target", id: "o3" });
    expect(s.targeting).toBe(false);
    expect(find(s, "d1")?.route).toEqual({ type: "man", target: "o3" });
  });
  test("custom routes: waypoints then double-tap drops the duplicate click", () => {
    let s = run(
      { type: "select", id: "o5" },
      { type: "pick", key: "custom" },
      { type: "draftPoint", pt: [19, 2] },
      { type: "draftPoint", pt: [24, -3] },
      { type: "draftPoint", pt: [24, -3] },
    );
    expect(s.draft?.pts).toHaveLength(3);
    s = reducer(s, { type: "draftFinish" });
    expect(s.draft).toBeNull();
    expect(find(s, "o5")?.route).toEqual({ type: "custom", pts: [[19, 2], [24, -3]] });
  });
  test("an empty custom draft leaves the route alone", () => {
    const s = run({ type: "select", id: "o5" }, { type: "pick", key: "custom" }, { type: "draftFinish" });
    expect(find(s, "o5")?.route).toBeNull();
    expect(s.past).toHaveLength(0);
  });
  test("only one primary read at a time", () => {
    let s = run({ type: "select", id: "o3" }, { type: "pick", key: "go" }, { type: "togglePrimary" });
    expect(find(s, "o3")?.route?.primary).toBe(true);
    s = reducer(s, { type: "select", id: "o4" });
    s = reducer(s, { type: "pick", key: "post" });
    s = reducer(s, { type: "togglePrimary" });
    expect(find(s, "o3")?.route?.primary).toBe(false);
    expect(find(s, "o4")?.route?.primary).toBe(true);
  });
  test("mirror flips handed routes and custom waypoints", () => {
    let s = run({ type: "select", id: "o3" }, { type: "pick", key: "out" }, { type: "mirror" });
    expect(find(s, "o3")?.route).toEqual({ type: "out", mirror: true });
    s = run({ type: "select", id: "o3" }, { type: "setRoute", id: "o3", route: { type: "custom", pts: [[5, 0]] } }, { type: "mirror" });
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[1, 0]] });
    s = run({ type: "select", id: "o3" }, { type: "pick", key: "go" }, { type: "mirror" });
    expect(find(s, "o3")?.route).toEqual({ type: "go" });
  });
  test("flip mirrors every spot and custom waypoints", () => {
    const s = run({ type: "setRoute", id: "o3", route: { type: "custom", pts: [[5, 0]] } }, { type: "flip" });
    expect(find(s, "o3")?.x).toBe(27);
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[25, 0]] });
    expect(find(s, "d5")?.x).toBe(15);
  });
  test("clear and reset are scoped and skip no-ops", () => {
    let s = run({ type: "setRoute", id: "o3", route: { type: "go" } }, { type: "setRoute", id: "d1", route: { type: "spy" } });
    s = reducer(s, { type: "clearRoutes", team: "defense" });
    expect(find(s, "o3")?.route).toEqual({ type: "go" });
    expect(find(s, "d1")?.route).toBeNull();
    const before = s.past.length;
    s = reducer(s, { type: "clearRoutes", team: "defense" });
    expect(s.past).toHaveLength(before);
    s = reducer(s, { type: "resetFormation", team: null });
    expect(s.past).toHaveLength(before);
    s = reducer(s, { type: "move", id: "o3", x: 9, y: 2, commit: true });
    s = reducer(s, { type: "resetFormation", team: "defense" });
    expect(find(s, "o3")?.x).toBe(9);
    s = reducer(s, { type: "resetFormation", team: "offense" });
    expect(find(s, "o3")?.x).toBe(3);
  });
  test("undo and redo restore snapshots and clear the selection", () => {
    let s = run({ type: "select", id: "o3" }, { type: "move", id: "o3", x: 9, y: 2, commit: true });
    s = reducer(s, { type: "undo" });
    expect(find(s, "o3")?.x).toBe(3);
    expect(s.selectedId).toBeNull();
    s = reducer(s, { type: "redo" });
    expect(find(s, "o3")?.x).toBe(9);
    expect(reducer(s, { type: "redo" })).toBe(s);
  });
  test("history is capped at 60 entries", () => {
    let s = initialState();
    for (let i = 0; i < 70; i++) s = reducer(s, { type: "move", id: "o3", x: 2 + (i % 20), y: 1, commit: true });
    expect(s.past).toHaveLength(60);
  });
  test("newPlay starts a fresh unsaved play and undo brings the old one back", () => {
    let s = run({ type: "load", id: "abc", name: "Bunch", notes: "hi", players: defaults() }, { type: "select", id: "o3" }, { type: "pick", key: "go" });
    s = reducer(s, { type: "newPlay" });
    expect(s.id).toBeNull();
    expect(s.name).toBe("New play");
    expect(s.notes).toBe("");
    expect(s.selectedId).toBeNull();
    expect(find(s, "o3")?.route).toBeNull();
    s = reducer(s, { type: "undo" });
    expect(find(s, "o3")?.route).toEqual({ type: "go" });
  });
  test("load pushes history and renames; hydrate does not", () => {
    const players = defaults().map((p) => ({ ...p, x: 15 }));
    let s = run({ type: "load", id: "abc", name: "Bunch", notes: "hi", players });
    expect(s.name).toBe("Bunch");
    expect(s.id).toBe("abc");
    expect(s.notes).toBe("hi");
    expect(s.past).toHaveLength(1);
    s = reducer(initialState(), { type: "hydrate", name: "Draft", players });
    expect(s.past).toHaveLength(0);
    expect(s.id).toBeNull();
    expect(selected(s)).toBeNull();
  });
  test("notes and the saved id do not touch history", () => {
    let s = run({ type: "setNotes", notes: "Sell the fake." });
    s = reducer(s, { type: "saved", id: "xyz" });
    expect(s.notes).toBe("Sell the fake.");
    expect(s.id).toBe("xyz");
    expect(s.past).toHaveLength(0);
  });
  test("rename commits once per session and caps at 3 uppercase letters", () => {
    let s = run({ type: "rename", id: "d1", label: "cbx", commit: true });
    s = reducer(s, { type: "rename", id: "d1", label: "cbxy", commit: false });
    expect(find(s, "d1")?.label).toBe("CBX");
    expect(s.past).toHaveLength(1);
  });
});

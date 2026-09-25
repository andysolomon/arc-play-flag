import { describe, expect, test } from "bun:test";
import { initialState, isContext, reducer, unsaved, type Action, type PlayState } from "./reducer";
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
    let s = run({ type: "hydrate", side: "defense", name: "Blitz", players: defaults() }, { type: "select", id: "d2" }, { type: "pick", key: "blitz" });
    expect(find(s, "d2")?.route).toEqual({ type: "blitz" });
    expect(find(s, "d2")?.y).toBe(-7);
    expect(s.past).toHaveLength(1);
    s = run({ type: "hydrate", side: "defense", name: "Blitz", players: defaults() }, { type: "select", id: "d5" }, { type: "pick", key: "blitz" });
    expect(find(s, "d5")?.y).toBe(-11);
    s = run({ type: "hydrate", side: "defense", name: "Blitz", players: defaults() }, { type: "setRoute", id: "d1", route: { type: "blitz" } });
    expect(find(s, "d1")?.y).toBe(-7);
  });
  test("reset formation keeps a blitzer on the blitz line", () => {
    let s = run(
      { type: "hydrate", side: "defense", name: "Blitz", players: defaults() },
      { type: "select", id: "d2" },
      { type: "pick", key: "blitz" },
      { type: "move", id: "d2", x: 11, y: -9, commit: true },
    );
    s = reducer(s, { type: "resetFormation", team: "defense" });
    expect(find(s, "d2")?.y).toBe(-7);
    expect(find(s, "d1")?.y).toBe(-5);
    // already home: nothing to commit
    expect(reducer(s, { type: "resetFormation", team: "defense" })).toBe(s);
  });
  test("custom waypoint add, move, and remove are each undoable and redoable", () => {
    let s = run({ type: "setRoute", id: "o3", route: { type: "custom", pts: [[5, -3], [8, -6]] } });
    s = reducer(s, { type: "customPointAdd", id: "o3", pt: [11, -9] });
    s = reducer(s, { type: "customPointMove", id: "o3", index: 1, pt: [9, -7] });
    s = reducer(s, { type: "customPointRemove", id: "o3", index: 0 });
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[9, -7], [11, -9]] });
    expect(s.past).toHaveLength(4);
    s = reducer(s, { type: "undo" });
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[5, -3], [9, -7], [11, -9]] });
    s = reducer(s, { type: "undo" });
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[5, -3], [8, -6], [11, -9]] });
    s = reducer(s, { type: "redo" });
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[5, -3], [9, -7], [11, -9]] });
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
    // 2·3 − 5 = 1 sits off the field: the waypoint is pulled back to the sideline
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[1.2, 0]] });
    s = run({ type: "select", id: "o3" }, { type: "pick", key: "go" }, { type: "mirror" });
    expect(find(s, "o3")?.route).toEqual({ type: "go" });
  });
  test("undo restores the geometry and the read a transform touched", () => {
    let s = run(
      { type: "select", id: "o3" },
      { type: "setRoute", id: "o3", route: { type: "custom", pts: [[8, -5]], primary: true } },
      { type: "mirror" },
    );
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[1.2, -5]], primary: true });
    s = reducer(s, { type: "undo" });
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[8, -5]], primary: true });
    s = reducer(s, { type: "redo" });
    expect(find(s, "o3")?.route).toEqual({ type: "custom", pts: [[1.2, -5]], primary: true });
  });
  test("a custom draft stops taking waypoints at the cap", () => {
    let s = run({ type: "select", id: "o5" }, { type: "pick", key: "custom" });
    for (let i = 0; i < 70; i++) s = reducer(s, { type: "draftPoint", pt: [10 + (i % 10), -i / 4] });
    expect(s.draft?.pts).toHaveLength(60);
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
  test("newPlay starts a fresh play and leaves the previous one out of undo and redo", () => {
    let s = run(
      { type: "load", id: "abc", name: "Bunch", notes: "hi", players: defaults() },
      { type: "select", id: "o3" },
      { type: "pick", key: "go" },
      { type: "saved", id: "abc" },
      { type: "newPlay", side: "offense" },
    );
    expect(s.id).toBeNull();
    expect(s.name).toBe("New play");
    expect(s.notes).toBe("");
    expect(s.selectedId).toBeNull();
    expect(find(s, "o3")?.route).toBeNull();
    expect(s.past).toHaveLength(0);
    expect(s.future).toHaveLength(0);
    expect(reducer(s, { type: "undo" })).toBe(s);
    expect(reducer(s, { type: "redo" })).toBe(s);
    s = reducer(s, { type: "select", id: "o4" });
    s = reducer(s, { type: "pick", key: "post" });
    s = reducer(s, { type: "undo" });
    expect(find(s, "o4")?.route).toBeNull();
    expect(s.id).toBeNull();
    expect(s.name).toBe("New play");
    s = reducer(s, { type: "redo" });
    expect(find(s, "o4")?.route).toEqual({ type: "post" });
    expect(s.id).toBeNull();
    expect(s.name).toBe("New play");
  });
  test("undoing a move keeps a name typed after the move", () => {
    let s = run({ type: "move", id: "o3", x: 9, y: 2, commit: true }, { type: "setName", name: "Sprint" }, { type: "setNotes", notes: "go" });
    s = reducer(s, { type: "undo" });
    expect(find(s, "o3")?.x).toBe(3);
    expect(s.name).toBe("Sprint");
    expect(s.notes).toBe("go");
  });
  test("unsaved knows when a play has work its record doesn't", () => {
    const saved = { id: "abc", name: "Bunch", notes: "hi", side: "offense" as const, players: defaults() };
    let s = run({ type: "load", id: "abc", name: "Bunch", notes: "hi", players: defaults() });
    expect(unsaved(s, saved)).toBe(false);
    expect(unsaved(reducer(s, { type: "setNotes", notes: "changed" }), saved)).toBe(true);
    expect(unsaved(reducer(s, { type: "move", id: "o3", x: 9, y: 2, commit: true }), saved)).toBe(true);
    s = initialState();
    expect(unsaved(s, null)).toBe(false);
    expect(unsaved(reducer(s, { type: "setName", name: "Mine" }), null)).toBe(true);
    expect(unsaved(reducer(s, { type: "move", id: "o3", x: 9, y: 2, commit: true }), null)).toBe(true);
  });
});

describe("play side", () => {
  test("a shadow player can be selected and given their own assignment", () => {
    let s = run({ type: "newPlay", side: "defense" }, { type: "select", id: "o3" }, { type: "pick", key: "slant" });
    expect(s.selectedId).toBe("o3");
    expect(find(s, "o3")?.route).toEqual({ type: "slant" });
    const shadow = find(s, "o3");
    expect(shadow && isContext(shadow, s.side)).toBe(true);
    s = reducer(s, { type: "select", id: "d1" });
    expect(s.selectedId).toBe("d1");
    s = reducer(s, { type: "pick", key: "blitz" });
    expect(find(s, "d1")?.route).toEqual({ type: "blitz" });
    s = reducer(s, { type: "select", id: "o3" });
    s = reducer(s, { type: "setShadow", on: false });
    expect(s.vis).toBe("defense");
    expect(s.selectedId).toBeNull();
    expect(find(s, "o3")?.route).toEqual({ type: "slant" });
  });
  test("a restored defensive draft shows the shadow offense; a play without a side is offensive", () => {
    expect(run({ type: "hydrate", name: "Blitz", side: "defense", players: defaults() }).vis).toBe("both");
    expect(run({ type: "load", name: "Old", players: defaults() }).side).toBe("offense");
  });
  test("hiding the shadow offense is remembered while the call stays defensive", () => {
    let s = run({ type: "newPlay", side: "defense" }, { type: "setShadow", on: false });
    expect(s.vis).toBe("defense");
    s = reducer(s, { type: "load", id: "d2", name: "Cover 3", side: "defense", players: defaults() });
    expect(s.vis).toBe("defense");
    s = reducer(s, { type: "setShadow", on: true });
    expect(s.vis).toBe("both");
    expect(reducer(s, { type: "setShadow", on: true })).toBe(s);
    expect(run({ type: "setShadow", on: false }).vis).toBe("offense");
  });
});

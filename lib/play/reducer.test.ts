import { describe, expect, test } from "bun:test";
import { initialState, isContext, reducer, selected, shadowing, unsaved, type Action, type PlayState } from "./reducer";
import { defaults } from "./routes";

const run = (...actions: Action[]): PlayState => actions.reduce(reducer, initialState());
const find = (s: PlayState, id: string) => s.players.find((p) => p.id === id);

describe("reducer", () => {
  test("man enters targeting and the next red player becomes the target", () => {
    let s = run({ type: "hydrate", side: "defense", name: "Cover", players: defaults() }, { type: "select", id: "d1" }, { type: "pick", key: "man" });
    expect(s.targeting).toBe("man");
    s = reducer(s, { type: "target", id: "d2" });
    expect(s.targeting).toBe("man");
    s = reducer(s, { type: "target", id: "o3" });
    expect(s.targeting).toBeNull();
    expect(find(s, "d1")?.route).toEqual({ type: "man", target: "o3" });
  });
  test("an empty custom draft leaves the route alone", () => {
    const s = run({ type: "select", id: "o5" }, { type: "pick", key: "custom" }, { type: "draftFinish" });
    expect(find(s, "o5")?.route).toBeNull();
    expect(s.past).toHaveLength(0);
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
  test("draft and custom waypoint removal respect disabled-state invariants", () => {
    let s = run({ type: "select", id: "o5" }, { type: "pick", key: "custom" });
    expect(reducer(s, { type: "draftPointRemove" })).toBe(s);
    s = reducer(s, { type: "draftPoint", pt: [19, 2] });
    s = reducer(s, { type: "draftPointRemove" });
    expect(s.draft?.pts).toEqual([]);
    s = run({ type: "setRoute", id: "o3", route: { type: "custom", pts: [[5, -3]] } });
    expect(reducer(s, { type: "customPointRemove", id: "o3", index: 0 })).toBe(s);
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
  test("mirror and flip keep the primary read and every other flag", () => {
    let s = run(
      { type: "select", id: "o5" },
      { type: "setRoute", id: "o5", route: { type: "custom", pts: [[21, 0], [24, -6]] } },
      { type: "togglePrimary" },
      { type: "mirror" },
    );
    expect(find(s, "o5")?.route).toEqual({ type: "custom", pts: [[17, 0], [14, -6]], primary: true });
    s = reducer(s, { type: "flip" });
    expect(find(s, "o5")?.route).toEqual({ type: "custom", pts: [[13, 0], [16, -6]], primary: true });
    // presets keep their primary and mirror flags across a flip; man keeps its target
    s = run(
      { type: "select", id: "o3" }, { type: "pick", key: "out" }, { type: "togglePrimary" }, { type: "mirror" },
      { type: "setRoute", id: "d1", route: { type: "man", target: "o3" } },
      { type: "flip" },
    );
    expect(find(s, "o3")?.route).toEqual({ type: "out", primary: true, mirror: true });
    expect(find(s, "d1")?.route).toEqual({ type: "man", target: "o3" });
    expect(find(s, "d1")?.x).toBe(27);
  });
  test("mirror twice and flip twice bring a custom route back where it was, with its read", () => {
    const route = { type: "custom" as const, pts: [[21, 0], [24, -6]] as [number, number][], primary: true };
    const start = run({ type: "select", id: "o5" }, { type: "setRoute", id: "o5", route });
    const back = reducer(reducer(start, { type: "mirror" }), { type: "mirror" });
    expect(find(back, "o5")?.route).toEqual(route);
    const flipped = reducer(reducer(start, { type: "flip" }), { type: "flip" });
    expect(find(flipped, "o5")?.route).toEqual(route);
    expect(find(flipped, "o5")?.x).toBe(19);
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
    s = reducer(s, { type: "move", id: "o3", x: 9, y: 2 });
    s = reducer(s, { type: "resetFormation", team: "defense" });
    expect(find(s, "o3")?.x).toBe(9);
    s = reducer(s, { type: "resetFormation", team: "offense" });
    expect(find(s, "o3")?.x).toBe(3);
  });
  test("opening B replaces A, so undo and redo cannot put one play's diagram on the other", () => {
    const aPlayers = defaults().map((p) => (p.id === "o3" ? { ...p, route: { type: "go" as const } } : p));
    const bPlayers = defaults().map((p) => (p.id === "o4" ? { ...p, route: { type: "post" as const } } : p));
    const s = run(
      { type: "load", id: "play-a", name: "Play A", notes: "A notes", players: aPlayers },
      { type: "setRoute", id: "o5", route: { type: "slant" } },
      { type: "undo" },
      { type: "load", id: "play-b", name: "Play B", notes: "B notes", players: bPlayers },
    );
    expect(s.id).toBe("play-b");
    expect(s.name).toBe("Play B");
    expect(s.notes).toBe("B notes");
    expect(find(s, "o4")?.route).toEqual({ type: "post" });
    expect(find(s, "o3")?.route).toBeNull();
    expect(s.past).toHaveLength(0);
    expect(s.future).toHaveLength(0);
    expect(reducer(s, { type: "undo" })).toBe(s);
    expect(reducer(s, { type: "redo" })).toBe(s);
  });
  test("unsaved knows when a play has work its record doesn't", () => {
    const saved = { id: "abc", name: "Bunch", notes: "hi", side: "offense" as const, players: defaults() };
    let s = run({ type: "load", id: "abc", name: "Bunch", notes: "hi", players: defaults() });
    expect(unsaved(s, saved)).toBe(false);
    expect(unsaved(reducer(s, { type: "setNotes", notes: "changed" }), saved)).toBe(true);
    expect(unsaved(reducer(s, { type: "move", id: "o3", x: 9, y: 2 }), saved)).toBe(true);
    s = initialState();
    expect(unsaved(s, null)).toBe(false);
    expect(unsaved(reducer(s, { type: "setName", name: "Mine" }), null)).toBe(true);
    expect(unsaved(reducer(s, { type: "move", id: "o3", x: 9, y: 2 }), null)).toBe(true);
  });
  test("load replaces the document and clears history; hydrate does not push any", () => {
    const players = defaults().map((p) => ({ ...p, x: 15 }));
    let s = run({ type: "move", id: "o3", x: 9, y: 2 }, { type: "load", id: "abc", name: "Bunch", notes: "hi", players });
    expect(s.name).toBe("Bunch");
    expect(s.id).toBe("abc");
    expect(s.notes).toBe("hi");
    expect(find(s, "o3")?.x).toBe(15);
    expect(s.past).toHaveLength(0);
    expect(s.future).toHaveLength(0);
    s = reducer(initialState(), { type: "hydrate", name: "Draft", players });
    expect(s.past).toHaveLength(0);
    expect(s.id).toBeNull();
    expect(selected(s)).toBeNull();
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
  test("an offensive play can show a shadow defense, and that choice sticks to the next offensive play", () => {
    let s = run({ type: "setShadow", on: true });
    expect(s.side).toBe("offense");
    expect(s.vis).toBe("both");
    expect(shadowing(s.side, s.vis)).toBe(true);
    s = reducer(s, { type: "select", id: "d1" });
    expect(s.selectedId).toBe("d1");
    s = reducer(s, { type: "pick", key: "zoneDeep" });
    expect(find(s, "d1")?.route).toEqual({ type: "zoneDeep" });
    s = reducer(s, { type: "select", id: "d2" });
    s = reducer(s, { type: "pick", key: "man" });
    expect(s.targeting).toBe("man");
    s = reducer(s, { type: "target", id: "o3" });
    expect(find(s, "d2")?.route).toEqual({ type: "man", target: "o3" });
    s = reducer(s, { type: "select", id: "o3" });
    expect(s.selectedId).toBe("o3");
    s = reducer(s, { type: "load", id: "o2", name: "Slant", side: "offense", players: defaults() });
    expect(s.vis).toBe("both");
    s = reducer(s, { type: "setShadow", on: false });
    expect(s.vis).toBe("offense");
    expect(reducer(s, { type: "setShadow", on: false })).toBe(s);
  });
});

describe("lateral chains", () => {
  const hops = (s: PlayState) => find(s, "o2")?.laterals;
  const lateralToZ = (): PlayState => run(
    { type: "select", id: "o5" }, { type: "pick", key: "go" },
    { type: "select", id: "o2" }, { type: "lateral" }, { type: "target", id: "o5" },
  );
  test("Lateral asks who takes it, like Man: any other red player, then that player is selected", () => {
    let s = run({ type: "select", id: "o2" }, { type: "lateral" });
    expect(s.targeting).toBe("lateral");
    const before = s;
    // the carrier themself, and a defender, are not choices
    expect(reducer(s, { type: "target", id: "o2" })).toBe(before);
    expect(reducer(s, { type: "target", id: "d1" })).toBe(before);
    s = reducer(s, { type: "target", id: "o5" });
    expect(s.targeting).toBeNull();
    expect(s.selectedId).toBe("o5");
    expect(hops(s)).toEqual([{ to: "o5" }]);
    expect(find(s, "o2")?.route).toBeNull();
    expect(s.past).toHaveLength(1);
  });
  test("dragging a catch forward snaps it level with the release, and past the line snaps it behind it", () => {
    let s = reducer(lateralToZ(), { type: "catchMove", hop: 0, pt: [22, 2] });
    expect(hops(s)).toEqual([{ to: "o5", catch: [22, 5] }]);
    s = reducer(s, { type: "catchMove", hop: 0, pt: [30, 6.5] });
    expect(hops(s)).toEqual([{ to: "o5", catch: [28.8, 6.5] }]);
    // nothing to move past the last toss
    expect(reducer(s, { type: "catchMove", hop: 1, pt: [5, 5] })).toBe(s);
  });
});

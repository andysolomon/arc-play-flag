import { describe, expect, test } from "bun:test";
import { initialState, reducer, selected, unsaved, type Action, type PlayState } from "./reducer";
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
    // the whole play comes back, not just its diagram: the toast promised as much
    expect(s.id).toBe("abc");
    expect(s.name).toBe("Bunch");
    expect(s.notes).toBe("hi");
    s = reducer(s, { type: "redo" });
    expect(s.id).toBeNull();
    expect(s.name).toBe("New play");
    expect(find(s, "o3")?.route).toBeNull();
  });
  test("A → B → undo leaves A's diagram under A's identity, so Save can't overwrite B", () => {
    const aPlayers = defaults().map((p) => (p.id === "o3" ? { ...p, route: { type: "go" as const } } : p));
    const bPlayers = defaults().map((p) => (p.id === "o4" ? { ...p, route: { type: "post" as const } } : p));
    let s = run(
      { type: "load", id: "play-a", name: "Play A", notes: "A notes", players: aPlayers },
      { type: "load", id: "play-b", name: "Play B", notes: "B notes", players: bPlayers },
    );
    s = reducer(s, { type: "undo" });
    expect(find(s, "o3")?.route).toEqual({ type: "go" });
    expect(find(s, "o4")?.route).toBeNull();
    expect(s.id).toBe("play-a");
    expect(s.name).toBe("Play A");
    expect(s.notes).toBe("A notes");
    // redo is the mirror image
    s = reducer(s, { type: "redo" });
    expect(find(s, "o4")?.route).toEqual({ type: "post" });
    expect(s.id).toBe("play-b");
    expect(s.name).toBe("Play B");
    expect(s.notes).toBe("B notes");
    // and undoing past both loads lands on the blank new play
    s = reducer(reducer(s, { type: "undo" }), { type: "undo" });
    expect(s.id).toBeNull();
    expect(s.name).toBe("New play");
    expect(s.players).toEqual(defaults());
  });
  test("edits made in B stay in B after undoing back through the switch", () => {
    let s = run(
      { type: "load", id: "play-a", name: "Play A", notes: "", players: defaults() },
      { type: "load", id: "play-b", name: "Play B", notes: "", players: defaults() },
      { type: "setName", name: "Play B v2" },
      { type: "setNotes", notes: "B notes" },
      { type: "setRoute", id: "o4", route: { type: "post" } },
    );
    // undoing the route edit keeps B's identity and everything typed into it
    s = reducer(s, { type: "undo" });
    expect(find(s, "o4")?.route).toBeNull();
    expect(s.id).toBe("play-b");
    expect(s.name).toBe("Play B v2");
    expect(s.notes).toBe("B notes");
    // the next undo crosses the switch and restores A whole
    s = reducer(s, { type: "undo" });
    expect(s.id).toBe("play-a");
    expect(s.name).toBe("Play A");
    // redo brings back B as it was when we left: edited name and notes included
    s = reducer(s, { type: "redo" });
    expect(s.id).toBe("play-b");
    expect(s.name).toBe("Play B v2");
    expect(s.notes).toBe("B notes");
  });
  test("undoing a move keeps a name typed after the move", () => {
    let s = run({ type: "move", id: "o3", x: 9, y: 2, commit: true }, { type: "setName", name: "Sprint" }, { type: "setNotes", notes: "go" });
    s = reducer(s, { type: "undo" });
    expect(find(s, "o3")?.x).toBe(3);
    expect(s.name).toBe("Sprint");
    expect(s.notes).toBe("go");
  });
  test("unsaved knows when a play has work its record doesn't", () => {
    const saved = { id: "abc", name: "Bunch", notes: "hi", players: defaults() };
    let s = run({ type: "load", id: "abc", name: "Bunch", notes: "hi", players: defaults() });
    expect(unsaved(s, saved)).toBe(false);
    expect(unsaved(reducer(s, { type: "setNotes", notes: "changed" }), saved)).toBe(true);
    expect(unsaved(reducer(s, { type: "move", id: "o3", x: 9, y: 2, commit: true }), saved)).toBe(true);
    s = initialState();
    expect(unsaved(s, null)).toBe(false);
    expect(unsaved(reducer(s, { type: "setName", name: "Mine" }), null)).toBe(true);
    expect(unsaved(reducer(s, { type: "move", id: "o3", x: 9, y: 2, commit: true }), null)).toBe(true);
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

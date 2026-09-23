import { describe, expect, test } from "bun:test";
import { HISTORY_CAP, emptyHistory, push, redo, undo, type Doc } from "./history";
import { defaults } from "./routes";

const snap = (n: number, doc: Partial<Doc> = {}): Doc =>
  ({ id: "play", name: "Play", notes: "", side: "offense", players: defaults().map((p) => ({ ...p, x: n })), ...doc });
const x = (d: { players: readonly { x: number }[] } | undefined) => d?.players[0]?.x;

describe("history", () => {
  test("undo and redo walk the snapshots", () => {
    let h = push(emptyHistory, snap(0));
    h = push(h, snap(1));
    const u = undo(h, snap(2));
    expect(x(u?.doc)).toBe(1);
    expect(x(u?.history.future[0])).toBe(2);
    const r = redo(u?.history ?? emptyHistory, u?.doc ?? snap(9));
    expect(x(r?.doc)).toBe(2);
    expect(r?.history.past).toHaveLength(2);
  });
  test("a new commit clears the redo stack", () => {
    const h = push(emptyHistory, snap(0));
    const u = undo(h, snap(1));
    const next = push(u?.history ?? emptyHistory, snap(3));
    expect(next.future).toHaveLength(0);
    expect(redo(next, snap(3))).toBeNull();
  });
  test("nothing to undo or redo returns null", () => {
    expect(undo(emptyHistory, snap(0))).toBeNull();
    expect(redo(emptyHistory, snap(0))).toBeNull();
  });
  test("capped at 60 snapshots, dropping the oldest", () => {
    let h = emptyHistory;
    for (let i = 0; i < 75; i++) h = push(h, snap(i));
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(x(h.past[0])).toBe(15);
    expect(x(h.past.at(-1))).toBe(74);
  });
  test("an ordinary edit restores the players and keeps the play you are on", () => {
    const h = push(emptyHistory, snap(0, { id: "a", name: "Old", notes: "", side: "defense" }));
    const current = snap(1, { id: "b", name: "Renamed", notes: "typed later", side: "offense" });
    const u = undo(h, current);
    expect(u?.doc).toMatchObject({ id: "b", name: "Renamed", notes: "typed later", side: "offense" });
    expect(x(u?.doc)).toBe(0);
    const r = redo(u?.history ?? emptyHistory, u?.doc ?? current);
    expect(r?.doc).toMatchObject({ id: "b", name: "Renamed", notes: "typed later", side: "offense" });
    expect(x(r?.doc)).toBe(1);
  });
});

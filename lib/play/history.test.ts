import { describe, expect, test } from "bun:test";
import { HISTORY_CAP, emptyHistory, push, redo, undo, type Doc } from "./history";
import { defaults } from "./routes";

const snap = (n: number, doc: Partial<Doc> = {}): Doc =>
  ({ id: "play", name: "Play", notes: "", players: defaults().map((p) => ({ ...p, x: n })), ...doc });
const x = (d: Doc | undefined) => d?.players[0]?.x;

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
  test("an ordinary edit restores the players and keeps the name and notes typed since", () => {
    const h = push(emptyHistory, snap(0, { name: "Old", notes: "" }));
    const u = undo(h, snap(1, { name: "Renamed", notes: "typed later" }));
    expect(u?.doc).toMatchObject({ id: "play", name: "Renamed", notes: "typed later" });
    expect(x(u?.doc)).toBe(0);
  });
  test("a swap restores the whole document, and redo brings the other one back whole", () => {
    const a = snap(0, { id: "a", name: "A", notes: "A notes" });
    const b = snap(5, { id: "b", name: "B", notes: "B notes" });
    const h = push(emptyHistory, a, true);
    const u = undo(h, b);
    expect(u?.doc).toEqual(a);
    expect(u?.history.future[0]).toEqual({ ...b, swap: true });
    const r = redo(u?.history ?? emptyHistory, u?.doc ?? a);
    expect(r?.doc).toEqual(b);
    expect(r?.history.past[0]).toEqual({ ...a, swap: true });
  });
});

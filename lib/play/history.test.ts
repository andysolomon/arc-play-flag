import { describe, expect, test } from "bun:test";
import { HISTORY_CAP, emptyHistory, push, redo, undo } from "./history";
import { defaults } from "./routes";

const snap = (n: number) => defaults().map((p) => ({ ...p, x: n }));

describe("history", () => {
  test("undo and redo walk the snapshots", () => {
    let h = push(emptyHistory, snap(0));
    h = push(h, snap(1));
    const u = undo(h, snap(2));
    expect(u?.players[0]?.x).toBe(1);
    expect(u?.history.future[0]?.[0]?.x).toBe(2);
    const r = redo(u?.history ?? emptyHistory, u?.players ?? []);
    expect(r?.players[0]?.x).toBe(2);
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
    expect(h.past[0]?.[0]?.x).toBe(15);
    expect(h.past.at(-1)?.[0]?.x).toBe(74);
  });
});

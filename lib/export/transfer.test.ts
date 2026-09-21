import { describe, expect, test } from "bun:test";
import { defaults } from "@/lib/play/routes";
import type { SavedPlay } from "@/lib/play/types";
import { encodePlaybookFile, MAX_FILE_BYTES } from "./playbook-file";
import { encodePlayFile, planTransfer, readTransfer, transferPlays, type Transfer } from "./transfer";

const play: SavedPlay = { id: "one", name: "Wheel", side: "offense", notes: "Sell the fake. 🏈", players: defaults().map(p => p.id === "o3" ? { ...p, route: { type: "custom", pts: [[12, -5], [8, -10]], primary: true } } : p.id === "d1" ? { ...p, route: { type: "man", target: "o3" } } : p) };
const decode = (text: string): Transfer => { const result = readTransfer(text); if (!result.ok) throw new Error(result.error); return result.file; };

describe("play and playbook transfers", () => {
  test("standalone offense and defense preserve routes, notes and primary without creating a book", () => {
    for (const side of ["offense", "defense"] as const) {
      const source = { ...play, side };
      const result = readTransfer(encodePlayFile(source));
      expect(result).toMatchObject({ ok: true, skipped: 0, normalized: false, file: { play: source } });
      const plan = planTransfer(decode(encodePlayFile(source)), [], []);
      expect(plan.plays).toEqual([source]);
      expect(plan.book).toBeNull();
    }
  });
  test("book order is independent of library order and unrelated plays stay out", () => {
    const other = { ...play, id: "two", name: "Zone", side: "defense" as const };
    const json = encodePlaybookFile({ id: "book", name: "Sunday", plays: ["two", "one"] }, [play, other, { ...play, id: "private" }], null);
    const file = decode(json);
    expect(transferPlays(file)).toEqual([other, play]);
    expect(json).not.toContain("private");
    expect(readTransfer(json)).toMatchObject({ normalized: false });
  });
  test("distinct identical plays keep their own IDs and book positions", () => {
    const second = { ...play, id: "second" };
    const file = decode(encodePlaybookFile({ id: "b", name: "Two calls", plays: [play.id, second.id] }, [play, second], null));
    const plan = planTransfer(file, [second, play], []);
    expect(plan.book?.plays).toEqual([play.id, second.id]);
    expect(plan.reused).toBe(2);
  });
  test("repeated conflicting imports reuse both copied plays and the copied book", () => {
    const file = decode(encodePlaybookFile({ id: "book", name: "Sunday", plays: [play.id] }, [play], null));
    const local = { ...play, notes: "Local edits" };
    const localBook = { id: "book", name: "Keep", plays: [play.id] };
    const first = planTransfer(file, [local], [localBook]);
    expect(first.copied).toBe(1);
    expect(first.book?.plays[0]).not.toBe(play.id);
    if (!first.book) throw new Error("Expected copied book");
    const again = planTransfer(file, [local, ...first.plays], [localBook, first.book]);
    expect(again.plays).toEqual([]);
    expect(again.book).toBeNull();
    expect(again.bookId).toBe(first.book.id);
    expect(again.reused).toBe(1);
    expect(local.notes).toBe("Local edits");
  });
  test("validation handles versions, missing references, malformed data and actual UTF-8 size", () => {
    expect(readTransfer("{")).toMatchObject({ ok: false, error: "notJson" });
    expect(readTransfer(JSON.stringify({ kind: "ffpd.play", version: 2, play }))).toMatchObject({ ok: false, error: "newerVersion" });
    expect(readTransfer(JSON.stringify({ kind: "ffpd.play", version: 1, play: { ...play, id: "__proto__" } }))).toMatchObject({ ok: false });
    const missing = JSON.parse(encodePlaybookFile({ id: "b", name: "Book", plays: [play.id] }, [play], null)) as { playbook: { plays: string[] } };
    missing.playbook.plays.push("missing");
    expect(readTransfer(JSON.stringify(missing))).toMatchObject({ ok: true, normalized: true });
    expect(readTransfer('"' + "é".repeat(MAX_FILE_BYTES / 2) + '"')).toMatchObject({ ok: false, error: "tooLarge" });
    expect(readTransfer(JSON.stringify({ kind: "ffpd.play", version: 1, play: { ...play, name: "x".repeat(90) } }))).toMatchObject({ ok: true, normalized: true });
  });
});

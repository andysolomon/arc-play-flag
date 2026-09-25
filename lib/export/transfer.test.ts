import { describe, expect, test } from "bun:test";
import { defaults } from "@/lib/play/routes";
import type { SavedPlay } from "@/lib/play/types";
import { encodePlaybookFile, MAX_FILE_BYTES } from "./playbook-file";
import { planTransfer, readTransfer, type Transfer } from "./transfer";

const play: SavedPlay = { id: "one", name: "Wheel", side: "offense", notes: "Sell the fake. 🏈", players: defaults().map(p => p.id === "o3" ? { ...p, route: { type: "custom", pts: [[12, -5], [8, -10]], primary: true } } : p.id === "d1" ? { ...p, route: { type: "man", target: "o3" } } : p) };
const decode = (text: string): Transfer => { const result = readTransfer(text); if (!result.ok) throw new Error(result.error); return result.file; };

describe("play and playbook transfers", () => {
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

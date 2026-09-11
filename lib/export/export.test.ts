import { describe, expect, test } from "bun:test";
import { defaults } from "@/lib/play/routes";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import { binderPages } from "./binder";
import { cardSvg } from "./card";
import { FLYER_SLOTS, flyerDefault, flyerPage } from "./flyer";
import { numbered, positionsOf } from "./numbered";
import { defaultPaper } from "./pages";
import { postcardPages, postcardSheet } from "./postcard";
import { MAX_FILE_BYTES, decodePlaybookFile, encodePlaybookFile, importMessage, planImport, readPlaybookFile } from "./playbook-file";
import { planCards, tile, wristbandPages } from "./wristband";

const play = (id: string, name: string, notes = ""): SavedPlay => ({
  id, name, notes,
  players: defaults().map((p) => (p.id === "o3" ? { ...p, route: { type: "go", primary: true } } : p.id === "o5" ? { ...p, route: { type: "dive" } } : p)),
});
const team = { name: "Sharks", color: "#123abc" };
const library = Array.from({ length: 7 }, (_, i) => play(`p${String(i)}`, `Play ${String(i + 1)}`, i === 0 ? "Sell the fake.\nThen go." : ""));
const book: Playbook = { id: "wk1", name: "Week 1", plays: ["p0", "p1", "missing", "p2", "p3", "p4", "p5", "p6"] };
const expectVisibility = (svg: string, vis: "offense" | "defense" | "both") => {
  expect(svg.includes("#e5675e")).toBe(vis !== "defense");
  expect(svg.includes("#4a8fe0")).toBe(vis !== "offense");
};

describe("numbering", () => {
  test("skips plays that no longer exist and numbers from 1", () => {
    const list = numbered(book, library);
    expect(list.map((n) => n.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(list[2]?.play.id).toBe("p2");
  });
  test("positions are offensive labels minus the quarterback", () => {
    expect(positionsOf(numbered(book, library))).toEqual(["C", "X", "Y", "Z"]);
  });
});

describe("wristbands", () => {
  test("plans one card set per position plus everyone, overflowing past the grid", () => {
    const cards = planCards(numbered(book, library), 6);
    expect(cards).toHaveLength(5 * 2);
    expect(cards[0]).toMatchObject({ position: "C", index: 0, count: 2 });
    expect(cards[1]?.cells.filter(Boolean)).toHaveLength(1);
    expect(cards[1]?.cells[0]?.n).toBe(7);
    expect(cards[9]?.position).toBeNull();
  });
  test("tiles slim cards three to a page, one per row", () => {
    expect(tile("letter", { w: 4.5, h: 2.25, rows: 2, cols: 3 })).toMatchObject({ perPage: 3, cols: 1, rows: 3 });
    expect(tile("a4", { w: 5, h: 3, rows: 3, cols: 4 }).perPage).toBe(3);
    expect(tile("letter", { w: 3.5, h: 2.75, rows: 2, cols: 3 })).toMatchObject({ cols: 2, rows: 3, perPage: 6 });
  });
  test("renders pages with cut lines, captions and highlighted fields", () => {
    const pages = wristbandPages(numbered(book, library), { size: { w: 4.5, h: 2.25, rows: 2, cols: 3 }, paper: "letter", bookName: "Week 1", team });
    expect(pages).toHaveLength(4);
    expect(pages[0]?.svg).toContain("stroke-dasharray=\"3 3\"");
    expect(pages[0]?.svg).toContain("C · Week 1 · 1 of 2");
    expect(pages[0]?.svg).toContain('r="33"');
    expect(pages[0]?.svg).not.toContain("#4a8fe0");
  });
});

describe("binder", () => {
  test("one detailed page per play with notes, the call and the mark", () => {
    const pages = binderPages(numbered(book, library), { layout: "one", paper: "a4", bookName: "Week 1", team });
    expect(pages).toHaveLength(7);
    expect(pages[0]?.svg).toContain("Sell the fake.");
    expect(pages[0]?.svg).toContain(">Play-action<");
    expect(pages[0]?.svg).toContain(">Go<");
    expect(pages[0]?.svg).toContain("arc-play-flag.vercel.app");
    expect(pages[0]?.svg).toContain("Sharks · Week 1");
  });
  test("four up packs plays with gutters and no route names", () => {
    const pages = binderPages(numbered(book, library), { layout: "four", paper: "letter", bookName: "Week 1", team });
    expect(pages).toHaveLength(2);
    expect(pages[0]?.svg).not.toContain(">Go<");
    expect(pages[1]?.svg.match(/<circle[^>]*fill="#f2b705"/g)?.length).toBe(3);
  });
});

describe("card", () => {
  test("is a 4:5 canvas with the team band and number", () => {
    const c = cardSvg({ name: "Trips right", players: library[0]?.players ?? [], n: 3, team });
    expect(c.w / c.h).toBeCloseTo(0.8);
    expect(c.svg).toContain('fill="#123abc"');
    expect(c.svg).toContain(">3<");
    expect(c.svg).toContain(">Sharks<");
  });
  test("draws the selected team composition", () => {
    for (const vis of ["offense", "defense", "both"] as const) {
      expectVisibility(cardSvg({ name: "Trips right", players: library[0]?.players ?? [], team, vis }).svg, vis);
    }
  });
});

describe("flyer", () => {
  const six = numbered(book, library).slice(0, 6);
  test("is one page of six plays with the team band, numbers and names", () => {
    const flyer = flyerPage(six, { paper: "letter", bookName: "Week 1", team });
    expect(flyer.w).toBe(612);
    expect(flyer.h).toBe(792);
    expect(flyer.svg).toContain('fill="#123abc"');
    expect(flyer.svg).toContain(">Sharks<");
    expect(flyer.svg).toContain(">Week 1<");
    expect(flyer.svg).toContain("arc-play-flag.vercel.app");
    for (const item of six) expect(flyer.svg).toContain(`>${item.play.name}<`);
    expect(flyer.svg.match(/<circle[^>]*fill="#f2b705"/g)?.length).toBe(6);
  });
  test("shows the plays simply: no route names and no read marker", () => {
    const flyer = flyerPage(six, { paper: "a4", bookName: "Week 1", team });
    expect(flyer.svg).not.toContain(">Go<");
    expect(flyer.svg).not.toContain(">Play-action<");
  });
  test("defaults to the first six and leaves an unfilled slot blank", () => {
    const list = numbered(book, library);
    expect(flyerDefault(list).map((i) => i?.n)).toEqual([1, 2, 3, 4, 5, 6]);
    const short = flyerDefault(list.slice(0, 4));
    expect(short).toHaveLength(FLYER_SLOTS);
    expect(short[4]).toBeNull();
    const flyer = flyerPage(short, { paper: "letter", bookName: "Week 1", team });
    expect(flyer.svg.match(/<circle[^>]*fill="#f2b705"/g)?.length).toBe(4);
  });
  test("a coach's own six are drawn in the order they picked", () => {
    const list = numbered(book, library);
    const picked = [list[6] ?? null, list[0] ?? null, null, list[3] ?? null, null, list[1] ?? null];
    const flyer = flyerPage(picked, { paper: "letter", bookName: "Week 1", team });
    expect(flyer.svg.match(/<circle[^>]*fill="#f2b705"/g)?.length).toBe(4);
    expect(flyer.svg.indexOf(">Play 7<")).toBeLessThan(flyer.svg.indexOf(">Play 1<"));
  });
  test("carries the chosen team composition", () => {
    for (const vis of ["offense", "defense", "both"] as const) {
      expectVisibility(flyerPage(six, { paper: "letter", bookName: "Week 1", team, vis }).svg, vis);
    }
  });
});

describe("postcards", () => {
  const list = numbered(book, library);
  const twoUp = { size: "twoUp", paper: "letter", bookName: "Week 1", team } as const;
  test("prints two cards a sheet, each front followed by its own backs page", () => {
    const pages = postcardPages(list, twoUp);
    // seven plays: four front sheets and the four back sheets that pair with them
    expect(pages).toHaveLength(8);
    expect(pages[0]?.svg).toContain(">Fronts<");
    expect(pages[1]?.svg).toContain("flip on the long edge");
    expect(pages[0]?.svg).toContain("stroke-dasharray=\"3 3\"");
  });
  test("a back sits exactly where its front did, so a duplex sheet lines up", () => {
    const pages = postcardPages(list.slice(0, 2), twoUp);
    // only the card-sized frames, not the play art nested inside them
    const slots = (svg: string) => svg.match(/<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" viewBox="0 0 1080 1350"/g);
    expect(slots(pages[0]?.svg ?? "")).toEqual(slots(pages[1]?.svg ?? ""));
    expect(postcardSheet(twoUp).slots).toHaveLength(2);
  });
  test("the back carries the coaching points, the team and a line for the player", () => {
    const pages = postcardPages(list.slice(0, 1), twoUp);
    const back = pages[1]?.svg ?? "";
    expect(back).toContain(">COACHING POINTS<");
    expect(back).toContain("Sell the fake.");
    expect(back).toContain(">Sharks<");
    expect(back).toContain(">Player<");
    expect(back).toContain(">Play 1<");
  });
  test("a play with no notes gets ruled lines to write on", () => {
    const blank = postcardPages(list.slice(1, 2), twoUp)[1]?.svg ?? "";
    const written = postcardPages(list.slice(0, 1), twoUp)[1]?.svg ?? "";
    const rules = (svg: string) => svg.match(/<rect[^>]*height="2"[^>]*fill="#6f6c66"/g)?.length ?? 0;
    expect(rules(blank)).toBeGreaterThan(4);
    expect(rules(written)).toBe(0);
  });
  test("4 by 6 stock is one card a sheet on a 4 by 6 page, with no cut lines", () => {
    const o = { size: "card46", paper: "letter", bookName: "Week 1", team } as const;
    const pages = postcardPages(list.slice(0, 3), o);
    expect(pages).toHaveLength(6);
    expect(pages[0]?.w).toBe(288);
    expect(pages[0]?.h).toBe(432);
    expect(pages[0]?.svg).not.toContain("stroke-dasharray");
    expect(postcardSheet(o).slots).toHaveLength(1);
  });
  test("the front is the picture card and carries the chosen composition", () => {
    for (const vis of ["offense", "defense", "both"] as const) {
      const front = postcardPages(list.slice(0, 1), { ...twoUp, vis })[0]?.svg ?? "";
      expect(front).toContain(">Play-action<");
      expectVisibility(front, vis);
    }
  });
});

describe("export visibility", () => {
  test("carries offense, defense and both through binder and wristband PDFs", () => {
    const items = numbered(book, library).slice(0, 1);
    for (const vis of ["offense", "defense", "both"] as const) {
      const binder = binderPages(items, { layout: "one", paper: "letter", bookName: "Week 1", team, vis });
      const bands = wristbandPages(items, { size: { w: 4.5, h: 2.25, rows: 2, cols: 3 }, paper: "letter", bookName: "Week 1", team, vis });
      expectVisibility(binder[0]?.svg ?? "", vis);
      expectVisibility(bands[0]?.svg ?? "", vis);
    }
  });
});

describe("paper", () => {
  test("defaults by region", () => {
    expect(defaultPaper("en-US")).toBe("letter");
    expect(defaultPaper("en-GB")).toBe("a4");
    expect(defaultPaper("de")).toBe("a4");
  });
});

describe("playbook file", () => {
  test("round-trips the book, its plays and the team", () => {
    const json = encodePlaybookFile(book, library, team);
    const file = decodePlaybookFile(json);
    expect(file?.playbook.plays).toEqual(["p0", "p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(file?.plays).toHaveLength(7);
    expect(file?.team).toEqual(team);
    expect(decodePlaybookFile("{}")).toBeNull();
    expect(decodePlaybookFile("nope")).toBeNull();
  });
  test("refuses files it can't vouch for, each with a reason", () => {
    const good = JSON.parse(encodePlaybookFile(book, library, team)) as Record<string, unknown>;
    const read = (patch: Record<string, unknown>) => readPlaybookFile(JSON.stringify({ ...good, ...patch }));
    expect(readPlaybookFile("{not json")).toEqual({ ok: false, error: "notJson" });
    expect(readPlaybookFile("[]")).toEqual({ ok: false, error: "notPlaybook" });
    expect(read({ kind: "other" })).toEqual({ ok: false, error: "notPlaybook" });
    expect(read({ version: 999 })).toEqual({ ok: false, error: "newerVersion" });
    expect(read({ version: "1" })).toEqual({ ok: false, error: "unknownVersion" });
    expect(read({ version: 0 })).toEqual({ ok: false, error: "unknownVersion" });
    expect(read({ playbook: null })).toEqual({ ok: false, error: "notPlaybook" });
    const dup = (good.plays as unknown[])[0];
    expect(read({ plays: Array.from({ length: 501 }, () => dup) })).toEqual({ ok: false, error: "tooManyPlays" });
    expect(read({ plays: [dup, dup] })).toEqual({ ok: false, error: "duplicatePlays" });
    expect(readPlaybookFile("x".repeat(MAX_FILE_BYTES + 1))).toEqual({ ok: false, error: "tooLarge" });
    for (const e of ["tooLarge", "notJson", "notPlaybook", "newerVersion", "unknownVersion", "tooManyPlays", "duplicatePlays"] as const) {
      expect(importMessage(e).length).toBeGreaterThan(10);
    }
  });
  test("extreme values are tamed and unreadable plays are counted, not imported", () => {
    const good = JSON.parse(encodePlaybookFile(book, library, team)) as { plays: Record<string, unknown>[] };
    const json = JSON.stringify({
      kind: "ffpd.playbook", version: 1, playbook: { id: "b", name: "B", plays: ["p0", "ghost", "empty"] },
      plays: [
        { ...good.plays[0], players: [{ id: "o1", team: "offense", x: 3, y: 1, route: { type: "custom", pts: [[1, 2]] } }] },
        { id: "empty", name: "Empty", players: [] },
        "junk",
      ],
    }).replace("[1,2]", "[1e400,-1e400]");
    const r = readPlaybookFile(json);
    if (!r.ok) throw new Error(r.error);
    expect(r.skipped).toBe(2);
    expect(r.file.plays).toHaveLength(1);
    expect(r.file.playbook.plays).toEqual(["p0"]);
    // an infinite waypoint is dropped, not clamped: it was never a place on the field
    expect(r.file.plays[0]?.players[0]?.route?.pts).toEqual([]);
    expect(r.file.plays[0]?.players[0]?.x).toBe(3);
  });
  test("import reuses identical plays, copies changed ones, and never duplicates a book", () => {
    const file = decodePlaybookFile(encodePlaybookFile(book, library, team));
    if (!file) throw new Error("decode failed");
    // a fresh device: everything is added
    const fresh = planImport(file, [], []);
    expect(fresh).toMatchObject({ added: 7, reused: 0, copied: 0 });
    expect(fresh.book?.id).toBe("wk1");
    // the same device: nothing to add, and the book already exists
    const again = planImport(file, library, [{ ...book, plays: file.playbook.plays }]);
    expect(again).toMatchObject({ added: 0, reused: 7, copied: 0, book: null });
    // one play edited locally: the file's version comes in as a copy under a new id
    const edited = library.map((p) => (p.id === "p1" ? { ...p, notes: "changed here" } : p));
    const plan = planImport(file, edited, []);
    expect(plan).toMatchObject({ added: 0, reused: 6, copied: 1 });
    expect(plan.plays[0]?.id).not.toBe("p1");
    expect(plan.book?.plays[1]).toBe(plan.plays[0]?.id);
    // a different book under the same id becomes "(imported)"
    const other = planImport(file, library, [{ id: "wk1", name: "Week 1", plays: ["p0"] }]);
    expect(other.book?.name).toBe("Week 1 (imported)");
    expect(other.book?.id).not.toBe("wk1");
  });
});

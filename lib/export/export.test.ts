import { describe, expect, test } from "bun:test";
import { defaults } from "@/lib/play/routes";
import type { Playbook, SavedPlay } from "@/lib/play/types";
import { binderPages } from "./binder";
import { flyerPage } from "./flyer";
import { numbered } from "./numbered";
import { PAPERS, defaultPaper, f2, type PaperKey, type SvgPage } from "./pages";
import { buildPdf } from "./pdf";
import { postcardPages, postcardSheet } from "./postcard";
import { MAX_FILE_BYTES, decodePlaybookFile, encodePlaybookFile, importMessage, planImport, readPlaybookFile } from "./playbook-file";
import { BAND_PRESETS, planCards, tile, wristbandPages } from "./wristband";

const play = (id: string, name: string, notes = ""): SavedPlay => ({
  id, name, notes, side: "offense",
  players: defaults().map((p) => (p.id === "o3" ? { ...p, route: { type: "go", primary: true } } : p.id === "o5" ? { ...p, route: { type: "dive" } } : p)),
});
const team = { name: "Sharks", color: "#123abc" };
const library = Array.from({ length: 7 }, (_, i) => play(`p${String(i)}`, `Play ${String(i + 1)}`, i === 0 ? "Sell the fake.\nThen go." : ""));
const book: Playbook = { id: "wk1", name: "Week 1", plays: ["p0", "p1", "missing", "p2", "p3", "p4", "p5", "p6"] };

describe("attribution", () => {
  test("the binder and the flyer carry the app's mark", () => {
    const list = numbered(book, library);
    expect(binderPages(list, { layout: "one", paper: "a4", bookName: "Week 1", team })[0]?.svg).toContain("arc-play-flag.vercel.app");
    expect(flyerPage(list.slice(0, 6), { paper: "letter", bookName: "Week 1", team }).svg).toContain("arc-play-flag.vercel.app");
  });
});

describe("postcards", () => {
  const list = numbered(book, library);
  const twoUp = { size: "twoUp", paper: "letter", bookName: "Week 1", team } as const;
  test("a back sits exactly where its front did, so a duplex sheet lines up", () => {
    const pages = postcardPages(list.slice(0, 2), twoUp);
    // only the card-sized frames, not the play art nested inside them
    const slots = (svg: string) => svg.match(/<svg x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" viewBox="0 0 1080 1350"/g);
    expect(slots(pages[0]?.svg ?? "")).toEqual(slots(pages[1]?.svg ?? ""));
    expect(postcardSheet(twoUp).slots).toHaveLength(2);
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
});

/**
 * The page markup with every nested `<svg>` (play art, card faces) collapsed to a `<frame>`
 * carrying its placement, so only shapes in the sheet's own point coordinates remain.
 */
const sheetMarkup = (svg: string): string => {
  let body = svg.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  for (;;) {
    const next = body.replace(/<svg\b([^>]*)>(?:(?!<svg\b)[\s\S])*?<\/svg>/g, "<frame$1/>");
    if (next === body) return body;
    body = next;
  }
};
const attr = (tag: string, name: string, fallback = 0): number => {
  const m = new RegExp(` ${name}="([-\\d.]+)"`).exec(tag);
  return m?.[1] ? Number(m[1]) : fallback;
};
/** Every box, line and disc drawn on the sheet, as [left, top, right, bottom] in points. */
const drawnBounds = (svg: string): [number, number, number, number][] => {
  const body = sheetMarkup(svg);
  const bounds: [number, number, number, number][] = [];
  for (const [tag] of body.matchAll(/<(?:rect|frame)\b[^>]*>/g)) {
    const x = attr(tag, "x"), y = attr(tag, "y");
    bounds.push([x, y, x + attr(tag, "width"), y + attr(tag, "height")]);
  }
  for (const [tag] of body.matchAll(/<line\b[^>]*>/g)) {
    const xs = [attr(tag, "x1"), attr(tag, "x2")], ys = [attr(tag, "y1"), attr(tag, "y2")];
    bounds.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  for (const [tag] of body.matchAll(/<circle\b[^>]*>/g)) {
    const cx = attr(tag, "cx"), cy = attr(tag, "cy"), r = attr(tag, "r");
    bounds.push([cx - r, cy - r, cx + r, cy + r]);
  }
  return bounds;
};
const expectOnTheSheet = (pg: SvgPage) => {
  const bounds = drawnBounds(pg.svg);
  expect(bounds.length).toBeGreaterThan(1);
  for (const [l, t, r, b] of bounds) {
    expect(l).toBeGreaterThanOrEqual(-0.01);
    expect(t).toBeGreaterThanOrEqual(-0.01);
    expect(r).toBeLessThanOrEqual(pg.w + 0.01);
    expect(b).toBeLessThanOrEqual(pg.h + 0.01);
  }
};
/** The dashed frames a coach cuts along, as [width, height] in points. */
const cutFrames = (svg: string): [number, number][] =>
  [...sheetMarkup(svg).matchAll(/<rect\b[^>]*stroke-dasharray="3 3"[^>]*>/g)].map(([tag]) => [attr(tag, "width"), attr(tag, "height")]);

describe("actual size", () => {
  const list = numbered(book, library);
  const opts = { bookName: "Week 1", team };
  const formats: Record<string, (paper: PaperKey) => SvgPage[]> = {
    wristbands: (paper) => wristbandPages(list, { ...opts, paper, size: { w: 4.5, h: 2.25, rows: 2, cols: 3 } }),
    "binder, one play a page": (paper) => binderPages(list, { ...opts, paper, layout: "one" }),
    "binder, four up": (paper) => binderPages(list, { ...opts, paper, layout: "four" }),
    "postcards, two up": (paper) => postcardPages(list, { ...opts, paper, size: "twoUp" }),
    flyer: (paper) => [flyerPage(list.slice(0, 6), { ...opts, paper })],
  };

  for (const paper of ["letter", "a4"] as const) {
    const { w, h, label } = PAPERS[paper];
    for (const [name, render] of Object.entries(formats)) {
      test(`${name} on ${label} is exactly ${f2(w)} × ${f2(h)} pt with nothing past the edge`, () => {
        const pages = render(paper);
        expect(pages.length).toBeGreaterThan(0);
        for (const pg of pages) {
          expect([pg.w, pg.h]).toEqual([w, h]);
          expect(pg.svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f2(w)} ${f2(h)}" width="${f2(w)}" height="${f2(h)}"`)).toBe(true);
          expectOnTheSheet(pg);
        }
        // the page box the printer sees is the paper, not the pixel size the page was drawn at
        const pdf = new TextDecoder("latin1").decode(buildPdf(
          pages.map((pg) => ({ w: pg.w, h: pg.h, image: { width: 1, height: 1, filter: "DCTDecode" as const, data: new Uint8Array(1) } })),
          name,
        ));
        expect([...pdf.matchAll(/\/MediaBox \[0 0 [\d.]+ [\d.]+\]/g)].map(([box]) => box)).toEqual(pages.map(() => `/MediaBox [0 0 ${f2(w)} ${f2(h)}]`));
      });
    }
  }

  test("a 4 by 6 postcard sheet is 4 by 6 inches whichever paper the book prints on", () => {
    for (const paper of ["letter", "a4"] as const) {
      for (const pg of postcardPages(list.slice(0, 1), { ...opts, paper, size: "card46" })) {
        expect([pg.w, pg.h]).toEqual([288, 432]);
        expectOnTheSheet(pg);
      }
    }
  });

  test("every wristband preset cuts out at its stated inches on both papers", () => {
    for (const preset of BAND_PRESETS) {
      for (const paper of ["letter", "a4"] as const) {
        const pages = wristbandPages(list, { ...opts, paper, size: preset });
        const { perPage } = tile(paper, preset);
        const cards = planCards(list, preset.rows * preset.cols).length;
        expect(pages).toHaveLength(Math.ceil(cards / perPage));
        const frames = pages.flatMap((pg) => cutFrames(pg.svg));
        expect(frames).toHaveLength(cards);
        for (const frame of frames) expect(frame).toEqual([preset.w * 72, preset.h * 72]);
      }
    }
  });

  test("two-up postcards are 4:5 cards inside the printable margin, cut where they are drawn", () => {
    for (const paper of ["letter", "a4"] as const) {
      const { w, h, slots } = postcardSheet({ ...opts, paper, size: "twoUp" });
      expect([w, h]).toEqual([PAPERS[paper].w, PAPERS[paper].h]);
      expect(slots).toHaveLength(2);
      for (const s of slots) {
        expect(s.w / s.h).toBeCloseTo(0.8, 6);
        expect(s.x).toBeGreaterThanOrEqual(0.4 * 72);
        expect(s.y).toBeGreaterThanOrEqual(0.4 * 72);
        expect(s.x + s.w).toBeLessThanOrEqual(w - 0.4 * 72);
        expect(s.y + s.h).toBeLessThanOrEqual(h - 0.4 * 72);
      }
      const front = postcardPages(list.slice(0, 2), { ...opts, paper, size: "twoUp" })[0];
      expect(cutFrames(front?.svg ?? "")).toEqual(slots.map((s) => [Number(f2(s.w)), Number(f2(s.h))]));
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

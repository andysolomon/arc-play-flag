import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { Designer, downloadBytes } from "../support/designer";
import { COVER_TWO_D, OTTERS, SLANT_LEFT, ZONE_D, play, playbook, seed } from "../support/fixtures";

/**
 * Issue #108, the coach-workflow polish: what a coach relies on once a staff shares and prints
 * plays every week.
 *
 * - A snapshot link carries the play's coaching notes, shows them on the share page and brings
 *   them back into the designer, as the playbook's short link always did.
 * - The toast sits under the play name, never over it.
 * - On a phone every header control shows its name, not just a glyph.
 * - The one-up and four-up binders download under different names.
 * - Every PDF keeps its words, invisibly, under the page pictures, so it can be searched.
 * - Playbook and play cards line up their titles whatever the first play's depth.
 *
 * Leaves `coach-polish-<device>-*.json` (what each check measured), the share page, the toast and
 * the phone header as pictures, and the binders with their extracted words in `test-results/`,
 * uploaded as `coach-polish`.
 */

const MESH_NOTES = "Mesh at 5 yards: X under, Y over.\nC sits in the hole if they drop.";
const MESH = play("fx-mesh", "Otter Mesh", { o3: { type: "slant", primary: true }, o4: { type: "in" } }, MESH_NOTES);

const out = (device: string, name: string): string => `test-results/coach-polish-${device}-${name}`;
const report = (device: string, name: string, data: unknown): void => {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(out(device, `${name}.json`), `${JSON.stringify(data, null, 2)}\n`);
};

/** The JSON a /p/ link carries, read the way anyone holding the link could. */
function payload(url: string): Record<string, unknown> {
  const id = /\/p\/([A-Za-z0-9_-]+)$/.exec(url)?.[1] ?? "";
  return JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function copyLink(page: Page, d: Designer): Promise<{ url: string; said: string }> {
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  await expect(dialog).toBeVisible();
  const line = dialog.getByText(/coaching notes/);
  const said = (await line.count()) ? (await line.innerText()).trim() : "";
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  return { url: await page.evaluate(() => navigator.clipboard.readText()), said };
}

test.describe("share links", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("a snapshot link carries the coaching notes to the share page and back into the designer", async ({ page }, testInfo) => {
    const device = testInfo.project.name;
    await seed(page, { plays: [MESH] });
    const d = new Designer(page);
    await d.goto("?open=fx-mesh");

    const withNotes = await copyLink(page, d);
    expect(payload(withNotes.url).notes).toBe(MESH_NOTES);
    expect(withNotes.said).toBe("Your coaching notes go with it, under the play.");

    await page.goto(withNotes.url);
    const notes = page.getByRole("region", { name: "COACHING NOTES" });
    await expect(notes).toBeVisible();
    // the line break the coach typed is kept
    expect(await notes.getByRole("paragraph").innerText()).toBe(MESH_NOTES);
    // the field still fits above them
    const field = await page.getByRole("img", { name: "Play diagram" }).boundingBox();
    const panel = await notes.boundingBox();
    expect(field && panel && field.y + field.height <= panel.y + 1).toBe(true);
    await page.screenshot({ path: out(device, "share-page.png") });

    await page.getByRole("link", { name: "Open in designer ›" }).click();
    await expect(d.field).toBeVisible();
    await d.clickTool("Notes");
    await expect(page.getByRole("textbox", { name: "Coaching points" })).toHaveValue(MESH_NOTES);

    // a play without notes says so, and its link is what it was before notes travelled
    await d.newPlay("Offense");
    await d.setName("Otter Blank");
    const without = await copyLink(page, d);
    expect(without.said).toBe("This play has no coaching notes yet; any you add in Play tools go with the link.");
    expect(Object.keys(payload(without.url))).toEqual(["name", "players"]);
    await page.goto(without.url);
    await expect(page.getByRole("heading", { name: "Otter Blank" })).toBeVisible();
    await expect(page.getByRole("region", { name: "COACHING NOTES" })).toHaveCount(0);

    report(device, "share-notes", {
      withNotes: { dialog: withNotes.said, payload: payload(withNotes.url) },
      without: { dialog: without.said, payload: Object.keys(payload(without.url)) },
    });
  });
});

test("the Saved toast sits under the play name, never over it", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  const d = new Designer(page);
  await d.goto();
  await d.setName("Trips Right Mesh");
  // the name and its "Saved" line above the field (the designer's only heading on the field pane)
  const row = page.locator("main h1").locator("..");
  const measured: { toast: string; title: unknown; pill: unknown }[] = [];
  const check = async (said: string) => {
    await expect(d.toast).toHaveText(said);
    const title = await row.boundingBox();
    const pill = await d.toast.boundingBox();
    measured.push({ toast: said, title, pill });
    expect(title && pill, "both are on screen").toBeTruthy();
    if (!title || !pill) return;
    expect(pill.y, `"${said}" starts below the play name`).toBeGreaterThanOrEqual(title.y + title.height);
    await expect(row.getByRole("heading")).toBeVisible();
  };

  await d.save();
  await check("Saved");
  await d.clickTool("Duplicate");
  await check("Saved a copy");
  // the drawing hint stays up over a clear field while a route is drawn: the moment the old spot hid the name longest
  await d.select("X");
  await d.pick("Custom");
  await d.foldOverlays();
  await check("Tap waypoints on the field · double-tap to finish");
  await page.screenshot({ path: out(device, "toast.png") });
  await page.keyboard.press("Escape");
  await d.newPlay("Offense");
  await check("New play");
  report(device, "toast", measured);
});

test.describe("phone header", () => {
  const CONTROLS = [
    { name: "Play tools", label: "Play" },
    { name: "Offense play", label: "Offense" },
    { name: "Undo", label: "Undo" },
    { name: "Redo", label: "Redo" },
    { name: "Clear routes", label: "Clear" },
    { name: "Route palette", label: "Routes" },
  ] as const;

  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    test(`at ${String(size.width)}px every header control shows its name under its glyph`, async ({ page }, testInfo) => {
      const device = testInfo.project.name;
      await page.setViewportSize(size);
      const d = new Designer(page);
      await d.goto();
      await d.settle();
      const header = page.locator("header");
      const found: Record<string, unknown>[] = [];
      for (const c of CONTROLS) {
        const control: Locator = header.getByRole(c.name === "Offense play" ? "img" : "button", { name: c.name, exact: true });
        const name = control.getByText(c.label, { exact: true });
        await expect(name, `${c.name} shows "${c.label}"`).toBeVisible();
        const box = await control.boundingBox();
        const text = await name.boundingBox();
        const glyph = await control.locator("img, svg").first().boundingBox();
        const hit = await control.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return at !== null && (el === at || el.contains(at));
        });
        found.push({ control: c.name, label: c.label, box, text, glyph, hit });
        expect(box && text && glyph).toBeTruthy();
        if (!box || !text || !glyph) continue;
        expect(box.height, `${c.name} is a 44px target`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${c.name} is a 44px target`).toBeGreaterThanOrEqual(44);
        expect(box.x, `${c.name} starts on screen`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `${c.name} ends on screen`).toBeLessThanOrEqual(size.width);
        // the name sits under the glyph, inside the key
        expect(text.y, `${c.name}'s name is under its glyph`).toBeGreaterThanOrEqual(glyph.y + glyph.height - 1);
        expect(text.x).toBeGreaterThanOrEqual(box.x);
        expect(text.x + text.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
        expect(text.y + text.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
        if (c.name !== "Offense play") expect(hit, `a tap at the centre of ${c.name} lands on it`).toBe(true);
      }
      const overflow = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, "the header fits the screen").toBeLessThanOrEqual(0);
      await header.screenshot({ path: out(device, `header-${String(size.width)}.png`) });
      report(device, `header-${String(size.width)}`, { viewport: size, overflow, controls: found });
    });
  }
});

/** Latin-1 view of the file, byte for byte. */
const latin = (b: Buffer): string => b.toString("latin1");

const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/**
 * The words under each page's picture, read out of the PDF's content streams: every `<hex> Tj`
 * run between BT and ET, decoded from WinAnsi, with where the run sits. The page boxes come from
 * each page object's MediaBox, so a run can be checked against the page it is on.
 */
function pdfWords(pdf: Buffer): { pages: { box: number[]; runs: { s: string; x: number; y: number; size: number; invisible: boolean }[] }[] } {
  const s = latin(pdf);
  const objects = new Map<number, string>();
  for (const m of s.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)) objects.set(Number(m[1]), m[2] ?? "");
  const pages: { box: number[]; runs: { s: string; x: number; y: number; size: number; invisible: boolean }[] }[] = [];
  for (const body of objects.values()) {
    if (!body.startsWith("<< /Type /Page ")) continue;
    const box = (/\/MediaBox \[([^\]]+)\]/.exec(body)?.[1] ?? "").split(" ").map(Number);
    const contents = Number(/\/Contents (\d+) 0 R/.exec(body)?.[1]);
    const stream = /stream\n([\s\S]*)\nendstream/.exec(objects.get(contents) ?? "")?.[1] ?? "";
    const runs: { s: string; x: number; y: number; size: number; invisible: boolean }[] = [];
    for (const block of stream.matchAll(/BT([\s\S]*?)ET/g)) {
      const text = block[1] ?? "";
      const invisible = /(^|\s)3 Tr(\s|$)/.test(text);
      for (const r of text.matchAll(/\/F1 ([\d.]+) Tf [\d.]+ Tz 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm <([0-9a-f]*)> Tj/g)) {
        const bytes = Buffer.from(r[4] ?? "", "hex");
        const word = Array.from(bytes, (b) => (b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] ?? "" : String.fromCharCode(b))).join("");
        runs.push({ s: word, size: Number(r[1]), x: Number(r[2]), y: Number(r[3]), invisible });
      }
    }
    pages.push({ box, runs });
  }
  return { pages };
}

test("the one-up and four-up binders download under their own names, and every PDF's words can be searched", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const device = testInfo.project.name;
  const book = playbook("fx-mesh-book", "Otter Mesh Book", [MESH, COVER_TWO_D, SLANT_LEFT]);
  await seed(page, { plays: [MESH, COVER_TWO_D, SLANT_LEFT], playbooks: [book], team: OTTERS });
  await page.goto("/playbooks?book=fx-mesh-book");
  const toast = page.locator("div[role='status']");

  const grab = async (button: string, file: string): Promise<{ name: string; words: ReturnType<typeof pdfWords>; text: string }> => {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name: button }).click()]);
    await expect(toast).toHaveText("Saved", { timeout: 60_000 });
    const bytes = await downloadBytes(dl);
    expect(latin(bytes.subarray(0, 5))).toBe("%PDF-");
    writeFileSync(out(device, file), bytes);
    const words = pdfWords(bytes);
    return { name: dl.suggestedFilename(), words, text: words.pages.map((p) => p.runs.map((r) => r.s).join("\n")).join("\n\f\n") };
  };

  const one = await grab("Download binder PDF", "binder.pdf");
  await page.getByRole("combobox", { name: "Binder layout" }).selectOption("four");
  const four = await grab("Download binder PDF", "binder-four-up.pdf");
  const bands = await grab("Download wristbands PDF", "wristbands.pdf");

  // one detailed page per play: its name and every line of its notes are on that page
  expect(one.words.pages).toHaveLength(3);
  for (const [i, p] of [MESH, COVER_TWO_D, SLANT_LEFT].entries()) {
    const page = (one.words.pages[i]?.runs ?? []).map((r) => r.s).join(" ");
    expect(page, `page ${String(i + 1)} names its play`).toContain(p.name);
    for (const line of p.notes.split("\n")) {
      for (const word of line.split(/\s+/).filter(Boolean)) expect(page, `page ${String(i + 1)} carries "${word}" from the notes`).toContain(word);
    }
  }
  expect(one.text).toContain("Mesh");
  expect(one.text).toContain("Otter Mesh Book");
  // the four-up and the wristbands name every play too, as far as a small cell fits it ("Otter Cover…")
  const named = (f: typeof one, name: string): boolean => f.words.pages.some((pg) => pg.runs.some((r) =>
    r.s.includes(name) || (r.s.endsWith("…") && r.s.length > 6 && name.startsWith(r.s.slice(0, -1).trimEnd()))));
  for (const p of [MESH, COVER_TWO_D, SLANT_LEFT]) {
    expect(named(four, p.name), `the four-up names ${p.name}`).toBe(true);
    expect(named(bands, p.name), `the wristbands name ${p.name}`).toBe(true);
  }
  // every run is invisible, on its page, and sized like printed text
  for (const f of [one, four, bands]) {
    for (const pg of f.words.pages) {
      expect(pg.runs.length, `${f.name}: every page has words`).toBeGreaterThan(0);
      const [, , w = 0, h = 0] = pg.box;
      for (const r of pg.runs) {
        expect(r.invisible, `${f.name}: "${r.s}" is drawn invisibly`).toBe(true);
        expect(r.x).toBeGreaterThanOrEqual(-1);
        expect(r.x).toBeLessThanOrEqual(w);
        expect(r.y).toBeGreaterThanOrEqual(-1);
        expect(r.y).toBeLessThanOrEqual(h);
        expect(r.size).toBeGreaterThan(1);
        expect(r.size).toBeLessThan(120);
      }
    }
  }
  // the name at the head of a binder page is read at the head of that page
  const title = one.words.pages[0]?.runs.find((r) => r.s === MESH.name);
  expect(title && title.y > (one.words.pages[0]?.box[3] ?? 0) * 0.6, "the play name sits in the top of the page").toBe(true);

  // the two binders are different printouts, so neither lands on the other's name
  expect(one.name).toBe("otter-mesh-book-binder.pdf");
  expect(four.name).toBe("otter-mesh-book-binder-four-up.pdf");
  expect(bands.name).toBe("otter-mesh-book-wristbands.pdf");
  await expect(page.getByText("Every PDF keeps its words under the pictures")).toBeVisible();

  for (const [key, f] of Object.entries({ one, four, bands })) writeFileSync(out(device, `${key}-words.txt`), `${f.text}\n`);
  report(device, "pdf-words", Object.fromEntries(Object.entries({ one, four, bands }).map(([k, f]) => [k, { file: f.name, pages: f.words.pages }])));
});

test("playbook and play cards line up their titles whether they open on an offensive play or a deep defensive call", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  const books = [
    playbook("fx-book-o", "Book Offense", [SLANT_LEFT, MESH]),
    playbook("fx-book-d", "Book Defense", [COVER_TWO_D, ZONE_D]),
    playbook("fx-book-mix", "Book Mixed", [ZONE_D, SLANT_LEFT, COVER_TWO_D]),
  ];
  await seed(page, { plays: [SLANT_LEFT, MESH, COVER_TWO_D, ZONE_D], playbooks: books, team: OTTERS });
  await page.goto("/playbooks");

  /** Each card's title, as far down its card as it sits, and the picture above it. */
  const measure = (names: readonly string[]) => page.evaluate((ns) => ns.map((n) => {
    const title = document.querySelector(`span[title="${CSS.escape(n)}"]`);
    const card = title?.closest(".shadow-tile");
    const pic = card?.querySelector("svg[role='img']:not([aria-hidden])") ?? card?.querySelector("svg");
    if (!title || !card || !pic) return { name: n, found: false, offset: NaN, picture: NaN };
    const t = title.getBoundingClientRect(), c = card.getBoundingClientRect(), p = pic.getBoundingClientRect();
    return { name: n, found: true, offset: Math.round((t.top - c.top) * 10) / 10, picture: Math.round(p.height * 10) / 10 };
  }), names);

  for (const n of books.map((b) => b.name)) await expect(page.locator(`span[title="${n}"]`)).toBeVisible();
  const bookCards = await measure(books.map((b) => b.name));
  const playCards = await measure([SLANT_LEFT.name, MESH.name, COVER_TWO_D.name, ZONE_D.name]);
  report(device, "cards", { bookCards, playCards });
  for (const set of [bookCards, playCards]) {
    for (const c of set) expect(c.found, `${c.name} is on the page`).toBe(true);
    const [first] = set;
    for (const c of set) {
      expect(Math.abs(c.offset - (first?.offset ?? 0)), `${c.name}'s title lines up with ${first?.name ?? ""}'s`).toBeLessThanOrEqual(1);
      expect(Math.abs(c.picture - (first?.picture ?? 0)), `${c.name}'s picture is as tall as ${first?.name ?? ""}'s`).toBeLessThanOrEqual(1);
    }
  }
  await page.screenshot({ path: out(device, "cards.png"), fullPage: true });
});

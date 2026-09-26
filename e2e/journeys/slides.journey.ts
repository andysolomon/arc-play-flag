import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Download, type Page } from "@playwright/test";
import { DIAGNOSTICS_KEY } from "../../lib/diagnostics";
import { playSvg } from "../../lib/render/play-svg";
import { armSabotage, canvasBudget, downloadBytes, sabotage } from "../support/designer";
import {
  COVER_TWO_D, FAKE_DIVE, HOOK_LADDER, KEYS, OTTERS, PITCH_OPTION, SLANT_LEFT, WALKTHROUGH, WALKTHROUGH_NOTES, WHEEL_RIGHT,
  corruptStoredText, playbook, seed,
} from "../support/fixtures";
import { PINNED, keepDeck, keepFile, packageProblems, pngSize, readDeck, readZip } from "../support/pptx";

const PLAYS = [SLANT_LEFT, WHEEL_RIGHT, HOOK_LADDER, COVER_TWO_D, FAKE_DIVE, PITCH_OPTION, WALKTHROUGH];
const BOOK = playbook("fx-meeting", "Otter Meeting Book", PLAYS);
const FAILED = "That export failed. Try again on a bigger screen.";

const toast = (page: Page) => page.locator("div[role='status']");
const slidesButton = (page: Page) => page.getByRole("button", { name: "Download slides" });

/** The stored export failures that say "No canvas.", read in the page. */
const noCanvasFailures = (page: Page): Promise<number> =>
  page.evaluate(
    (key) => (JSON.parse(localStorage.getItem(key) ?? "[]") as { kind: string; message: string }[]).filter((d) => d.kind === "export" && d.message === "No canvas.").length,
    DIAGNOSTICS_KEY,
  );

const pad = (n: number): string => String(n).padStart(2, "0");
/** A DOS date and time as the calendar reads them. */
const dos = (date: number, time: number): string =>
  `${String(1980 + (date >> 9))}-${pad((date >> 5) & 15)}-${pad(date & 31)} ${pad(time >> 11)}:${pad((time >> 5) & 63)}:${pad((time & 31) * 2)}`;

const NAMES = [
  "[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "docProps/app.xml",
  "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "ppt/presProps.xml", "ppt/viewProps.xml", "ppt/tableStyles.xml",
  "ppt/theme/theme1.xml", "ppt/theme/theme2.xml",
  "ppt/slideMasters/slideMaster1.xml", "ppt/slideMasters/_rels/slideMaster1.xml.rels",
  "ppt/slideLayouts/slideLayout1.xml", "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
  "ppt/notesMasters/notesMaster1.xml", "ppt/notesMasters/_rels/notesMaster1.xml.rels",
  "ppt/slides/slide1.xml", "ppt/slides/_rels/slide1.xml.rels", "ppt/notesSlides/notesSlide1.xml", "ppt/notesSlides/_rels/notesSlide1.xml.rels",
  "ppt/slides/slide2.xml", "ppt/slides/_rels/slide2.xml.rels", "ppt/notesSlides/notesSlide2.xml", "ppt/notesSlides/_rels/notesSlide2.xml.rels",
  "ppt/slides/slide3.xml", "ppt/slides/_rels/slide3.xml.rels", "ppt/notesSlides/notesSlide3.xml", "ppt/notesSlides/_rels/notesSlide3.xml.rels",
  "ppt/slides/slide4.xml", "ppt/slides/_rels/slide4.xml.rels", "ppt/notesSlides/notesSlide4.xml", "ppt/notesSlides/_rels/notesSlide4.xml.rels",
  "ppt/slides/slide5.xml", "ppt/slides/_rels/slide5.xml.rels", "ppt/notesSlides/notesSlide5.xml", "ppt/notesSlides/_rels/notesSlide5.xml.rels",
  "ppt/slides/slide6.xml", "ppt/slides/_rels/slide6.xml.rels", "ppt/notesSlides/notesSlide6.xml", "ppt/notesSlides/_rels/notesSlide6.xml.rels",
  "ppt/slides/slide7.xml", "ppt/slides/_rels/slide7.xml.rels", "ppt/notesSlides/notesSlide7.xml", "ppt/notesSlides/_rels/notesSlide7.xml.rels",
  "ppt/slides/slide8.xml", "ppt/slides/_rels/slide8.xml.rels", "ppt/notesSlides/notesSlide8.xml", "ppt/notesSlides/_rels/notesSlide8.xml.rels",
  "ppt/slides/slide9.xml", "ppt/slides/_rels/slide9.xml.rels", "ppt/notesSlides/notesSlide9.xml", "ppt/notesSlides/_rels/notesSlide9.xml.rels",
  "ppt/slides/slide10.xml", "ppt/slides/_rels/slide10.xml.rels", "ppt/notesSlides/notesSlide10.xml", "ppt/notesSlides/_rels/notesSlide10.xml.rels",
  "ppt/media/image1.png", "ppt/media/image2.png", "ppt/media/image3.png", "ppt/media/image4.png", "ppt/media/image5.png",
  "ppt/media/image6.png", "ppt/media/image7.png", "ppt/media/image8.png", "ppt/media/image9.png", "ppt/media/image10.png",
];

const TITLES = [
  "Otter Meeting Book",
  "Plays at a glance · 1–6",
  "Plays at a glance · 7",
  "1 · Otter Slant Left",
  "2 · Otter Wheel Right",
  '3 · Otter "Hook" & <Ladder>',
  "4 · Otter Cover Two D",
  "5 · Otter Fake Dive",
  "6 · Otter Pitch Option",
  "7 · Otter Walkthrough",
];

// Defender 4's man target names nobody, and loading a play drops such a route, so it reads "No assignment"
const ALTS = [
  "Title slide: Otter Meeting Book, Riverside Otters. 7 plays · 6 offense, 1 defense.",
  'Plays at a glance, 1–6 of 7: 1 Otter Slant Left; 2 Otter Wheel Right; 3 Otter "Hook" & <Ladder>; 4 Otter Cover Two D; 5 Otter Fake Dive; 6 Otter Pitch Option.',
  "Plays at a glance, 7 of 7: 7 Otter Walkthrough.",
  "Play 1: Otter Slant Left.\nPass.\nLeft to right: X: Slant; C: Snap; QB: Throw; Z: No route; Y: Out.\nCoaching points: X wins inside.",
  "Play 2: Otter Wheel Right.\nPass. Primary read: Z (Wheel).\nLeft to right: X: No route; C: Snap; QB: Throw, look to Z first; Z: Wheel (primary read); Y: Corner.",
  'Play 3: Otter "Hook" & <Ladder>.\nRun: Z takes it (Handoff).\nLeft to right: X: Go; C: Snap; QB: Hand off to Z; Z: Handoff (primary read); Y: Post.\nCoaching points: Z takes it & runs <behind> the C. Shout "hut" on two.',
  "Play 4: Otter Cover Two D.\nDefense.\nLeft to right: Defender 1: Zone deep; Defender 2: Man on X; Defender 3: No assignment; Defender 4: No assignment; Defender 5: Zone deep.\nCoaching points: Deep halves. Nobody gets behind you.",
  "Play 5: Otter Fake Dive.\nPlay-action: fake to Z, then throw. Primary read: X (Post).\nLeft to right: X: Post (primary read); C: Snap; QB: Fake to Z, then throw, look to X first; Z: Dive; Y: Curl.",
  "Play 6: Otter Pitch Option.\nOption: pitch to Z, who throws or keeps it.\nLeft to right: Player 1: Custom route; C: Snap; QB: Pitch to Z; Z: Pitch; Y: Corner.",
  `Play 7: Otter Walkthrough.\nNobody on this side yet.\nCoaching points: ${WALKTHROUGH_NOTES}`,
];

const NOTES = [
  'Otter Meeting Book · Riverside Otters\n7 plays, in book order:\n1 · Otter Slant Left · Pass\n2 · Otter Wheel Right · Pass\n3 · Otter "Hook" & <Ladder> · Run\n4 · Otter Cover Two D · Defense\n5 · Otter Fake Dive · Play-action\n6 · Otter Pitch Option · Option\n7 · Otter Walkthrough',
  '1 · Otter Slant Left · Pass\n2 · Otter Wheel Right · Pass\n3 · Otter "Hook" & <Ladder> · Run\n4 · Otter Cover Two D · Defense\n5 · Otter Fake Dive · Play-action\n6 · Otter Pitch Option · Option',
  "7 · Otter Walkthrough",
  "1 · Otter Slant Left · Pass\n\nPass.\n\nX wins inside.\n\nLeft to right:\nX: Slant\nC: Snap\nQB: Throw\nZ: No route\nY: Out",
  "2 · Otter Wheel Right · Pass\n\nPass. Primary read: Z (Wheel).\n\nLeft to right:\nX: No route\nC: Snap\nQB: Throw, look to Z first\nZ: Wheel (primary read)\nY: Corner",
  '3 · Otter "Hook" & <Ladder> · Run\n\nRun: Z takes it (Handoff).\n\nZ takes it & runs <behind> the C.\n\nShout "hut" on two.\n\nLeft to right:\nX: Go\nC: Snap\nQB: Hand off to Z\nZ: Handoff (primary read)\nY: Post',
  "4 · Otter Cover Two D · Defense\n\nDefense.\n\nDeep halves.\nNobody gets behind you.\n\nLeft to right:\nDefender 1: Zone deep\nDefender 2: Man on X\nDefender 3: No assignment\nDefender 4: No assignment\nDefender 5: Zone deep",
  "5 · Otter Fake Dive · Play-action\n\nPlay-action: fake to Z, then throw. Primary read: X (Post).\n\nLeft to right:\nX: Post (primary read)\nC: Snap\nQB: Fake to Z, then throw, look to X first\nZ: Dive\nY: Curl",
  "6 · Otter Pitch Option · Option\n\nOption: pitch to Z, who throws or keeps it.\n\nLeft to right:\nPlayer 1: Custom route\nC: Snap\nQB: Pitch to Z\nZ: Pitch\nY: Corner",
  `7 · Otter Walkthrough\n\n${WALKTHROUGH_NOTES}\n\nNobody on this side yet.`,
];

/** Title boxes in EMU, by slide kind: title slide, plays at a glance, one play. */
const TITLE_BOX = [609600, 2870200, 10972800, 1016000];
const GLANCE_BOX = [457200, 330200, 7620000, 609600];
const PLAY_BOX = [1270000, 406400, 7620000, 609600];

// the only time input is the clock; pinning it and the zone makes the file repeatable
test.use({ timezoneId: PINNED.timezone });

test("a coach downloads the playbook as slides for a team meeting: every slide, title, picture and speaker note follows the book, the package is sound, and the same book twice is the same file", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date(PINNED.clock));
  await seed(page, { plays: PLAYS, playbooks: [BOOK], team: OTTERS });
  await corruptStoredText(page, "fx-hook-ladder");
  // hostile text reached storage, or the escaping below would prove nothing
  const planted = await page.evaluate((key) => {
    const p = (JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, { name: string; notes: string } | undefined>)["fx-hook-ladder"];
    return { control: p?.name.includes("\u0001") ?? false, lone: /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(p?.name ?? ""), vtab: p?.notes.includes("\u000B") ?? false };
  }, KEYS.plays);
  expect(planted).toEqual({ control: true, lone: true, vtab: true });

  await page.goto("/playbooks?book=fx-meeting");
  await expect(page.getByText("SLIDES", { exact: true })).toBeVisible();
  await expect(page.getByText("One play per slide for your team meeting, with your notes and every player's job in the speaker notes.")).toBeVisible();
  await expect(page.getByText("10 slides · opens in PowerPoint, Keynote and Google Slides")).toBeVisible();
  // the faces embed the hand face by fetching its woff2; without it they quietly fall back to cursive
  const faceFetches: number[] = [];
  page.on("response", (r) => { if (r.request().resourceType() === "fetch" && /\.woff2(\?|$)/.test(r.url())) faceFetches.push(r.status()); });
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), slidesButton(page).click()]);
  await expect(toast(page)).toHaveText("Saved", { timeout: 60_000 });
  expect(d.suggestedFilename()).toBe("otter-meeting-book-slides.pptx");
  expect(faceFetches.length, "the hand face was never fetched for the faces").toBeGreaterThan(0);
  expect(faceFetches.every((status) => status === 200)).toBe(true);

  // the ZIP, kept first so a failing run still leaves the file; readZip refuses any structural defect
  const raw = await downloadBytes(d);
  await keepFile(testInfo, raw);
  const items = readZip(raw);
  expect(items.map((i) => i.name)).toEqual(NAMES);
  for (const i of items) {
    expect({ name: i.name, method: i.method, flags: i.flags, madeBy: i.madeBy, needed: i.needed, time: i.time, date: i.date })
      .toEqual({ name: i.name, method: 0, flags: 0, madeBy: 20, needed: 20, time: 0x6000, date: 0x5d21 });
    expect(dos(i.date, i.time)).toBe("2026-09-01 12:00:00");
  }

  // the package, every part parsed by the browser
  const deck = await readDeck(page, items);
  await keepDeck(testInfo, browser.version(), raw, items, deck);
  expect(packageProblems(deck, items)).toEqual([]);
  expect(deck.sldSz).toEqual({ cx: 12192000, cy: 6858000, type: null });
  expect(deck.notesSz).toBe(true);
  expect(deck.notesMasterBeforeSldIds).toBe(true);
  expect(deck.sldIds).toEqual([256, 257, 258, 259, 260, 261, 262, 263, 264, 265]);
  expect({ title: deck.coreTitle, created: deck.created, modified: deck.modified, slides: deck.appSlides, notes: deck.appNotes })
    .toEqual({ title: "Otter Meeting Book", created: "2026-09-01T12:00:00Z", modified: "2026-09-01T12:00:00Z", slides: 10, notes: 10 });

  // fonts and escaping, in the raw bytes
  const part = (name: string): Buffer => {
    const hit = items.find((i) => i.name === name);
    if (!hit) throw new Error(`no ${name} in the deck`);
    return hit.data;
  };
  const xml = items.filter((i) => /\.(xml|rels)$/.test(i.name));
  expect(xml.filter((i) => i.data.includes("Patrick Hand")).map((i) => i.name)).toEqual([]);
  expect(xml.filter((i) => /^ppt\/slides\/slide\d+\.xml$/.test(i.name) && i.data.includes("<a:latin")).map((i) => i.name)).toEqual([]);
  expect(part("ppt/theme/theme1.xml").toString("utf8").split('<a:latin typeface="Arial"/>').length - 1).toBe(2);
  const replacement = Buffer.from([0xef, 0xbf, 0xbd]);
  expect(xml.filter((i) => i.data.includes(0x01) || i.data.includes(0x0b) || i.data.includes(replacement)).map((i) => i.name)).toEqual([]);
  expect(part("ppt/slides/slide6.xml").toString("utf8")).toContain('<a:t>3 · Otter "Hook" &amp; &lt;Ladder&gt;</a:t>');
  expect(part("ppt/notesSlides/notesSlide6.xml").toString("utf8")).toContain("&amp; runs &lt;behind&gt;");
  const master = part("ppt/slideMasters/slideMaster1.xml").toString("utf8");
  expect(master).toContain('<a:srgbClr val="2A9D8F"/>');
  expect(master).toContain('<a:srgbClr val="F4EFE2"/>');

  // every slide: a title under one full-bleed 1920 × 1080 picture
  for (const [n, s] of deck.slides.entries()) {
    const i = n + 1;
    expect(s.part).toBe(`ppt/slides/slide${String(i)}.xml`);
    expect(s.spTree).toEqual(["sp", "pic"]);
    expect(s.title, `${s.part} has no title placeholder`).not.toBeNull();
    expect(s.ids).toEqual([1, 2, 3]);
    expect(s.picXfrm).toEqual([0, 0, 12192000, 6858000]);
    expect(s.embed).toBe("rId2");
    expect(s.media).toBe(`ppt/media/image${String(i)}.png`);
    const png = part(`ppt/media/image${String(i)}.png`);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const size = pngSize(png);
    expect(size).toEqual({ w: 1920, h: 1080 });
    expect(png.subarray(-12).toString("hex")).toBe("0000000049454e44ae426082");
    const [, , cx = 0, cy = 0] = s.picXfrm ?? [];
    expect(cx * size.h).toBe(cy * size.w);
    expect(s.titleXfrm).toEqual(i === 1 ? TITLE_BOX : i <= 3 ? GLANCE_BOX : PLAY_BOX);
  }
  // every face was really drawn: a flat or failed face is a few KB, a real one 100 KB or more
  const faces = deck.slides.map((s) => part(s.media ?? ""));
  for (const [n, f] of faces.entries()) expect(f.length, `face ${String(n + 1)} is nearly empty`).toBeGreaterThan(40_000);
  expect(faces.filter((f, n) => faces.some((g, k) => k !== n && f.equals(g)))).toHaveLength(0);
  expect(deck.slides.map((s) => s.title)).toEqual(TITLES);
  expect(deck.slides.map((s) => s.descr)).toEqual(ALTS);
  expect(deck.slides.map((s) => s.notes)).toEqual(NOTES);

  // route labels stay whole on the field, measured in the real face
  const fields = PLAYS.map((p) => ({ name: p.name, svg: playSvg(p.players, { level: "detailed", show: p.side }) }));
  const labels = await page.evaluate(async (list) => {
    await document.fonts.load("15px 'Patrick Hand'");
    await document.fonts.ready;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:660px;visibility:hidden;pointer-events:none";
    document.body.appendChild(host);
    const found = list.map(({ name, svg }) => {
      host.innerHTML = svg;
      return Array.from(host.querySelectorAll<SVGTextElement>('text[font-size="15"]')).map((t) => {
        const b = t.getBBox();
        return { play: name, text: t.textContent ?? "", left: b.x, right: b.x + b.width };
      });
    });
    host.remove();
    return found.flat();
  }, fields);
  expect(labels.filter((l) => l.play === "Otter Wheel Right").map((l) => l.text)).toContain("Corner");
  for (const l of labels) {
    expect(l.left, `${l.play}: "${l.text}" starts off the field`).toBeGreaterThanOrEqual(0);
    expect(l.right, `${l.play}: "${l.text}" runs off the field`).toBeLessThanOrEqual(660);
  }

  // the same book on the same clock is the same file, byte for byte
  const [d2] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), slidesButton(page).click()]);
  await expect(toast(page)).toHaveText("Saved", { timeout: 60_000 });
  expect((await downloadBytes(d2)).equals(raw)).toBe(true);

  // opt in with SLIDES_SOFFICE=/path/to/soffice (LibreOffice with Impress)
  const soffice = process.env.SLIDES_SOFFICE;
  if (soffice && testInfo.project.name === "chromium") {
    const dir = testInfo.project.outputDir;
    // the conversion brings its own 90 s allowance
    test.setTimeout(testInfo.timeout + 90_000);
    await promisify(execFile)(
      soffice,
      [`-env:UserInstallation=file://${join(dir, "slides-lo-profile")}`, "--headless", "--convert-to", "pdf", "--outdir", dir, join(dir, "slides-chromium.pptx")],
      { timeout: 90_000 },
    );
    const pdf = join(dir, "slides-chromium.pdf");
    expect((await readFile(pdf, "latin1")).match(/\/Type\s*\/Page(?!s)/g)?.length).toBe(10);
    await testInfo.attach("slides-chromium.pdf", { path: pdf, contentType: "application/pdf" });
  } else {
    testInfo.annotations.push({ type: "LibreOffice", description: soffice ? "skipped (runs on the chromium project)" : "skipped (set SLIDES_SOFFICE)" });
  }
});

test("a slide that cannot be drawn, first or halfway through the deck, is a failure and never a download", async ({ page }) => {
  test.setTimeout(120_000);
  await armSabotage(page);
  await seed(page, { plays: PLAYS, playbooks: [BOOK], team: OTTERS });
  await page.goto("/playbooks?book=fx-meeting");
  const downloads: Download[] = [];
  page.on("download", (d) => { downloads.push(d); });

  // the first slide cannot get a canvas
  await sabotage(page, "noCanvas", true);
  await slidesButton(page).click();
  await expect(toast(page)).toHaveText(FAILED, { timeout: 60_000 });
  await expect(slidesButton(page)).toBeEnabled();
  await expect.poll(() => noCanvasFailures(page)).toBe(1);

  // slides 1 and 2 draw, slide 3 runs out; the toast already says it failed, so wait on the record
  await sabotage(page, "noCanvas", false);
  await canvasBudget(page, 2);
  await slidesButton(page).click();
  await expect.poll(() => noCanvasFailures(page), { timeout: 60_000 }).toBe(2);
  await expect(toast(page)).toHaveText(FAILED);
  await expect(slidesButton(page)).toBeEnabled();
  expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__ffpdCanvasBudget)).toBe(0);

  // lifted, the same button saves the whole deck, and it is the only file there ever was
  await canvasBudget(page, null);
  const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), slidesButton(page).click()]);
  await expect(toast(page)).toHaveText("Saved", { timeout: 60_000 });
  expect(downloads).toHaveLength(1);
  expect(readZip(await downloadBytes(d))).toHaveLength(67);
});

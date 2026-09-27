import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readBackupFile } from "../../lib/export/backup";
import { readTransfer } from "../../lib/export/transfer";
import type { SavedPlay } from "../../lib/play/types";
import { Designer, downloadText } from "../support/designer";
import {
  GOAL_LINE_FADE, KEYS, OTTERS, RED_ZONE_FADE, SLANT_LEFT, formation, jsonUpload, playbook, seed, storedDraft, storedPlays,
} from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * Yards count from the offense's own goal line: the field is 40 yards goal line to goal
 * line, midfield is the 20, and a 10-yard end zone runs to the end line at the 50. Field
 * yard n sits at y = los - n, in yards from the line of scrimmage.
 */
const GOAL = 40, END_LINE = 50;
/** The deepest player in the default formation (the safety), whom the card must never cut off. */
const DEEPEST = Math.min(...formation().map((p) => p.y));
const DEFAULT_NOTE = "Saved with this play. Yards count from your own goal line: midfield is the 20, their goal line the 40.";
const NO_RUN_NOTE = "Saved with this play. The ball is in a no-run zone, so no runs from here.";
/** The spots the sweep visits; 18, 35 and 39 are inside a no-run zone. */
const SPOTS = [7, 12, 18, 20, 30, 35, 39] as const;
const IN_NO_RUN_ZONE = new Set([18, 35, 39]);

const losSelect = (page: Page): Locator => page.locator("#play-sidebar").getByRole("combobox", { name: "Line of scrimmage" });
const losNote = (page: Page): Locator => page.locator("#play-sidebar").getByText(/^Saved with this play\./);
const openSettings = (page: Page) => page.getByRole("button", { name: /team, theme & backup settings/ }).click();
/** Saved / Unsaved / Draft autosaved, under the play's name */
const status = (page: Page): Locator => page.locator("main span[aria-live='polite']").filter({ hasText: /^(Saved|Unsaved|Draft autosaved|Saving failed)$/ });

/** A field as it is drawn, read back in yards from the line of scrimmage (0.1-yard precision). */
interface Reading {
  viewBox: string;
  /** the card's top edge */
  top: number;
  lines: { y: number; w: number }[];
  /** yard numbers carry the line they label (`y`); every label carries its baseline (`base`) */
  labels: { t: string; y: number; base: number }[];
  bands: [number, number][];
  endZone: [number, number] | null;
  /** where each route's arrowhead points */
  tips: number[];
}

/** Reads the live field, a snapshot preview or a thumbnail (the svg itself or the element holding it). */
async function readField(target: Locator): Promise<Reading> {
  return target.evaluate((el) => {
    const svg = el instanceof SVGSVGElement ? el : el.querySelector("svg");
    if (!svg) throw new Error("no field here");
    const viewBox = svg.getAttribute("viewBox") ?? "";
    const top = 8 - Number(viewBox.split(" ")[3]) / 22;
    const yd = (v: number): number => Math.round((top + v / 22) * 10) / 10 + 0;
    const at = (e: Element, a: string): number => Number(e.getAttribute(a));
    const span = (r: Element): [number, number] => [yd(at(r, "y")), yd(at(r, "y") + at(r, "height"))];
    const ez = svg.querySelector('rect[fill="#a7e5a7"]');
    return {
      viewBox,
      top,
      lines: [...svg.querySelectorAll('line[x1="0"][x2="660"]')].map((l) => ({ y: yd(at(l, "y1")), w: at(l, "stroke-width") })),
      // a yard number sits 7 units above its line
      labels: [...svg.querySelectorAll('g[fill-opacity="0.5"] > text')].map((t) => ({ t: t.textContent ?? "", y: yd(at(t, "y") + 7), base: yd(at(t, "y")) })),
      bands: [...svg.querySelectorAll('rect[fill^="url(#"]')].map(span),
      endZone: ez ? span(ez) : null,
      tips: [...svg.querySelectorAll("polygon")].map((p) => yd(Number((p.getAttribute("points") ?? "").split(" ")[0]?.split(",")[1]))),
    };
  });
}

/**
 * The field layer's markup (end zone, bands, lines, numbers), to prove a spot changes nothing
 * else. Attributes are sorted and inline styles spelled one way, since a node the server drew
 * and one React drew again in the browser serialize their styles differently.
 */
async function fieldMarkup(field: Locator): Promise<string> {
  return field.evaluate((svg) => {
    const canon = (el: Element): string => {
      const attrs = [...el.attributes]
        .map((a) => `${a.name}="${a.name === "style" ? a.value.replace(/\s+/g, "").replace(/;$/, "") : a.value}"`)
        .sort()
        .join(" ");
      const inner = el.children.length ? [...el.children].map(canon).join("") : (el.textContent ?? "");
      return `<${el.tagName} ${attrs}>${inner}</${el.tagName}>`;
    };
    const g = svg.querySelector(":scope > g");
    return g ? canon(g) : "";
  });
}

/**
 * What a coach reads off the field with the ball on `los`: one line of scrimmage, a line
 * every 5 yards up to their goal line, the goal line and end line in heavier ink, the
 * no-run bands and end zone where the league puts them, routes that stay in bounds, and a
 * card that never runs past the end line unless a player already stands there.
 */
function expectField(m: Reading, los: number, { labels = true }: { labels?: boolean } = {}): void {
  const at = (n: number): number => los - n;
  const onCard = (y: number): boolean => y >= m.top - 0.01 && y <= 8;
  const clip = (a: number, b: number): [number, number] | null => {
    const lo = Math.max(a, m.top), hi = Math.min(b, 8);
    return hi - lo > 0.05 ? [lo, hi] : null;
  };
  expect(m.lines.filter((l) => l.w === 4.5).map((l) => l.y), "one line of scrimmage").toEqual([0]);
  expect(m.lines.filter((l) => l.w === 1.6).map((l) => l.y), "a plain line every 5 yards").toEqual(
    [0, 5, 10, 15, 20, 25, 30, 35].map(at).filter((y) => y !== 0 && onCard(y)),
  );
  expect(m.lines.filter((l) => l.w === 3).map((l) => l.y), "the goal line and end line").toEqual([GOAL, END_LINE].map(at).filter(onCard));
  expect(m.lines).toHaveLength(m.lines.filter((l) => [4.5, 3, 1.6].includes(l.w)).length);
  // the band before midfield only while the ball is short of it
  const bands = [los < 20 ? clip(at(20), at(15)) : null, clip(at(GOAL), at(GOAL - 5))].filter((b): b is [number, number] => b !== null);
  expect(m.bands, "no-run bands").toEqual(bands);
  const endZone = clip(at(END_LINE), at(GOAL));
  expect(m.endZone, "end zone").toEqual(endZone);
  const floor = Math.max(m.top, at(END_LINE));
  for (const tip of m.tips) expect(tip, "a route stays in bounds").toBeGreaterThanOrEqual(floor - 0.05);
  expect(m.top, "the card stops at the end line").toBeGreaterThanOrEqual(Math.min(at(END_LINE), DEEPEST - 1.2) - 0.01);
  if (!labels) {
    expect(m.labels).toEqual([]);
    return;
  }
  const numbers = [los, 10, 15, 20, 25, 30, 35, GOAL]
    .filter((n, i) => i === 0 || n > los)
    .map((n) => ({ t: n !== los ? String(n) : los === 5 ? "LOS" : `LOS ${String(los)}`, y: at(n) }))
    .filter((l) => onCard(l.y));
  expect(m.labels.filter((l) => /^(LOS|\d)/.test(l.t)).map(({ t, y }) => ({ t, y })), "yard numbers").toEqual(numbers);
  expect(m.labels.filter((l) => l.t.startsWith("LOS"))).toHaveLength(1);
  // a band is named in the part of it in front of the ball, never among the offense behind it
  const named = m.labels.filter((l) => l.t === "NO-RUN");
  expect(named).toHaveLength(bands.filter(([a, b]) => (Math.min(b, 0) - a) * 22 > 46).length);
  for (const l of named) expect(l.base, "NO-RUN in front of the ball").toBeLessThan(0);
  expect(m.labels.some((l) => l.t === "END ZONE")).toBe(endZone !== null && (endZone[1] - endZone[0]) * 22 > 30);
}

/** The play a /p/ link carries, as the app wrote it. */
function linkPayload(url: string): Record<string, unknown> {
  const id = new URL(url).pathname.split("/").pop() ?? "";
  return JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as Record<string, unknown>;
}

/** Leaves a JSON record in test-results/ and on the report, with no timestamps, so a rerun reproduces it. */
async function keep(testInfo: TestInfo, name: string, data: unknown): Promise<void> {
  const file = `test-results/${name}-${testInfo.project.name}.json`;
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  await testInfo.attach(name, { path: file, contentType: "application/json" });
}

test("a coach puts the ball on their 10 for a red-zone play, and only that play moves", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await seed(page, { plays: [RED_ZONE_FADE, SLANT_LEFT], team: OTTERS });
  const d = new Designer(page);
  await d.goto(`?open=${RED_ZONE_FADE.id}`);
  await expect(page.getByRole("heading", { name: RED_ZONE_FADE.name })).toBeVisible();
  await d.closeSidebars();
  // every play starts where every drive does: the 5, drawn exactly as the field always was
  const markup5 = await fieldMarkup(d.field);
  const at5 = await readField(d.field);
  expectField(at5, 5);
  await d.field.screenshot({ path: `test-results/line-of-scrimmage-${project}-5.png` });

  await d.tools();
  const spot = losSelect(page);
  await expect(spot).toHaveValue("5");
  await expect(spot.locator("option")).toHaveCount(35);
  await expect(spot.locator('option[value="5"]')).toHaveText("The 5 · drive start");
  await expect(spot.locator('option[value="12"]')).toHaveText("The 12");
  await expect(spot.locator('option[value="20"]')).toHaveText("The 20 · midfield");
  await expect(spot.locator('option[value="30"]')).toHaveText("The 30 · their 10");
  await expect(spot.locator('option[value="39"]')).toHaveText("The 39 · their 1");
  await expect(losNote(page)).toHaveText(DEFAULT_NOTE);
  await expect(await d.tool("Save")).toHaveAttribute("title", "Save this play");

  const sweep: Record<string, unknown>[] = [{ los: 5, option: "The 5 · drive start", note: DEFAULT_NOTE, ...at5 }];
  for (const los of SPOTS) {
    await d.tools();
    await spot.selectOption(String(los));
    await expect(spot).toHaveValue(String(los));
    const note = IN_NO_RUN_ZONE.has(los) ? NO_RUN_NOTE : DEFAULT_NOTE;
    await expect(losNote(page)).toHaveText(note);
    const option = await spot.locator(`option[value="${String(los)}"]`).textContent();
    await d.closeSidebars();
    await expect(async () => { expectField(await readField(d.field), los); }).toPass();
    const m = await readField(d.field);
    if (los === 12) expect(m.labels.slice(0, 4).map((l) => l.t)).toEqual(["LOS 12", "15", "20", "25"]);
    // past midfield the band before it lies behind the play, so it is left off
    if (los === 20) for (const [, bottom] of m.bands) expect(bottom).toBeLessThanOrEqual(0);
    if (los === 35) {
      // their 5: the goal line 5 yards off, the whole end zone and nothing past the end line, on every screen
      expect(m.viewBox).toBe("0 0 660 506");
      expect(m.bands).toEqual([[-5, 0]]);
      expect(m.endZone).toEqual([-15, -5]);
    }
    // their 1: the safety stands on the end line, so the card keeps a yard past it rather than cut him off
    if (los === 39) expect(m.viewBox).toBe("0 0 660 440");
    await d.field.screenshot({ path: `test-results/line-of-scrimmage-${project}-${String(los)}.png` });
    sweep.push({ los, option, note, ...m });
  }

  // back on the 5, the field is the same markup it started as, and the draft carries no spot
  await d.tools();
  await spot.selectOption("5");
  await d.closeSidebars();
  await expect.poll(() => fieldMarkup(d.field)).toBe(markup5);
  await expect.poll(async () => { const dr = await storedDraft(page); return dr !== null && !("los" in dr); }).toBe(true);
  await expect(status(page)).toHaveText("Saved");

  // their 10: it marks the play changed and autosaves; undo leaves the spot where it is
  await d.tools();
  await spot.selectOption("30");
  await expect(status(page)).toHaveText("Draft autosaved");
  await expect(await d.tool("Save")).toHaveAttribute("title", "Save changes to this play");
  await expect.poll(async () => (await storedDraft(page))?.los).toBe(30);
  await d.clickTool("Clear routes");
  await expect(d.routes).toHaveCount(0);
  await d.undo.click();
  await expect(d.routes).toHaveCount(2);
  await d.tools();
  await expect(spot).toHaveValue("30");

  // saved with the play, last, and only because it is off the 5
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  const saved = (await storedPlays(page))[RED_ZONE_FADE.id];
  expect(saved).toEqual({ ...RED_ZONE_FADE, los: 30 });
  expect(Object.keys(saved ?? {}).at(-1)).toBe("los");

  // a reload and a reopen put the ball back where the coach left it
  await page.reload();
  await expect(d.field).toBeVisible();
  await d.tools();
  await expect(losSelect(page)).toHaveValue("30");
  await d.closeSidebars();
  await expect(async () => { expectField(await readField(d.field), 30); }).toPass();
  await d.openSaved(RED_ZONE_FADE.name);
  await d.tools();
  await expect(losSelect(page)).toHaveValue("30");

  // a duplicate keeps it
  await d.clickTool("Duplicate");
  await expect(d.toast).toHaveText("Saved a copy");
  const copy = Object.values(await storedPlays(page)).find((p) => p.name === `${RED_ZONE_FADE.name} copy`);
  expect(copy?.los).toBe(30);

  // every other play stays on the 5, drawn exactly as before
  await d.openSaved(SLANT_LEFT.name);
  await d.tools();
  await expect(losSelect(page)).toHaveValue("5");
  await d.closeSidebars();
  await expect(async () => { expectField(await readField(d.field), 5); }).toPass();
  await expect.poll(() => fieldMarkup(d.field)).toBe(markup5);

  // and so does a new one
  await d.newPlay("Offense");
  await expect(losSelect(page)).toHaveValue("5");
  await expect(d.field.locator("text", { hasText: /^LOS$/ })).toHaveCount(1);
  await expect.poll(async () => (await storedDraft(page))?.name).toBe("New play");
  expect(await storedDraft(page)).not.toHaveProperty("los");

  await keep(testInfo, "line-of-scrimmage", {
    project,
    markupAtThe5: createHash("sha256").update(markup5).digest("hex"),
    sweep,
    saved: { keys: Object.keys(saved ?? {}), los: saved?.los ?? null },
    duplicate: { los: copy?.los ?? null },
  });
});

test("the spot travels in the share link, and links from before it still open on the 5", async ({ page }, testInfo) => {
  await seed(page, { plays: [GOAL_LINE_FADE, SLANT_LEFT], team: OTTERS });
  const d = new Designer(page);
  await d.goto(`?open=${GOAL_LINE_FADE.id}`);
  await d.tools();
  await expect(losSelect(page)).toHaveValue("35");
  await expect(losNote(page)).toHaveText(NO_RUN_NOTE);
  // the picker as a coach finds it in Play tools, with the no-run warning under it
  await losSelect(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/line-of-scrimmage-${testInfo.project.name}-tools-35.png` });

  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  const preview = dialog.getByRole("img", { name: "Offense snapshot preview" });
  await expect(preview).toBeVisible();
  const snapshot = await readField(preview);
  expectField(snapshot, 35);
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  const payload = linkPayload(url);
  expect(Object.keys(payload)).toEqual(["name", "players", "los"]);
  expect(payload.los).toBe(35);

  // another device, without the team, sees the same field
  await page.evaluate((key) => { localStorage.removeItem(key); }, KEYS.team);
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared).toBeVisible();
  await expect(async () => { expectField(await readField(shared), 35); }).toPass();
  await expect(shared.locator("text", { hasText: "LOS 35" })).toHaveCount(1);
  const sharedReading = await readField(shared);
  await shared.screenshot({ path: `test-results/line-of-scrimmage-${testInfo.project.name}-shared-35.png` });
  await page.getByRole("link", { name: "Open in designer ›" }).click();
  await expect(d.field).toBeVisible();
  await d.tools();
  await expect(losSelect(page)).toHaveValue("35");

  // a play on the 5 writes the link exactly as before
  await d.openSaved(SLANT_LEFT.name);
  await d.clickTool("Copy share link");
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const plainKeys = Object.keys(linkPayload(await page.evaluate(() => navigator.clipboard.readText())));
  expect(plainKeys).toEqual(["name", "players"]);

  // links made before plays had a spot, or hand-edited ones, open on a real yard line
  const players = formation({ o3: { type: "go" } });
  const legacy: { extra: Record<string, unknown>; los: number }[] = [
    { extra: {}, los: 5 },
    { extra: { los: "30" }, los: 5 },
    { extra: { los: 99 }, los: 39 },
    { extra: { los: 12.4 }, los: 12 },
  ];
  for (const l of legacy) {
    const id = Buffer.from(JSON.stringify({ name: "Otter Old Link", players, ...l.extra })).toString("base64url");
    await page.goto(`/p/${id}`);
    const field = page.getByRole("img", { name: "Play diagram" });
    await expect(field).toBeVisible();
    await expect(async () => { expectField(await readField(field), l.los); }).toPass();
  }

  await keep(testInfo, "line-of-scrimmage-links", {
    project: testInfo.project.name,
    snapshotPreview: snapshot,
    link: { keys: Object.keys(payload), los: payload.los },
    sharedPage: sharedReading,
    linkOnThe5: { keys: plainKeys },
    legacy: legacy.map((l) => ({ payload: l.extra, opensOn: l.los })),
  });
});

test("playbooks, files, short links and backups keep each play's spot", async ({ page, browser }, testInfo) => {
  const book = playbook("fx-los", "Otter Goal Line Book", [GOAL_LINE_FADE, SLANT_LEFT]);
  await seed(page, { plays: [GOAL_LINE_FADE, SLANT_LEFT], playbooks: [book], team: OTTERS });

  // the printout preview draws the book's first play from their 5
  await page.goto(`/playbooks?book=${book.id}`);
  const preview = page.getByRole("img", { name: "Playbook PDF preview" });
  await expect(preview).toBeVisible();
  const pdf = await readField(preview);
  expectField(pdf, 35);
  expect(pdf.viewBox).toBe("0 0 660 506");
  await preview.screenshot({ path: `test-results/line-of-scrimmage-${testInfo.project.name}-pdf-preview.png` });

  // the playbook file carries the spot only where there is one, and reads back untouched
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download playbook file" }).click()]);
  const text = await downloadText(download);
  const read = readTransfer(text);
  expect(read.ok && !read.normalized).toBe(true);
  const filePlays = (JSON.parse(text) as { plays: SavedPlay[] }).plays;
  expect(filePlays.find((p) => p.id === GOAL_LINE_FADE.id)?.los).toBe(35);
  expect(filePlays.find((p) => p.id === SLANT_LEFT.id)).not.toHaveProperty("los");

  // gallery thumbnails: each play on its own spot
  await page.goto("/playbooks");
  const goalThumb = page.getByRole("img", { name: GOAL_LINE_FADE.name }).first();
  await expect(goalThumb).toBeVisible();
  const goalArt = await readField(goalThumb);
  expectField(goalArt, 35, { labels: false });
  expect(goalArt.viewBox).toBe("0 0 660 506");
  const slantArt = await readField(page.getByRole("img", { name: SLANT_LEFT.name }).first());
  expectField(slantArt, 5, { labels: false });
  expect(slantArt.viewBox).toBe("0 0 660 528");

  // a short link uploads the play with its spot, in the canonical form the server accepts
  const upload: { body: string | null } = { body: null };
  await page.route("**/api/shares", async (route) => {
    upload.body = route.request().postData();
    await route.fulfill({ status: 201, json: { token: "abcdefghijklmnop", revokeKey: "x".repeat(32), expiresAt: "2099-01-01T00:00:00Z" } });
  });
  const card = page.getByRole("link", { name: `Open ${GOAL_LINE_FADE.name} in the designer` }).locator("xpath=..");
  await card.getByRole("button", { name: "Share", exact: true }).click();
  await expect.poll(() => upload.body).not.toBeNull();
  const shortLink = readTransfer(upload.body ?? "");
  expect(shortLink.ok && !shortLink.normalized).toBe(true);
  expect(shortLink.ok && shortLink.file.kind === "ffpd.play" ? shortLink.file.play.los : null).toBe(35);

  // the device backup keeps it
  await page.goto("/playbooks");
  await openSettings(page);
  const [backupDownload] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
  const backup = await downloadText(backupDownload);
  const backupRead = readBackupFile(backup);
  expect(backupRead.ok).toBe(true);
  expect(backupRead.ok ? backupRead.file.plays.find((p) => p.id === GOAL_LINE_FADE.id)?.los : null).toBe(35);

  // another coach holds the same play on the 5: the file brings the goal-line version in as a copy
  const onThe5: SavedPlay = { id: GOAL_LINE_FADE.id, name: GOAL_LINE_FADE.name, notes: GOAL_LINE_FADE.notes, side: GOAL_LINE_FADE.side, players: GOAL_LINE_FADE.players };
  const other = await browser.newContext();
  try {
    const page2 = await other.newPage();
    await seed(page2, { plays: [onThe5] });
    await page2.goto("/playbooks");
    await page2.getByLabel("Import a playbook file").setInputFiles(jsonUpload("otter-goal-line-book.playbook.json", text));
    await expect(page2.getByRole("button", { name: "Import playbook", exact: true })).toBeVisible();
    await expect(page2.getByText(/repaired or removed/)).toHaveCount(0);
    await page2.getByRole("button", { name: "Import playbook", exact: true }).click();
    await expect.poll(async () => Object.keys(await storedPlays(page2)).length).toBe(3);
    const lib = await storedPlays(page2);
    expect(lib[GOAL_LINE_FADE.id]).toEqual(onThe5);
    expect(Object.values(lib).filter((p) => p.name === GOAL_LINE_FADE.name).map((p) => p.los ?? 5).sort((a, b) => a - b)).toEqual([5, 35]);

    // restoring the backup over it puts the book's play back on their 5
    await page2.goto("/playbooks");
    await openSettings(page2);
    await page2.getByLabel("Restore a device backup").setInputFiles(jsonUpload("device-backup.json", backup));
    await page2.getByRole("region", { name: "Restore preview" }).getByRole("button", { name: "Replace device data" }).click();
    await expect.poll(async () => (await storedPlays(page2))[GOAL_LINE_FADE.id]?.los).toBe(35);

    await keep(testInfo, "line-of-scrimmage-files", {
      project: testInfo.project.name,
      pdfPreview: pdf,
      thumbnails: { goalLine: goalArt, onThe5: slantArt },
      playbookFile: filePlays.map((p) => ({ id: p.id, keys: Object.keys(p), los: p.los ?? null })),
      shortLink: { normalized: shortLink.ok ? shortLink.normalized : null, los: 35 },
      importedBeside: Object.values(lib).map((p) => ({ id: p.id === GOAL_LINE_FADE.id ? p.id : "(copy)", name: p.name, los: p.los ?? null })),
    });
  } finally {
    await other.close();
  }
});

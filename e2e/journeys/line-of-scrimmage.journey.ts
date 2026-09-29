import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { readBackupFile } from "../../lib/export/backup";
import { readTransfer } from "../../lib/export/transfer";
import type { SavedPlay } from "../../lib/play/types";
import { Designer, downloadText } from "../support/designer";
import {
  GOAL_LINE_FADE, KEYS, OTTERS, RED_ZONE_FADE, SLANT_LEFT, formation, jsonUpload, play, playbook, seed, storedDraft, storedPlays,
} from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * A spot is stored in yards from the offense's own goal line: the field is 40 yards goal line
 * to goal line, midfield is the 20, and a 10-yard end zone runs to the end line at the 50.
 * Field yard n sits at y = los - n, in yards from the line of scrimmage. The coach reads the
 * other way, in yards to go: the own goal line is "the 40", their 10 (the 30) "the 10".
 */
const GOAL = 40, END_LINE = 50;
/** What the field and picker call yard n: the yards left to their goal line. */
const toGo = (n: number): number => GOAL - n;
/** The deepest player in the default formation (the safety), whom the card must never cut off. */
const DEEPEST = Math.min(...formation().map((p) => p.y));
const DEFAULT_NOTE = "Saved with this play. Yards count down to their goal line: every drive starts on the 40, midfield is the 20.";
const NO_RUN_NOTE = "Saved with this play. The ball is in a no-run zone, so no runs from here.";
/** The only spots a coach can pick, as stored: from the 40 (the own goal line), the 20, the 10 and the 5. */
const CHOICES = [
  { los: 0, option: "From the 40 · drive start" },
  { los: 20, option: "From the 20 · midfield" },
  { los: 30, option: "From the 10" },
  { los: 35, option: "From the 5" },
] as const;
/** The spots the sweep visits after the drive start; only their 5 is inside a no-run zone. */
const SPOTS = [20, 30, 35] as const;
const IN_NO_RUN_ZONE = new Set([35]);

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
  const numbers = [los, 5, 10, 15, 20, 25, 30, 35, GOAL]
    .filter((n, i) => i === 0 || n > los)
    .map((n) => ({ t: n === los ? (los === 0 ? "LOS" : `LOS ${String(toGo(los))}`) : n === GOAL ? "G" : String(toGo(n)), y: at(n) }))
    .filter((l) => onCard(l.y));
  expect(m.labels.filter((l) => /^(LOS|G$|\d)/.test(l.t)).map(({ t, y }) => ({ t, y })), "yard numbers").toEqual(numbers);
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

test("a coach puts the ball on the 10 for a red-zone play, and only that play moves", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await seed(page, { plays: [RED_ZONE_FADE, SLANT_LEFT], team: OTTERS });
  const d = new Designer(page);
  await d.goto(`?open=${RED_ZONE_FADE.id}`);
  await expect(page.getByRole("heading", { name: RED_ZONE_FADE.name })).toBeVisible();
  await d.closeSidebars();
  // every play starts where every drive does: the own goal line, which a coach calls the 40
  const markup0 = await fieldMarkup(d.field);
  const at0 = await readField(d.field);
  expectField(at0, 0);
  await d.field.screenshot({ path: `test-results/line-of-scrimmage-${project}-40.png` });

  await d.tools();
  const spot = losSelect(page);
  await expect(spot).toHaveValue("0");
  // four spots and no more, counted down into their end zone
  await expect(spot.locator("option")).toHaveText(CHOICES.map((c) => c.option));
  expect(await spot.locator("option").evaluateAll((os) => os.map((o) => Number((o as HTMLOptionElement).value)))).toEqual(CHOICES.map((c) => c.los));
  await expect(losNote(page)).toHaveText(DEFAULT_NOTE);
  await expect(await d.tool("Save")).toHaveAttribute("title", "Save this play");

  const sweep: Record<string, unknown>[] = [{ los: 0, option: CHOICES[0].option, note: DEFAULT_NOTE, ...at0 }];
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
    // the card shows as much field as it did from the 40, up to the end line
    expect(m.top, "the card ends at the end line, or where it did from the 40").toBe(Math.max(los - END_LINE, at0.top));
    if (los === 20) {
      expect(m.labels.slice(0, 4).map((l) => l.t)).toEqual(["LOS 20", "15", "10", "5"]);
      // past midfield the band before it lies behind the play, so it is left off
      for (const [, bottom] of m.bands) expect(bottom).toBeLessThanOrEqual(0);
    }
    if (los === 35) {
      // the 5: the goal line 5 yards off, the whole end zone and nothing past the end line, on every screen
      expect(m.viewBox).toBe("0 0 660 506");
      expect(m.bands).toEqual([[-5, 0]]);
      expect(m.endZone).toEqual([-15, -5]);
      expect(m.labels.slice(0, 2).map((l) => l.t)).toEqual(["LOS 5", "G"]);
    }
    await d.field.screenshot({ path: `test-results/line-of-scrimmage-${project}-${String(toGo(los))}.png` });
    sweep.push({ los, option, note, ...m });
  }

  // back on the 40, the field is the same markup it started as, and the draft carries no spot
  await d.tools();
  await spot.selectOption("0");
  await d.closeSidebars();
  await expect.poll(() => fieldMarkup(d.field)).toBe(markup0);
  await expect.poll(async () => { const dr = await storedDraft(page); return dr !== null && !("los" in dr); }).toBe(true);
  await expect(status(page)).toHaveText("Saved");
  // four spot changes, and nothing to undo: the spot is the play's, like its name
  await expect(d.undo).toBeDisabled();

  // the 10: it marks the play changed and autosaves; undo leaves the spot where it is
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

  // saved with the play, last, and only because it is off the own goal line
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

  // a new play, started from the copy on the 10, goes back to the 40
  await expect(losSelect(page)).toHaveValue("30");
  await d.newPlay("Offense");
  await expect(losSelect(page)).toHaveValue("0");
  await expect(d.field.locator("text", { hasText: /^LOS$/ })).toHaveCount(1);
  await expect.poll(async () => (await storedDraft(page))?.name).toBe("New play");
  expect(await storedDraft(page)).not.toHaveProperty("los");

  // every other play stays on the 40, drawn exactly as before
  await d.openSaved(SLANT_LEFT.name);
  await d.tools();
  await expect(losSelect(page)).toHaveValue("0");
  await d.closeSidebars();
  await expect(async () => { expectField(await readField(d.field), 0); }).toPass();
  await expect.poll(() => fieldMarkup(d.field)).toBe(markup0);

  await keep(testInfo, "line-of-scrimmage", {
    project,
    choices: CHOICES,
    markupAtThe40: createHash("sha256").update(markup0).digest("hex"),
    sweep,
    saved: { keys: Object.keys(saved ?? {}), los: saved?.los ?? null },
    duplicate: { los: copy?.los ?? null },
  });
});

test("the spot travels in the share link, and links without one open on the 40", async ({ page }, testInfo) => {
  await seed(page, { plays: [GOAL_LINE_FADE, SLANT_LEFT], team: OTTERS });
  const d = new Designer(page);
  await d.goto(`?open=${GOAL_LINE_FADE.id}`);
  await d.tools();
  await expect(losSelect(page)).toHaveValue("35");
  await expect(losNote(page)).toHaveText(NO_RUN_NOTE);
  // the picker as a coach finds it in Play tools, with the no-run warning under it
  await losSelect(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/line-of-scrimmage-${testInfo.project.name}-tools-5.png` });

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
  await expect(shared.locator("text", { hasText: "LOS 5" })).toHaveCount(1);
  const sharedReading = await readField(shared);
  await shared.screenshot({ path: `test-results/line-of-scrimmage-${testInfo.project.name}-shared-5.png` });
  await page.getByRole("link", { name: "Open in designer ›" }).click();
  await expect(d.field).toBeVisible();
  await d.tools();
  await expect(losSelect(page)).toHaveValue("35");

  // a play on the 40 writes the link without a spot
  await d.openSaved(SLANT_LEFT.name);
  await d.clickTool("Copy share link");
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const plainKeys = Object.keys(linkPayload(await page.evaluate(() => navigator.clipboard.readText())));
  // (its coaching notes travel with it, #108)
  expect(plainKeys).toEqual(["name", "players", "notes"]);

  // links without a spot, spotted before the choices were cut to four, or hand-edited, open on one of the four
  const players = formation({ o3: { type: "go" } });
  const legacy: { extra: Record<string, unknown>; los: number }[] = [
    { extra: {}, los: 0 },
    { extra: { los: "30" }, los: 0 },
    { extra: { los: 7 }, los: 0 },
    { extra: { los: 12.4 }, los: 20 },
    { extra: { los: 25 }, los: 30 },
    { extra: { los: 33 }, los: 35 },
    { extra: { los: 99 }, los: 35 },
    { extra: { los: -4 }, los: 0 },
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
    linkOnThe40: { keys: plainKeys },
    legacy: legacy.map((l) => ({ payload: l.extra, opensOn: l.los })),
  });
});

test("playbooks, files, short links and backups keep each play's spot", async ({ page, browser }, testInfo) => {
  const book = playbook("fx-los", "Otter Goal Line Book", [GOAL_LINE_FADE, SLANT_LEFT]);
  await seed(page, { plays: [GOAL_LINE_FADE, SLANT_LEFT], playbooks: [book], team: OTTERS });

  // the printout preview draws the book's first play from the 5
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
  expectField(slantArt, 0, { labels: false });
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

  // another coach holds the same play on the 40: the file brings the goal-line version in as a copy
  const onThe40: SavedPlay = { id: GOAL_LINE_FADE.id, name: GOAL_LINE_FADE.name, notes: GOAL_LINE_FADE.notes, side: GOAL_LINE_FADE.side, players: GOAL_LINE_FADE.players };
  const other = await browser.newContext();
  try {
    const page2 = await other.newPage();
    await seed(page2, { plays: [onThe40] });
    await page2.goto("/playbooks");
    await page2.getByLabel("Import a playbook file").setInputFiles(jsonUpload("otter-goal-line-book.playbook.json", text));
    await expect(page2.getByRole("button", { name: "Import playbook", exact: true })).toBeVisible();
    await expect(page2.getByText(/repaired or removed/)).toHaveCount(0);
    await page2.getByRole("button", { name: "Import playbook", exact: true }).click();
    await expect.poll(async () => Object.keys(await storedPlays(page2)).length).toBe(3);
    const lib = await storedPlays(page2);
    expect(lib[GOAL_LINE_FADE.id]).toEqual(onThe40);
    expect(Object.values(lib).filter((p) => p.name === GOAL_LINE_FADE.name).map((p) => p.los ?? 0).sort((a, b) => a - b)).toEqual([0, 35]);

    // restoring the backup over it puts the book's play back on the 5
    await page2.goto("/playbooks");
    await openSettings(page2);
    await page2.getByLabel("Restore a device backup").setInputFiles(jsonUpload("device-backup.json", backup));
    await page2.getByRole("region", { name: "Restore preview" }).getByRole("button", { name: "Replace device data" }).click();
    await expect.poll(async () => (await storedPlays(page2))[GOAL_LINE_FADE.id]?.los).toBe(35);

    await keep(testInfo, "line-of-scrimmage-files", {
      project: testInfo.project.name,
      pdfPreview: pdf,
      thumbnails: { goalLine: goalArt, onThe40: slantArt },
      playbookFile: filePlays.map((p) => ({ id: p.id, keys: Object.keys(p), los: p.los ?? null })),
      shortLink: { normalized: shortLink.ok ? shortLink.normalized : null, los: 35 },
      importedBeside: Object.values(lib).map((p) => ({ id: p.id === GOAL_LINE_FADE.id || p.id === SLANT_LEFT.id ? p.id : "(copy)", name: p.name, los: p.los ?? null })),
    });
  } finally {
    await other.close();
  }
});

test("near their goal, ▶ keeps every player on the field, a man defender included", async ({ page }, testInfo) => {
  // a defensive call from the 5, so both teams are drawn: a Go with man coverage on it, and a corner
  const call: SavedPlay = {
    ...play("fx-goal-line-man", "Otter Goal Line Man", {
      o3: { type: "go" }, o4: { type: "corner" }, d1: { type: "man", target: "o3" }, d4: { type: "man", target: "o4" },
    }, "", "defense"),
    los: 35,
  };
  await seed(page, { plays: [call] });
  const d = new Designer(page);
  await d.goto(`?open=${call.id}`);
  await expect(page.getByRole("heading", { name: call.name })).toBeVisible();
  await d.closeSidebars();
  await expect(d.field.getByRole("button", { name: "Defense d1", exact: true })).toBeVisible();
  const before = await readField(d.field);
  expectField(before, 35);

  // every frame of the run: the highest any player's centre gets, in SVG units from the card's top
  const run = d.field.evaluate((svg) => new Promise<{ highest: number; frames: number }>((resolve) => {
    let highest = Infinity, frames = 0, started = false;
    const t0 = performance.now();
    const tick = (): void => {
      const stop = document.querySelector('[aria-label="Stop the play"]');
      if (stop) started = true;
      for (const g of svg.querySelectorAll('g[aria-label^="Offense "], g[aria-label^="Defense "]')) {
        const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute("transform") ?? "");
        if (m) highest = Math.min(highest, Number(m[2]));
      }
      if (started) frames++;
      if ((started && !stop) || performance.now() - t0 > 20_000) resolve({ highest, frames });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  await page.getByRole("button", { name: "Run the play" }).click();
  const { highest, frames } = await run;
  expect(frames, "the play ran").toBeGreaterThan(10);
  // a token's radius is 23: every player stays whole on the card, short of the end line
  expect(highest).toBeGreaterThanOrEqual(23);
  await expect(page.getByRole("button", { name: "Run the play" })).toBeVisible();
  await keep(testInfo, "line-of-scrimmage-playback", { project: testInfo.project.name, los: 35, viewBox: before.viewBox, highestTokenCentre: highest });
});

import { writeFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import { binderPages } from "../../lib/export/binder";
import { slidePlans } from "../../lib/export/slides";
import { S } from "../../lib/play/geometry";
import { INK } from "../../lib/play/routes";
import { PLAYS_KEY } from "../../lib/play/storage";
import type { Route, SavedPlay } from "../../lib/play/types";
import { Designer } from "../support/designer";
import { OTTERS } from "../support/fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * A deep zone can be called as a deep half or a deep third (lib/play/deep.ts, lib/play/zones.ts D1–D6),
 * beside Auto, where the deep zones split the field among themselves by count as they always have. The
 * palette's DEEP pills say which is called and what it does; the bubble on the field owns the half or
 * third nearest its defender, and the Auto zones share what is left; Flip moves a half to the other side
 * with its defender; undo and redo carry the call; the saved play stores `split` only when called; the
 * binder page and the slide's alt text name each zone "Deep half", "Deep third" or "Zone deep"; and the
 * share snapshot and share page draw the same shell. Leaves `deep-zones-<device>.json` (each step's pills, caption, every deep bubble in yards,
 * the stored routes and the printouts' words), the binder page as SVG and pictures of the palette, the field,
 * the binder page, the snapshot and the share page in
 * `test-results/`.
 */

const PLAY = "Otter Quarter Quarter Half";

/** A deep bubble as drawn, in yards: its centre across the field and its half-width. */
interface Bubble { cx: number; rx: number }

interface Step {
  step: string;
  pills?: { auto: boolean; half: boolean; third: boolean };
  caption?: string;
  bubbles: Bubble[];
  stored?: Record<string, Route | null>;
  labels?: string[];
}

const round = (v: number): number => Math.round(v * 100) / 100;

/** Every deep-zone bubble in a picture, left to right, in yards (S units a yard on the field and in every picture). */
async function bubbles(svg: Locator): Promise<Bubble[]> {
  const raw = await svg.locator(`ellipse[stroke="${INK.deep}"]`).evaluateAll((els) =>
    els.map((el) => ({ cx: Number(el.getAttribute("cx")), rx: Number(el.getAttribute("rx")) })));
  return raw.map((b) => ({ cx: round(b.cx / S), rx: round(b.rx / S) })).sort((a, b) => a.cx - b.cx || a.rx - b.rx);
}

test("a deep zone is called Auto, as a deep half or as a deep third, on the field, in the saved play and in the share link", async ({ page }, testInfo) => {
  const d = new Designer(page);
  const steps: Step[] = [];
  const device = testInfo.project.name;
  const group = page.locator("#route-sidebar").getByRole("group", { name: "Deep zone" });
  const pill = (name: "Auto" | "Half" | "Third") => group.getByRole("button", { name, exact: true });
  const caption = group.locator("span").last();

  /** The DEEP pills as they read, with the palette open. */
  async function pills(): Promise<NonNullable<Step["pills"]>> {
    await d.palette();
    await expect(group).toBeVisible();
    const pressed = async (l: Locator) => (await l.getAttribute("aria-pressed")) === "true";
    return { auto: await pressed(pill("Auto")), half: await pressed(pill("Half")), third: await pressed(pill("Third")) };
  }

  /** The field draws exactly these deep bubbles, left to right (yards, to the hundredth). */
  async function shell(svg: Locator, want: Bubble[], step: string, extra: Partial<Step> = {}): Promise<void> {
    let got: Bubble[] = [];
    await expect(async () => {
      got = await bubbles(svg);
      expect(got).toEqual(want.map((b) => ({ cx: round(b.cx), rx: round(b.rx) })));
    }).toPass();
    steps.push({ step, bubbles: got, ...extra });
  }

  /** Calls the selected deep zone, and reads the pills and caption back. */
  async function call(label: string, split: "Auto" | "Half" | "Third"): Promise<Partial<Step>> {
    await d.select(label, "Defense");
    await d.palette();
    await pill(split).click();
    const read = await pills();
    expect(read).toEqual({ auto: split === "Auto", half: split === "Half", third: split === "Third" });
    return { pills: read, caption: (await caption.textContent()) ?? "" };
  }

  const stored = async (): Promise<Record<string, Route | null>> =>
    page.evaluate(([key, name]) => {
      const lib = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, SavedPlay>;
      const play = Object.values(lib).find((p) => p.name === name);
      return Object.fromEntries((play?.players ?? []).filter((p) => p.team === "defense").map((p) => [p.label, p.route]));
    }, [PLAYS_KEY, PLAY] as const);

  await d.goto();
  await d.newPlay("Defense");

  // D1: a deep zone starts Auto, and Auto draws the shell by count, as every deep zone always has
  await d.select("S", "Defense");
  await d.pick("Zone deep");
  let read = await pills();
  expect(read).toEqual({ auto: true, half: false, third: false });
  await expect(caption).toHaveText(/one owns it all, two take halves, three take thirds/);
  await shell(d.field, [{ cx: 15, rx: 7.4 }], "S Zone deep, Auto: cover 1, the whole field", { pills: read, caption: (await caption.textContent()) ?? "" });
  for (const label of ["LC", "RC"]) {
    await d.select(label, "Defense");
    await d.pick("Zone deep");
  }
  await shell(d.field, [{ cx: 5, rx: 4.65 }, { cx: 15, rx: 4.65 }, { cx: 25, rx: 4.65 }], "LC and RC Zone deep too, all Auto: cover 3, thirds by count");

  // D2 + D5: RC called as a deep half owns the right half; LC and S, still Auto, split the half it leaves (cover 6)
  let said = await call("RC", "Half");
  await expect(caption).toHaveText("Owns the deep half of the field on this side, however many others play deep.");
  await shell(d.field, [{ cx: 3.75, rx: 3.4 }, { cx: 11.25, rx: 3.4 }, { cx: 22.5, rx: 7.15 }], "RC Half: RC owns the right half, LC and S quarter the left", said);
  await page.locator("#route-sidebar").screenshot({ path: `test-results/deep-zones-${device}-palette.png` });
  await d.closeSidebars();
  await d.field.screenshot({ path: `test-results/deep-zones-${device}-cover-6.png` });

  // D2: nothing is stored as a side, so Flip takes RC's half to the left with RC, and the quarters go right
  await d.clickTool("Flip play");
  await shell(d.field, [{ cx: 7.5, rx: 7.15 }, { cx: 18.75, rx: 3.4 }, { cx: 26.25, rx: 3.4 }], "Flip: RC's half follows RC to the left");
  await d.undo.click();
  await shell(d.field, [{ cx: 3.75, rx: 3.4 }, { cx: 11.25, rx: 3.4 }, { cx: 22.5, rx: 7.15 }], "Undo the flip: back on the right");

  // undo and redo carry the call
  await d.undo.click();
  await shell(d.field, [{ cx: 5, rx: 4.65 }, { cx: 15, rx: 4.65 }, { cx: 25, rx: 4.65 }], "Undo: RC Auto again, thirds by count");
  await d.select("RC", "Defense");
  read = await pills();
  expect(read).toEqual({ auto: true, half: false, third: false });
  await d.redo.click();
  await shell(d.field, [{ cx: 3.75, rx: 3.4 }, { cx: 11.25, rx: 3.4 }, { cx: 22.5, rx: 7.15 }], "Redo: RC Half again");

  // thirds called: each owns the third nearest them, S with the open middle between them (D5)
  said = await call("LC", "Third");
  await expect(caption).toHaveText("Owns the deep third of the field nearest them, however many others play deep.");
  await shell(d.field, [{ cx: 5, rx: 4.65 }, { cx: 12.5, rx: 2.15 }, { cx: 22.5, rx: 7.15 }], "LC Third: LC the left third, S the open stretch before RC's half", said);
  said = await call("RC", "Third");
  await shell(d.field, [{ cx: 5, rx: 4.65 }, { cx: 15, rx: 4.65 }, { cx: 25, rx: 4.65 }], "RC Third: called cover 3, S Auto in the middle third", said);

  // D3: a fourth deep defender called into a third that is taken takes the nearest free one, and never leaves the field
  await d.select("LB", "Defense");
  await d.pick("Zone deep");
  said = await call("LB", "Third");
  // LB's own third is the middle one, so S (Auto) finds nothing open and splits the whole field alone (D5)
  await shell(d.field, [{ cx: 5, rx: 4.65 }, { cx: 15, rx: 4.65 }, { cx: 15, rx: 7.4 }, { cx: 25, rx: 4.65 }], "LB Third: LB the middle third, S Auto with nothing open takes the whole field", said);
  // and taken off again: Zone deep picked again takes the route, call and all
  await d.pick("Zone deep");
  await shell(d.field, [{ cx: 5, rx: 4.65 }, { cx: 15, rx: 4.65 }, { cx: 25, rx: 4.65 }], "LB Zone deep again: the route comes off");

  // saved: a half or third stores its split, Auto stores nothing but the deep zone
  said = await call("RC", "Half");
  await d.setName(PLAY);
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  const routes = await stored();
  expect(routes.LC).toEqual({ type: "zoneDeep", split: "third" });
  expect(routes.RC).toEqual({ type: "zoneDeep", split: "half" });
  expect(routes.S).toEqual({ type: "zoneDeep" });
  expect(Object.keys(routes.S ?? {})).toEqual(["type"]);
  expect(routes.LB).toBeNull();
  const saved: Bubble[] = [{ cx: 5, rx: 4.65 }, { cx: 12.5, rx: 2.15 }, { cx: 22.5, rx: 7.15 }];
  await shell(d.field, saved, "saved: LC Third, S Auto, RC Half", { ...said, stored: routes });

  // the printouts say each zone as called: the binder page draws its name in its bubble, the slide's alt text gives every job
  const play = await page.evaluate(([key, name]) =>
    Object.values(JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, SavedPlay>).find((p) => p.name === name), [PLAYS_KEY, PLAY] as const);
  if (!play) throw new Error("the play was not saved");
  const book = [{ n: 1, play }];
  const binder = binderPages(book, { paper: "letter", bookName: "Otter Deep Book", team: OTTERS, layout: "one" })[0]?.svg ?? "";
  const printed = Array.from(binder.matchAll(/>(Deep half|Deep third|Zone deep)</g), (m) => m[1] ?? "").sort();
  expect(printed).toEqual(["Deep half", "Deep third", "Zone deep"]);
  const alt = slidePlans(book, { bookName: "Otter Deep Book", team: OTTERS }).slides.at(-1)?.alt.split("\n") ?? [];
  expect(alt).toContain("Left to right: LC: Deep third; LB: No assignment; S: Zone deep; R: No assignment; RC: Deep half.");
  steps.push({ step: "printouts: the binder page and the slide's alt text name each zone as called", bubbles: saved, labels: [...printed, ...alt] });
  writeFileSync(`test-results/deep-zones-${device}-binder.svg`, binder);
  await page.setContent(`<body style="margin:0">${binder}</body>`);
  await page.locator("svg").first().screenshot({ path: `test-results/deep-zones-${device}-binder.png` });

  // reopened: the same shell, and the palette says how RC is called
  await d.openSaved(PLAY);
  await shell(d.field, saved, "reopened");
  await d.select("RC", "Defense");
  expect(await pills()).toEqual({ auto: false, half: true, third: false });

  // the share snapshot names each zone as called, and the share page draws the same shell
  await d.clickTool("Copy share link");
  const dialog = page.getByRole("dialog", { name: "Share snapshot" });
  const preview = dialog.getByRole("img", { name: /^Defense snapshot preview/ });
  await expect(preview).toBeVisible();
  await shell(preview, saved, "share snapshot: the same shell");
  await preview.screenshot({ path: `test-results/deep-zones-${device}-snapshot.png` });
  await dialog.getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  expect(url).toMatch(/\/p\/[A-Za-z0-9_-]+$/);
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" });
  await expect(shared.getByRole("img", { name: /^Defense / })).toHaveCount(5);
  await shell(shared, saved, "share page: the same shell from the link");
  await shared.screenshot({ path: `test-results/deep-zones-${device}-shared.png` });

  writeFileSync(`test-results/deep-zones-${device}.json`, `${JSON.stringify({ play: PLAY, steps }, null, 2)}\n`);
});

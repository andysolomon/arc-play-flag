import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { encodeShare } from "../../lib/play/share";
import { Designer, armSabotage, sabotage } from "../support/designer";
import { SLANT_LEFT, storedPlays } from "../support/fixtures";

/**
 * Save is in the header, where the side badge used to be: a coach drawing on a phone saves without
 * opening Play tools. The header says when there is something to save (a yellow dot on the key),
 * ⌘S / Ctrl+S does the same as the key (in the play name too), a save that does not land opens Play
 * tools on its warning, and roster mode, which has no play to save, keeps its side switch there.
 *
 * Leaves `header-save-<device>-{save,refused,roster,never-saved,keys}.json` (each step: the field's status, the dot, the
 * key's title, whether Play tools was open and what was stored) and pictures of the header before and
 * after a save and of a refused save's warning in `test-results/`, uploaded as `header-save`.
 */

const out = (device: string, name: string): string => `test-results/header-save-${device}-${name}`;
const report = (device: string, name: string, steps: unknown[]): void => {
  mkdirSync("test-results", { recursive: true });
  writeFileSync(out(device, `${name}.json`), `${JSON.stringify({ device, steps }, null, 2)}\n`);
};

const header = (page: Page): Locator => page.getByRole("banner");
const saveKey = (page: Page): Locator => header(page).getByRole("button", { name: "Save play", exact: true });
/** The yellow dot on the Save key: the play differs from its last save. */
const dot = (page: Page): Locator => saveKey(page).locator("span[aria-hidden]");
const status = (page: Page, text: string): Locator => page.locator("main").getByText(text, { exact: true });
const toolsToggle = (page: Page): Locator => page.getByRole("button", { name: "Play tools" });

/** What the coach can see and what the device kept, for the artifact. */
async function step(page: Page, steps: unknown[], name: string): Promise<void> {
  const stored = Object.values(await storedPlays(page));
  steps.push({
    step: name,
    status: await page.locator("main [aria-live='polite']").first().textContent(),
    dot: await dot(page).count() > 0,
    title: await saveKey(page).count() > 0 ? await saveKey(page).getAttribute("title") : null,
    playToolsOpen: await toolsToggle(page).getAttribute("aria-expanded") === "true",
    stored: stored.map((p) => ({ name: p.name, routes: Object.fromEntries(p.players.filter((q) => q.route).map((q) => [q.id, q.route?.type])) })),
  });
}

/** Whether the app took the last ⌘S / Ctrl+S for itself, so the browser's "Save page as" never opened. */
async function watchSaveKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "s" && (e.metaKey || e.ctrlKey)) (window as unknown as Record<string, boolean>).__ffpdSaveTaken = e.defaultPrevented;
    });
  });
}
const saveKeyTaken = (page: Page): Promise<boolean | undefined> =>
  page.evaluate(() => (window as unknown as Record<string, boolean | undefined>).__ffpdSaveTaken);

test("a coach saves from the header without opening Play tools, and the header says when there is something to save", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  const steps: unknown[] = [];
  const d = new Designer(page);
  await d.goto();
  await watchSaveKeys(page);

  // the side badge is gone: the field's own colours say whose play it is
  await expect(header(page).getByRole("img")).toHaveCount(0);
  await expect(header(page).getByText(/^(Offense|Defense)$/)).toHaveCount(0);
  await expect(saveKey(page)).toBeVisible();
  await expect(saveKey(page)).toBeEnabled();
  await expect(saveKey(page)).toHaveAttribute("title", "Save this play (⌘S)");
  await expect(dot(page)).toHaveCount(0);
  await expect(toolsToggle(page)).toHaveAttribute("aria-expanded", "false");
  // nothing is drawn yet, so nothing has gone into the draft either
  await expect(status(page, "Unsaved")).toBeVisible();
  await step(page, steps, "fresh play: nothing to save yet");

  await d.select("X");
  await d.pick("Slant");
  await d.closeSidebars();
  await expect(d.routes).toHaveCount(1);
  await expect(dot(page)).toBeVisible();
  await expect(saveKey(page)).toHaveAttribute("title", "Save changes to this play (⌘S)");
  await header(page).screenshot({ path: out(device, "unsaved.png") });
  await step(page, steps, "X runs a slant: the dot says there is something to save");

  await saveKey(page).click();
  await expect(d.toast).toHaveText("Saved");
  await expect(status(page, "Saved")).toBeVisible();
  await expect(dot(page)).toHaveCount(0);
  await expect(toolsToggle(page)).toHaveAttribute("aria-expanded", "false");
  let stored = Object.values(await storedPlays(page));
  expect(stored).toHaveLength(1);
  expect(stored[0]?.name).toBe("New play");
  expect(stored[0]?.players.find((p) => p.id === "o3")?.route).toEqual({ type: "slant" });
  await header(page).screenshot({ path: out(device, "saved.png") });
  await step(page, steps, "header Save: stored, Play tools never opened");

  // the next edit brings the dot back, and the next save writes over the same play
  await d.select("Y");
  await d.pick("Out");
  await d.closeSidebars();
  // the field says the edit is only in the draft; the dot says Save has something to keep
  await expect(dot(page)).toBeVisible();
  await expect(status(page, "Draft autosaved")).toBeVisible();
  await step(page, steps, "Y runs an out: unsaved again");

  await page.keyboard.press("ControlOrMeta+s");
  await expect(d.toast).toHaveText("Saved");
  await expect(dot(page)).toHaveCount(0);
  expect(await saveKeyTaken(page), "the app takes ⌘S, so the browser's own save never opens").toBe(true);
  stored = Object.values(await storedPlays(page));
  expect(stored).toHaveLength(1);
  expect(stored[0]?.players.find((p) => p.id === "o4")?.route).toEqual({ type: "out" });
  await step(page, steps, "⌘S saves the same play again");

  // ⌘S in the play name saves the name as it is typed, without leaving the field
  await d.tools();
  await d.nameInput.fill("Otter Header Save");
  await expect(dot(page)).toBeVisible();
  await d.nameInput.press("ControlOrMeta+s");
  await expect(d.toast).toHaveText("Saved");
  await expect(d.nameInput).toBeFocused();
  await expect(dot(page)).toHaveCount(0);
  expect(Object.values(await storedPlays(page)).map((p) => p.name)).toEqual(["Otter Header Save"]);
  await step(page, steps, "⌘S in the play name: saved under the new name");

  // the header's Save is the same Save as Play tools': the tile agrees there is nothing left to save
  await expect((await d.tool("Save")).locator("span[aria-hidden]")).toHaveCount(0);

  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(page.getByRole("heading", { name: "Otter Header Save" })).toBeVisible();
  await expect(status(page, "Saved")).toBeVisible();
  await expect(dot(page)).toHaveCount(0);
  await step(page, steps, "after a reload: still saved");
  report(device, "save", steps);
});

test("a play that was never saved keeps its dot through a reload, and so does one opened from a share link", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  const steps: unknown[] = [];
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Slant");
  await d.closeSidebars();
  await expect(dot(page)).toBeVisible();

  // the reload restores the draft with no history behind it: still not in the library, so still a dot
  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(d.routes).toHaveCount(1);
  await expect(dot(page)).toBeVisible();
  await expect(saveKey(page)).toHaveAttribute("title", "Save changes to this play (⌘S)");
  await expect((await d.tool("Save")).locator("span[aria-hidden]")).toHaveCount(1);
  expect(await storedPlays(page)).toEqual({});
  await step(page, steps, "reloaded, never saved: the dot stays");

  await saveKey(page).click();
  await expect(d.toast).toHaveText("Saved");
  await expect(dot(page)).toHaveCount(0);
  await step(page, steps, "saved from the header");

  // a blank new play has nothing to save, before a reload and after one
  await d.newPlay();
  await expect(d.routes).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);
  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(dot(page)).toHaveCount(0);
  await step(page, steps, "a blank new play, reloaded: no dot");

  // a play opened from a share link is not in the library until it is saved
  await d.goto(`?p=${encodeShare({ name: "Otter Shared Slant", players: SLANT_LEFT.players })}`);
  await expect(page.getByRole("heading", { name: "Otter Shared Slant" })).toBeVisible();
  await expect(dot(page)).toBeVisible();
  await saveKey(page).click();
  await expect(d.toast).toHaveText("Saved");
  await expect(dot(page)).toHaveCount(0);
  expect(Object.values(await storedPlays(page)).map((p) => p.name).sort()).toEqual(["New play", "Otter Shared Slant"]);
  await step(page, steps, "opened from a share link, then saved from the header");
  report(device, "never-saved", steps);
});

test("⌘S finds the S key on a Cyrillic layout, and an autofill keydown with no key breaks nothing", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  const steps: unknown[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => { errors.push(e.message); });
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Slant");
  await d.closeSidebars();
  await expect(dot(page)).toBeVisible();

  // Ctrl+S on a Russian layout types "ы" from the S key's place; the app still saves and keeps the browser's save away
  const prevented = await page.evaluate(() => !window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "ы", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
  })));
  expect(prevented, "the browser's own save never opens").toBe(true);
  await expect(d.toast).toHaveText("Saved");
  await expect(dot(page)).toHaveCount(0);
  expect(Object.values(await storedPlays(page))).toHaveLength(1);
  await step(page, steps, "Ctrl+ы (the S key on a Russian layout) saved");

  // Ctrl+O typed on a Dvorak layout sits where QWERTY has S: its letter wins, so it is not a save
  await d.select("Y");
  await d.pick("Out");
  await d.closeSidebars();
  await expect(dot(page)).toBeVisible();
  const taken = await page.evaluate(() => !window.dispatchEvent(new KeyboardEvent("keydown", {
    key: "o", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true,
  })));
  expect(taken).toBe(false);
  await expect(dot(page)).toBeVisible();
  await step(page, steps, "Ctrl+O from the S key's place on Dvorak: not a save");

  // a browser filling in a field sends a keydown that is no KeyboardEvent and has no key
  await d.tools();
  await d.nameInput.evaluate((el) => { el.dispatchEvent(new Event("keydown", { bubbles: true })); });
  await d.closeSidebars();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(d.routes).toHaveCount(1);
  expect(errors, "no page error").toEqual([]);
  await step(page, steps, "an autofill keydown with no key: no error, and Undo still works");
  report(device, "keys", steps);
});

test("a header save that does not land opens Play tools on its warning, and Save again lands it", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  const steps: unknown[] = [];
  await armSabotage(page);
  const d = new Designer(page);
  await d.goto();
  await d.select("Z");
  await d.pick("Go");
  await d.closeSidebars();
  await expect(d.routes).toHaveCount(1);

  await sabotage(page, "quota", true);
  await saveKey(page).click();
  await expect(status(page, "Saving failed")).toBeVisible();
  await expect(toolsToggle(page)).toHaveAttribute("aria-expanded", "true");
  const alert = page.locator("#play-sidebar").getByRole("alert");
  await expect(alert).toContainText("Couldn't save: this browser's storage is full.");
  await expect(alert.getByRole("button", { name: "Download play" })).toBeVisible();
  await expect(dot(page)).toBeVisible();
  expect(await storedPlays(page)).toEqual({});
  await page.screenshot({ path: out(device, "failed.png") });
  await step(page, steps, "header Save refused: Play tools opens on the warning");

  await sabotage(page, "quota", false);
  await saveKey(page).click();
  await expect(d.toast).toHaveText("Saved");
  await expect(alert).toHaveCount(0);
  await expect(dot(page)).toHaveCount(0);
  expect(Object.values(await storedPlays(page)).map((p) => p.players.find((q) => q.id === "o5")?.route?.type)).toEqual(["go"]);
  await step(page, steps, "header Save again: stored, the warning gone");
  report(device, "refused", steps);
});

test("roster mode has no play to save: the header keeps its side switch there, and ⌘S stores nothing", async ({ page }, testInfo) => {
  const device = testInfo.project.name;
  const steps: unknown[] = [];
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Slant");
  await expect(saveKey(page)).toBeVisible();

  await d.roster();
  await expect(saveKey(page)).toHaveCount(0);
  // the roster has both sides, so the field says neither
  await expect(page.locator("main").getByText(/^(Offensive play|Defensive call)$/)).toHaveCount(0);
  await expect(d.rosterView).toHaveAccessibleName("Showing offense");
  await d.rosterView.click();
  await expect(d.rosterView).toHaveAccessibleName("Showing defense");
  await d.closeSidebars();
  // the key is handled as it lands, so by the time the press returns a save would already be stored
  await page.keyboard.press("ControlOrMeta+s");
  expect(await storedPlays(page)).toEqual({});
  await step(page, steps, "roster mode: the side switch, no Save");

  await d.roster(false);
  await expect(saveKey(page)).toBeVisible();
  await expect(dot(page)).toBeVisible();
  await expect(d.routes).toHaveCount(1);
  await saveKey(page).click();
  await expect(d.toast).toHaveText("Saved");
  expect(Object.values(await storedPlays(page))).toHaveLength(1);
  await step(page, steps, "back on the play: Save is back and saves the slant");
  report(device, "roster", steps);
});

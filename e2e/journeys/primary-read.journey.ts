import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Designer } from "../support/designer";
import { storedDraft, storedPlays } from "../support/fixtures";
import type { Route } from "../../lib/play/types";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/**
 * A receiver keeps the primary read when its route is replaced (issue #109). Marking X as the read and
 * then drawing a custom route over the Out (or picking another preset) handed X a fresh route with no
 * read on it: the palette went back to "☆ Mark primary", the red route turned brown, and nothing said
 * so. How this could break, and the test that catches each:
 *  - Finish on a custom route drops the read                                                → "replaced"
 *  - the keyboard finish (Enter) or a double tap takes another path and drops it            → "replaced"
 *  - another preset picked over it drops it, or a preset picked over a custom route does    → "replaced"
 *  - the palette button, the red ink and the stored route disagree                          → every step reads all three
 *  - Undo brings the old route back without its read, or Redo re-applies without it         → "replaced"
 *  - a cancelled custom draft touches the route or the read                                 → "replaced"
 *  - taking the route away leaves a read on a player who runs nothing, or a route picked
 *    afterwards comes back with the old read                                                → "replaced"
 *  - the read is on the field but not in the saved play, the reopened play or the link      → "replaced"
 *  - keeping the read makes a second one: replacing the route of a receiver whose read was
 *    moved to another player must not make them primary again                               → "only one"
 * Leaves `primary-read-<device>.json` and `primary-read-<device>-only-one.json` (each step's stored
 * route, what the palette button said and how many routes wore the read's red) and a picture of the
 * field and the palette after the custom route in test-results/.
 */

interface Step { step: string; route: Route | null | undefined; button: string; red: number }

const routeOf = async (page: Page, id = "o3"): Promise<Route | null | undefined> =>
  (await storedDraft(page))?.players.find((p) => p.id === id)?.route;

/** The palette open for this player, selecting them again only if a transform or a key dropped the selection. */
async function withPalette(d: Designer, label: string): Promise<void> {
  if ((await d.player(label).getAttribute("aria-pressed")) !== "true") await d.select(label);
  else await d.palette();
}

/** What was stored, what the field drew in red and what the palette said, once the draft has landed. */
async function check(d: Designer, steps: Step[], step: string, expected: Route | null, red: number, label = "X", id = "o3"): Promise<void> {
  await expect.poll(() => routeOf(d.page, id), { message: step }).toEqual(expected);
  await expect(d.primaryRoutes, step).toHaveCount(red);
  await withPalette(d, label);
  const button = (await d.primaryButton.count()) ? (await d.primaryButton.innerText()).trim() : "";
  steps.push({ step, route: await routeOf(d.page, id), button, red });
}

const finish = (page: Page) => page.getByRole("button", { name: "Finish", exact: true });

test("a receiver keeps the primary read when its route is replaced: on the field, in the saved play and in the share link", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Out");
  await d.palette();
  await d.primaryButton.click();
  await check(d, steps, "Out marked", { type: "out", primary: true }, 1);
  await expect(d.primaryButton).toHaveText("★ Primary read");

  // another preset over it
  await d.pick("Post");
  await check(d, steps, "Post over Out", { type: "post", primary: true }, 1);
  await expect(d.primaryButton).toHaveText("★ Primary read");

  // a custom route over it, finished from the palette
  await d.pick("Custom");
  await d.tapField(4, -3);
  await d.tapField(4.5, -9);
  await finish(page).click();
  await check(d, steps, "Custom over Post", { type: "custom", pts: [[4, -3], [4.5, -9]], primary: true }, 1);
  await expect(d.primaryButton).toHaveText("★ Primary read");
  await page.locator("#route-sidebar").screenshot({ path: `test-results/primary-read-${testInfo.project.name}-palette.png` });
  await d.closeSidebars();
  await d.field.screenshot({ path: `test-results/primary-read-${testInfo.project.name}-custom.png` });

  // a preset over the custom route
  await withPalette(d, "X");
  await d.pick("Corner");
  await check(d, steps, "Corner over Custom", { type: "corner", primary: true }, 1);

  // the keyboard finish
  await d.pick("Custom");
  await d.tapField(5, -4);
  await expect(d.field).toBeFocused();
  await page.keyboard.press("Enter");
  await check(d, steps, "Custom by Enter", { type: "custom", pts: [[5, -4]], primary: true }, 1);

  // the double-tap finish
  await d.pick("Custom");
  await d.tapField(4, -3);
  await d.doubleTapField(4.5, -10);
  await check(d, steps, "Custom by double tap", { type: "custom", pts: [[4, -3], [4.5, -10]], primary: true }, 1);

  // Undo and Redo carry the read with the route
  await d.undo.click();
  await check(d, steps, "Undo", { type: "custom", pts: [[5, -4]], primary: true }, 1);
  await d.redo.click();
  await check(d, steps, "Redo", { type: "custom", pts: [[4, -3], [4.5, -10]], primary: true }, 1);

  // a cancelled draft leaves the route and its read alone
  await d.pick("Custom");
  await d.tapField(8, -8);
  await page.keyboard.press("Escape");
  await check(d, steps, "Cancelled draft", { type: "custom", pts: [[4, -3], [4.5, -10]], primary: true }, 1);

  // taking the route away takes the read with it, and a route picked afterwards starts without one
  await d.pick("Corner");
  await check(d, steps, "Corner over Custom again", { type: "corner", primary: true }, 1);
  await d.pick("Corner");
  await check(d, steps, "Route removed", null, 0);
  await expect(d.primaryButton).toHaveCount(0);
  await d.pick("Out");
  await check(d, steps, "Out after removal", { type: "out" }, 0);
  await expect(d.primaryButton).toHaveText("☆ Mark primary");

  // saved, reopened and shared with the read
  await d.primaryButton.click();
  await check(d, steps, "Out marked again", { type: "out", primary: true }, 1);
  await d.pick("Custom");
  await d.tapField(4, -3);
  await d.tapField(4.5, -9);
  await finish(page).click();
  await check(d, steps, "Custom over Out", { type: "custom", pts: [[4, -3], [4.5, -9]], primary: true }, 1);
  await d.setName("Otter Read Swap");
  await d.save();
  await expect(d.toast).toHaveText("Saved");
  const saved = Object.values(await storedPlays(page)).find((p) => p.name === "Otter Read Swap");
  expect(saved?.players.find((p) => p.id === "o3")?.route).toEqual({ type: "custom", pts: [[4, -3], [4.5, -9]], primary: true });
  await d.newPlay();
  await expect(d.primaryRoutes).toHaveCount(0);
  await d.openSaved("Otter Read Swap");
  await expect(d.primaryRoutes).toHaveCount(1);
  await d.select("X");
  await expect(d.primaryButton).toHaveText("★ Primary read");
  steps.push({ step: "Reopened", route: saved?.players.find((p) => p.id === "o3")?.route, button: (await d.primaryButton.innerText()).trim(), red: 1 });

  await d.clickTool("Copy share link");
  await page.getByRole("dialog", { name: "Share snapshot" }).getByRole("button", { name: "Copy snapshot link" }).click();
  await expect(d.toast).toHaveText("Link copied");
  const url = await page.evaluate(() => navigator.clipboard.readText());
  await page.goto(url);
  const shared = page.getByRole("img", { name: "Play diagram" }).locator("path[stroke='#c2261a']");
  await expect(shared).toHaveCount(1);
  steps.push({ step: "Share page", route: saved?.players.find((p) => p.id === "o3")?.route, button: "", red: await shared.count() });

  writeFileSync(`test-results/primary-read-${testInfo.project.name}.json`, `${JSON.stringify({ test: "replaced", steps }, null, 2)}\n`);
});

test("keeping the read never makes a second one: a receiver whose read moved to another player stays plain when their route is replaced", async ({ page }, testInfo) => {
  const steps: Step[] = [];
  const d = new Designer(page);
  await d.goto();
  await d.select("X");
  await d.pick("Out");
  await d.palette();
  await d.primaryButton.click();
  await check(d, steps, "X marked", { type: "out", primary: true }, 1);

  // the read moves to Y
  await d.select("Y");
  await d.pick("Post");
  await d.palette();
  await d.primaryButton.click();
  await check(d, steps, "Y marked", { type: "post", primary: true }, 1, "Y", "o4");
  await expect.poll(async () => (await routeOf(page))?.primary).toBeFalsy();

  // X's route replaced: X stays plain, Y keeps the read
  await d.select("X");
  await d.pick("Custom");
  await d.tapField(4, -3);
  await finish(page).click();
  await expect.poll(() => routeOf(page)).toMatchObject({ type: "custom", pts: [[4, -3]] });
  expect((await routeOf(page))?.primary).toBeFalsy();
  await expect(d.primaryRoutes).toHaveCount(1);
  await withPalette(d, "X");
  await expect(d.primaryButton).toHaveText("☆ Mark primary");
  steps.push({ step: "X's Custom over Out", route: await routeOf(page), button: (await d.primaryButton.innerText()).trim(), red: 1 });
  expect(await routeOf(page, "o4")).toEqual({ type: "post", primary: true });

  // Y's route replaced: Y keeps the read, X stays plain
  await d.select("Y");
  await d.pick("Corner");
  await check(d, steps, "Y's Corner over Post", { type: "corner", primary: true }, 1, "Y", "o4");
  await expect(d.primaryButton).toHaveText("★ Primary read");
  expect((await routeOf(page))?.primary).toBeFalsy();

  writeFileSync(`test-results/primary-read-${testInfo.project.name}-only-one.json`, `${JSON.stringify({ test: "only one", steps }, null, 2)}\n`);
});

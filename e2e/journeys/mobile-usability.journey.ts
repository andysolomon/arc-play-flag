import { writeFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import { Designer } from "../support/designer";
import { OTTERS, play, playbook, seed, storedPlaybooks } from "../support/fixtures";

/**
 * A coach can edit and export on a narrow phone, dismiss a long preview without scrolling
 * back to its top, and see feedback as soon as a control is pressed. Failure cases:
 * - a nested grid overflows while the document hides it;
 * - small reorder/remove/download controls are hard to hit, or a select zooms iOS Safari;
 * - scrolling long notes loses the modal title/close button or scrolls the book behind it;
 * - press feedback is missing, moves in reduced motion, or affects disabled controls.
 * Leaves mobile-usability-<device>-*.json and screenshots with the measured bounds and states.
 */
const ALPHA = play("fx-mobile-alpha", "Otter Alpha Slant", { o3: { type: "slant" } },
  Array.from({ length: 35 }, (_, i) => `Coaching point ${String(i + 1)}: find the open receiver before throwing.`).join("\n"));
const BETA = play("fx-mobile-beta", "Otter Beta Wheel", { o5: { type: "wheel" } });
const BOOK = playbook("fx-mobile-book", "Otter Mobile Book", [ALPHA, BETA]);

async function target(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error("control has no bounds");
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  return box;
}

test("editing and exporting fit narrow phones and keep controls tappable", async ({ page }, info) => {
  await seed(page, { plays: [ALPHA, BETA], playbooks: [BOOK], team: OTTERS });
  const measurements = [];
  for (const width of [320, 393, 810]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/playbooks?book=${BOOK.id}`);
    const rows = page.locator("ol > li");
    await expect(rows).toHaveCount(2);
    const controls = [];
    for (const name of [`Remove ${ALPHA.name}`, "Move up", "Move down"]) {
      controls.push({ name, box: await target(rows.first().getByRole("button", { name, exact: true })) });
    }
    const downloads = page.getByRole("button", { name: /^Download / });
    await expect(downloads).toHaveCount(6);
    for (const download of await downloads.all()) {
      controls.push({ name: await download.innerText(), box: await target(download) });
    }
    const fields = await page.getByRole("group", { name: "Featured plays", exact: true }).getByRole("combobox").evaluateAll(
      elements => elements.map(el => ({ fontSize: parseFloat(getComputedStyle(el).fontSize), width: el.getBoundingClientRect().width })),
    );
    expect(fields).toHaveLength(6);
    for (const field of fields) expect(field.fontSize).toBeGreaterThanOrEqual(16);
    // Read every nested box: overflow on the inner library scroller can be hidden by the shell.
    const overflow = await page.locator(".app-root").evaluate(root => [...root.querySelectorAll<HTMLElement>("div, ol, fieldset")]
      .filter(el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
      .map(el => ({ tag: el.tagName, classes: el.className, client: el.clientWidth, scroll: el.scrollWidth })));
    expect(overflow).toEqual([]);
    for (const { box } of controls) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    measurements.push({ width, controls, fields, overflow });
    await page.getByRole("button", { name: "Download flyer PDF", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/mobile-usability-${info.project.name}-${String(width)}-exports.png` });
  }
  await page.locator("ol > li").first().getByRole("button", { name: "Move down", exact: true }).click();
  await expect.poll(async () => (await storedPlaybooks(page))[BOOK.id]?.plays).toEqual([BETA.id, ALPHA.id]);
  await page.locator("ol > li").last().getByRole("button", { name: `Remove ${ALPHA.name}`, exact: true }).click();
  await expect.poll(async () => (await storedPlaybooks(page))[BOOK.id]?.plays).toEqual([BETA.id]);
  writeFileSync(`test-results/mobile-usability-${info.project.name}-exports.json`, `${JSON.stringify(measurements, null, 2)}\n`);
});

test("long modal content scrolls while its title and close button stay reachable", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seed(page, { plays: [ALPHA, BETA], playbooks: [BOOK] });
  await page.goto(`/playbooks?book=${BOOK.id}`);
  const trigger = page.getByRole("button", { name: `View ${ALPHA.name}`, exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: ALPHA.name, exact: true });
  const close = dialog.getByRole("button", { name: "Close play", exact: true });
  const heading = dialog.getByRole("heading", { name: ALPHA.name, exact: true });
  await expect(close).toBeVisible();
  const before = { close: await close.boundingBox(), heading: await heading.boundingBox() };
  const body = dialog.locator(".overflow-y-auto");
  await body.hover();
  await page.mouse.wheel(0, 10000);
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  const after = { close: await close.boundingBox(), heading: await heading.boundingBox() };
  expect(after).toEqual(before);
  await expect(dialog.getByRole("link", { name: "Open in designer ›" })).toBeInViewport();
  const scroll = await body.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, content: el.scrollHeight,
    overscroll: getComputedStyle(el).overscrollBehaviorY, dialogTop: el.parentElement?.scrollTop }));
  expect(scroll.overscroll).toBe("contain");
  expect(scroll.dialogTop).toBe(0);
  await page.screenshot({ path: `test-results/mobile-usability-${info.project.name}-modal.png` });
  // Keyboard navigation reaches the actions; dismissal restores focus to the card.
  await dialog.getByRole("link", { name: "Open in designer ›" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("link", { name: "Game-day reader at this play" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("link", { name: "Open in designer ›" })).toBeFocused();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  writeFileSync(`test-results/mobile-usability-${info.project.name}-modal.json`, `${JSON.stringify({ before, after, scroll }, null, 2)}\n`);
});

test("controls respond during a press and reduced motion keeps them still", async ({ page }, info) => {
  await seed(page, { plays: [ALPHA], playbooks: [BOOK], team: OTTERS });
  await page.goto("/");
  const designer = new Designer(page);
  await designer.tools();
  const measurements = [];
  for (const reducedMotion of ["reduce", "no-preference"] as const) {
    await page.emulateMedia({ reducedMotion });
    const notes = page.getByRole("button", { name: "Notes", exact: true });
    await notes.scrollIntoViewIfNeeded();
    const box = await notes.boundingBox();
    if (!box) throw new Error("Notes has no bounds");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(notes).toHaveCSS("opacity", "0.8");
    if (reducedMotion === "reduce") await expect(notes).toHaveCSS("scale", "none");
    else await expect(notes).toHaveCSS("scale", "0.97");
    measurements.push({ reducedMotion, pressed: await notes.evaluate(el => ({ opacity: getComputedStyle(el).opacity, scale: getComputedStyle(el).scale })) });
    await page.screenshot({ path: `test-results/mobile-usability-${info.project.name}-press-${reducedMotion}.png` });
    await page.mouse.up();
    await expect(notes).toHaveCSS("opacity", "1");
  }
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await expect(undo).toBeDisabled();
  const box = await undo.boundingBox();
  if (!box) throw new Error("Undo has no bounds");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(undo).toHaveCSS("opacity", "1");
  await expect(undo).toHaveCSS("scale", "none");
  await page.mouse.up();
  writeFileSync(`test-results/mobile-usability-${info.project.name}-press.json`, `${JSON.stringify(measurements, null, 2)}\n`);
});

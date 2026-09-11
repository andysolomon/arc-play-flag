import { expect, test } from "@playwright/test";
import { Designer } from "../support/designer";
import { formation, seed, storedDraft } from "../support/fixtures";

const FIRST_USE_KEY = "ffpd.first-use.v1";

test("a first-time coach sees the shortest draw-and-run path and can dismiss it for good", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();

  const guide = page.getByRole("region", { name: "Getting started" });
  await expect(guide).toContainText("Tap a player → pick a route → press ▶");
  const demo = page.getByRole("link", { name: "Demo" });
  await expect(demo).toBeVisible();
  await expect(demo).toHaveAttribute("href", "/demo");
  await expect(page.getByRole("button", { name: "Play tools" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Route palette" })).toHaveAttribute("aria-expanded", "false");
  await guide.getByRole("button", { name: "Dismiss getting started" }).click();
  await expect(guide).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), FIRST_USE_KEY)).toBe("done");

  await d.select("X");
  await d.pick("Slant");
  await expect(d.routes).toHaveCount(1);
  await page.getByRole("button", { name: "Run the play" }).click();
  await expect(page.getByRole("button", { name: "Stop the play" })).toBeVisible();

  await page.reload();
  await expect(guide).toHaveCount(0);
});

test("the default phone view keeps overlay drawers fully off a clear canvas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const d = new Designer(page);
  await d.goto();

  await expect(page.getByRole("button", { name: "Play tools" })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("button", { name: "Route palette" })).toHaveAttribute("aria-expanded", "false");

  const left = page.locator("#play-sidebar");
  const right = page.locator("#route-sidebar");
  await expect(left).toHaveAttribute("data-open", "false");
  await expect(right).toHaveAttribute("data-open", "false");

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await expect.poll(async () => {
    const leftBox = await left.boundingBox();
    const rightBox = await right.boundingBox();
    if (!leftBox || !rightBox || !viewport) return false;
    // fully past the left / right edges (1px subpixel tolerance)
    return leftBox.x + leftBox.width <= 1 && rightBox.x >= viewport.width - 1;
  }).toBe(true);

  await d.tools();
  await expect(left).toHaveAttribute("data-open", "true");
  await d.closeSidebars();
  await expect(left).toHaveAttribute("data-open", "false");
  await expect.poll(async () => {
    const leftBox = await left.boundingBox();
    return !!leftBox && leftBox.x + leftBox.width <= 1;
  }).toBe(true);
});

test("the fictional example is editable and opens on the route choice", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await page.getByRole("button", { name: "Try an example" }).click();

  await expect(page.getByRole("button", { name: "Route palette" })).toHaveAttribute("aria-expanded", "true");
  await expect(d.player("X")).toHaveAttribute("aria-pressed", "true");
  await expect(d.routes).toHaveCount(2);
  await d.pick("Post");
  await expect.poll(async () => (await storedDraft(page))?.name).toBe("Riverside Otters Quick Slant");
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o3")?.route?.type).toBe("post");
});

test("trying the example after starting work leaves that draft untouched", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otter Sideline Draft");
  await d.select("Y");
  await d.pick("Corner");
  await d.closeSidebars();

  await page.getByRole("button", { name: "Try an example" }).click();
  await expect(d.toast).toHaveText("Example skipped · your draft is untouched");
  await d.tools();
  await expect(d.nameInput).toHaveValue("Otter Sideline Draft");
  await expect.poll(async () => (await storedDraft(page))?.players.find((p) => p.id === "o4")?.route?.type).toBe("corner");
});

test("an existing draft returns untouched without onboarding", async ({ page }) => {
  await seed(page, {
    draft: {
      name: "Otter Existing Draft",
      notes: "Keep this work.",
      players: formation({ o5: { type: "wheel" } }),
    },
  });
  const d = new Designer(page);
  await d.goto();

  await expect(page.getByRole("region", { name: "Getting started" })).toHaveCount(0);
  await expect(d.routes).toHaveCount(1);
  await d.tools();
  await expect(d.nameInput).toHaveValue("Otter Existing Draft");
  expect((await storedDraft(page))?.notes).toBe("Keep this work.");
});

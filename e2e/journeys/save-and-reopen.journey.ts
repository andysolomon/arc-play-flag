import { expect, test } from "@playwright/test";
import { Designer, armSabotage, downloadText, sabotage } from "../support/designer";
import { storedPlays } from "../support/fixtures";

test("a coach names a play, draws it, saves it, and finds it again after a reload and a reopen", async ({ page }) => {
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otter Post Corner");
  await d.select("X");
  await d.pick("Post");
  await expect(d.routes).toHaveCount(1);

  // a keyboard nudge is an edit too: Y steps one yard toward the middle
  await d.player("Y").focus();
  await page.keyboard.press("ArrowLeft");
  expect(await d.playerX("Y")).toBe(26);

  await d.save();
  await expect(d.toast).toHaveText("Saved");

  // the draft survives a reload exactly as it was left
  await page.reload();
  await expect(d.field).toBeVisible();
  await expect(d.routes).toHaveCount(1);
  expect(await d.playerX("Y")).toBe(26);
  await d.tools();
  await expect(d.nameInput).toHaveValue("Otter Post Corner");

  // start a fresh play, then reopen the saved one from the library
  await d.clickTool("New play");
  await expect(d.routes).toHaveCount(0);
  await expect(d.nameInput).toHaveValue("New play");
  await d.openSaved("Otter Post Corner");
  await expect(d.nameInput).toHaveValue("Otter Post Corner");
  await expect(d.routes).toHaveCount(1);
  expect(await d.playerX("Y")).toBe(26);

  const stored = Object.values(await storedPlays(page));
  expect(stored).toHaveLength(1);
  expect(stored[0]?.name).toBe("Otter Post Corner");
  expect(stored[0]?.players.find((p) => p.id === "o3")?.route).toEqual({ type: "post" });
  expect(stored[0]?.players.find((p) => p.id === "o4")?.x).toBe(26);
});

test("a save that does not land says so, keeps the play on the field, and offers a file and a retry", async ({ page }) => {
  await armSabotage(page);
  const d = new Designer(page);
  await d.goto();
  await d.setName("Otter Fail Safe");
  await d.select("Z");
  await d.pick("Go");
  await expect(d.routes).toHaveCount(1);

  await sabotage(page, "quota", true);
  await d.save();
  const alert = page.locator("#play-sidebar").getByRole("alert");
  await expect(alert).toContainText("Couldn't save: this browser's storage is full.");
  await expect(alert).toContainText("Your play is still here.");
  // nothing was stored and no saved-play list appeared, so no false success anywhere
  expect(await storedPlays(page)).toEqual({});
  await expect(d.openSelect).toHaveCount(0);
  await expect(d.routes).toHaveCount(1);

  // the way out is a one-play playbook file that "Import a file…" takes back
  const [download] = await Promise.all([page.waitForEvent("download"), alert.getByRole("button", { name: "Download play" }).click()]);
  expect(download.suggestedFilename()).toBe("otter-fail-safe.playbook.json");
  const file = JSON.parse(await downloadText(download)) as {
    kind: string; plays: { name: string; players: { id: string; route: { type: string } | null }[] }[];
  };
  expect(file.kind).toBe("ffpd.playbook");
  expect(file.plays).toHaveLength(1);
  expect(file.plays[0]?.name).toBe("Otter Fail Safe");
  expect(file.plays[0]?.players.find((p) => p.id === "o5")?.route?.type).toBe("go");

  // once there is room again, Try again lands and the warning goes away
  await sabotage(page, "quota", false);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(d.toast).toHaveText("Saved");
  await expect(page.locator("#play-sidebar").getByRole("alert")).toHaveCount(0);
  await expect(d.openSelect.locator("option")).toHaveText(["Open a saved play…", "Otter Fail Safe"]);
  expect(Object.values(await storedPlays(page)).map((p) => p.name)).toEqual(["Otter Fail Safe"]);
});

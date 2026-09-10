import { expect, test } from "@playwright/test";
import { downloadText } from "../support/designer";
import {
  KEYS, OTTERS, SLANT_LEFT, WHEEL_RIGHT, jsonUpload, play, playbook, seed, storageSnapshot, storedDraft, storedPlaybooks, storedPlays,
} from "../support/fixtures";

const restoreInput = (page: import("@playwright/test").Page) => page.getByLabel("Restore a device backup");

test("a complete device backup waits for an explicit merge or replace choice", async ({ page }) => {
  const custom = play("fx-custom", "Otter Custom", { o3: { type: "custom", pts: [[8, -2], [19, -12]], primary: true } }, "Read the safety.");
  const book = playbook("fx-week", "Otter Week", [WHEEL_RIGHT, SLANT_LEFT]);
  const draft = { id: custom.id, name: "Current chalkboard", notes: "Still changing", players: custom.players };
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, custom], playbooks: [book], team: OTTERS, draft });
  await page.goto("/playbooks");

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download backup" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^riverside-otters-device-backup-\d{4}-\d{2}-\d{2}\.json$/);
  const backup = await downloadText(download);
  const parsed = JSON.parse(backup) as {
    kind: string; plays: { id: string; notes: string; players: { id: string; route: unknown }[] }[];
    playbooks: { plays: string[] }[]; draft: { name: string } | null;
  };
  expect(parsed.kind).toBe("ffpd.backup");
  expect(parsed.plays.map((p) => p.id)).toEqual(["fx-slant-left", "fx-wheel-right", "fx-custom"]);
  expect(parsed.playbooks[0]?.plays).toEqual(["fx-wheel-right", "fx-slant-left"]);
  expect(parsed.draft?.name).toBe("Current chalkboard");
  expect(parsed.plays[2]?.players.find((p) => p.id === "o3")?.route).toEqual({ type: "custom", pts: [[8, -2], [19, -12]], primary: true });

  const localOnly = play("fx-local", "Local only");
  await page.evaluate(([keys, local]) => {
    localStorage.setItem(keys.plays, JSON.stringify({ [local.id]: local }));
    localStorage.setItem(keys.books, JSON.stringify({}));
  }, [KEYS, localOnly] as const);
  await page.reload();
  await restoreInput(page).setInputFiles(jsonUpload("device-backup.json", backup));
  const preview = page.getByRole("region", { name: "Restore preview" });
  await expect(preview).toContainText("3 plays");
  await expect(preview).toContainText("1 current-only play");
  expect(Object.keys(await storedPlays(page))).toEqual(["fx-local"]);

  await preview.getByRole("button", { name: "Merge backup" }).click();
  expect(Object.keys(await storedPlays(page))).toEqual(["fx-local", "fx-slant-left", "fx-wheel-right", "fx-custom"]);
  expect((await storedPlaybooks(page))["fx-week"]?.plays).toEqual(["fx-wheel-right", "fx-slant-left"]);
  expect((await storedDraft(page))?.name).toBe("Current chalkboard");

  await restoreInput(page).setInputFiles(jsonUpload("device-backup.json", backup));
  await page.getByRole("region", { name: "Restore preview" }).getByRole("button", { name: "Replace device data" }).click();
  expect(Object.keys(await storedPlays(page))).toEqual(["fx-slant-left", "fx-wheel-right", "fx-custom"]);
});

test("an invalid device backup changes nothing and never offers restore actions", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  await page.goto("/playbooks");
  const before = await storageSnapshot(page);
  await restoreInput(page).setInputFiles(jsonUpload("bad-backup.json", JSON.stringify({ kind: "ffpd.backup", version: 1, plays: [] })));
  await expect(page.locator("div[role='status']")).toHaveText("That file isn't a device backup.");
  await expect(page.getByRole("region", { name: "Restore preview" })).toHaveCount(0);
  expect(await storageSnapshot(page)).toEqual(before);

  const hostile = {
    kind: "ffpd.backup",
    version: 1,
    exported: "2026-09-01T12:00:00.000Z",
    plays: [{ ...SLANT_LEFT, id: "__proto__" }],
    playbooks: [],
    team: OTTERS,
    draft: null,
  };
  await restoreInput(page).setInputFiles(jsonUpload("hostile-backup.json", JSON.stringify(hostile)));
  await expect(page.locator("div[role='status']")).toHaveText("That backup is incomplete or contains invalid data. Nothing was changed.");
  await expect(page.getByRole("region", { name: "Restore preview" })).toHaveCount(0);
  expect(await storageSnapshot(page)).toEqual(before);
});

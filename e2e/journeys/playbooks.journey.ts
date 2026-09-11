import { expect, test, type Page } from "@playwright/test";
import { armSabotage, downloadBytes, downloadText, sabotage } from "../support/designer";
import {
  COVER_TWO, OTTERS, SLANT_LEFT, WHEEL_RIGHT, jsonUpload, playbook, playbookFile, seed, storageSnapshot, storedPlaybooks, storedPlays,
} from "../support/fixtures";

const toast = (page: Page) => page.locator("div[role='status']");
const items = (page: Page) => page.getByRole("list").getByRole("listitem");
const importInput = (page: Page) => page.getByLabel("Import a playbook file");

test("a coach makes a playbook, adds plays, reorders them, and the order survives a reload", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], team: OTTERS });
  await page.goto("/playbooks");
  await expect(page.getByText("No playbooks yet.")).toBeVisible();

  await page.getByRole("button", { name: "+ New playbook" }).click();
  await expect(page).toHaveURL(/\/playbooks\?book=/);
  const name = page.getByRole("textbox", { name: "Playbook name" });
  await expect(name).toHaveValue("Playbook 1");
  await name.fill("Otter Game Plan");
  await expect(page.getByText("Empty. Add plays from the list below.")).toBeVisible();

  await page.getByTitle("Add Otter Slant Left").click();
  await page.getByTitle("Add Otter Wheel Right").click();
  await page.getByTitle("Add Otter Cover Two").click();
  await expect(items(page)).toHaveText([/Otter Slant Left/, /Otter Wheel Right/, /Otter Cover Two/]);
  await expect(page.getByText("Every saved play is already in this playbook.")).toBeVisible();

  await items(page).nth(0).getByRole("button", { name: "Move down" }).click();
  await expect(items(page)).toHaveText([/Otter Wheel Right/, /Otter Slant Left/, /Otter Cover Two/]);
  await expect(items(page).nth(0).getByLabel("Play 1")).toBeVisible();

  await page.reload();
  await expect(name).toHaveValue("Otter Game Plan");
  await expect(items(page)).toHaveText([/Otter Wheel Right/, /Otter Slant Left/, /Otter Cover Two/]);

  await page.getByRole("button", { name: "Remove Otter Cover Two" }).click();
  await expect(items(page)).toHaveText([/Otter Wheel Right/, /Otter Slant Left/]);
  await page.getByRole("link", { name: "‹ All playbooks" }).click();
  await expect(page.getByRole("link", { name: /Otter Game Plan/ })).toContainText("2 plays");
  expect(Object.values(await storedPlaybooks(page)).map((b) => b.plays)).toEqual([["fx-wheel-right", "fx-slant-left"]]);
});

test("exports are disabled for an empty book, download as real files for a full one, and say when they fail", async ({ page }) => {
  await armSabotage(page);
  const empty = playbook("fx-empty", "Otter Empty Book", []);
  const road = playbook("fx-road", "Otter Road Book", [WHEEL_RIGHT, COVER_TWO]);
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [empty, road], team: OTTERS });

  await page.goto("/playbooks?book=fx-empty");
  for (const label of ["Download wristbands PDF", "Download binder PDF", "Download postcards PDF", "Download flyer PDF", "Download playbook file"]) {
    await expect(page.getByRole("button", { name: label })).toBeDisabled();
  }

  await page.goto("/playbooks?book=fx-road");
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download playbook file" }).click()]);
  await expect(toast(page)).toHaveText("Saved");
  expect(file.suggestedFilename()).toBe("otter-road-book.playbook.json");
  const parsed = JSON.parse(await downloadText(file)) as { kind: string; playbook: { plays: string[] }; plays: { id: string }[]; team: { name: string } | null };
  expect(parsed.kind).toBe("ffpd.playbook");
  expect(parsed.playbook.plays).toEqual(["fx-wheel-right", "fx-cover-two"]);
  expect(parsed.plays.map((p) => p.id)).toEqual(["fx-wheel-right", "fx-cover-two"]);
  expect(parsed.team?.name).toBe("Riverside Otters");

  await expect(page.getByRole("radio", { name: "Both teams" })).toBeChecked();
  await page.getByRole("radio", { name: "Defense" }).check();
  const preview = page.getByRole("img", { name: "Defense PDF preview" });
  await expect(preview.locator('circle[fill="#4a8fe0"]')).toHaveCount(5);
  await expect(preview.locator('circle[fill="#e5675e"]')).toHaveCount(0);
  await page.getByRole("combobox", { name: "Binder layout" }).selectOption("four");
  const [pdf] = await Promise.all([page.waitForEvent("download", { timeout: 40_000 }), page.getByRole("button", { name: "Download binder PDF" }).click()]);
  await expect(toast(page)).toHaveText("Saved", { timeout: 40_000 });
  expect(pdf.suggestedFilename()).toBe("otter-road-book-binder.pdf");
  expect((await downloadBytes(pdf)).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // a page that cannot be drawn is a failure, not a "Saved"
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  await sabotage(page, "noCanvas", true);
  await page.getByRole("button", { name: "Download wristbands PDF" }).click();
  await expect(toast(page)).toHaveText("That export failed. Try again on a bigger screen.");
  await expect(page.getByRole("button", { name: "Download wristbands PDF" })).toBeEnabled();
  expect(downloaded).toBe(false);
});

test("postcards print two-sided and the flyer prints one page the coach chose", async ({ page }) => {
  const road = playbook("fx-road", "Otter Road Book", [WHEEL_RIGHT, COVER_TWO, SLANT_LEFT]);
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [road], team: OTTERS });
  await page.goto("/playbooks?book=fx-road");

  // one play's postcard is named after the play, not the book
  await page.getByRole("combobox", { name: "Plays to print as postcards" }).selectOption("fx-cover-two");
  const [cards] = await Promise.all([
    page.waitForEvent("download", { timeout: 40_000 }),
    page.getByRole("button", { name: "Download postcards PDF" }).click(),
  ]);
  await expect(toast(page)).toHaveText("Saved", { timeout: 40_000 });
  expect(cards.suggestedFilename()).toBe("otter-cover-two-postcard.pdf");
  expect((await downloadBytes(cards)).subarray(0, 5).toString("latin1")).toBe("%PDF-");

  // the flyer starts on the book's own order and follows the slots a coach changes
  const slot = page.getByRole("combobox", { name: "Flyer slot 1" });
  await expect(slot).toHaveValue("fx-wheel-right");
  await expect(page.getByRole("combobox", { name: "Flyer slot 4" })).toHaveValue("");
  await slot.selectOption("fx-slant-left");
  const [flyer] = await Promise.all([
    page.waitForEvent("download", { timeout: 40_000 }),
    page.getByRole("button", { name: "Download flyer PDF" }).click(),
  ]);
  await expect(toast(page)).toHaveText("Saved", { timeout: 40_000 });
  expect(flyer.suggestedFilename()).toBe("otter-road-book-flyer.pdf");
  expect((await downloadBytes(flyer)).subarray(0, 5).toString("latin1")).toBe("%PDF-");
});

test("a bad file is refused with a reason and changes nothing; a good one lands as a new book", async ({ page }) => {
  await seed(page, { plays: [SLANT_LEFT] });
  await page.goto("/playbooks");
  await expect(page.getByText("No playbooks yet.")).toBeVisible();
  const before = await storageSnapshot(page);

  await importInput(page).setInputFiles(jsonUpload("scribbles.json", "{ this is not json"));
  await expect(toast(page)).toHaveText("That file isn't readable. Was it edited?");

  await importInput(page).setInputFiles(jsonUpload("notes.json", JSON.stringify({ kind: "ffpd.notes", plays: [] })));
  await expect(toast(page)).toHaveText("That file isn't a playbook.");

  const future = JSON.parse(playbookFile(playbook("fx-future", "Otter Future Book", [WHEEL_RIGHT]), [WHEEL_RIGHT])) as { version: number };
  future.version = 99;
  await importInput(page).setInputFiles(jsonUpload("future.playbook.json", JSON.stringify(future)));
  await expect(toast(page)).toHaveText("That playbook was made by a newer version of this app. Update, then try again.");

  expect(await storageSnapshot(page)).toEqual(before);
  await expect(page.getByText("No playbooks yet.")).toBeVisible();

  const good = playbookFile(playbook("fx-road", "Otter Road Book", [WHEEL_RIGHT, COVER_TWO]), [WHEEL_RIGHT, COVER_TWO], OTTERS);
  await importInput(page).setInputFiles(jsonUpload("otter-road-book.playbook.json", good));
  await expect(toast(page)).toHaveText("Imported “Otter Road Book” · 2 plays added");
  await expect(page).toHaveURL(/book=fx-road/);
  await expect(items(page)).toHaveText([/Otter Wheel Right/, /Otter Cover Two/]);
  expect(Object.keys(await storedPlays(page)).sort()).toEqual(["fx-cover-two", "fx-slant-left", "fx-wheel-right"]);

  // the file's team is taken on a device that had none
  await page.getByRole("link", { name: "‹ All playbooks" }).click();
  await expect(page.getByRole("textbox", { name: "Team name" })).toHaveValue("Riverside Otters");
});

test("a playbook file downloaded on one device imports whole on another", async ({ page, browser }) => {
  const season = playbook("fx-season", "Otter Season Book", [COVER_TWO, SLANT_LEFT, WHEEL_RIGHT]);
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [season], team: OTTERS });
  await page.goto("/playbooks?book=fx-season");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download playbook file" }).click()]);
  expect(download.suggestedFilename()).toBe("otter-season-book.playbook.json");
  const text = await downloadText(download);

  // another coach's device: a second, empty browser context
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await page2.goto("/playbooks");
  await importInput(page2).setInputFiles(jsonUpload("otter-season-book.playbook.json", text));
  await expect(toast(page2)).toHaveText("Imported “Otter Season Book” · 3 plays added");
  await expect(items(page2)).toHaveText([/Otter Cover Two/, /Otter Slant Left/, /Otter Wheel Right/]);
  expect(await storedPlays(page2)).toEqual(await storedPlays(page));
  expect(await storedPlaybooks(page2)).toEqual(await storedPlaybooks(page));
  await page2.getByRole("link", { name: "‹ All playbooks" }).click();
  await expect(page2.getByRole("textbox", { name: "Team name" })).toHaveValue("Riverside Otters");
  await other.close();
});

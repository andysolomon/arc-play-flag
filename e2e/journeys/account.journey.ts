import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { Designer } from "../support/designer";
import { accountView, expectSaved, marker, openPanel, panel, reloadedBy, runId, signIn, status, teamButton, teamPlayNames, teamRecord } from "../support/account";
import { KEYS, OTTERS, SLANT_LEFT, WHEEL_RIGHT, playbook, seed, storedPlays, storedTeam } from "../support/fixtures";

/**
 * A coach's account (docs/adr/011-coach-accounts.md): sign in with the fixture coaches, the device's
 * work becomes a team, a second device signed in to the account gets it, a team is one of several,
 * two devices' changes merge instead of overwriting, and signing out clears the device. How this
 * could break, and the test that catches each:
 *  - signing in on a device with work loses it, or doesn't make a team of it (A3)              → "a coach's work"
 *  - a second device signed in to the account doesn't get the team, or gets it stale (A4, A5)  → "a coach's work"
 *  - a play saved on one device doesn't reach the other after a reload (A5)                    → "a coach's work"
 *  - a new team doesn't start empty, a switch doesn't change what the device holds (A17)       → "several teams"
 *  - a deleted team stays listed, or its deletion takes another team's plays with it           → "several teams"
 *  - a push refused as changed elsewhere overwrites the other device's play, or loses its own   → "two devices"
 *  - a write while offline is lost, or reported saved (A7)                                      → "offline"
 *  - signing out leaves the team on the device, or loses a change not yet pushed (A11)          → "signing out"
 *  - signed out, the panel offers no way in, or the account is written to                       → "signing out"
 *  - a session that ends mid-work loses the device's marker, or a save made signed out never goes
 *    up on the next sign-in, or goes up as a second team instead of the same one (A5, A12)      → "a session that ends"
 * Leaves `account-<device>-<test>.json` (each step: what the panel said, what the device held, what
 * the account held) and pictures of the panel and the sign-in page in test-results/, uploaded as `account`.
 */

test.beforeEach(() => {
  test.skip(!process.env.SHARING_TEST_REDIS_URL, "Requires disposable Redis REST adapter; enabled in CI");
});

interface Step { step: string; panel: string; status: string | null; device: string[]; account?: unknown; marker?: unknown }
const steps: Step[] = [];

async function read(page: Page, step: string, account?: unknown): Promise<void> {
  await openPanel(page);
  steps.push({
    step,
    panel: (await panel(page).innerText()).replace(/\s+/g, " ").trim(),
    status: (await status(page).count()) ? await status(page).getAttribute("data-status") : null,
    device: Object.values(await storedPlays(page)).map((p) => p.name),
    ...(account !== undefined ? { account } : {}),
    marker: await marker(page),
  });
}

function save(name: string): void {
  writeFileSync(`test-results/account-${name}.json`, `${JSON.stringify({ steps: steps.splice(0) }, null, 2)}\n`);
}

/** Draws nothing: names and saves a fresh play, as the quickest write a coach makes. */
async function savePlay(page: Page, name: string): Promise<void> {
  const d = new Designer(page);
  await d.newPlay();
  await d.setName(name);
  await d.save();
  await expect(d.toast).toContainText("Saved");
}

test("a coach's work follows them into a new account and onto a second device", async ({ page, browser }, testInfo) => {
  const run = runId();
  // signed out, the panel leads to sign-in and nothing leaves the device
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT], playbooks: [playbook("fx-week", "Otter Week", [SLANT_LEFT])], team: OTTERS });
  const d = new Designer(page);
  await d.goto();
  await d.tools();
  await expect(panel(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(panel(page)).toContainText("Google or X");
  await read(page, "signed out", await accountView(page.context()));
  await panel(page).screenshot({ path: `test-results/account-${testInfo.project.name}-signed-out.png` });

  // the sign-in page, then the device's work as the account's first team (A3)
  await page.goto(`/sign-in?run=${run}`);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.screenshot({ path: `test-results/account-${testInfo.project.name}-sign-in.png` });
  await reloadedBy(page, () => page.getByRole("button", { name: "Continue as Coach Otter" }).click());
  await d.tools();
  await expect(panel(page)).toContainText("Signed in as Coach Otter");
  await expect(teamButton(page)).toContainText("Riverside Otters");
  await expectSaved(page);
  await panel(page).screenshot({ path: `test-results/account-${testInfo.project.name}-signed-in.png` });
  const view = await accountView(page.context());
  if (!("teams" in view)) throw new Error("not signed in");
  expect(view.teams.map((t) => [t.name, t.plays, t.playbooks])).toEqual([["Riverside Otters", 2, 1]]);
  const teamId = view.teams[0]?.id ?? "";
  expect(await marker(page)).toMatchObject({ teamId, rev: 1, dirty: false });
  expect(await teamPlayNames(page.context(), teamId)).toEqual(["Otter Slant Left", "Otter Wheel Right"]);
  expect(Object.keys(await storedPlays(page))).toEqual(["fx-slant-left", "fx-wheel-right"]);
  await read(page, "signed in: the device's work is the account's first team", view);

  // a save goes up
  await savePlay(page, "Otter Fade");
  await expect(status(page)).toHaveAttribute("data-status", /saving|pending/);
  await expectSaved(page);
  expect(await teamPlayNames(page.context(), teamId)).toEqual(["Otter Slant Left", "Otter Wheel Right", "Otter Fade"]);
  expect((await marker(page))?.rev).toBe(2);
  await read(page, "a play saved here is in the account", await teamRecord(page.context(), teamId));

  // a second, empty device signed in to the account opens the same team (A4)
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signIn(page2, "Coach Otter", run);
  const d2 = new Designer(page2);
  await d2.tools();
  await expect(teamButton(page2)).toContainText("Riverside Otters");
  await expectSaved(page2);
  expect(Object.values(await storedPlays(page2)).map((p) => p.name)).toEqual(["Otter Slant Left", "Otter Wheel Right", "Otter Fade"]);
  expect(await storedTeam(page2)).toEqual(OTTERS);
  await page2.goto("/playbooks");
  await expect(page2.getByText("Otter Week", { exact: true })).toBeVisible();
  await expect(page2.getByText("3 plays", { exact: true })).toBeVisible();
  await read(page2, "a second device: the team came down", await accountView(other));

  // a play saved on the second device reaches the first on its next visit (A5)
  await d2.goto();
  await savePlay(page2, "Otter Reverse");
  await expectSaved(page2);
  await page.reload();
  await d.tools();
  await expectSaved(page);
  expect(Object.values(await storedPlays(page)).map((p) => p.name)).toEqual(["Otter Slant Left", "Otter Wheel Right", "Otter Fade", "Otter Reverse"]);
  expect((await marker(page))?.rev).toBe(3);
  await read(page, "the first device, after a reload: the other device's play is here", await teamRecord(page.context(), teamId));
  await other.close();
  save(`${testInfo.project.name}-a-coachs-work`);
});

test("an account holds several teams and the device shows the one that is open", async ({ page }, testInfo) => {
  const run = runId();
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  await signIn(page, "Coach Otter", run);
  const d = new Designer(page);
  await d.tools();
  await expectSaved(page);
  const first = await accountView(page.context());
  if (!("teams" in first)) throw new Error("not signed in");
  const otters = first.teams[0]?.id ?? "";

  // a new team starts empty and is the one the device has open
  await teamButton(page).click();
  const menu = page.getByRole("menu", { name: "Teams" });
  await expect(menu.getByRole("menuitemradio")).toHaveCount(1);
  await panel(page).screenshot({ path: `test-results/account-${testInfo.project.name}-teams.png` });
  await menu.getByRole("menuitem", { name: "+ New team…" }).click();
  await panel(page).getByRole("textbox", { name: "New team name" }).fill("Harbor Herons");
  await reloadedBy(page, () => panel(page).getByRole("button", { name: "Create team" }).click());
  await d.tools();
  await expect(teamButton(page)).toContainText("Harbor Herons");
  await expect(teamButton(page)).toContainText("2 teams");
  await expectSaved(page);
  expect(await storedPlays(page)).toEqual({});
  expect((await storedTeam(page))?.name).toBe("Harbor Herons");
  await read(page, "a new team: empty, open on this device", await accountView(page.context()));

  // its plays are its own
  await savePlay(page, "Heron Sweep");
  await expectSaved(page);
  const view = await accountView(page.context());
  if (!("teams" in view)) throw new Error("not signed in");
  const herons = view.teams.find((t) => t.name === "Harbor Herons")?.id ?? "";
  expect(await teamPlayNames(page.context(), herons)).toEqual(["Heron Sweep"]);
  expect(await teamPlayNames(page.context(), otters)).toEqual(["Otter Slant Left"]);

  // switching back brings the Otters' plays and settings, and the pick is the account's
  await teamButton(page).click();
  await reloadedBy(page, () => page.getByRole("menu", { name: "Teams" }).getByRole("menuitemradio", { name: /Riverside Otters/ }).click());
  await d.tools();
  await expect(teamButton(page)).toContainText("Riverside Otters");
  await expectSaved(page);
  expect(Object.values(await storedPlays(page)).map((p) => p.name)).toEqual(["Otter Slant Left"]);
  expect(await storedTeam(page)).toEqual(OTTERS);
  const switched = await accountView(page.context());
  if (!("teams" in switched)) throw new Error("not signed in");
  expect(switched.current).toBe(otters);
  await read(page, "switched back to the Otters", switched);

  // deleting the open team takes its plays from the account and the device opens another
  await teamButton(page).click();
  await page.getByRole("menu", { name: "Teams" }).getByRole("menuitem", { name: /^Delete “Riverside Otters”/ }).click();
  const confirm = panel(page).getByRole("group", { name: "Delete team" });
  await expect(confirm).toContainText("1 play");
  await reloadedBy(page, () => confirm.getByRole("button", { name: "Delete team" }).click());
  await d.tools();
  await expect(teamButton(page)).toContainText("Harbor Herons");
  await expect(teamButton(page)).toContainText("1 team");
  await expectSaved(page);
  expect(Object.values(await storedPlays(page)).map((p) => p.name)).toEqual(["Heron Sweep"]);
  const after = await accountView(page.context());
  if (!("teams" in after)) throw new Error("not signed in");
  expect(after.teams.map((t) => t.name)).toEqual(["Harbor Herons"]);
  expect((await page.context().request.get(`/api/account/teams/${otters}`)).status()).toBe(404);
  await read(page, "the Otters deleted: the Herons are open", after);
  save(`${testInfo.project.name}-several-teams`);
});

test("two devices' changes to one team merge instead of overwriting each other", async ({ page, browser }, testInfo) => {
  const run = runId();
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  await signIn(page, "Coach Otter", run);
  const d = new Designer(page);
  await d.tools();
  await expectSaved(page);
  const view = await accountView(page.context());
  if (!("teams" in view)) throw new Error("not signed in");
  const teamId = view.teams[0]?.id ?? "";

  const other = await browser.newContext();
  const page2 = await other.newPage();
  await signIn(page2, "Coach Otter", run);
  const d2 = new Designer(page2);
  await d2.tools();
  await expectSaved(page2);

  // the second device's push can't get through; the first writes meanwhile
  await page2.route("**/api/account/teams/*", (route) => (route.request().method() === "PUT" ? route.abort() : route.continue()));
  await savePlay(page2, "Otter Reverse");
  await expect(status(page2)).toHaveAttribute("data-status", /pending|error/, { timeout: 15_000 });
  expect((await marker(page2))?.dirty).toBe(true);
  await read(page2, "second device: a save the account hasn't got", await teamRecord(other, teamId));
  await savePlay(page, "Otter Fade");
  await expectSaved(page);
  expect(await teamPlayNames(page.context(), teamId)).toEqual(["Otter Slant Left", "Otter Fade"]);

  // back through: refused as changed elsewhere, merged, pushed; both devices end with both plays
  await page2.unroute("**/api/account/teams/*");
  await page2.evaluate(() => { window.dispatchEvent(new Event("online")); });
  await expectSaved(page2);
  expect(await teamPlayNames(page.context(), teamId)).toEqual(["Otter Slant Left", "Otter Fade", "Otter Reverse"]);
  expect(Object.values(await storedPlays(page2)).map((p) => p.name).sort()).toEqual(["Otter Fade", "Otter Reverse", "Otter Slant Left"]);
  expect((await marker(page2))?.rev).toBe(3);
  await read(page2, "second device: merged and pushed", await teamRecord(other, teamId));
  await page.reload();
  await d.tools();
  await expectSaved(page);
  expect(Object.values(await storedPlays(page)).map((p) => p.name).sort()).toEqual(["Otter Fade", "Otter Reverse", "Otter Slant Left"]);
  await read(page, "first device, reloaded: both plays", await teamRecord(page.context(), teamId));
  await other.close();
  save(`${testInfo.project.name}-two-devices`);
});

test("a write while offline stays on the device and goes up when the device is back", async ({ page, context }, testInfo) => {
  const run = runId();
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  await signIn(page, "Coach Otter", run);
  const d = new Designer(page);
  await d.tools();
  await expectSaved(page);
  const view = await accountView(context);
  if (!("teams" in view)) throw new Error("not signed in");
  const teamId = view.teams[0]?.id ?? "";

  await context.setOffline(true);
  await savePlay(page, "Otter Fade");
  await expect(status(page)).toHaveAttribute("data-status", "offline", { timeout: 15_000 });
  await expect(status(page)).toContainText("Offline");
  expect(Object.keys(await storedPlays(page))).toHaveLength(2);
  expect((await marker(page))?.dirty).toBe(true);
  await panel(page).screenshot({ path: `test-results/account-${testInfo.project.name}-offline.png` });
  await read(page, "offline: saved here, not yet in the account");

  await context.setOffline(false);
  await page.evaluate(() => { window.dispatchEvent(new Event("online")); });
  await expectSaved(page);
  expect(await teamPlayNames(context, teamId)).toEqual(["Otter Slant Left", "Otter Fade"]);
  expect(await marker(page)).toMatchObject({ teamId, rev: 2, dirty: false });
  await read(page, "back online: pushed", await teamRecord(context, teamId));
  save(`${testInfo.project.name}-offline`);
});

test("signing out clears the device, and signing in brings the team back", async ({ page, context }, testInfo) => {
  const run = runId();
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT], playbooks: [playbook("fx-week", "Otter Week", [SLANT_LEFT])], team: OTTERS });
  await signIn(page, "Coach Otter", run);
  const d = new Designer(page);
  await d.tools();
  await expectSaved(page);

  await reloadedBy(page, () => panel(page).getByRole("button", { name: "Sign out" }).click());
  await d.tools();
  await expect(panel(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(await page.evaluate((keys) => Object.values(keys).map((k) => localStorage.getItem(k)), KEYS)).toEqual([null, null, null, null, null]);
  expect(await marker(page)).toBeNull();
  const out = await accountView(context);
  expect("user" in out ? out.user : "off").toBeNull();
  await read(page, "signed out: nothing of the team on the device", out);

  // a play drawn signed out stays the device's (A2); signing in makes a second team of it (A3)
  await savePlay(page, "Otter Scout Look");
  await d.tools();
  await expect(panel(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  await signIn(page, "Coach Otter", run);
  await d.tools();
  await expectSaved(page);
  const back = await accountView(context);
  if (!("teams" in back)) throw new Error("not signed in");
  expect(back.teams.map((t) => [t.name, t.plays])).toEqual([["Riverside Otters", 2], ["My team", 1]]);
  await expect(teamButton(page)).toContainText("My team");

  // and the Otters are a switch away, whole
  await teamButton(page).click();
  await reloadedBy(page, () => page.getByRole("menu", { name: "Teams" }).getByRole("menuitemradio", { name: /Riverside Otters/ }).click());
  await d.tools();
  await expectSaved(page);
  expect(Object.keys(await storedPlays(page))).toEqual(["fx-slant-left", "fx-wheel-right"]);
  await page.goto("/playbooks");
  await expect(page.getByText("Otter Week", { exact: true })).toBeVisible();
  await read(page, "signed in again, the Otters opened: the book and its plays are back", await accountView(context));
  save(`${testInfo.project.name}-signing-out`);
});

test("a session that ends keeps the device's work for the next sign-in, which pushes it to the same team", async ({ page, context }, testInfo) => {
  const run = runId();
  await seed(page, { plays: [SLANT_LEFT], team: OTTERS });
  await signIn(page, "Coach Otter", run);
  const d = new Designer(page);
  await d.tools();
  await expectSaved(page);
  const view = await accountView(context);
  if (!("teams" in view)) throw new Error("not signed in");
  const teamId = view.teams[0]?.id ?? "";

  // the session ends without a sign-out (A12): the device keeps the team and its marker
  await context.clearCookies();
  await page.reload();
  await d.tools();
  await expect(panel(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  expect(Object.keys(await storedPlays(page))).toEqual(["fx-slant-left"]);
  expect(await marker(page)).toMatchObject({ teamId, rev: 1, dirty: false });
  await read(page, "the session ended: signed out, the team still on the device");

  // a save made signed out stays the device's, and is remembered as not yet in the account (A5)
  await savePlay(page, "Otter Fade");
  await d.tools();
  await expect(panel(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  expect((await marker(page))?.dirty).toBe(true);
  expect(await teamPlayNames(context, teamId).catch(() => "signed out")).toBe("signed out");
  await read(page, "saved signed out: on the device, marked as not yet pushed");

  // signing in again pushes it to the same team, not a new one
  await signIn(page, "Coach Otter", run);
  await d.tools();
  await expectSaved(page);
  await expect(teamButton(page)).toContainText("1 team");
  expect(await teamPlayNames(context, teamId)).toEqual(["Otter Slant Left", "Otter Fade"]);
  expect(await marker(page)).toMatchObject({ teamId, rev: 2, dirty: false });
  await read(page, "signed in again: the save went up to the same team", await teamRecord(context, teamId));
  save(`${testInfo.project.name}-a-session-that-ends`);
});

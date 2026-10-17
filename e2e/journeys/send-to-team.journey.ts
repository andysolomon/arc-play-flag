import { writeFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Designer } from "../support/designer";
import { accountView, expectSaved, marker, reloadedBy, runId, signIn, teamButton, teamRecord } from "../support/account";
import { COVER_TWO, OTTERS, SLANT_LEFT, WHEEL_RIGHT, playbook, seed, storedPlaybooks, storedPlays } from "../support/fixtures";
import { defaultLineups } from "../../lib/play/lineup";
import { EMPTY_DESK } from "../../lib/account/data";
import type { TeamData } from "../../lib/account/types";

/**
 * Sending a playbook or a play to another of the account's teams, from the playbooks page (ADR 012,
 * S1–S7 in lib/account/sync.ts). How this could break, and the test that catches each:
 *  - the row shows signed out, or with one team, where there is nowhere to send to                  → "a playbook and a play"
 *  - the book arrives without its plays, its order or its primary, or the plays without the book   → "a playbook and a play"
 *  - sending changes this team, this device, or starts a push of the device's own team (S7)        → "a playbook and a play"
 *  - a second send writes the book or play again instead of saying it is already there (S1)        → "a playbook and a play"
 *  - the team switched to does not show what was sent                                              → "a playbook and a play"
 *  - a differing play under the same id overwrites the other team's version, or is dropped (S2)    → "a differing play"
 *  - a team written by its own device between the read and the write loses that write, or the
 *    send (S3)                                                                                      → "a differing play"
 *  - a team deleted meanwhile is reported sent to, or stays on the list (S4)                        → "a differing play"
 * Leaves `send-to-team-<device>-<test>.json` (each step: the toast, what the device held, what each
 * team held) and pictures of the send dialog in test-results/, uploaded as `send-to-team`.
 */

test.beforeEach(() => {
  test.skip(!process.env.SHARING_TEST_REDIS_URL, "Requires disposable Redis REST adapter; enabled in CI");
});

interface Step { step: string; toast?: string; device: { plays: string[]; books: string[] }; teams: Record<string, unknown>; marker: unknown }
const steps: Step[] = [];

async function teamView(context: BrowserContext, id: string): Promise<unknown> {
  const r = await context.request.get(`/api/account/teams/${id}`);
  if (!r.ok()) return { status: r.status() };
  const t = (await r.json()) as { rev: number; data: TeamData };
  return { rev: t.rev, plays: t.data.plays.map((p) => `${p.id}:${p.name}`), playbooks: t.data.playbooks.map((b) => ({ id: b.id, name: b.name, plays: b.plays, primary: b.primary ?? null })) };
}

async function read(page: Page, step: string, teams: Record<string, string>, toast?: string): Promise<void> {
  const views: Record<string, unknown> = {};
  for (const [name, id] of Object.entries(teams)) views[name] = await teamView(page.context(), id);
  steps.push({
    step,
    ...(toast !== undefined ? { toast } : {}),
    device: { plays: Object.values(await storedPlays(page)).map((p) => p.name), books: Object.values(await storedPlaybooks(page)).map((b) => b.name) },
    teams: views,
    marker: await marker(page),
  });
}

function save(name: string): void {
  writeFileSync(`test-results/send-to-team-${name}.json`, `${JSON.stringify({ steps: steps.splice(0) }, null, 2)}\n`);
}

/** Writes to the account API as the app does: same origin, JSON. */
const origin = (page: Page): Record<string, string> => ({ origin: new URL(page.url()).origin, "content-type": "application/json" });

/** A second team of the account, made as the panel would make it, or with the data given. */
async function otherTeam(page: Page, body: { name: string; color: string } | { data: TeamData }): Promise<string> {
  const r = await page.context().request.post("/api/account/teams", { headers: origin(page), data: body });
  expect(r.status()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}

const moreFor = (page: Page, name: string): Locator => page.getByRole("button", { name: `More actions for ${name}` });
const sendItem = (page: Page): Locator => page.getByRole("button", { name: "Send to another team…" });
const dialog = (page: Page, title: string): Locator => page.getByRole("dialog", { name: `Send “${title}” to another team` });
const toast = (page: Page): Locator => page.locator("[role='status'].fixed");

/** Sends a book or play to the team named, from its ⋯ menu, and returns what the toast said. */
async function send(page: Page, title: string, team: string): Promise<string> {
  await moreFor(page, title).click();
  await sendItem(page).click();
  await dialog(page, title).getByRole("group", { name: "Send to" }).getByRole("button", { name: team }).click();
  await expect(dialog(page, title)).toBeHidden();
  await expect(toast(page)).toContainText(title);
  return (await toast(page).innerText()).trim();
}

test("a playbook and a play go to another team, whole, and nothing here changes", async ({ page }, testInfo) => {
  const run = runId();
  const week = playbook("fx-week", "Otter Week", [SLANT_LEFT, WHEEL_RIGHT], WHEEL_RIGHT);
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT, COVER_TWO], playbooks: [week], team: OTTERS });

  // signed out there is nowhere to send to, and the menu says nothing about it
  await page.goto("/playbooks");
  await moreFor(page, week.name).click();
  await expect(page.getByRole("button", { name: "Export playbook file" })).toBeVisible();
  await expect(sendItem(page)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // signed in with one team: the same
  await signIn(page, "Coach Otter", run);
  const d = new Designer(page);
  await d.tools();
  await expectSaved(page);
  const view = await accountView(page.context());
  if (!("teams" in view)) throw new Error("not signed in");
  const otters = view.teams[0]?.id ?? "";
  await page.goto("/playbooks");
  await moreFor(page, week.name).click();
  await expect(page.getByRole("button", { name: "Export playbook file" })).toBeVisible();
  await expect(sendItem(page)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // a second team, and the row appears
  const herons = await otherTeam(page, { name: "Harbor Herons", color: "#8338ec" });
  await page.reload();
  await read(page, "two teams, before any send", { otters, herons });
  await moreFor(page, week.name).click();
  await sendItem(page).click();
  const modal = dialog(page, week.name);
  await expect(modal).toContainText("Copies the playbook and its 2 plays");
  await expect(modal.getByRole("group", { name: "Send to" }).getByRole("button")).toHaveCount(1);
  await expect(modal.getByRole("button", { name: /Harbor Herons/ })).toContainText("0 plays · 0 playbooks");
  await modal.screenshot({ path: `test-results/send-to-team-${testInfo.project.name}-dialog.png` });
  await modal.getByRole("button", { name: /Harbor Herons/ }).click();
  await expect(modal).toBeHidden();
  await expect(toast(page)).toHaveText("Sent “Otter Week” to Harbor Herons · 2 plays added");
  await page.screenshot({ path: `test-results/send-to-team-${testInfo.project.name}-sent.png` });

  // the Herons have the book with its plays, order and primary; the Otters and this device are as they were
  const sent = await teamRecord(page.context(), herons);
  expect(sent.rev).toBe(2);
  expect(sent.data.plays.map((p) => [p.id, p.name, p.notes])).toEqual([[SLANT_LEFT.id, SLANT_LEFT.name, SLANT_LEFT.notes], [WHEEL_RIGHT.id, WHEEL_RIGHT.name, ""]]);
  expect(sent.data.playbooks).toEqual([{ id: week.id, name: week.name, plays: [SLANT_LEFT.id, WHEEL_RIGHT.id], primary: WHEEL_RIGHT.id }]);
  expect(sent.data.team.name).toBe("Harbor Herons");
  const home = await teamRecord(page.context(), otters);
  expect(home.rev).toBe(1);
  expect(home.data.plays).toHaveLength(3);
  expect(Object.keys(await storedPlays(page)).sort()).toEqual([COVER_TWO.id, SLANT_LEFT.id, WHEEL_RIGHT.id]);
  expect(Object.keys(await storedPlaybooks(page))).toEqual([week.id]);
  expect(await marker(page)).toMatchObject({ teamId: otters, rev: 1, dirty: false });
  await read(page, "the playbook sent", { otters, herons }, "Sent “Otter Week” to Harbor Herons · 2 plays added");

  // sent again, it is already there and nothing is written
  expect(await send(page, week.name, /Harbor Herons/.source)).toBe("“Otter Week” is already in Harbor Herons");
  expect((await teamRecord(page.context(), herons)).rev).toBe(2);
  await read(page, "the playbook sent again", { otters, herons }, "“Otter Week” is already in Harbor Herons");

  // a lone play goes too, and one the team has already is left as it is
  await moreFor(page, COVER_TWO.name).click();
  await sendItem(page).click();
  await expect(dialog(page, COVER_TWO.name)).toContainText("Copies the play");
  await expect(dialog(page, COVER_TWO.name).getByRole("button", { name: /Harbor Herons/ })).toContainText("2 plays · 1 playbook");
  await dialog(page, COVER_TWO.name).getByRole("button", { name: /Harbor Herons/ }).click();
  await expect(toast(page)).toHaveText("Sent “Otter Cover Two” to Harbor Herons · 1 play added");
  expect((await teamRecord(page.context(), herons)).data.plays.map((p) => p.name)).toEqual([SLANT_LEFT.name, WHEEL_RIGHT.name, COVER_TWO.name]);
  expect((await teamRecord(page.context(), herons)).data.playbooks).toHaveLength(1);
  expect(await send(page, SLANT_LEFT.name, /Harbor Herons/.source)).toBe("“Otter Slant Left” is already in Harbor Herons");
  expect((await teamRecord(page.context(), herons)).rev).toBe(3);
  await read(page, "a play sent, and one already there", { otters, herons });

  // the Herons, opened, show what arrived
  await d.goto();
  await d.tools();
  await teamButton(page).click();
  await reloadedBy(page, () => page.getByRole("menu", { name: "Teams" }).getByRole("menuitemradio", { name: /Harbor Herons/ }).click());
  await d.tools();
  await expect(teamButton(page)).toContainText("Harbor Herons");
  await expectSaved(page);
  await page.goto("/playbooks");
  await expect(page.getByText("Otter Week", { exact: true })).toBeVisible();
  await expect(page.getByText("3 plays", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Open" }).first().click();
  await expect(page.getByRole("textbox", { name: "Playbook name" })).toHaveValue("Otter Week");
  await expect(page.getByText(SLANT_LEFT.name, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(WHEEL_RIGHT.name, { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `test-results/send-to-team-${testInfo.project.name}-arrived.png`, fullPage: true });
  await read(page, "the Herons opened: the book and its plays are here", { otters, herons });
  save(`${testInfo.project.name}-a-playbook-and-a-play`);
});

test("a differing play comes in as a copy, a team changed under the send still gets it, and a team gone says so", async ({ page }, testInfo) => {
  const run = runId();
  await seed(page, { plays: [SLANT_LEFT, WHEEL_RIGHT], team: OTTERS });
  await signIn(page, "Coach Otter", run);
  const d = new Designer(page);
  await d.tools();
  await expectSaved(page);
  const view = await accountView(page.context());
  if (!("teams" in view)) throw new Error("not signed in");
  const otters = view.teams[0]?.id ?? "";
  // the Herons hold their own Slant Left under the same id
  const heronSlant = { ...SLANT_LEFT, notes: "Heron version: X sits down." };
  const herons = await otherTeam(page, { data: { plays: [heronSlant], playbooks: [], team: { name: "Harbor Herons", color: "#8338ec" }, lineups: defaultLineups(), ...EMPTY_DESK } });
  await page.goto("/playbooks");
  await read(page, "the Herons with their own Slant Left", { otters, herons });

  // S2: the Otters' version comes in as a copy; the Herons' stands
  expect(await send(page, SLANT_LEFT.name, /Harbor Herons/.source)).toBe("Sent “Otter Slant Left” to Harbor Herons · 1 play copied");
  const copied = await teamRecord(page.context(), herons);
  expect(copied.rev).toBe(2);
  expect(copied.data.plays.map((p) => [p.id === SLANT_LEFT.id ? "same id" : "new id", p.name, p.notes])).toEqual([["same id", SLANT_LEFT.name, heronSlant.notes], ["new id", SLANT_LEFT.name, SLANT_LEFT.notes]]);
  await read(page, "a differing play: a copy under a new id", { otters, herons }, "Sent “Otter Slant Left” to Harbor Herons · 1 play copied");

  // S3: a Herons device writes between this page's read and its write; the write is refused, planned again, and both land
  let puts = 0;
  await page.route(`**/api/account/teams/${herons}`, async (route) => {
    if (route.request().method() !== "PUT") { await route.continue(); return; }
    puts++;
    if (puts === 1) {
      const current = await teamRecord(page.context(), herons);
      const sweep = { ...COVER_TWO, id: "fx-heron-sweep", name: "Heron Sweep" };
      const r = await page.context().request.put(`/api/account/teams/${herons}`, { headers: origin(page), data: { data: { ...current.data, plays: [...current.data.plays, sweep] }, rev: current.rev } });
      expect(r.ok()).toBe(true);
    }
    await route.continue();
  });
  expect(await send(page, WHEEL_RIGHT.name, /Harbor Herons/.source)).toBe("Sent “Otter Wheel Right” to Harbor Herons · 1 play added");
  await page.unroute(`**/api/account/teams/${herons}`);
  expect(puts).toBe(2);
  const merged = await teamRecord(page.context(), herons);
  expect(merged.rev).toBe(4);
  expect(merged.data.plays.map((p) => p.name)).toEqual([SLANT_LEFT.name, SLANT_LEFT.name, "Heron Sweep", WHEEL_RIGHT.name]);
  expect((await teamRecord(page.context(), otters)).rev).toBe(1);
  await read(page, "written elsewhere meanwhile: refused once, then both plays there", { otters, herons }, "Sent “Otter Wheel Right” to Harbor Herons · 1 play added");

  // S4: the Herons are deleted while the dialog is open
  await moreFor(page, WHEEL_RIGHT.name).click();
  await sendItem(page).click();
  const modal = dialog(page, WHEEL_RIGHT.name);
  await expect(modal.getByRole("button", { name: /Harbor Herons/ })).toBeVisible();
  expect((await page.context().request.delete(`/api/account/teams/${herons}`, { headers: origin(page) })).status()).toBe(204);
  await modal.getByRole("button", { name: /Harbor Herons/ }).click();
  await expect(modal.getByRole("alert")).toHaveText("Harbor Herons isn't in your account any more.");
  await expect(modal.getByRole("button", { name: /Harbor Herons/ })).toHaveCount(0);
  await expect(modal).toContainText("No other team to send to");
  await modal.screenshot({ path: `test-results/send-to-team-${testInfo.project.name}-gone.png` });
  await modal.getByRole("button", { name: "Cancel" }).click();
  await expect(modal).toBeHidden();
  await moreFor(page, WHEEL_RIGHT.name).click();
  await expect(sendItem(page)).toHaveCount(0);
  await page.keyboard.press("Escape");
  expect(Object.keys(await storedPlays(page)).sort()).toEqual([SLANT_LEFT.id, WHEEL_RIGHT.id]);
  expect(await marker(page)).toMatchObject({ teamId: otters, rev: 1, dirty: false });
  await read(page, "the Herons gone: said so, off the list, nothing here changed", { otters, herons });
  save(`${testInfo.project.name}-a-differing-play`);
});

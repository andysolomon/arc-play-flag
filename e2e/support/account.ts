import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { Designer } from "./designer";
import { MARKER_KEY, type Marker } from "../../lib/account/sync";
import type { AccountResponse, TeamRecord } from "../../lib/account/types";

/**
 * The account as a coach drives it (docs/adr/010-coach-accounts.md): the fixture coaches' sign-in
 * page, the account panel in Play tools, and what the account API says. A run id keeps each test's
 * account apart from every other's, in the disposable Redis behind the test adapter.
 */
export const runId = (): string => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The account panel: in Play tools on the designer, in the settings dialog on the playbooks screen; `openPanel` gets it on screen. */
export const panel = (page: Page): Locator => page.locator("[data-account-mode]");
export const status = (page: Page): Locator => panel(page).getByRole("status", { name: "Account status" });
export const teamButton = (page: Page): Locator => panel(page).getByRole("button", { name: "Switch team" });

/** Opens Play tools on the designer, or the settings dialog on the playbooks screen, so the panel can be read. */
export async function openPanel(page: Page): Promise<void> {
  if (await page.getByRole("button", { name: "Play tools" }).count()) { await new Designer(page).tools(); return; }
  if (!(await panel(page).count())) await page.getByRole("button", { name: /account, team, theme & backup settings/ }).click();
  await expect(panel(page)).toBeVisible();
}

/**
 * Runs an action that ends in a full page load (a sign-in, a switch of team, a sign-out: ADR 010, A17)
 * and returns once the new document is there, so nothing is read off the old one.
 */
export async function reloadedBy(page: Page, action: () => Promise<void>): Promise<void> {
  await page.evaluate(() => { (window as unknown as { __ffpdOldDocument?: true }).__ffpdOldDocument = true; });
  await action();
  await page.waitForFunction(() => !("__ffpdOldDocument" in window));
  await expect(page.locator("[aria-label='Play diagram']")).toBeVisible();
}

/** Signs in as a fixture coach from the sign-in page, as a coach would: a tap, then the designer. */
export async function signIn(page: Page, coach: "Coach Otter" | "Coach Heron", run: string): Promise<void> {
  await page.goto(`/sign-in?run=${run}`);
  await reloadedBy(page, () => page.getByRole("button", { name: `Continue as ${coach}` }).click());
}

/** Waits until the panel says the account has the device's latest. */
export async function expectSaved(page: Page): Promise<void> {
  await expect(status(page)).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
}

export async function marker(page: Page): Promise<Marker | null> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as Marker | null, MARKER_KEY);
}

/** What the account API says for this context's session. */
export async function accountView(context: BrowserContext): Promise<AccountResponse> {
  const r = await context.request.get("/api/account");
  return r.json() as Promise<AccountResponse>;
}

export async function teamRecord(context: BrowserContext, id: string): Promise<TeamRecord> {
  const r = await context.request.get(`/api/account/teams/${id}`);
  expect(r.ok()).toBe(true);
  return r.json() as Promise<TeamRecord>;
}

/** The names of the plays the account holds for a team, in the order it stores them. */
export async function teamPlayNames(context: BrowserContext, id: string): Promise<string[]> {
  return (await teamRecord(context, id)).data.plays.map((p) => p.name);
}

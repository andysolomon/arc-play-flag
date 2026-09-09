import type { Page } from "@playwright/test";
import { FILE_KIND, FILE_VERSION } from "../../lib/export/playbook-file";
import { defaults } from "../../lib/play/routes";
import { DRAFT_KEY, PLAYBOOKS_KEY, PLAYS_KEY, TEAM_KEY, type DraftRecord } from "../../lib/play/storage";
import type { Playbook, Player, Route, SavedPlay, TeamSettings } from "../../lib/play/types";

/**
 * Fictional fixtures for the Riverside Otters, a team that does not exist. Every test
 * builds what it needs from these; nothing here comes from a real coach's browser.
 */
export const OTTERS: TeamSettings = { name: "Riverside Otters", color: "#2a9d8f" };

/** The default formation with routes on the named players. */
export function formation(routes: Record<string, Route> = {}): Player[] {
  return defaults().map((p) => ({ ...p, route: routes[p.id] ?? null }));
}

export function play(id: string, name: string, routes: Record<string, Route> = {}, notes = ""): SavedPlay {
  return { id, name, notes, players: formation(routes) };
}

export const SLANT_LEFT = play("fx-slant-left", "Otter Slant Left", { o3: { type: "slant" }, o4: { type: "out" } }, "X wins inside.");
export const WHEEL_RIGHT = play("fx-wheel-right", "Otter Wheel Right", { o5: { type: "wheel", primary: true }, o4: { type: "corner" } });
export const COVER_TWO = play("fx-cover-two", "Otter Cover Two", {
  o3: { type: "go", primary: true },
  o4: { type: "post" },
  d1: { type: "zoneDeep" },
  d4: { type: "zoneDeep" },
  d2: { type: "man", target: "o3" },
  d3: { type: "blitz" },
});

export function playbook(id: string, name: string, plays: readonly SavedPlay[]): Playbook {
  return { id, name, plays: plays.map((p) => p.id) };
}

export interface Seed {
  plays?: readonly SavedPlay[];
  playbooks?: readonly Playbook[];
  team?: TeamSettings;
  draft?: DraftRecord;
}

/**
 * Writes fixtures into this context's own localStorage before the screen under test
 * loads. The page is loaded once to get an origin to write against; the app reads
 * storage again on the next navigation.
 */
export async function seed(page: Page, data: Seed): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([keys, d]) => {
      const byId = <T extends { id: string }>(xs: readonly T[] | undefined): Record<string, T> | null =>
        xs ? Object.fromEntries(xs.map((x) => [x.id, x])) : null;
      const plays = byId(d.plays);
      const books = byId(d.playbooks);
      if (plays) localStorage.setItem(keys.plays, JSON.stringify(plays));
      if (books) localStorage.setItem(keys.books, JSON.stringify(books));
      if (d.team) localStorage.setItem(keys.team, JSON.stringify(d.team));
      if (d.draft) localStorage.setItem(keys.draft, JSON.stringify(d.draft));
    },
    [{ plays: PLAYS_KEY, books: PLAYBOOKS_KEY, team: TEAM_KEY, draft: DRAFT_KEY }, data] as const,
  );
}

/** The library as the app stored it, for asserting what a journey durably wrote. */
export async function storedPlays(page: Page): Promise<Record<string, SavedPlay>> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}") as Record<string, SavedPlay>, PLAYS_KEY);
}

export async function storedPlaybooks(page: Page): Promise<Record<string, Playbook>> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "{}") as Record<string, Playbook>, PLAYBOOKS_KEY);
}

export async function storedDraft(page: Page): Promise<DraftRecord | null> {
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? "null") as DraftRecord | null, DRAFT_KEY);
}

/** The raw text of every app key, to prove a refused import changed nothing. */
export async function storageSnapshot(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate(
    (keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])),
    [PLAYS_KEY, PLAYBOOKS_KEY, TEAM_KEY, DRAFT_KEY],
  );
}

/** A playbook file exactly as the app writes one (see lib/export/playbook-file.ts). */
export function playbookFile(book: Playbook, plays: readonly SavedPlay[], team: TeamSettings | null = null): string {
  return JSON.stringify({ kind: FILE_KIND, version: FILE_VERSION, exported: "2026-09-01T12:00:00.000Z", playbook: book, plays, team }, null, 2);
}

/** A file Playwright can hand to an <input type="file">. */
export function jsonUpload(name: string, text: string): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: "application/json", buffer: Buffer.from(text, "utf8") };
}

/** Local storage keys the app uses, for tests that break a write on purpose. */
export const KEYS = { plays: PLAYS_KEY, books: PLAYBOOKS_KEY, team: TEAM_KEY, draft: DRAFT_KEY } as const;

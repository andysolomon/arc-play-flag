import type { Page } from "@playwright/test";
import { FILE_KIND, FILE_VERSION } from "../../lib/export/playbook-file";
import { defaults } from "../../lib/play/routes";
import { DRAFT_KEY, PLAYBOOKS_KEY, PLAYS_KEY, TEAM_KEY, type DraftRecord } from "../../lib/play/storage";
import type { Playbook, Player, Route, SavedPlay, Team, TeamSettings } from "../../lib/play/types";

/**
 * Fictional fixtures for the Riverside Otters, a team that does not exist. Every test
 * builds what it needs from these; nothing here comes from a real coach's browser.
 */
export const OTTERS: TeamSettings = { name: "Riverside Otters", color: "#2a9d8f" };

/** The default formation with routes on the named players. */
export function formation(routes: Record<string, Route> = {}): Player[] {
  return defaults().map((p) => ({ ...p, route: routes[p.id] ?? null }));
}

export function play(id: string, name: string, routes: Record<string, Route> = {}, notes = "", side: Team = "offense"): SavedPlay {
  return { id, name, notes, side, players: formation(routes) };
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

// the slides journey's book: every call type, both sides, idle and unlabelled players, a deleted man target (loading
// drops that route, so the defender has no assignment), an empty side
export const HOOK_LADDER = play("fx-hook-ladder", 'Otter "Hook" & <Ladder>', { o3: { type: "go" }, o4: { type: "post" }, o5: { type: "handoff", primary: true } }, 'Z takes it & runs <behind> the C.\n\nShout "hut" on two.');
export const COVER_TWO_D = play("fx-cover-two-d", "Otter Cover Two D", { d1: { type: "zoneDeep" }, d4: { type: "zoneDeep" }, d2: { type: "man", target: "o3" }, d3: { type: "man", target: "fx-gone" } }, "Deep halves.\nNobody gets behind you.", "defense");
export const FAKE_DIVE = play("fx-fake-dive", "Otter Fake Dive", { o5: { type: "dive" }, o3: { type: "post", primary: true }, o4: { type: "curl" } });
export const PITCH_OPTION: SavedPlay = (() => {
  const p = play("fx-pitch-option", "Otter Pitch Option", { o5: { type: "pitch" }, o4: { type: "corner" }, o3: { type: "custom", pts: [[3, -6], [8, -10]] } });
  return { ...p, players: p.players.map((q) => (q.id === "o3" ? { ...q, label: "" } : q)) };
})();
/** Longer than the panel's three reserved lines, so the face cuts it and the notes keep it whole. */
export const WALKTHROUGH_NOTES = "Walk it at half speed, then at full speed. ".repeat(13).trim();
export const WALKTHROUGH: SavedPlay = { ...play("fx-walkthrough", "Otter Walkthrough", {}, WALKTHROUGH_NOTES), players: formation().filter((p) => p.team === "defense") };

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

/**
 * Plants what an imported file could carry, inside the page (a lone surrogate may not survive
 * CDP): \u0001 and a lone high surrogate on the name, \u000B in the notes.
 */
export async function corruptStoredText(page: Page, id: string): Promise<void> {
  await page.evaluate(
    ([key, playId]) => {
      const lib = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, SavedPlay>;
      const p = lib[playId];
      if (!p) throw new Error(`no stored play ${playId}`);
      lib[playId] = { ...p, name: p.name + "\u0001" + String.fromCharCode(0xd83e), notes: p.notes.replace("on two", "\u000Bon two") };
      localStorage.setItem(key, JSON.stringify(lib));
    },
    [PLAYS_KEY, id] as const,
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

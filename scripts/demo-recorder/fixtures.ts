import { FIRST_USE_KEY } from "../../components/FirstUse";
import { encodePlaybookFile } from "../../lib/export/playbook-file";
import { defaults } from "../../lib/play/routes";
import { DRAFT_KEY, PLAYBOOKS_KEY, PLAYS_KEY, TEAM_KEY, type DraftRecord } from "../../lib/play/storage";
import type { Playbook, Player, Route, SavedPlay, TeamSettings } from "../../lib/play/types";
import type { ChapterSlug } from "./options";

/**
 * Stable, wholly fictional Demo data for the Riverside Otters, a team that does not
 * exist. Every chapter starts from these records inside a disposable browser profile;
 * nothing is ever read from a coach's browser.
 */
export const DEMO_TEAM: TeamSettings = { name: "Riverside Otters", color: "#2a9d8f" };

function formation(routes: Readonly<Record<string, Route>> = {}): Player[] {
  return defaults().map((player) => ({ ...player, route: routes[player.id] ?? null }));
}

function play(id: string, name: string, routes: Readonly<Record<string, Route>>, notes = ""): SavedPlay {
  return { id, name, notes, players: formation(routes) };
}

/** The finished slant the library shows; `build-play` draws this play from a blank field. */
export const QUICK_SLANT = play("demo-slant", "Otter Quick Slant", {
  o3: { type: "slant", primary: true },
  o5: { type: "custom", pts: [[19, -1], [13, -6]] },
}, "X wins inside; Z's custom route clears the middle.");

/** Play-action to the wheel: `run-play` runs it, `save-export` saves and shares it. */
export const PLAY_ACTION_WHEEL = play("demo-play-action", "Otter Play-Action Wheel", {
  o3: { type: "go" },
  o4: { type: "corner" },
  o5: { type: "wheel", primary: true },
  o2: { type: "handoff" },
}, "Sell the handoff, then find Z on the wheel.");

/** Offense only; `build-defense` adds the zone, the man coverage and the blitz on camera. */
export const COVER_TWO_PRESSURE = play("demo-defense", "Otter Cover Two Pressure", {
  o3: { type: "go", primary: true },
  o4: { type: "post" },
}, "Fictional install: a deep zone, man on X, and one legal blitzer.");

/** A plain run: Z takes the handoff and carries it. `run-play` runs this before the pass. */
export const INSIDE_HANDOFF = play("demo-handoff", "Otter Inside Handoff", {
  o5: { type: "handoff", primary: true },
}, "Z takes it inside off the centre's hip.");

export const DEMO_PLAYS: readonly SavedPlay[] = [QUICK_SLANT, INSIDE_HANDOFF, PLAY_ACTION_WHEEL, COVER_TWO_PRESSURE];

/** Another coach's book, handed over as a file; `print-playbook` imports it on camera. */
export const RED_ZONE_FADE = play("demo-red-zone", "Otter Red Zone Fade", {
  o4: { type: "corner", primary: true },
}, "Fictional install from a visiting coach.");

export const SHARED_BOOK: Playbook = { id: "demo-shared-book", name: "Otter Red Zone", plays: [RED_ZONE_FADE.id] };

/**
 * The bytes of that handed-over file. Neither the book nor its play is seeded into the
 * library, so the import on camera really does add something the device did not have.
 */
export function sharedBookFile(): string {
  return encodePlaybookFile(SHARED_BOOK, [RED_ZONE_FADE], DEMO_TEAM);
}

/** A saved book on the playbooks home; `playbooks` creates a second one beside it. */
export const DEMO_PLAYBOOK: Playbook = {
  id: "demo-game-plan",
  name: "Otter Game Plan",
  plays: [QUICK_SLANT.id, PLAY_ACTION_WHEEL.id],
};

/** The play a chapter opens with `/?open=<id>`, when it opens one. */
export const CHAPTER_PLAY: Readonly<Partial<Record<ChapterSlug, SavedPlay>>> = {
  "run-play": INSIDE_HANDOFF,
  "build-defense": COVER_TWO_PRESSURE,
  "save-share": PLAY_ACTION_WHEEL,
  "export-play": PLAY_ACTION_WHEEL,
};

/** A blank, unnamed formation: `build-play` names it and draws its routes on camera. */
export const BLANK_DRAFT: DraftRecord = { id: null, name: "", notes: "", players: formation() };

const draftOf = (saved: SavedPlay): DraftRecord => ({ id: saved.id, name: saved.name, notes: saved.notes, players: saved.players });

/** Where `custom-routes` picks up from `build-play`: the slant is drawn, Z is still empty. */
export const SLANT_IN_PROGRESS: DraftRecord = {
  ...draftOf(QUICK_SLANT),
  players: QUICK_SLANT.players.map((player) => (player.id === "o5" ? { ...player, route: null } : player)),
};

/** `playbooks` types the team name on camera, so it starts with the name still empty. */
const CHAPTER_TEAM: Readonly<Partial<Record<ChapterSlug, TeamSettings>>> = {
  playbooks: { name: "", color: DEMO_TEAM.color },
};

/** A chapter that must start mid-edit seeds the draft directly instead of opening a saved play. */
const CHAPTER_DRAFT: Readonly<Partial<Record<ChapterSlug, DraftRecord>>> = {
  "custom-routes": SLANT_IN_PROGRESS,
};

export const STORAGE_KEYS = {
  plays: PLAYS_KEY,
  playbooks: PLAYBOOKS_KEY,
  team: TEAM_KEY,
  draft: DRAFT_KEY,
  firstUse: FIRST_USE_KEY,
} as const;

/** Every localStorage key the disposable profile is seeded with before a chapter starts. */
export function storageFor(slug: ChapterSlug): Readonly<Record<string, string>> {
  const opened = CHAPTER_PLAY[slug];
  const draft = CHAPTER_DRAFT[slug] ?? (opened ? draftOf(opened) : BLANK_DRAFT);
  return {
    [STORAGE_KEYS.plays]: JSON.stringify(Object.fromEntries(DEMO_PLAYS.map((saved) => [saved.id, saved]))),
    [STORAGE_KEYS.playbooks]: JSON.stringify({ [DEMO_PLAYBOOK.id]: DEMO_PLAYBOOK }),
    [STORAGE_KEYS.team]: JSON.stringify(CHAPTER_TEAM[slug] ?? DEMO_TEAM),
    [STORAGE_KEYS.draft]: JSON.stringify(draft),
    // the first-use guide is a separate story; it must never cover a recorded chapter
    [STORAGE_KEYS.firstUse]: "done",
  };
}

import { FIRST_USE_KEY } from "../../components/FirstUse";
import { GOAL_YARD } from "../../lib/play/field";
import { defaults } from "../../lib/play/routes";
import { DRAFT_KEY, LINEUPS_KEY, PLAYBOOKS_KEY, PLAYS_KEY, TEAM_KEY, type DraftRecord } from "../../lib/play/storage";
import type { Lineups, Pair, Playbook, Player, Route, SavedPlay, Team, TeamSettings } from "../../lib/play/types";
import type { ChapterSlug } from "./options";

/**
 * Stable, wholly fictional Demo data for the Riverside Otters, a team that does not
 * exist. Every chapter starts from these records inside a disposable browser profile;
 * nothing is ever read from a coach's browser.
 *
 * Every play here stands in a formation of its own, so the tour reads like a playbook and
 * not like one play edited ten times: Twins, Trips, Pistol, Split backs, Bunch and Stack on
 * offense, Cover 1 on defense. The coordinates are yards: x across the 30-yard field, y from
 * the line of scrimmage (offense positive, defense negative). Tokens touch at 2.2 yards, so
 * no two centres sit closer than 2.9; outside breaks keep their room before the sideline.
 */
export const DEMO_TEAM: TeamSettings = { name: "Riverside Otters", color: "#2a9d8f" };

type Spots = Readonly<Record<string, Pair>>;

/** Where each position stands: offense by id (o1 C, o2 QB, o3 X, o4 Y, o5 Z), defense (d1 LC, d2 LB, d3 R, d4 RC, d5 S). */
export const FORMATIONS = {
  /** X wide left with Z in the slot beside him, Y alone to the right. The hero builds this from the New-play spots with one drag. */
  twinsLeft: { o1: [15, 1], o2: [15, 5], o3: [3, 1], o5: [9, 1.5], o4: [27, 1] },
  /** The quarterback a short gun behind the centre with the back straight behind: the run look. */
  pistol: { o1: [15, 1], o2: [15, 4], o5: [15, 6.9], o3: [5, 1], o4: [25, 1] },
  /** Two backs either side of a shotgun quarterback: play-action, and the halfback pass. */
  gunSplit: { o1: [15, 1], o2: [15, 5], o5: [12, 5], o4: [18, 5], o3: [4, 1] },
  /** Three receivers to the right, nobody left of the centre: the jet sweep's open side. */
  tripsRight: { o1: [15, 1], o2: [15, 5], o5: [21, 2], o3: [24, 1.5], o4: [27, 1] },
  /** The look the defense is drawn against. */
  twinsRight: { o1: [15, 1], o2: [15, 5], o3: [4, 1], o5: [20, 1.5], o4: [26, 1] },
  /** A tight triangle to the right, 3 yards apart, so the releases stay clean. */
  bunchRight: { o1: [15, 1], o2: [15, 5], o3: [21, 1], o5: [23.5, 2.5], o4: [18.5, 2.5] },
  /** The same triangle to the left, for the goal line. */
  bunchLeft: { o1: [15, 1], o2: [15, 5], o3: [9, 1], o5: [6.5, 2.5], o4: [11.5, 2.5] },
  /** X on the line with Z stacked behind him. */
  stackLeft: { o1: [15, 1], o2: [15, 5], o3: [5, 1], o5: [5, 4], o4: [24, 1] },
} as const satisfies Record<string, Spots>;

/** The defense's home spots on an offensive play (the shadow defense), where New play puts them. */
const DEF_HOME: Spots = { d1: [4, -5], d2: [11, -4], d3: [18, -4], d4: [26, -5], d5: [15, -11] };
/** Cover 1: corners over the receivers, the linebacker out on the slot, the safety deep and one rusher at the legal 7 yards. */
const COVER_ONE: Spots = { d1: [4, -5], d2: [19, -4], d3: [9, -7], d4: [26, -5], d5: [15, -10] };

function lineup(offense: Spots, routes: Readonly<Record<string, Route>> = {}, defense: Spots = DEF_HOME): Player[] {
  return defaults().map((player) => {
    const at = (player.team === "offense" ? offense : defense)[player.id] ?? [player.x, player.y];
    return { ...player, x: at[0], y: at[1], route: routes[player.id] ?? null };
  });
}

interface PlayOptions {
  notes?: string;
  side?: Team;
  los?: number;
  /** the other team drawn, faded, in the play's pictures */
  artShadow?: true;
  defense?: Spots;
}

function play(id: string, name: string, offense: Spots, routes: Readonly<Record<string, Route>>, o: PlayOptions = {}): SavedPlay {
  return {
    id, name, notes: o.notes ?? "", side: o.side ?? "offense", players: lineup(offense, routes, o.defense),
    ...(o.los === undefined ? {} : { los: o.los }),
    ...(o.artShadow ? { artShadow: true as const } : {}),
  };
}

/** The hero's play, as it is once drawn: X's slant is the read, Z climbs the seam beside him. */
export const TWINS_SLANT = play("demo-twins-slant", "Otter Twins Slant", FORMATIONS.twinsLeft, {
  o3: { type: "slant", primary: true },
  o5: { type: "go" },
}, { notes: "X wins inside off Z's seam." });

/** A plain run: Z takes it off the quarterback's hip while X and Y clear the corners. */
export const PISTOL_DIVE = play("demo-pistol-dive", "Otter Pistol Dive", FORMATIONS.pistol, {
  o5: { type: "dive", primary: true },
  o3: { type: "go" },
  o4: { type: "go" },
}, { notes: "Z takes it off the right hip. X and Y run their corners off." });

/** Z is already crossing when the ball is snapped and takes the handoff in stride, to the open left side. */
export const JET_SWEEP = play("demo-jet-sweep", "Otter Jet Sweep", FORMATIONS.tripsRight, {
  o5: { type: "jet", primary: true },
  o3: { type: "go" },
  o4: { type: "go" },
}, { notes: "Z crosses at full speed; the handoff lands behind the line. Nobody lines up to the left." });

/** The same look, the jet faked: X's post comes open behind it. Drawn against a faded Cover 1. */
export const JET_FAKE_POST = play("demo-jet-fake", "Otter Jet Fake Post", FORMATIONS.tripsRight, {
  o5: { type: "jet" },
  o3: { type: "post", primary: true },
  o4: { type: "go" },
  d5: { type: "zoneDeep" },
  d1: { type: "zoneFlat" },
  d4: { type: "man", target: "o4" },
  d2: { type: "man", target: "o5" },
  d3: { type: "blitz" },
}, { notes: "Sell the jet, then X breaks to the post behind the safety.", artShadow: true, defense: COVER_ONE });

/** The defensive call, complete: man across, the safety free in the middle, one rusher from 7 yards. */
export const COVER_ONE_RUSH = play("demo-cover-one", "Otter Cover 1 Rush", FORMATIONS.twinsRight, {
  o3: { type: "go", primary: true },
  o5: { type: "slant" },
  o4: { type: "curl" },
  d1: { type: "man", target: "o3" },
  d2: { type: "man", target: "o5" },
  d4: { type: "man", target: "o4" },
  d5: { type: "zoneDeep" },
  d3: { type: "blitz" },
}, { notes: "Man across, the safety free in the middle, one rusher from 7 yards.", side: "defense", defense: COVER_ONE });

/** A bunch to the right: X's corner is the read, Z slants under it, Y runs the flat. The roster chapter's play. */
export const BUNCH_CORNER = play("demo-bunch-corner", "Otter Bunch Corner", FORMATIONS.bunchRight, {
  o3: { type: "corner", primary: true },
  o5: { type: "slant" },
  o4: { type: "flat" },
}, { notes: "Release clean, no picks. X to the corner, Z under, Y to the flat." });

/** Goal to go from their 10: X's post finishes in the end zone, so the touchdown chapter scores with it. */
export const GOAL_TO_GO_POST = play("demo-goal-to-go", "Otter Bunch Post", FORMATIONS.bunchLeft, {
  o3: { type: "post", primary: true },
  o5: { type: "corner" },
  o4: { type: "flat" },
  o1: { type: "curl" },
}, { notes: "X splits the safeties. Z corner, Y flat, C curls as the check-down.", los: GOAL_YARD - 10 });

/** Play-action from split backs: Z sells the dive, Y wheels up the sideline, X curls backside. */
export const SPLIT_WHEEL = play("demo-split-wheel", "Otter Play-Action Wheel", FORMATIONS.gunSplit, {
  o5: { type: "dive" },
  o4: { type: "wheel", primary: true },
  o3: { type: "curl" },
}, { notes: "Sell the dive first, then find Y on the wheel." });

/** The halfback pass: the quarterback laterals to Z, who throws it on to Y in the corner. */
export const HALFBACK_PASS: SavedPlay = (() => {
  const p = play("demo-halfback-pass", "Otter Halfback Pass", FORMATIONS.gunSplit, {
    o5: { type: "throw" },
    o4: { type: "corner", primary: true },
    o3: { type: "go" },
  }, { notes: "QB tosses back to Z, who sets up and throws to Y. A lateral never goes forward." });
  return { ...p, players: p.players.map((q) => (q.id === "o2" ? { ...q, laterals: [{ to: "o5" }] } : q)) };
})();

/** A fade from the stack at their 5: the ball is in the no-run zone, but this is a pass. */
export const STACK_FADE = play("demo-stack-fade", "Otter Stack Fade", FORMATIONS.stackLeft, {
  o3: { type: "go", primary: true },
  o5: { type: "slant" },
  o4: { type: "in" },
}, { notes: "X fades to the back pylon; Z slants under him off the stack.", los: GOAL_YARD - 5 });

export const DEMO_PLAYS: readonly SavedPlay[] = [
  TWINS_SLANT, PISTOL_DIVE, JET_SWEEP, JET_FAKE_POST, COVER_ONE_RUSH, BUNCH_CORNER, GOAL_TO_GO_POST, SPLIT_WHEEL, HALFBACK_PASS, STACK_FADE,
];

/** Saturday's book: seven calls in seven looks, so every wristband cell and every slide shows a different play. */
export const DEMO_PLAYBOOK: Playbook = {
  id: "demo-game-plan",
  name: "Otter Game Plan",
  plays: [PISTOL_DIVE.id, JET_SWEEP.id, JET_FAKE_POST.id, BUNCH_CORNER.id, GOAL_TO_GO_POST.id, SPLIT_WHEEL.id, STACK_FADE.id],
};

/**
 * The team: twelve fictional players with a depth chart at every position of the standard formation, two
 * deep, so the Secondary Lineup the app makes from it starts a different player at every position.
 */
export const DEMO_LINEUPS: Lineups = {
  active: "main",
  players: ["Maya", "Devon", "Sam", "Jordan", "Theo", "Omar", "Ava", "Priya", "Leo", "Nia", "Kai", "Ellie"],
  lineups: [{
    id: "main",
    name: "Starting Lineup",
    slots: [
      { team: "offense", tag: "C", depth: ["Theo", "Omar"] },
      { team: "offense", tag: "QB", depth: ["Sam", "Jordan"] },
      { team: "offense", tag: "X", depth: ["Maya", "Devon"] },
      { team: "offense", tag: "Y", depth: ["Ava", "Priya"] },
      { team: "offense", tag: "Z", depth: ["Leo", "Nia"] },
      { team: "defense", tag: "LC", depth: ["Devon", "Maya"] },
      { team: "defense", tag: "LB", depth: ["Kai", "Theo"] },
      { team: "defense", tag: "R", depth: ["Jordan", "Leo"] },
      { team: "defense", tag: "RC", depth: ["Priya", "Ava"] },
      { team: "defense", tag: "S", depth: ["Nia", "Ellie"] },
    ],
  }],
};

/** The play a chapter opens with `/?open=<id>`, when it opens one. */
export const CHAPTER_PLAY: Readonly<Partial<Record<ChapterSlug, SavedPlay>>> = {
  roster: BUNCH_CORNER,
  "league-rules": PISTOL_DIVE,
  "run-game": JET_SWEEP,
};

const draftOf = (saved: SavedPlay, id: string | null = saved.id): DraftRecord => ({
  id, name: saved.name, notes: saved.notes, side: saved.side, players: saved.players,
  ...(saved.los === undefined ? {} : { los: saved.los }),
  ...(saved.artShadow ? { artShadow: true as const } : {}),
});

/** The same play with some routes and laterals not drawn yet, for a chapter that draws them on camera. */
function undrawn(saved: SavedPlay, ids: readonly string[], spots: Spots = {}): SavedPlay {
  return {
    ...saved,
    players: saved.players.map((p) => {
      const at = spots[p.id];
      const moved = at ? { ...p, x: at[0], y: at[1] } : p;
      if (!ids.includes(p.id)) return moved;
      const bare: Player = { ...moved, route: null };
      delete bare.laterals;
      return bare;
    }),
  };
}

/** The hero starts on a play already on the board, so New play visibly starts a fresh one. */
export const HERO_START: DraftRecord = draftOf(PISTOL_DIVE);

/** The defense with the safety, the left corner and the rusher still to be given their jobs; the rusher stands too close to the line. */
export const COVER_ONE_IN_PROGRESS: DraftRecord = draftOf(undrawn(COVER_ONE_RUSH, ["d1", "d3", "d5"], { d3: [9, -3] }));

/** The share chapter saves the hero's play for the first time, so it starts unsaved. */
export const TWINS_SLANT_UNSAVED: DraftRecord = draftOf({ ...TWINS_SLANT, notes: "" }, null);

/** The touchdown chapter draws X's route itself. */
export const GOAL_TO_GO_IN_PROGRESS: DraftRecord = draftOf(undrawn(GOAL_TO_GO_POST, ["o3"]));

/** The trick-plays chapter tosses the ball to Z and gives Z the throw on camera. */
export const HALFBACK_PASS_IN_PROGRESS: DraftRecord = draftOf(undrawn(HALFBACK_PASS, ["o2", "o5"]));

/** A chapter that must start mid-edit seeds the draft directly instead of opening a saved play. */
const CHAPTER_DRAFT: Readonly<Partial<Record<ChapterSlug, DraftRecord>>> = {
  "first-play": HERO_START,
  defense: COVER_ONE_IN_PROGRESS,
  share: TWINS_SLANT_UNSAVED,
  touchdown: GOAL_TO_GO_IN_PROGRESS,
  "trick-plays": HALFBACK_PASS_IN_PROGRESS,
};

/** A blank, unnamed formation, for a chapter that opens nothing. */
export const BLANK_DRAFT: DraftRecord = { id: null, name: "", notes: "", players: lineup({}) };

export const STORAGE_KEYS = {
  plays: PLAYS_KEY,
  playbooks: PLAYBOOKS_KEY,
  team: TEAM_KEY,
  lineups: LINEUPS_KEY,
  draft: DRAFT_KEY,
  firstUse: FIRST_USE_KEY,
} as const;

/** Every localStorage key the disposable profile is seeded with before a chapter starts. */
export function storageFor(slug: ChapterSlug): Readonly<Record<string, string>> {
  const opened = CHAPTER_PLAY[slug];
  const draft = CHAPTER_DRAFT[slug] ?? (opened ? draftOf(opened) : BLANK_DRAFT);
  // the share chapter saves the hero's play as new, so the library must not hold it already
  const library = slug === "share" ? DEMO_PLAYS.filter((saved) => saved.id !== TWINS_SLANT.id) : DEMO_PLAYS;
  return {
    [STORAGE_KEYS.plays]: JSON.stringify(Object.fromEntries(library.map((saved) => [saved.id, saved]))),
    [STORAGE_KEYS.playbooks]: JSON.stringify({ [DEMO_PLAYBOOK.id]: DEMO_PLAYBOOK }),
    [STORAGE_KEYS.team]: JSON.stringify(DEMO_TEAM),
    [STORAGE_KEYS.lineups]: JSON.stringify(DEMO_LINEUPS),
    [STORAGE_KEYS.draft]: JSON.stringify(draft),
    // the first-use guide is a separate story; it must never cover a recorded chapter
    [STORAGE_KEYS.firstUse]: "done",
  };
}

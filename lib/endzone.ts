/**
 * The end zone's look, chosen per device, and the touchdowns that unlock the rest. Classic is
 * the green the field has always had; the others paint the band beyond the goal line with a
 * design of their own, after themes from Omarchy's community collection. A few are open from
 * the start and each touchdown pass thrown on ▶ opens the next. Screen only: printed pages,
 * cards and exports keep the classic end zone (lib/render/play-svg.ts never reads this).
 */

/** How a celebration's pieces move: fall from the top, drift sideways, rain straight down, or burst from the end zone. */
export type ConfettiMotion = "fall" | "drift" | "rain" | "burst";
/** What a piece of confetti is: a paper strip, a dot, a petal, a star, a character, a square pixel, or a spark. */
export type ConfettiShape = "strip" | "dot" | "petal" | "star" | "glyph" | "pixel" | "spark";

export interface Confetti {
  /** hex colours, or "team" for the team's own colour */
  readonly colors: readonly string[];
  readonly shapes: readonly ConfettiShape[];
  readonly motion: ConfettiMotion;
  /** the characters a "glyph" piece is drawn from */
  readonly glyphs?: string;
}

/** The TOUCHDOWN! banner: its fill, its lettering and its edge. "team" is the team's colour; "auto" is ink or cream, whichever reads on the fill. */
export interface Banner {
  readonly fill: string;
  readonly ink: string;
  readonly edge: string;
}

export interface EndZone {
  readonly id: string;
  readonly name: string;
  readonly blurb: string;
  /** touchdowns this device must have thrown before the end zone can be picked; 0 is open from the start */
  readonly unlock: number;
  readonly confetti: Confetti;
  readonly banner: Banner;
}

/** In unlock order. Keep in step with components/endzone/art (one design per id) and the end zone block in app/globals.css. */
export const END_ZONES = [
  {
    id: "classic", name: "Classic", blurb: "Painted turf, the green the field has always had", unlock: 0,
    confetti: { colors: ["#f2b705", "#e5675e", "#4a8fe0", "#fffdf6", "#2e9e5b"], shapes: ["strip", "dot"], motion: "fall" },
    banner: { fill: "#f2b705", ink: "#1b1a17", edge: "#1b1a17" },
  },
  {
    id: "home", name: "Home Team", blurb: "Your team's colour in bold stripes, its name painted across", unlock: 0,
    confetti: { colors: ["team", "#fffdf6", "#1b1a17", "team"], shapes: ["strip", "dot"], motion: "fall" },
    banner: { fill: "team", ink: "auto", edge: "#1b1a17" },
  },
  {
    id: "synthwave", name: "Synthwave '84", blurb: "A neon sunset over a chrome grid", unlock: 0,
    confetti: { colors: ["#ff2a6d", "#ff8b39", "#fede5d", "#72f1b8", "#36f9f6", "#b967ff"], shapes: ["strip", "star", "spark"], motion: "burst" },
    banner: { fill: "#241b2f", ink: "#fede5d", edge: "#ff2a6d" },
  },
  {
    id: "sakura", name: "Sakura", blurb: "Cherry blossoms drifting over a spring pitch", unlock: 1,
    confetti: { colors: ["#ffb7c5", "#ff8fab", "#fde2e4", "#ffffff", "#f06292"], shapes: ["petal"], motion: "drift" },
    banner: { fill: "#fff0f3", ink: "#7a2e44", edge: "#f06292" },
  },
  {
    id: "matrix", name: "Matrix", blurb: "Green code raining down a black end zone", unlock: 2,
    confetti: { colors: ["#00ff41", "#008f11", "#39ff14", "#b6ffb0"], shapes: ["glyph"], motion: "rain", glyphs: "0123456789ABCDEF<>/*+=" },
    banner: { fill: "#0d0208", ink: "#00ff41", edge: "#00ff41" },
  },
  {
    id: "great-wave", name: "Great Wave", blurb: "Hokusai's wave rolling across an indigo end zone", unlock: 3,
    confetti: { colors: ["#1f3a60", "#3f6fb5", "#f4ecd8", "#8fb3d9", "#ffffff"], shapes: ["dot", "spark"], motion: "burst" },
    banner: { fill: "#f4ecd8", ink: "#1f3a60", edge: "#1f3a60" },
  },
  {
    id: "eight-bit", name: "8-Bit", blurb: "Pixel bricks, spinning coins and a blinking 1UP", unlock: 4,
    confetti: { colors: ["#e40058", "#fca044", "#f8d878", "#5c94fc", "#fcfcfc", "#00a800"], shapes: ["pixel"], motion: "fall" },
    banner: { fill: "#000000", ink: "#fcfcfc", edge: "#e40058" },
  },
  {
    id: "event-horizon", name: "Event Horizon", blurb: "Stars bending round a glowing black hole", unlock: 5,
    confetti: { colors: ["#ffd27f", "#ff9e4a", "#ffffff", "#9d7bff", "#5ad1ff"], shapes: ["star", "spark", "dot"], motion: "burst" },
    banner: { fill: "#0b0a1a", ink: "#ffd27f", edge: "#9d7bff" },
  },
] as const satisfies readonly EndZone[];

export type EndZoneId = (typeof END_ZONES)[number]["id"];
export const DEFAULT_END_ZONE: EndZoneId = "classic";

export const ENDZONE_KEY = "ffpd.endzone.v1";
export const TOUCHDOWNS_KEY = "ffpd.touchdowns.v1";

export const endZoneById = (id: EndZoneId): EndZone => END_ZONES.find((z) => z.id === id) ?? END_ZONES[0];

/** An end zone this app draws, or classic for anything else (a junk value, one a later release dropped). */
export const parseEndZone = (raw: unknown): EndZoneId =>
  END_ZONES.find((z) => z.id === raw)?.id ?? DEFAULT_END_ZONE;

/** A whole number of touchdowns, or 0 for anything that isn't one. */
export const parseTouchdowns = (raw: unknown): number => {
  const n = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : 0;
  return Number.isSafeInteger(n) ? n : 0;
};

export const isUnlocked = (zone: EndZone, touchdowns: number): boolean => touchdowns >= zone.unlock;

/** The next end zone a touchdown opens, or null once every one is open. */
export const nextLocked = (touchdowns: number): EndZone | null => END_ZONES.find((z) => !isUnlocked(z, touchdowns)) ?? null;

// storage can be blocked (private mode, site data off); a choice or a touchdown then lasts until the page closes
let unsavedZone: EndZoneId | null = null;
let unsavedTouchdowns: number | null = null;
const zoneListeners = new Set<() => void>();
const touchdownListeners = new Set<() => void>();

export function getEndZone(): EndZoneId {
  if (unsavedZone) return unsavedZone;
  try { return parseEndZone(localStorage.getItem(ENDZONE_KEY)); } catch { return DEFAULT_END_ZONE; }
}

/** Keeps the choice on this device; classic forgets it. */
export function setEndZone(id: EndZoneId): void {
  try {
    if (id === DEFAULT_END_ZONE) localStorage.removeItem(ENDZONE_KEY);
    else localStorage.setItem(ENDZONE_KEY, id);
    unsavedZone = null;
  } catch {
    unsavedZone = id;
  }
  zoneListeners.forEach((l) => { l(); });
}

export function getTouchdowns(): number {
  if (unsavedTouchdowns !== null) return unsavedTouchdowns;
  try { return parseTouchdowns(localStorage.getItem(TOUCHDOWNS_KEY)); } catch { return 0; }
}

/** Counts a touchdown pass on this device and says which end zone, if any, it just opened. */
export function recordTouchdown(): { touchdowns: number; unlocked: EndZone | null } {
  const before = getTouchdowns();
  const touchdowns = before + 1;
  try {
    localStorage.setItem(TOUCHDOWNS_KEY, String(touchdowns));
    unsavedTouchdowns = null;
  } catch {
    unsavedTouchdowns = touchdowns;
  }
  touchdownListeners.forEach((l) => { l(); });
  const unlocked = END_ZONES.find((z) => !isUnlocked(z, before) && isUnlocked(z, touchdowns)) ?? null;
  return { touchdowns, unlocked };
}

function subscribeTo(listeners: Set<() => void>, key: string, onChange: () => void): () => void {
  const onStorage = (e: StorageEvent): void => { if (e.key === key || e.key === null) onChange(); };
  listeners.add(onChange);
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    removeEventListener("storage", onStorage);
  };
}

/** For useSyncExternalStore: this tab's picks and other tabs'. */
export const subscribeEndZone = (onChange: () => void): (() => void) => subscribeTo(zoneListeners, ENDZONE_KEY, onChange);
export const subscribeTouchdowns = (onChange: () => void): (() => void) => subscribeTo(touchdownListeners, TOUCHDOWNS_KEY, onChange);

// prerendered pages don't know the device's choice; it lands right after hydration
export const serverEndZone = (): EndZoneId => DEFAULT_END_ZONE;
export const serverTouchdowns = (): number => 0;

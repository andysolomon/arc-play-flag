import type { Pair, Player, Route, RouteType, Team } from "./types";

export const PLAYS_KEY = "ffpd.plays.v1";
export const DRAFT_KEY = "ffpd.draft.v1";

export type Library = Record<string, { players: Player[] }>;
export interface DraftRecord {
  name: string;
  players: Player[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const num = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

const ROUTE_TYPES = new Set<string>([
  "go", "out", "in", "slant", "corner", "post", "curl", "flat", "cross", "wheel", "block", "handoff",
  "custom", "man", "zoneDeep", "zoneFlat", "curlFlat", "midRead", "blitz", "spy",
]);

function toPair(v: unknown): Pair | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const x: unknown = v[0], y: unknown = v[1];
  return typeof x === "number" && typeof y === "number" ? [x, y] : null;
}

function normalizeRoute(v: unknown): Route | null {
  if (!isRecord(v) || typeof v.type !== "string" || !ROUTE_TYPES.has(v.type)) return null;
  const r: Route = { type: v.type as RouteType };
  if (Array.isArray(v.pts)) r.pts = v.pts.map(toPair).filter((q): q is Pair => q !== null);
  if (typeof v.target === "string") r.target = v.target;
  if (v.mirror === true) r.mirror = true;
  if (v.primary === true) r.primary = true;
  return r;
}

/**
 * Accepts the prototype's stored shape (and anything older that looks like it) and
 * returns players clamped back onto the field, exactly as the prototype's load does.
 */
export function normalizePlayers(raw: unknown): Player[] {
  if (!Array.isArray(raw)) return [];
  const out: Player[] = [];
  raw.forEach((v: unknown, i) => {
    if (!isRecord(v)) return;
    const team: Team = v.team === "defense" ? "defense" : "offense";
    const x = Math.max(1.2, Math.min(28.8, num(v.x, 15)));
    const y0 = num(v.y, team === "offense" ? 1 : -5);
    const y = team === "offense" ? Math.max(0.9, Math.min(7.4, y0)) : Math.min(-0.9, Math.max(-36, y0));
    out.push({
      id: typeof v.id === "string" ? v.id : `p${String(i)}`,
      team,
      label: typeof v.label === "string" ? v.label.slice(0, 3) : "",
      x, y,
      route: normalizeRoute(v.route),
    });
  });
  return out;
}

export function readAll(storage: StorageLike | null = browserStorage()): Library {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(PLAYS_KEY) ?? "{}");
    if (!isRecord(parsed)) return {};
    const lib: Library = {};
    for (const [name, rec] of Object.entries(parsed)) {
      if (isRecord(rec) && Array.isArray(rec.players)) lib[name] = { players: normalizePlayers(rec.players) };
    }
    return lib;
  } catch {
    return {};
  }
}

export function store(
  name: string,
  players: readonly Player[],
  storage: StorageLike | null = browserStorage(),
): Library {
  const all = readAll(storage);
  all[name] = { players: [...players] };
  try {
    storage?.setItem(PLAYS_KEY, JSON.stringify(all));
  } catch {
    /* quota or private mode: the in-memory library still updates */
  }
  return all;
}

export function readDraft(storage: StorageLike | null = browserStorage()): DraftRecord | null {
  if (!storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(DRAFT_KEY) ?? "null");
    if (!isRecord(parsed) || !Array.isArray(parsed.players)) return null;
    const players = normalizePlayers(parsed.players);
    if (!players.length) return null;
    return { name: typeof parsed.name === "string" ? parsed.name : "New play", players };
  } catch {
    return null;
  }
}

export function writeDraft(
  draft: DraftRecord,
  storage: StorageLike | null = browserStorage(),
): void {
  try {
    storage?.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function kebab(name: string): string {
  const k = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return k || "play";
}

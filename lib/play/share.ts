import { LOS_YARD, losOf, readLos, withLos } from "./field";
import { readBallPlan } from "./ball-plan";
import { artShadow, cleanNotes, normalizePlayers, readSide, type DraftRecord } from "./storage";
import type { BallStep, Player, Team } from "./types";

/** Share links carry the whole play as base64url JSON in the path: /p/<id>. No backend. */

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): string | null {
  try {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Only the fields the designer reads, so the id stays short. */
function compact(p: Player): Player {
  const out: Player = { id: p.id, team: p.team, label: p.label, x: p.x, y: p.y, route: null };
  if (p.route) {
    out.route = { type: p.route.type };
    if (p.route.pts) out.route.pts = p.route.pts;
    if (p.route.target) out.route.target = p.route.target;
    if (p.route.mirror) out.route.mirror = true;
    if (p.route.primary) out.route.primary = true;
  }
  return out;
}

/** A decoded link: the whole play, including the other team kept for the designer. */
export interface SharedRecord extends DraftRecord {
  side: Team;
  /** false when the coach's league plays without no-run zones, so the snapshot matches their field */
  noRunZones: boolean;
}

/**
 * Both teams always travel in the payload. The snapshot view draws this play's side, and
 * the other team faded only when the play includes it in its pictures; "Open in designer"
 * restores the other team as the faded shadow. `side` is written only for a defensive
 * call, so an offensive play's link is unchanged from before plays had a side. No-run
 * zones are written only when they are off, the pictures' choice only when it is on, the
 * ball spot only when it is off the own goal line, and the coaching notes only when there are
 * some, for the same reason. A `vis` field from an older link is ignored: those links still
 * carry every player.
 */
export function encodeShare(rec: DraftRecord, noRunZones = true): string {
  const payload: { name: string; players: Player[]; side?: Team; noRunZones?: false; artShadow?: true; los?: number; notes?: string; ballPlan?: BallStep[] } = {
    name: rec.name, players: rec.players.map(compact),
    ...readBallPlan(rec.ballPlan),
  };
  const notes = cleanNotes(rec.notes);
  if (notes.trim()) payload.notes = notes;
  if (rec.side === "defense") payload.side = "defense";
  if (!noRunZones) payload.noRunZones = false;
  if (rec.artShadow) payload.artShadow = true;
  const los = losOf(rec);
  if (los !== LOS_YARD) payload.los = los;
  return toBase64Url(JSON.stringify(payload));
}

export function decodeShare(id: string): SharedRecord | null {
  if (!id || id.length > 20000) return null;
  const json = fromBase64Url(id);
  if (json === null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null || !("players" in parsed)) return null;
    const players = normalizePlayers(parsed.players);
    if (!players.length) return null;
    const name = "name" in parsed && typeof parsed.name === "string" ? parsed.name.slice(0, 80) : "Shared play";
    // links without a side predate the choice: read the side off the routes, as storage does
    const side = readSide("side" in parsed ? parsed.side : undefined, players);
    const noRunZones = !("noRunZones" in parsed) || parsed.noRunZones !== false;
    // links from before notes travelled carry none
    const notes = cleanNotes("notes" in parsed ? parsed.notes : undefined);
    // links without a spot put the ball where every drive starts, the own goal line
    return withLos(
      { name, ...(notes ? { notes } : {}), players, side, noRunZones, ...artShadow("artShadow" in parsed ? parsed.artShadow : undefined),
        ...readBallPlan("ballPlan" in parsed ? parsed.ballPlan : undefined) },
      readLos("los" in parsed ? parsed.los : undefined),
    );
  } catch {
    return null;
  }
}

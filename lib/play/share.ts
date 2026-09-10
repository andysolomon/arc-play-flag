import { normalizePlayers, type DraftRecord } from "./storage";
import type { Player, Vis } from "./types";

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

/** A decoded link: the whole play plus which side the sender chose to show. */
export interface SharedRecord extends DraftRecord {
  vis: Vis;
}

/**
 * Both teams always travel in the payload so "Open in designer" recovers the full play;
 * `vis` records which side the link shows. "both" is omitted, so links made before the
 * choice existed and both-team links are the same bytes.
 */
export function encodeShare(rec: DraftRecord, vis: Vis = "both"): string {
  const payload: { name: string; players: Player[]; vis?: Vis } = { name: rec.name, players: rec.players.map(compact) };
  if (vis !== "both") payload.vis = vis;
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
    // links without a vis field predate the choice and always meant both teams
    const raw = "vis" in parsed ? parsed.vis : "both";
    const vis: Vis = raw === "offense" || raw === "defense" ? raw : "both";
    return { name, players, vis };
  } catch {
    return null;
  }
}

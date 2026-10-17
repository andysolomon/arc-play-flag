import { createHash } from "node:crypto";
import { command, countHit } from "@/lib/redis/command";
import { PRESENCE_SECONDS, type Presence } from "./types";

/**
 * Who has a team open and which play they are on (docs/adr/013-organizations.md, rule 8), kept in
 * Redis since it expires in seconds: `ffpd:presence:<team>`, a hash coach → Presence. Written by the
 * poll and read back less the caller; a store that is down means nobody is shown, never a failed poll.
 */
const key = (team: string): string => `ffpd:presence:${team}`;

/** Says where the coach is and returns everyone else seen in the last 30 seconds. */
export async function touch(team: string, me: Presence): Promise<Presence[]> {
  try {
    await command("HSET", key(team), me.coach, JSON.stringify(me));
    await command("EXPIRE", key(team), PRESENCE_SECONDS * 4);
    const raw = await command("HGETALL", key(team));
    const others: Presence[] = [];
    const stale: string[] = [];
    const cutoff = Date.now() - PRESENCE_SECONDS * 1000;
    // Upstash answers HGETALL as a flat list; a RESP3 client (the journeys' adapter) as an object
    const pairs: unknown[] = Array.isArray(raw) ? (raw as unknown[]) : typeof raw === "object" && raw !== null ? Object.entries(raw).flat() : [];
    {
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        const coach = pairs[i];
        const value = pairs[i + 1];
        if (typeof coach !== "string" || typeof value !== "string" || coach === me.coach) continue;
        let p: unknown;
        try { p = JSON.parse(value); } catch { stale.push(coach); continue; }
        const at = typeof p === "object" && p !== null && "at" in p && typeof p.at === "string" ? Date.parse(p.at) : NaN;
        if (!Number.isFinite(at) || at < cutoff) { stale.push(coach); continue; }
        const r = p as Presence;
        others.push({ coach, name: typeof r.name === "string" ? r.name : "A coach", play: typeof r.play === "string" ? r.play : null, at: r.at });
      }
    }
    if (stale.length) await command("HDEL", key(team), ...stale);
    return others;
  } catch {
    return [];
  }
}

/** A poll a second per coach per team, averaged over a minute; a store that is down limits nothing. */
export async function pollAllowed(team: string, coach: string): Promise<boolean> {
  const digest = createHash("sha256").update(`poll:${team}:${coach}`).digest("hex");
  try {
    return (await countHit(`ffpd:limit:poll:${digest}`, 60)) <= 90;
  } catch {
    return true;
  }
}

import { createHash } from "node:crypto";
import { RedisError, command as redis, countHit } from "@/lib/redis/command";
import { newId } from "@/lib/play/storage";
import { MAX_TEAMS, completeTeamData, readPrefs, readTouchdowns, summarize, teamName, withRev } from "./data";
import type { AccountPrefs, CoachPrefs, TeamData, TeamRecord, TeamSummary, TeamWritten } from "./types";

/**
 * The accounts' store, server-only (docs/adr/012-coach-accounts.md, docs/adr/013-whole-desk-in-account.md):
 * each account a list of team ids, the team it last opened and the coach's look; each team a hash of
 * its owner, write count, data and the summary the list shows. Every write is one Lua script, so a
 * team is only ever written by its owner, against the rev the device read, and the list, the team and
 * the look change together.
 *
 * Keys: `ffpd:account:<user>:teams` (list), `ffpd:account:<user>:current` (string),
 * `ffpd:account:<user>:prefs` (hash: `rev`, `json`, `touchdowns`), `ffpd:team:<id>` (hash).
 */
export class AccountError extends Error {
  constructor(public status: number, message: string, public record?: TeamRecord) { super(message); }
}

export const UNAVAILABLE = "Your account is temporarily unavailable. Your work stays on this device.";
const UNCONFIGURED = "Accounts aren't set up on this deployment yet.";

async function command(...args: (string | number)[]): Promise<unknown> {
  try {
    return await redis(...args);
  } catch (e) {
    throw new AccountError(503, e instanceof RedisError && e.reason === "unconfigured" ? UNCONFIGURED : UNAVAILABLE);
  }
}

const teamsKey = (user: string): string => `ffpd:account:${user}:teams`;
const currentKey = (user: string): string => `ffpd:account:${user}:current`;
const prefsKey = (user: string): string => `ffpd:account:${user}:prefs`;
const teamKey = (id: string): string => `ffpd:team:${id}`;
export const TEAM_ID = /^[a-z0-9]{1,40}$/;

/** Writes 1,200 and reads 1,200 an hour per account (the board goes up as it changes, A20); the key never carries the user id itself. */
export const WRITES_AN_HOUR = 1_200;
export const READS_AN_HOUR = 1_200;
export async function limit(user: string, write: boolean): Promise<void> {
  const digest = createHash("sha256").update(`account:${user}`).digest("hex");
  const hits = await countHit(`ffpd:limit:account:${write ? "write" : "read"}:${digest}`, 3600).catch((e: unknown) => {
    throw new AccountError(503, e instanceof RedisError && e.reason === "unconfigured" ? UNCONFIGURED : UNAVAILABLE);
  });
  if (hits > (write ? WRITES_AN_HOUR : READS_AN_HOUR)) throw new AccountError(429, "Too many account requests. Try again in a while.");
}

const FIELDS = ["owner", "rev", "updated", "name", "color", "plays", "playbooks"] as const;
type Fields = Record<(typeof FIELDS)[number], string>;

function summaryOf(id: string, f: Fields): TeamSummary {
  return { id, name: f.name, color: f.color, plays: Number(f.plays), playbooks: Number(f.playbooks), updated: f.updated, rev: Number(f.rev) };
}

// ---- the coach's look ----------------------------------------------------------------------------------

/** The look's choices as JSON, the touchdowns apart: the script compares the JSON and takes the higher count. */
function prefsArgs(prefs: CoachPrefs | undefined): [string, number] {
  if (!prefs) return ["", 0];
  const { touchdowns, ...choices } = readPrefs(prefs);
  return [JSON.stringify(choices), touchdowns];
}

/** The look from the hash's fields: rev, json and touchdowns, each possibly missing. */
function prefsOf(values: unknown): AccountPrefs {
  const list: unknown[] = Array.isArray(values) ? (values as unknown[]) : [];
  const [rev, json, touchdowns] = list;
  let choices: unknown = null;
  try { choices = typeof json === "string" ? JSON.parse(json) : null; } catch { choices = null; }
  return withRev({ ...readPrefs(choices), touchdowns: readTouchdowns(Number(touchdowns)) }, typeof rev === "string" ? Number(rev) || 0 : 0);
}

/**
 * The Lua that keeps the look, shared by the scripts that write a team: `pk` is its key, `json` the
 * choices (empty when the device sent none, which leaves it alone), `td` the device's touchdowns.
 * The rev moves only when something changed, and the count never goes down (A25).
 */
const KEEP_PREFS = `
local function keep_prefs(pk, json, td)
  if json == '' then return end
  local old = redis.call('HGET', pk, 'json')
  local had = tonumber(redis.call('HGET', pk, 'touchdowns')) or 0
  local n = tonumber(td) or 0
  if n < had then n = had end
  if old ~= json or n ~= had then
    local rev = tonumber(redis.call('HGET', pk, 'rev')) or 0
    redis.call('HSET', pk, 'rev', rev + 1, 'json', json, 'touchdowns', n)
  end
end`;

/** The coach's look as the account holds it: the defaults, at rev 0, until a device writes one. */
export async function readAccountPrefs(user: string): Promise<AccountPrefs> {
  return prefsOf(await command("HMGET", prefsKey(user), "rev", "json", "touchdowns"));
}

/** The account's teams in the order they were made, the one it last opened, and the coach's look. */
export async function listTeams(user: string): Promise<{ teams: TeamSummary[]; current: string | null; prefs: AccountPrefs }> {
  const ids = await command("LRANGE", teamsKey(user), 0, MAX_TEAMS - 1);
  const teams: TeamSummary[] = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    if (typeof id !== "string") continue;
    const values = await command("HMGET", teamKey(id), ...FIELDS);
    if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) continue;
    const f = Object.fromEntries(FIELDS.map((k, i) => [k, values[i] as string])) as Fields;
    if (f.owner !== user) continue;
    teams.push(summaryOf(id, f));
  }
  const current = await command("GET", currentKey(user));
  const prefs = await readAccountPrefs(user);
  return { teams, current: typeof current === "string" && teams.some((t) => t.id === current) ? current : null, prefs };
}

const CREATE = `${KEEP_PREFS}
if redis.call('LLEN', KEYS[1]) >= tonumber(ARGV[2]) then return -1 end
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('HSET', KEYS[2], 'owner', ARGV[1], 'rev', 1, 'updated', ARGV[3], 'name', ARGV[4], 'color', ARGV[5], 'plays', ARGV[6], 'playbooks', ARGV[7], 'data', ARGV[8])
redis.call('RPUSH', KEYS[1], ARGV[9])
redis.call('SET', KEYS[3], ARGV[9])
keep_prefs(KEYS[4], ARGV[10], ARGV[11])
return 1`;

/** Makes a team from its data, as the account's current one, keeping the device's look when it sent one. */
export async function createTeam(user: string, data: TeamData, prefs?: CoachPrefs): Promise<TeamRecord> {
  const updated = new Date().toISOString();
  const json = JSON.stringify(data);
  for (let i = 0; i < 3; i++) {
    const id = newId();
    const result = await command("EVAL", CREATE, 4, teamsKey(user), teamKey(id), currentKey(user), prefsKey(user),
      user, MAX_TEAMS, updated, teamName(data), data.team.color, data.plays.length, data.playbooks.length, json, id, ...prefsArgs(prefs));
    if (result === -1) throw new AccountError(409, `An account holds up to ${String(MAX_TEAMS)} teams. Delete one to make another.`);
    if (result === 1) return { ...summarize(id, data, 1, updated), data, prefs: await readAccountPrefs(user) };
  }
  throw new AccountError(503, UNAVAILABLE);
}

/** One team with its data and the coach's look; 404 for a team that isn't this account's. */
export async function readTeam(user: string, id: string): Promise<TeamRecord> {
  const values = await command("HMGET", teamKey(id), ...FIELDS, "data");
  if (!Array.isArray(values) || values.some((v) => typeof v !== "string")) throw new AccountError(404, "That team isn't in your account.");
  const f = Object.fromEntries(FIELDS.map((k, i) => [k, values[i] as string])) as Fields;
  if (f.owner !== user) throw new AccountError(404, "That team isn't in your account.");
  let data: unknown;
  try { data = JSON.parse(values[FIELDS.length] as string); } catch { throw new AccountError(503, UNAVAILABLE); }
  // a team written before the desk went up (ADR 013) reads with an empty desk
  return { ...summaryOf(id, f), data: completeTeamData(data as TeamData), prefs: await readAccountPrefs(user) };
}

const WRITE = `${KEEP_PREFS}
local owner = redis.call('HGET', KEYS[1], 'owner')
if not owner or owner ~= ARGV[1] then return 0 end
local rev = tonumber(redis.call('HGET', KEYS[1], 'rev'))
if rev ~= tonumber(ARGV[2]) then return -1 end
redis.call('HSET', KEYS[1], 'rev', rev + 1, 'updated', ARGV[3], 'name', ARGV[4], 'color', ARGV[5], 'plays', ARGV[6], 'playbooks', ARGV[7], 'data', ARGV[8])
keep_prefs(KEYS[2], ARGV[9], ARGV[10])
return rev + 1`;

/**
 * Writes a team's data over the rev the device read, and the coach's look when the device sent one.
 * A team written since (by another device) is refused with 409 and the account's copy, so the device
 * can merge it in and write again (A8).
 */
export async function writeTeam(user: string, id: string, data: TeamData, rev: number, prefs?: CoachPrefs): Promise<TeamWritten> {
  const updated = new Date().toISOString();
  const result = await command("EVAL", WRITE, 2, teamKey(id), prefsKey(user),
    user, rev, updated, teamName(data), data.team.color, data.plays.length, data.playbooks.length, JSON.stringify(data), ...prefsArgs(prefs));
  if (result === 0) throw new AccountError(404, "That team isn't in your account.");
  if (result === -1) throw new AccountError(409, "This team was changed on another device.", await readTeam(user, id));
  if (typeof result !== "number") throw new AccountError(503, UNAVAILABLE);
  return { ...summarize(id, data, result, updated), prefs: await readAccountPrefs(user) };
}

const DELETE = `
local owner = redis.call('HGET', KEYS[1], 'owner')
if not owner or owner ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('LREM', KEYS[2], 0, ARGV[2])
if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('DEL', KEYS[3]) end
return 1`;

export async function deleteTeam(user: string, id: string): Promise<void> {
  const result = await command("EVAL", DELETE, 3, teamKey(id), teamsKey(user), currentKey(user), user, id);
  if (result !== 1) throw new AccountError(404, "That team isn't in your account.");
}

const CURRENT = `
if not redis.call('LPOS', KEYS[1], ARGV[1]) then return 0 end
redis.call('SET', KEYS[2], ARGV[1])
return 1`;

/** Remembers which team the account opened last, so a new device opens it too (A4). */
export async function setCurrent(user: string, id: string): Promise<void> {
  const result = await command("EVAL", CURRENT, 2, teamsKey(user), currentKey(user), id);
  if (result !== 1) throw new AccountError(404, "That team isn't in your account.");
}

import { deviceWritten } from "@/lib/device-writes";
import { TOKEN_PATTERN } from "./links";

/**
 * The share links this device made and can still revoke (components/playbooks/ShareBook.tsx), keyed by
 * what they share: a playbook's id, or `play:<id>` for a play. Each holds the link's token, the key
 * that revokes it and when it expires; a play's link also keeps the snapshot it was made from, so the
 * same play shares the same link again. Kept on the device and, signed in, in the account with the
 * team (docs/adr/013-whole-desk-in-account.md), so a link made on one device can be revoked from another.
 */
export interface Share {
  token: string;
  revokeKey: string;
  expiresAt: string;
  snapshotJson?: string;
}
export type Shares = Record<string, Share[]>;

export const SHARES_KEY = "ffpd.shares.v1";
/** Tells the screens on this page a share link was kept or revoked (the `storage` event only reaches other pages). */
export const SHARES_EVENT = "shares-changed";

const UNSAFE = new Set(["__proto__", "constructor", "prototype"]);
const REVOKE_KEY = /^[A-Za-z0-9_-]{32}$/;
/** A play's or a book's id, as the app makes them, with a play's prefix. */
const SHARE_ID = /^(play:)?[A-Za-z0-9_-]{1,60}$/;
/** Links kept per play or book, and per team, at most: more than a coach makes, less than would fill a team. */
export const MAX_SHARES_EACH = 50;
export const MAX_SHARED_ITEMS = 2_000;
const MAX_SNAPSHOT = 400_000;

export const isShare = (entry: unknown): entry is Share => {
  if (!entry || typeof entry !== "object") return false;
  const s = entry as Partial<Share>;
  return typeof s.token === "string" && TOKEN_PATTERN.test(s.token) && typeof s.revokeKey === "string" && REVOKE_KEY.test(s.revokeKey)
    && typeof s.expiresAt === "string" && Number.isFinite(Date.parse(s.expiresAt))
    && (s.snapshotJson === undefined || (typeof s.snapshotJson === "string" && s.snapshotJson.length <= MAX_SNAPSHOT));
};

/** The links from any JSON-ish value: every entry that is one, under every id that is one, and nothing else. */
export function parseShares(raw: unknown): Shares {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Shares = {};
  let items = 0;
  for (const [id, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries) || UNSAFE.has(id) || !SHARE_ID.test(id)) continue;
    if (items++ >= MAX_SHARED_ITEMS) break;
    const valid = (entries as unknown[]).filter(isShare).slice(0, MAX_SHARES_EACH).map((s) => ({
      token: s.token, revokeKey: s.revokeKey, expiresAt: s.expiresAt, ...(s.snapshotJson === undefined ? {} : { snapshotJson: s.snapshotJson }),
    }));
    out[id] = valid;
  }
  return out;
}

/** The stored text, for useSyncExternalStore: "{}" when there is none or storage is blocked. */
export function sharesSnapshot(): string {
  try { return localStorage.getItem(SHARES_KEY) ?? "{}"; } catch { return "{}"; }
}

function parseText(raw: string): Shares {
  try { return parseShares(JSON.parse(raw)); } catch { return {}; }
}

/** Every link this device holds, by what it shares. */
export const readShares = (): Shares => parseText(sharesSnapshot());

/** Writes the links as one record and tells this page's screens. Throws when storage refuses, as the caller says so. */
export function writeShares(all: Shares): void {
  localStorage.setItem(SHARES_KEY, JSON.stringify(all));
  window.dispatchEvent(new Event(SHARES_EVENT));
  deviceWritten();
}

/** Puts the links for one play or book in place of what was there. */
export function setShares(id: string, next: Share[]): void {
  const all = readShares();
  all[id] = next;
  writeShares(all);
}

export function subscribeShares(listener: () => void): () => void {
  window.addEventListener("storage", listener);
  window.addEventListener(SHARES_EVENT, listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener(SHARES_EVENT, listener); };
}

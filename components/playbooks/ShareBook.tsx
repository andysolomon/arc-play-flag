"use client";

import { useState, useSyncExternalStore } from "react";
import { encodePlaybookFile } from "@/lib/export/playbook-file";
import type { Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";
import { TOKEN_PATTERN } from "@/lib/sharing/links";
import { card, input, pill } from "../ui";

type Share = { token: string; revokeKey: string; expiresAt: string };
const KEY = "ffpd.shares.v1";
function subscribe(listener: () => void) {
  window.addEventListener("storage", listener); window.addEventListener("shares-changed", listener);
  return () => { window.removeEventListener("storage", listener); window.removeEventListener("shares-changed", listener); };
}
function snapshot(): string { try { return localStorage.getItem(KEY) ?? "{}"; } catch { return "{}"; } }
function parse(raw: string): Record<string, Share[]> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([id, entries]: [string, unknown]) => {
      if (!Array.isArray(entries) || ["__proto__", "constructor", "prototype"].includes(id)) return [];
      const valid = (entries as unknown[]).filter((entry): entry is Share => {
        if (!entry || typeof entry !== "object") return false;
        const s = entry as Partial<Share>;
        return typeof s.token === "string" && TOKEN_PATTERN.test(s.token) && typeof s.revokeKey === "string" && /^[A-Za-z0-9_-]{32}$/.test(s.revokeKey) && typeof s.expiresAt === "string" && Number.isFinite(Date.parse(s.expiresAt));
      });
      return [[id, valid]];
    }));
  } catch { return {}; }
}
async function failure(response: Response): Promise<never> {
  const data = await response.json() as { error?: string };
  throw new Error(data.error ?? "Sharing failed. Try again.");
}

export function ShareBook({ book, plays, team }: { book: Playbook; plays: readonly SavedPlay[]; team: TeamSettings }) {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "{}");
  const shares = parse(raw)[book.id] ?? [];
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [latest, setLatest] = useState<Share | null>(null);
  const [includeTeam, setIncludeTeam] = useState(false);
  const json = encodePlaybookFile(book, plays, includeTeam ? team : null);
  const save = (next: Share[]) => {
    const all = parse(snapshot());
    all[book.id] = next;
    localStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new Event("shares-changed"));
  };
  const create = async () => {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
      if (!response.ok) await failure(response);
      const share = await response.json() as Share;
      if (!TOKEN_PATTERN.test(share.token) || !/^[A-Za-z0-9_-]{32}$/.test(share.revokeKey)) throw new Error("Sharing returned an invalid link.");
      setLatest(share); setPreview(false);
      try { save([...(parse(snapshot())[book.id] ?? []), share]); setMessage("Link created. Copy or share it below."); }
      catch { setMessage("Link created, but its revoke control could not be saved on this device. Keep this page open to revoke it."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create a link. Try again online."); }
    finally { setBusy(false); }
  };
  const revoke = async (share: Share) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/shares/${share.token}`, { method: "DELETE", headers: { Authorization: `Bearer ${share.revokeKey}` } });
      if (!response.ok) await failure(response);
      if (latest?.token === share.token) setLatest(null);
      try { save((parse(snapshot())[book.id] ?? []).filter(s => s.token !== share.token)); } catch { /* server revocation succeeded */ }
      setMessage("Link revoked. Copies already imported are unaffected.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke the link."); }
    finally { setBusy(false); }
  };
  const visible = latest && !shares.some(s => s.token === latest.token) ? [...shares, latest] : shares;
  return <section className={`${card} flex flex-col gap-3`} aria-label="Share playbook">
    <h2 className="text-title">Share playbook</h2>
    <p className="text-caption">Create a short link to a snapshot. Anyone with the link can view and import it. Links expire after 90 days; your later edits stay on this device.</p>
    <button type="button" className={`${pill} min-h-11 self-start px-3`} disabled={busy} onClick={() => { setPreview(p => !p); }}>Share playbook…</button>
    {preview && <div className="flex flex-col gap-2">
      <p><strong>{book.name}</strong> · {book.plays.length} plays, including both teams&apos; routes and coaching notes.</p>
      <details><summary className="cursor-pointer py-2">Review included plays and notes</summary>{book.plays.map(id => {
        const play = plays.find(p => p.id === id);
        return <div key={id} className="py-2"><strong>{play?.name ?? "Missing play"}</strong><p className="whitespace-pre-wrap break-words">{play?.notes}</p></div>;
      })}</details>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={includeTeam} onChange={e => { setIncludeTeam(e.target.checked); }} />Include team name and colour: {team.name || "No team name"}</label>
      <p className="text-caption">Only this snapshot is uploaded. Revoke controls are saved in this browser; clearing site data loses those controls. Imported copies cannot be revoked.</p>
      <button type="button" disabled={busy || book.plays.some(id => !plays.some(p => p.id === id))} className={`${pill} min-h-11 self-start px-3`} onClick={() => { void create(); }}>{busy ? "Creating link…" : "Create link"}</button>
    </div>}
    {message && <p role="status">{message}</p>}
    {visible.map(share => <div key={share.token} className="flex flex-col gap-2 border-t border-ink pt-2">
      <label className="text-caption">Share URL<input className={`${input} mt-1 w-full min-w-0`} aria-label="Share URL" readOnly value={typeof window === "undefined" ? "" : `${window.location.origin}/s/${share.token}`} onFocus={e => { e.target.select(); }} /></label>
      <p className="text-caption">Expires {new Date(share.expiresAt).toLocaleDateString()}</p>
      <div className="flex flex-wrap gap-2">
        <button className={`${pill} min-h-11 px-3`} type="button" onClick={() => {
          void navigator.clipboard?.writeText(`${window.location.origin}/s/${share.token}`).then(() => { setMessage("Link copied"); }).catch(() => { setMessage("Select the URL above and copy it."); });
          if (!navigator.clipboard) setMessage("Select the URL above and copy it.");
        }}>Copy link</button>
        <button className={`${pill} min-h-11 px-3`} type="button" onClick={() => {
          if (!navigator.share) { setMessage("Use Copy link or select the URL above."); return; }
          void navigator.share({ title: book.name, url: `${window.location.origin}/s/${share.token}` }).catch(() => { setMessage("Use Copy link to share the URL."); });
        }}>Share link</button>
        <button className={`${pill} min-h-11 px-3`} type="button" disabled={busy} onClick={() => { void revoke(share); }}>Revoke link</button>
      </div>
    </div>)}
  </section>;
}

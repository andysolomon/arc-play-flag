"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { encodePlayFile } from "@/lib/export/transfer";
import { PreviewModal } from "./PreviewModal";
import { encodePlaybookFile } from "@/lib/export/playbook-file";
import type { Playbook, SavedPlay, TeamSettings } from "@/lib/play/types";
import { TOKEN_PATTERN } from "@/lib/sharing/links";
import { card, eyebrow, input, pill, pillDark } from "../ui";
import { TwoStep } from "./TwoStep";

type Share = { token: string; revokeKey: string; expiresAt: string; snapshotJson?: string };
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
/** How many live share links this device holds for a play or playbook id. */
export function useShareCount(id: string): number {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "{}");
  return (parse(raw)[id] ?? []).length;
}
async function failure(response: Response): Promise<never> {
  const data = await response.json() as { error?: string };
  throw new Error(data.error ?? "Sharing failed. Try again.");
}

type Props = { book: Playbook; plays: readonly SavedPlay[]; team: TeamSettings };
export function ShareBook(props: Props) { return <SharePanel {...props} />; }
export function ShareBookButton(props: Props) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className={`${pill} min-h-11 px-3 text-small`} aria-label={`Share ${props.book.name}`} onClick={() => { setOpen(true); }}>Share</button>
    {open && <PreviewModal title="Share entire playbook" onClose={() => { setOpen(false); }}><SharePanel {...props} initialPreview inModal /></PreviewModal>}</>;
}
/** What a play card needs to offer "Manage share links" from its own menu. */
export type ShareControls = { links: number; manage: () => void };
/**
 * The play card's Share button: it reads "Copied ✓" for a moment after a successful copy, so the
 * card never changes height. `children` renders beside it with the share controls.
 */
export function SharePlayButton({ play, children }: { play: SavedPlay; children?: (share: ShareControls) => ReactNode }) {
  return <SharePanel play={play} menu={children} />;
}
/** "Dec 21, 2026" */
function expiry(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function SharePanel({ book, plays = [], team, play, menu, initialPreview = false, inModal = !!play }: Partial<Props> & {
  play?: SavedPlay; menu?: (share: ShareControls) => ReactNode; initialPreview?: boolean;
  /** a modal already titles it and frames it, so drop the card and heading */
  inModal?: boolean;
}) {
  const id = play ? `play:${play.id}` : book?.id ?? "";
  const name = play?.name ?? book?.name ?? "";
  const kind = play ? "play" : "playbook";
  const [open, setOpen] = useState(false);
  const raw = useSyncExternalStore(subscribe, snapshot, () => "{}");
  const shares = parse(raw)[id] ?? [];
  const [preview, setPreview] = useState(initialPreview);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [latest, setLatest] = useState<Share | null>(null);
  const [includeTeam, setIncludeTeam] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => { setCopied(false); }, 2000);
    return () => { window.clearTimeout(t); };
  }, [copied]);
  const json = play ? encodePlayFile(play) : book ? encodePlaybookFile(book, plays, includeTeam && team ? team : null) : "";
  const save = (next: Share[]) => {
    const all = parse(snapshot());
    all[id] = next;
    localStorage.setItem(KEY, JSON.stringify(all));
    window.dispatchEvent(new Event("shares-changed"));
  };
  const copy = async (share: Share) => {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(`${window.location.origin}/s/${share.token}`);
      if (play && !open) setCopied(true); else setMessage("Link copied");
    } catch { setOpen(true); setMessage("Select the URL below and copy it, or use Copy link."); }
  };
  const create = async () => {
    setBusy(true); setMessage("");
    try {
      const existing = play && (parse(snapshot())[id] ?? []).find(s => s.snapshotJson === json && Date.parse(s.expiresAt) > Date.now());
      if (existing) { setLatest(existing); await copy(existing); return; }
      const response = await fetch("/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
      if (!response.ok) await failure(response);
      const share = await response.json() as Share;
      if (!TOKEN_PATTERN.test(share.token) || !/^[A-Za-z0-9_-]{32}$/.test(share.revokeKey)) throw new Error("Sharing returned an invalid link.");
      if (play) share.snapshotJson = json;
      setLatest(share); setPreview(false);
      try { save([...(parse(snapshot())[id] ?? []), share]); if (!play) setMessage("Link created. Copy it below."); }
      catch { setOpen(true); setMessage("Link created, but its revoke control could not be saved on this device. Keep this page open to revoke it."); return; }
      if (play) await copy(share);
    } catch (error) { setOpen(true); setMessage(error instanceof Error ? error.message : "Could not create a link. Try again online."); }
    finally { setBusy(false); }
  };
  const revoke = async (share: Share) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/shares/${share.token}`, { method: "DELETE", headers: { Authorization: `Bearer ${share.revokeKey}` } });
      if (!response.ok) await failure(response);
      if (latest?.token === share.token) setLatest(null);
      try { save((parse(snapshot())[id] ?? []).filter(s => s.token !== share.token)); } catch { /* server revocation succeeded */ }
      setMessage("Link revoked. Copies already imported are unaffected.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not revoke the link."); }
    finally { setBusy(false); }
  };
  const visible = latest && !shares.some(s => s.token === latest.token) ? [...shares, latest] : shares;
  const url = (share: Share) => typeof window === "undefined" ? "" : `${window.location.origin}/s/${share.token}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const panel = <section className={inModal ? "flex flex-col gap-3" : `${card} flex flex-col gap-3`} aria-label={`Share ${kind}`}>
    {!inModal && <h2 className="text-title">Share {kind}: {name}</h2>}
    <p className="max-w-[46ch] text-base leading-body text-ink-muted">Anyone with this link can view and import a snapshot with both teams and notes. Your later edits stay on this device.</p>
    {!inModal && <button type="button" className={`${pill} min-h-11 self-start px-3`} disabled={busy} onClick={() => { setPreview(p => !p); }}>Share playbook…</button>}
    {preview && book && team && <div className="flex flex-col gap-2">
      <p><strong>{book.name}</strong> · {book.plays.length} plays, including both teams&apos; routes and coaching notes.</p>
      <details><summary className="cursor-pointer py-2">Review included plays and notes</summary>{book.plays.map(id => {
        const play = plays.find(p => p.id === id);
        return <div key={id} className="py-2"><strong>{play?.name ?? "Missing play"}</strong><p className="whitespace-pre-wrap break-words">{play?.notes}</p></div>;
      })}</details>
      <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={includeTeam} onChange={e => { setIncludeTeam(e.target.checked); }} />Include team name and colour: {team.name || "No team name"}</label>
      <p className="text-caption leading-note text-ink-muted">Links expire after 90 days. Revoke controls are saved in this browser; clearing site data loses them. Imported copies can&apos;t be revoked.</p>
      <button type="button" disabled={busy || book.plays.some(id => !plays.some(p => p.id === id))} className={`${pillDark} min-h-11 self-start px-4`} onClick={() => { void create(); }}>{busy ? "Creating link…" : "Create link"}</button>
    </div>}
    {message && <p role="status" className="text-small">{message}</p>}
    {visible.map((share, i) => <div key={share.token} className="flex flex-col gap-2">
      <span className={`${eyebrow} mt-1`}>{visible.length > 1 ? `SHARE LINK ${String(i + 1)}` : "SHARE LINK"}</span>
      <input className={`${input} min-w-0`} aria-label="Share URL" readOnly value={url(share)} onFocus={e => { e.target.select(); }} />
      <span className="text-caption text-ink-muted">Expires {expiry(share.expiresAt)}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button className={`${pillDark} min-h-11 px-4 text-small`} type="button" onClick={() => {
          if (!navigator.clipboard) { setMessage("Select the URL and copy it."); return; }
          void navigator.clipboard.writeText(url(share)).then(() => { setMessage("Link copied"); }).catch(() => { setMessage("Select the URL and copy it."); });
        }}>Copy link</button>
        {canShare && <button className={`${pill} min-h-11 px-3 text-small`} type="button" onClick={() => {
          void navigator.share({ title: name, url: url(share) }).catch(() => { /* the person closed the share sheet */ });
        }}>Send to…</button>}
        <span className="flex-1" />
        <TwoStep label="Revoke link" confirm="Tap again to revoke" onConfirm={() => { void revoke(share); }} base={`${pill} min-h-11 px-3 text-small text-offense data-[active=true]:text-ink`} />
      </div>
    </div>)}
  </section>;
  if (!play) return panel;
  const manage = () => { setOpen(true); };
  return <>
    <button type="button" disabled={busy} data-copied={copied} className={`${pill} min-h-11 flex-1 px-3 text-small data-[copied=true]:bg-yellow-soft`} onClick={() => { void create(); }}>
      {busy ? "Creating…" : copied ? "Copied ✓" : "Share"}
    </button>
    <span role="status" className="sr-only">{copied ? "Link copied" : ""}</span>
    {menu?.({ links: visible.length, manage })}
    {open && <PreviewModal title={`Share “${name}”`} onClose={() => { setOpen(false); setMessage(""); }}>{panel}</PreviewModal>}
  </>;
}

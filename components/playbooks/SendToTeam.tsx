"use client";

import { useState } from "react";
import { transferPlays, type Transfer } from "@/lib/export/transfer";
import { sendTargets, sendToTeam, type SendResult } from "@/lib/account/sync";
import { copyTargets, copyTo } from "@/lib/org/sync";
import { useAccount } from "../account/AccountPanel";
import { menuItem, pill, pillDark } from "../ui";
import type { Say } from "./PlaybooksScreen";
import { PreviewModal } from "./PreviewModal";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/** What the toast says once a send is done (S1: already there; else what the other team gained). */
export function sentWords(title: string, r: Extract<SendResult, { ok: true }>): string {
  if (r.unchanged) return `“${title}” is already in ${r.team.name}`;
  const count = (n: number) => `${String(n)} ${n === 1 ? "play" : "plays"}`;
  const bits = [r.added ? `${count(r.added)} added` : "", r.copied ? `${count(r.copied)} copied` : "", r.reused ? `${count(r.reused)} already there` : ""].filter(Boolean);
  return `Sent “${title}” to ${r.team.name}${bits.length ? " · " + bits.join(" · ") : ""}`;
}

/**
 * The ⋯ menu row that opens the send: shown only when the account has another team to send to
 * (signed out, or with one team, there is nowhere else for a play to go).
 */
export function SendToTeamItem({ onPick }: { onPick: () => void }) {
  const s = useAccount();
  // an organization's teams the coach draws on are targets too (ADR 013, rule 10)
  if (sendTargets(s).length === 0 && copyTargets().filter((t) => t.target.kind === "org").length === 0) return null;
  return <button type="button" className={menuItem} onClick={onPick}>Send to another team…</button>;
}

/** The account's other teams, one tap each: the book or play is copied into the one tapped, and nothing here changes. */
export function SendToTeamModal({ transfer, say, onClose }: { transfer: Transfer; say: Say; onClose: () => void }) {
  const s = useAccount();
  const targets = sendTargets(s);
  const orgTargets = copyTargets().filter((t) => t.target.kind === "org");
  const title = transfer.kind === "ffpd.playbook" ? transfer.playbook.name : transfer.play.name;
  const plays = transferPlays(transfer).length;
  const [sending, setSending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const send = async (id: string) => {
    setError("");
    setSending(id);
    const r = await sendToTeam(transfer, id);
    setSending(null);
    if (!r.ok) { setError(r.message); return; }
    say(sentWords(title, r), 3200);
    onClose();
  };
  /** Into an organization's team: the copies are new records that say where they came from (ADR 013, rule 10). */
  const sendToOrg = async (t: (typeof orgTargets)[number]) => {
    setError("");
    setSending(t.target.team);
    try {
      await copyTo(t.target, transferPlays(transfer), transfer.kind === "ffpd.playbook" ? [transfer.playbook] : []);
      say(`Sent “${title}” to ${t.label}`, 3200);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send it.");
    } finally {
      setSending(null);
    }
  };
  const what = transfer.kind === "ffpd.playbook"
    ? `Copies the playbook and its ${plural(plays, "play")} into the team you pick.`
    : "Copies the play into the team you pick.";
  return (
    <PreviewModal title={`Send “${title}” to another team`} closeLabel="Close send to team" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <span className="text-caption leading-note text-ink-muted">{what} Nothing in this team changes. A play that team already has is used as is.</span>
        {targets.length === 0 && orgTargets.length === 0 && <span className="text-base text-ink-muted">No other team to send to. Make one under settings first.</span>}
        <div role="group" aria-label="Send to" className="flex flex-col gap-2">
          {targets.map((t) => (
            <button
              key={t.id}
              type="button"
              disabled={sending !== null}
              onClick={() => { void send(t.id); }}
              className={`${pill} flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left`}
            >
              <span aria-hidden className="h-4 w-4 flex-none rounded-full border-2 border-ink" style={{ background: t.color }} />
              <span className="min-w-0 flex-1 truncate text-base">{t.name}</span>
              <span className="text-caption text-ink-muted">{plural(t.plays, "play")} · {plural(t.playbooks, "playbook")}</span>
              <span className="w-[72px] text-right text-small">{sending === t.id ? "Sending…" : "Send"}</span>
            </button>
          ))}
        </div>
        {[...new Set(orgTargets.map((t) => t.group))].map((group) => (
          <div key={group} role="group" aria-label={`Send to ${group}`} className="flex flex-col gap-2">
            <span className="text-eyebrow tracking-eyebrow text-ink-muted">{group.toUpperCase()}</span>
            {orgTargets.filter((t) => t.group === group).map((t) => (
              <button
                key={t.target.team}
                type="button"
                disabled={sending !== null}
                onClick={() => { void sendToOrg(t); }}
                className={`${pill} flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left`}
              >
                <span className="min-w-0 flex-1 truncate text-base">{t.label}</span>
                <span className="w-[72px] text-right text-small">{sending === t.target.team ? "Sending…" : "Send"}</span>
              </button>
            ))}
          </div>
        ))}
        {error && <p role="alert" className="text-small">{error}</p>}
        <button type="button" onClick={onClose} className={`${pillDark} mt-1 min-h-11 self-end px-5 text-small`}>Cancel</button>
      </div>
    </PreviewModal>
  );
}

"use client";

import { useEffect, useState, type SubmitEvent } from "react";
import { createOrg, deleteOrg, invite, leaveOrg, manage, moveTeamToOrg, readOrg, type AccountState } from "@/lib/account/sync";
import * as api from "@/lib/org/api";
import { HEAD, type Grants, type Invite, type Level, type Membership, type OrgDetail, type OrgSummary, type OrgTeamSummary } from "@/lib/org/types";
import { PreviewModal } from "../playbooks/PreviewModal";
import { TwoStep } from "../playbooks/TwoStep";
import { divider, eyebrow, input, pill, pillDark, select } from "../ui";

const plural = (n: number, one: string): string => `${String(n)} ${n === 1 ? one : one === "coach" ? "coaches" : `${one}s`}`;

/** What a coach may do on a team, in a word (rule 3). */
export function levelWords(level: Level, role?: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return level >= HEAD ? "Head coach" : level === 2 ? "Assistant" : level === 1 ? "Viewer" : "No access";
}

/**
 * The ORGANIZATION corner of the account panel (docs/adr/013-organizations.md): the organizations the
 * coach is in, one to make, and for each a way to move the open team in, make a team there, open its
 * members (admins), leave it, or delete it (the owner).
 */
export function OrgSection({ s }: { s: AccountState }) {
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [members, setMembers] = useState<OrgSummary | null>(null);
  const busy = s.status === "busy";
  const onCreate = (e: SubmitEvent) => {
    e.preventDefault();
    setMaking(false);
    void createOrg(name);
    setName("");
  };
  if (s.orgMode !== "on") return null;
  return (
    <div className="flex flex-none flex-col gap-2" data-org-count={s.orgs.length}>
      <span className={eyebrow}>ORGANIZATION</span>
      {s.orgs.length === 0 && (
        <span className="text-caption leading-note text-ink-muted">An organization owns teams its coaches share: every member sees them, head coaches and assistants draw on them.</span>
      )}
      {s.orgs.map((o) => (
        <div key={o.id} role="group" aria-label={o.name} className="flex flex-col gap-1.5 rounded-tile border-2 border-ink bg-white p-2.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-small">{o.name}</span>
            <span className="text-caption text-ink-muted">{levelWords(0, o.role) === "No access" ? "Member" : levelWords(0, o.role)} · {plural(o.members, "coach")}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(o.role === "owner" || o.role === "admin") && (
              <button type="button" disabled={busy} onClick={() => { setMembers(o); }} className={`${pill} min-h-11 px-3 text-small`}>Members…</button>
            )}
            {s.teamId && !s.org && (
              <button type="button" disabled={busy} onClick={() => { void moveTeamToOrg(o.id); }} className={`${pill} min-h-11 px-3 text-small`}>Move this team here…</button>
            )}
            {o.role !== "owner" && (
              <TwoStep label="Leave" confirm="Tap again to leave" onConfirm={() => { void leaveOrg(o.id); }} base={`${pill} min-h-11 px-3 text-small`} />
            )}
            {o.role === "owner" && (
              <TwoStep label="Delete organization" confirm={`Delete it and its ${plural(o.teams, "team")}?`} onConfirm={() => { void deleteOrg(o.id); }} base={`${pill} min-h-11 px-3 text-small text-offense`} />
            )}
          </div>
        </div>
      ))}
      {making ? (
        <form onSubmit={onCreate} className="flex flex-none flex-col gap-2" aria-label="New organization">
          <input value={name} onChange={(e) => { setName(e.target.value); }} maxLength={40} placeholder="Organization name" aria-label="New organization name" autoFocus className={input} />
          <div className="flex gap-2">
            <button type="submit" className={`${pillDark} min-h-11 px-4 text-small`}>Create organization</button>
            <button type="button" onClick={() => { setMaking(false); }} className={`${pill} min-h-11 px-3 text-small`}>Cancel</button>
          </div>
          <span className="text-caption leading-note text-ink-muted">You own it. Move a team in, invite coaches, and every member sees every team, rosters included.</span>
        </form>
      ) : (
        <button type="button" disabled={busy} onClick={() => { setMaking(true); }} className={`${pill} min-h-11 self-start px-3 text-small`}>+ New organization…</button>
      )}
      {members && <MembersModal org={members} onClose={() => { setMembers(null); }} />}
    </div>
  );
}

/** Grants as the editor holds them: every team or a list, and a role per team. */
interface Draft { all: boolean; teams: Set<string>; roles: Record<string, "head" | "assist" | "view"> }
const draftOf = (g: Grants): Draft => ({
  all: g.teams === null, teams: new Set(g.teams ?? []),
  roles: Object.fromEntries([...g.heads.map((t) => [t, "head"] as const), ...g.assists.map((t) => [t, "assist"] as const)]),
});
const grantsOf = (d: Draft): Grants => ({
  teams: d.all ? null : [...d.teams],
  heads: Object.entries(d.roles).filter(([, r]) => r === "head").map(([t]) => t),
  assists: Object.entries(d.roles).filter(([, r]) => r === "assist").map(([t]) => t),
});

function GrantsEditor({ teams, draft, onChange, label }: { teams: OrgTeamSummary[]; draft: Draft; onChange: (d: Draft) => void; label: string }) {
  return (
    <fieldset className="flex flex-col gap-1.5 border-0 p-0">
      <legend className="text-caption text-ink-muted">{label}</legend>
      <label className="flex min-h-9 items-center gap-2 text-small">
        <input type="radio" checked={draft.all} onChange={() => { onChange({ ...draft, all: true }); }} className="h-4 w-4 accent-ink" /> Every team
      </label>
      <label className="flex min-h-9 items-center gap-2 text-small">
        <input type="radio" checked={!draft.all} onChange={() => { onChange({ ...draft, all: false }); }} className="h-4 w-4 accent-ink" /> Only these teams
      </label>
      {teams.map((t) => (
        <div key={t.id} className="flex items-center gap-2 pl-6">
          <label className="flex min-w-0 flex-1 items-center gap-2 text-small">
            <input type="checkbox" checked={draft.all || draft.teams.has(t.id)} disabled={draft.all}
              onChange={(e) => { const next = new Set(draft.teams); if (e.target.checked) next.add(t.id); else next.delete(t.id); onChange({ ...draft, teams: next }); }}
              className="h-4 w-4 accent-ink" />
            <span className="truncate">{t.name}</span>
          </label>
          <select aria-label={`Role on ${t.name}`} value={draft.roles[t.id] ?? "view"} className={`${select} min-h-9 py-0.5 text-small`}
            onChange={(e) => { const roles = { ...draft.roles }; if (e.target.value === "view") Reflect.deleteProperty(roles, t.id); else roles[t.id] = e.target.value as "head" | "assist"; onChange({ ...draft, roles }); }}>
            <option value="view">Viewer</option>
            <option value="assist">Assistant</option>
            <option value="head">Head coach</option>
          </select>
        </div>
      ))}
    </fieldset>
  );
}

/** Everyone in the organization, each one's grants and role, the invites open, and one to make (rule 4). Admins only. */
function MembersModal({ org, onClose }: { org: OrgSummary; onClose: () => void }) {
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [message, setMessage] = useState("");
  const [link, setLink] = useState<Invite | null>(null);
  const load = () => readOrg(org.id).then(setDetail, (e: unknown) => { setMessage(e instanceof Error ? e.message : "Couldn't read the organization."); });
  useEffect(() => { void readOrg(org.id).then(setDetail, (e: unknown) => { setMessage(e instanceof Error ? e.message : "Couldn't read the organization."); }); }, [org.id]);
  const run = async (what: () => Promise<unknown>, said: string) => {
    if (await manage(what)) { setMessage(said); await load(); }
    else setMessage("That didn't work. Check the account panel for why.");
  };
  const me = detail?.me;
  return (
    <PreviewModal title={`${org.name}: members`} onClose={onClose} closeLabel="Close members">
      {!detail ? <span className="text-small text-ink-muted">{message || "Reading…"}</span> : (
        <div className="flex flex-col gap-3" data-members={detail.members?.length ?? 0}>
          <span className={eyebrow}>COACHES</span>
          {(detail.members ?? []).map((m) => (
            <MemberRow key={m.coach} m={m} teams={detail.teams} isMe={m.coach === me?.coach} owner={me?.role === "owner"} run={run} org={org.id} />
          ))}
          <span className={divider} />
          <span className={eyebrow}>INVITES</span>
          {(detail.invites ?? []).map((i) => (
            <div key={i.token} className="flex flex-wrap items-center gap-2 text-small">
              <span className="min-w-0 flex-1 truncate">{i.email ?? "Link"} · until {new Date(i.expires).toLocaleDateString()}</span>
              {!i.email && <button type="button" className={`${pill} min-h-9 px-3 text-small`} onClick={() => { void navigator.clipboard?.writeText(inviteUrl(i.token)); setLink(i); }}>Copy link</button>}
              <button type="button" className={`${pill} min-h-9 px-3 text-small`} onClick={() => { void run(() => api.revokeInvite(org.id, i.token), "Invite revoked"); }}>Revoke</button>
            </div>
          ))}
          {link && <span className="break-all text-caption text-ink-muted" data-invite-link>{inviteUrl(link.token)}</span>}
          <InviteForm teams={detail.teams} onMade={(i) => { setLink(i.email ? null : i); setMessage(i.email ? `${i.email} is in on their next sign-in.` : "Link made. It works for 7 days."); void load(); }} org={org.id} />
          <span className={divider} />
          <RenameForm org={org} onDone={() => { setMessage("Renamed."); void load(); }} />
          {message && <span role="status" className="text-caption leading-note text-ink-muted">{message}</span>}
        </div>
      )}
    </PreviewModal>
  );
}

const inviteUrl = (token: string): string => `${window.location.origin}/sign-in?invite=${encodeURIComponent(token)}`;

function MemberRow({ m, teams, isMe, owner, run, org }: { m: Membership; teams: OrgTeamSummary[]; isMe: boolean; owner: boolean; run: (w: () => Promise<unknown>, said: string) => Promise<void>; org: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(m));
  const [role, setRole] = useState<"admin" | "member">(m.role === "admin" ? "admin" : "member");
  const sees = m.teams === null ? "every team" : plural(m.teams.length, "team");
  return (
    <div role="group" aria-label={m.name} className="flex flex-col gap-1.5 rounded-tile border-2 border-ink bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-small">{m.name}{isMe ? " (you)" : ""}</span>
        <span className="text-caption text-ink-muted">{levelWords(0, m.role) === "No access" ? "Member" : levelWords(0, m.role)} · sees {sees} · heads {m.heads.length} · assists {m.assists.length}</span>
      </div>
      {!isMe && m.role !== "owner" && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={`${pill} min-h-9 px-3 text-small`} onClick={() => { setEditing((e) => !e); }}>{editing ? "Cancel" : "Change…"}</button>
          <TwoStep label="Remove" confirm="Tap again to remove" base={`${pill} min-h-9 px-3 text-small`} onConfirm={() => { void run(() => api.removeMember(org, m.coach), `${m.name} removed`); }} />
          {owner && <TwoStep label="Make owner" confirm="Tap again: you become an admin" base={`${pill} min-h-9 px-3 text-small`} onConfirm={() => { void run(() => api.transferOwner(org, m.coach), `${m.name} owns the organization now`); }} />}
        </div>
      )}
      {editing && (
        <form className="flex flex-col gap-2" onSubmit={(e: SubmitEvent) => { e.preventDefault(); setEditing(false); void run(() => api.setMember(org, m.coach, { ...grantsOf(draft), role }), `${m.name} changed`); }}>
          <label className="flex items-center gap-2 text-small">Role
            <select value={role} onChange={(e) => { setRole(e.target.value as "admin" | "member"); }} className={`${select} min-h-9 py-0.5 text-small`}>
              <option value="member">Member</option><option value="admin">Admin</option>
            </select>
          </label>
          <GrantsEditor teams={teams} draft={draft} onChange={setDraft} label="Sees" />
          <button type="submit" className={`${pillDark} min-h-11 self-start px-4 text-small`}>Save changes</button>
        </form>
      )}
    </div>
  );
}

function InviteForm({ teams, onMade, org }: { teams: OrgTeamSummary[]; onMade: (i: Invite) => void; org: string }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<Draft>({ all: true, teams: new Set(), roles: {} });
  const [error, setError] = useState("");
  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    try {
      const made = await invite(org, { ...grantsOf(draft), ...(email.trim() ? { email: email.trim() } : {}) });
      setOpen(false); setEmail(""); setError("");
      onMade(made);
    } catch (err) { setError(err instanceof Error ? err.message : "Couldn't make the invite."); }
  };
  if (!open) return <button type="button" className={`${pill} min-h-11 self-start px-3 text-small`} onClick={() => { setOpen(true); }}>Invite a coach…</button>;
  return (
    <form onSubmit={(e) => { void onSubmit(e); }} aria-label="Invite a coach" className="flex flex-col gap-2 rounded-tile border-2 border-dashed border-ink p-2.5">
      <input value={email} onChange={(e) => { setEmail(e.target.value); }} type="email" placeholder="Email (leave empty for a link)" aria-label="Email to invite" className={input} />
      <GrantsEditor teams={teams} draft={draft} onChange={setDraft} label="They see" />
      <div className="flex gap-2">
        <button type="submit" className={`${pillDark} min-h-11 px-4 text-small`}>{email.trim() ? "Invite by email" : "Make a link"}</button>
        <button type="button" onClick={() => { setOpen(false); }} className={`${pill} min-h-11 px-3 text-small`}>Cancel</button>
      </div>
      {error && <span role="alert" className="text-small">{error}</span>}
      <span className="text-caption leading-note text-ink-muted">A link works for 7 days for anyone who has it; an email invite works once, for that address. Everyone invited sees every roster they can see a team of.</span>
    </form>
  );
}

function RenameForm({ org, onDone }: { org: OrgSummary; onDone: () => void }) {
  const [name, setName] = useState(org.name);
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={(e: SubmitEvent) => { e.preventDefault(); void manage(() => api.renameOrg(org.id, name)).then((ok) => { if (ok) onDone(); }); }}>
      <input value={name} onChange={(e) => { setName(e.target.value); }} maxLength={40} aria-label="Organization name" className={`${input} min-w-0 flex-1`} />
      <button type="submit" className={`${pill} min-h-11 px-3 text-small`}>Rename</button>
    </form>
  );
}

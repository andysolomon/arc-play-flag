"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type SubmitEvent } from "react";
import {
  SIGN_IN_PATH, canOpenProfile, createTeam, currentOrgTeam, currentTeam, deleteTeam, getAccountState, getServerAccountState, openProfile, signOut,
  subscribeAccount, switchTeam, type AccountState,
} from "@/lib/account/sync";
import { clearNotice } from "@/lib/org/sync";
import { HEAD } from "@/lib/org/types";
import { Chevron, Menu, MenuHeading } from "../Menu";
import { chip, eyebrow, input, menuChoice, menuItem, menuItemDanger, pill, pillDark } from "../ui";
import { OrgSection, levelWords } from "./OrgPanel";

const plural = (n: number, one: string): string => `${String(n)} ${one}${n === 1 ? "" : "s"}`;

/** What the status line says, in one line a coach can act on. */
export function statusWords(s: AccountState): string {
  switch (s.status) {
    case "checking": return "Checking your account…";
    case "saving": return s.org ? "Sharing with your organization…" : "Saving to your account…";
    case "saved": return s.message ?? (s.org ? "Shared with your organization" : "Saved to your account");
    case "pending": return s.message ?? (s.org ? "Not yet shared with your organization" : "Not yet in your account");
    case "offline": return "Offline. Saves to your account when you're back online.";
    case "busy": return "One moment…";
    case "error": return s.message ?? "Something went wrong with your account.";
    case "idle": return s.message ?? "";
  }
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState);
}

/** The note under the team fields: where the team's name goes, and where it is kept. */
export function TeamNote() {
  const s = useAccount();
  const kept = s.user && s.teamId ? (s.org ? `Shared with ${s.orgs.find((o) => o.id === s.org)?.name ?? "your organization"}.` : "Saved to your account.") : "Saved on this device.";
  return <span className="flex-none text-caption leading-note text-ink-muted">Your name is painted across a styled end zone and goes on cards, slides and printed pages. {kept}</span>;
}

/**
 * The account corner of Play tools and of the playbooks' settings: who is signed in, which of their
 * teams this device has open, and whether the account has the latest. Signed out, it says what an
 * account is for and leads to sign-in (docs/adr/012-coach-accounts.md).
 */
export function AccountPanel({ heading = true }: { heading?: boolean }) {
  const s = useAccount();
  return (
    <div className="flex flex-none flex-col gap-2" data-account-mode={s.mode}>
      {heading && <span className={eyebrow}>ACCOUNT</span>}
      {s.mode === "off" ? (
        <span className="text-caption leading-note text-ink-muted">Sign-in isn&apos;t set up on this deployment. Your work stays on this device.</span>
      ) : s.user ? (
        <SignedIn s={s} />
      ) : s.mode === "unknown" && s.teamId && s.status !== "checking" ? (
        // the account can't be reached and this device mirrors a team: most likely signed in and offline (A7)
        <span role="status" aria-label="Account status" data-status={s.status} className="text-caption leading-note text-ink-muted">
          {s.status === "offline" ? "Offline. Your work stays on this device and goes to your account when you're back online." : statusWords(s)}
        </span>
      ) : (
        <>
          <span className="text-small leading-note">Sign in with Google or X to keep your plays, playbooks, lineups and the play on your board in an account, and pick up where you left off on any device.</span>
          <Link href={SIGN_IN_PATH} className={`${pillDark} inline-flex min-h-11 items-center self-start px-4 text-small !text-cream no-underline`}>Sign in</Link>
          {s.status === "checking" && <span role="status" aria-label="Account status" className="text-caption leading-note text-ink-muted">{statusWords(s)}</span>}
          {s.message && <span role="status" aria-label="Account status" className="text-caption leading-note text-ink-muted">{s.message}</span>}
        </>
      )}
    </div>
  );
}

/** The notice of what another coach did, shown for a moment under the status line (ADR 013, rule 8). */
function Notice({ s }: { s: AccountState }) {
  const notice = s.notice;
  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(clearNotice, 6000);
    return () => { window.clearTimeout(t); };
  }, [notice]);
  if (!notice) return null;
  return <span role="status" aria-label="Organization notice" className="text-caption leading-note text-ink">{notice}</span>;
}

function SignedIn({ s }: { s: AccountState }) {
  const own = currentTeam(s);
  const orgTeam = currentOrgTeam(s);
  const team = own ?? orgTeam;
  const orgName = s.org ? s.orgs.find((o) => o.id === s.org)?.name ?? "the organization" : null;
  const [orgForNew, setOrgForNew] = useState<string | null>(null);
  const canDelete = team !== null && (!s.org || (s.level ?? 0) >= HEAD);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const close = useCallback(() => { setOpen(false); }, []);
  const busy = s.status === "busy";
  const onCreate = (e: SubmitEvent) => {
    e.preventDefault();
    setMaking(false);
    void createTeam(name, orgForNew);
    setName("");
  };
  const teamCount = s.teams.length + s.orgTeams.length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-small">Signed in as <strong className="font-normal text-ink">{s.user?.name}</strong></span>
        {canOpenProfile() && <button type="button" onClick={openProfile} className={`${pill} min-h-11 px-3 text-small`}>Manage account</button>}
        <button type="button" disabled={busy} onClick={() => { void signOut(); }} className={`${pill} min-h-11 px-3 text-small`}>Sign out</button>
      </div>
      <div ref={root} className="relative flex-none">
        <button
          ref={trigger} type="button" disabled={busy} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-label="Switch team"
          onClick={() => { setOpen((o) => !o); }}
          className={`${pill} flex min-h-11 w-full items-center gap-2 px-3 text-left text-small`}
        >
          <span aria-hidden className="h-4 w-4 flex-none rounded-full border-2 border-ink" style={{ background: team?.color ?? "#f2b705" }} />
          <span className="min-w-0 flex-1 truncate">{team?.name ?? "Opening your team…"}</span>
          {orgTeam && <span className={chip} data-level={s.level}>{levelWords(s.level ?? 0)}</span>}
          <span className="text-caption text-ink-muted">{plural(teamCount, "team")}</span>
          <Chevron open={open} />
        </button>
        {open && (
          <Menu id={menuId} label="Teams" root={root} trigger={trigger} onClose={close} className="absolute left-0 right-0 top-full z-20 mt-1">
            <MenuHeading>Your teams</MenuHeading>
            {s.teams.map((t) => (
              <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === s.teamId} className={menuChoice}
                onClick={() => { close(); void switchTeam(t.id); }}>
                <span aria-hidden className="h-3.5 w-3.5 flex-none rounded-full border-2 border-ink" style={{ background: t.color }} />
                <span className="min-w-0 flex-1 truncate">{t.name}</span>
                <span className="text-caption text-ink-muted">{plural(t.plays, "play")}</span>
              </button>
            ))}
            <button type="button" role="menuitem" className={menuItem} onClick={() => { close(); setDeleting(false); setOrgForNew(null); setMaking(true); }}>+ New team…</button>
            {s.orgs.map((o) => (
              <div key={o.id} className="contents">
                <MenuHeading>{o.name}</MenuHeading>
                {s.orgTeams.filter((t) => t.org === o.id).map((t) => (
                  <button key={t.id} type="button" role="menuitemradio" aria-checked={t.id === s.teamId && o.id === s.org} className={menuChoice}
                    onClick={() => { close(); void switchTeam(t.id, o.id); }}>
                    <span aria-hidden className="h-3.5 w-3.5 flex-none rounded-full border-2 border-ink" style={{ background: t.color }} />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="text-caption text-ink-muted">{levelWords(t.level)} · {plural(t.plays, "play")}</span>
                  </button>
                ))}
                <button type="button" role="menuitem" className={menuItem} onClick={() => { close(); setDeleting(false); setOrgForNew(o.id); setMaking(true); }}>+ New team in {o.name}…</button>
              </div>
            ))}
            {team && canDelete && (
              <button type="button" role="menuitem" className={menuItemDanger} onClick={() => { close(); setMaking(false); setDeleting(true); }}>
                Delete “{team.name}” {s.org ? `from ${orgName ?? "the organization"}` : "from your account"}…
              </button>
            )}
          </Menu>
        )}
      </div>
      {making && (
        <form onSubmit={onCreate} className="flex flex-none flex-col gap-2" aria-label="New team">
          <input value={name} onChange={(e) => { setName(e.target.value); }} maxLength={40} placeholder="Team name" aria-label="New team name" autoFocus className={input} />
          <div className="flex gap-2">
            <button type="submit" className={`${pillDark} min-h-11 px-4 text-small`}>Create team</button>
            <button type="button" onClick={() => { setMaking(false); }} className={`${pill} min-h-11 px-3 text-small`}>Cancel</button>
          </div>
          <span className="text-caption leading-note text-ink-muted">A team starts empty. Each team has its own plays, playbooks, lineups and colour.{orgForNew ? " Every coach in the organization will see it; you head it." : ""}</span>
        </form>
      )}
      {deleting && team && (
        <div role="group" aria-label="Delete team" className="flex flex-none flex-col gap-2 rounded-tile border-2 border-ink bg-white p-3">
          <span className="text-small leading-note">Delete “{team.name}” and its {plural(team.plays, "play")} and {plural(team.playbooks, "playbook")} {s.org ? `from ${orgName ?? "the organization"}, for every coach in it` : "from your account"}? This device opens another team.</span>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setDeleting(false); void deleteTeam(team.id, s.org); }} className={`${pillDark} min-h-11 px-4 text-small`}>Delete team</button>
            <button type="button" onClick={() => { setDeleting(false); }} className={`${pill} min-h-11 px-3 text-small`}>Cancel</button>
          </div>
        </div>
      )}
      {orgTeam && (s.level ?? 0) < 2 && (
        <span className="text-caption leading-note text-ink-muted" data-read-only>{(s.level ?? 0) === 0 ? "You no longer have access to this team." : `You can look at this team but not change it. Ask an admin of ${orgName ?? "the organization"}.`} Printing and every export still work.</span>
      )}
      <span role="status" aria-label="Account status" data-status={s.status} className="text-caption leading-note text-ink-muted">{statusWords(s)}</span>
      <Notice s={s} />
      <OrgSection s={s} />
    </>
  );
}

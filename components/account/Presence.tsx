"use client";

import { useSyncExternalStore } from "react";
import { getServerAccountState, getAccountState, subscribeAccount } from "@/lib/account/sync";
import { getPlays, getServerPlays, subscribe } from "@/lib/play/library";
import type { Presence as Who } from "@/lib/org/types";

/** A coach's initials, for an avatar. */
export const initials = (name: string): string => name.split(/\s+/).filter((w) => w && !/^coach$/i.test(w)).map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 2) || "C";

/** The other coaches on this team right now, as avatars with where they are (ADR 013, rule 8); nothing on a coach's own team. */
export function Presence({ className = "" }: { className?: string }) {
  const s = useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState);
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  if (!s.org || s.presence.length === 0) return null;
  const where = (p: Who): string => (p.play ? `on “${plays.find((x) => x.id === p.play)?.name ?? "a play"}”` : "looking at the playbooks");
  return (
    <ul aria-label="Coaches here now" className={`m-0 flex list-none items-center gap-1 p-0 ${className}`}>
      {s.presence.map((p) => (
        <li key={p.coach} title={`${p.name}, ${where(p)}`} aria-label={`${p.name}, ${where(p)}`}
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-yellow-soft text-caption leading-none text-ink">
          <span aria-hidden>{initials(p.name)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Who else is on a play, by first name, for the play's row and card. */
export function usePresenceOn(playId: string | null): string[] {
  const s = useSyncExternalStore(subscribeAccount, getAccountState, getServerAccountState);
  if (!playId) return [];
  return s.presence.filter((p) => p.play === playId).map((p) => p.name);
}

/** "2 hours ago", for a stamp. */
export function ago(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${String(m)} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${String(d)} day${d === 1 ? "" : "s"} ago`;
}

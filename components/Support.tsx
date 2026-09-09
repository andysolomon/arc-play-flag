"use client";

import { type MouseEvent } from "react";
import { REPO, reportUrl } from "@/lib/diagnostics";

const NEW_ISSUE = `https://github.com/${REPO}/issues/new`;

/**
 * "Report a problem": a link to a new GitHub issue with the scrubbed diagnostics filled
 * in. The body is built at click time so it carries whatever happened most recently, and
 * the coach sees the whole thing on GitHub before posting it.
 */
export function ReportLink({ children = "Report a problem" }: { children?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => { e.currentTarget.href = reportUrl(); };
  return (
    <a href={NEW_ISSUE} target="_blank" rel="noopener noreferrer" onClick={onClick}>{children}</a>
  );
}

/** Where a coach's plays are, in plain words that match what the code does. */
export function StorageNote() {
  return (
    <details className="text-caption leading-note text-ink-muted">
      <summary className="cursor-pointer">Where your plays live</summary>
      <ul className="mb-0 mt-1 flex flex-col gap-1 pl-4">
        <li>Plays, playbooks, your team name and the play you&apos;re drawing are saved in this browser only, on this device. There&apos;s no account and nothing is sent to a server.</li>
        <li>A share link carries the whole play inside the address, so anyone who has the link can open it.</li>
        <li>Clearing this site&apos;s data, or closing a private window, removes your plays. Keep a copy: export a playbook file from Playbooks.</li>
        <li>When something breaks, a short note about the error (never your plays or notes) is kept in this browser for “Report a problem”.</li>
      </ul>
    </details>
  );
}

/** The support corner of the Play tools sidebar. */
export function Support() {
  return (
    <div className="flex flex-none flex-col gap-1">
      <StorageNote />
      <span className="text-caption leading-note text-ink-muted">
        Something wrong? <ReportLink />
      </span>
    </div>
  );
}

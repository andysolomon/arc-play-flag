"use client";

import { memo, useRef, type ChangeEvent } from "react";
import { byLine } from "@/lib/play/assignments";
import { teamFill } from "@/lib/play/geometry";
import { MAX_DEPTH, MAX_NAME, depthOf, depthWord, starterOf, withDepth } from "@/lib/play/roster";
import type { Player, Roster, Team } from "@/lib/play/types";
import { Sticker } from "./Sticker";
import { crumb, eyebrow, input, pill } from "./ui";

interface Props {
  roster: Roster;
  onRoster: (next: Roster) => void;
  /** the position tapped on the field, whose depth chart is being set */
  selected: Player | null;
  /** everyone on the field, both teams, for the list of positions */
  players: readonly Player[];
  /** the play's own side: its positions are listed first */
  side: Team;
  /** a position in the list tapped: select that player on the field */
  onSelect: (id: string) => void;
  /** the tag field, the same one the route palette has */
  onRename: (id: string, label: string, commit: boolean) => void;
  /** back to drawing the play */
  onDone: () => void;
}

const SIDE_WORD: Record<Team, string> = { offense: "OFFENSE", defense: "DEFENSE" };

/** "Devon, 2 deep", "Unassigned" or "No tag": a position's line in the list, and how its button is named. */
function says(roster: Roster, p: Player): string {
  if (!p.label) return "No tag";
  const who = starterOf(roster, p.team, p.label);
  const deep = depthOf(roster, p.team, p.label).length;
  if (!who) return deep > 1 ? `Unassigned, ${String(deep)} deep` : "Unassigned";
  return deep > 1 ? `${who}, ${String(deep)} deep` : who;
}

/**
 * The right sidebar in roster mode (docs/adr/008-roster-depth-chart.md): the position tapped on the field
 * with its depth chart to fill in, starter first, and every position on the field to jump between. The
 * roster is the team's, kept on this device, so a change here lands at once and is never undone.
 */
function RosterSidebarImpl({ roster, onRoster, selected: sel, players, side, onSelect, onRename, onDone }: Props) {
  // one history entry per rename session, not per keystroke, as the palette's tag field does
  const renaming = useRef<string | null>(null);
  // the line just added gets the focus as it mounts, so a name can be typed straight away
  const focusLine = useRef<number | null>(null);

  const depth = sel?.label ? depthOf(roster, sel.team, sel.label) : [];
  const set = (next: readonly string[]) => {
    if (sel?.label) onRoster(withDepth(roster, sel.team, sel.label, next));
  };
  const change = (i: number, name: string) => { set(depth.map((n, k) => (k === i ? name : n))); };
  const add = () => {
    if (depth.length >= MAX_DEPTH) return;
    focusLine.current = depth.length;
    set([...depth, ""]);
  };
  const remove = (i: number) => { set(depth.filter((_, k) => k !== i)); };
  const up = (i: number) => {
    if (i <= 0) return;
    const next = [...depth];
    const a = next[i - 1] ?? "", b = next[i] ?? "";
    next[i - 1] = b;
    next[i] = a;
    set(next);
  };
  // the play's own side first, each team left to right as the wristbands count them
  const teams: Team[] = side === "defense" ? ["defense", "offense"] : ["offense", "defense"];

  return (
    <>
      <span className={eyebrow}>ROSTER</span>
      {!sel && (
        <div className="flex flex-none flex-col items-center gap-[10px] rounded-tile border-2 border-dashed border-ink px-[10px] py-[18px]">
          <Sticker icon="roster" size={56} className="opacity-75" />
          <span className="text-center text-base leading-body text-ink-muted">
            Tap a position on the field to set who plays it.
            <br />
            Drag to line them up.
          </span>
        </div>
      )}
      {sel && (
        <>
          <div className="flex flex-none items-center gap-[10px]">
            {/* the coloured token is the tag field, as in the route palette: the tag is the position */}
            <input
              value={sel.label}
              maxLength={3}
              placeholder="Tag"
              aria-label="Player tag"
              title="Position tag (up to 3 letters)"
              onFocus={() => { renaming.current = null; }}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const commit = renaming.current !== sel.id;
                renaming.current = sel.id;
                onRename(sel.id, e.target.value, commit);
              }}
              className="h-[42px] w-[42px] flex-none rounded-full border-[2.5px] border-ink p-0 text-center text-base text-ink placeholder:text-ink/60"
              style={{ background: teamFill(sel.team) }}
            />
            <h2 className="flex-1 text-title font-normal leading-tight">
              {sel.label ? `Who plays ${sel.label}` : "Tag this position first"}
            </h2>
          </div>
          {sel.label && (
            <div className="flex flex-none flex-col gap-1.5" role="group" aria-label={`Depth chart at ${sel.label}`}>
              <span className={eyebrow}>DEPTH CHART</span>
              {depth.length === 0 && (
                <span className="flex-none text-small leading-note text-ink-muted">Nobody is down for {sel.label} yet.</span>
              )}
              {depth.length > 0 && (
                <ol className="flex flex-none flex-col gap-1.5">
                  {depth.map((name, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <span className={`${crumb} w-7 flex-none justify-center`} data-active={i === 0} aria-hidden="true">{String(i + 1)}</span>
                      <input
                        ref={(node) => { if (node && focusLine.current === i) { focusLine.current = null; node.focus(); } }}
                        value={name}
                        maxLength={MAX_NAME}
                        placeholder={i === 0 ? "Starter" : "Next up"}
                        aria-label={`${depthWord(i)} at ${sel.label}`}
                        autoComplete="off"
                        autoCapitalize="words"
                        onChange={(e: ChangeEvent<HTMLInputElement>) => { change(i, e.target.value); }}
                        className={`${input} min-w-0 flex-1 px-3`}
                      />
                      <button
                        type="button"
                        onClick={() => { up(i); }}
                        disabled={i === 0}
                        title={i === 0 ? "The starter" : "Move up the depth chart"}
                        aria-label={`Move ${name.trim() || depthWord(i)} up`}
                        className={`${pill} min-h-11 min-w-11 flex-none px-2 text-base`}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => { remove(i); }}
                        title="Take off the depth chart"
                        aria-label={`Remove ${name.trim() || depthWord(i)}`}
                        className={`${pill} min-h-11 min-w-11 flex-none px-2 text-base`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <button
                type="button"
                onClick={add}
                disabled={depth.length >= MAX_DEPTH}
                className={`${pill} min-h-11 flex-none self-start px-3 py-1 text-small`}
              >
                + Add a player
              </button>
              <span className="flex-none text-caption leading-note text-ink-muted">
                Starter first; ▲ moves a player up. The starter&apos;s name shows under {sel.label} on every play. Kept on this device, never in links or printouts.
              </span>
            </div>
          )}
        </>
      )}
      {teams.map((team) => {
        const list = players.filter((p) => p.team === team).sort(byLine);
        if (!list.length) return null;
        return (
          <div key={team} className="flex flex-none flex-col gap-1.5" role="group" aria-label={`${team === "offense" ? "Offense" : "Defense"} positions`}>
            <span className={eyebrow}>{SIDE_WORD[team]}</span>
            <ul className="flex flex-none flex-col gap-1">
              {list.map((p) => {
                const line = says(roster, p);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => { onSelect(p.id); }}
                      aria-pressed={p.id === sel?.id}
                      data-active={p.id === sel?.id}
                      aria-label={`${p.label || "No tag"}: ${line}`}
                      className={`${pill} flex min-h-11 w-full items-center gap-2 px-3 text-left text-small data-[active=true]:bg-yellow data-[active=true]:on-yellow data-[active=true]:hover:bg-yellow`}
                    >
                      <span aria-hidden="true" className="h-5 w-5 flex-none rounded-full border-2 border-ink" style={{ background: teamFill(p.team) }} />
                      <span className="w-7 flex-none">{p.label || "·"}</span>
                      <span className={`min-w-0 flex-1 truncate ${line.startsWith("Unassigned") || line === "No tag" ? "text-ink-muted" : ""}`}>{line}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
      <button type="button" onClick={onDone} className={`${pill} min-h-11 flex-none self-start px-3 py-1 text-small`}>
        ‹ Back to routes
      </button>
    </>
  );
}

export const RosterSidebar = memo(RosterSidebarImpl);

"use client";

import { memo, useEffect, useId, useRef, useState, type ChangeEvent } from "react";
import { byLine } from "@/lib/play/assignments";
import { teamFill } from "@/lib/play/geometry";
import {
  MAIN_LINEUP, MAX_LINEUPS, MAX_LINEUP_NAME, activeLineup, branched, fromName, lineupName, renamed, withActive, without,
} from "@/lib/play/lineup";
import { MAX_DEPTH, MAX_NAME, available, depthOf, depthWord, playerNames, standings, starterOf, teamNames, withDepth, withPlayer } from "@/lib/play/roster";
import { shown } from "@/lib/play/reducer";
import { newId } from "@/lib/play/storage";
import type { Lineups, Player, Roster, Team, Vis } from "@/lib/play/types";
import { VIEW } from "./Header";
import { Sticker } from "./Sticker";
import { crumb, eyebrow, input, pill, segment, segmentInput, segmented, select } from "./ui";

/** The views in the order the header's badge goes through them. */
const VIEWS: readonly Vis[] = ["offense", "defense", "both"];

interface Props {
  /** every lineup and which one the field shows */
  lineups: Lineups;
  onLineups: (next: Lineups) => void;
  /** the active lineup's slots, the ones the depth chart edits */
  roster: Roster;
  onRoster: (next: Roster) => void;
  /** the position tapped on the field, whose depth chart is being set */
  selected: Player | null;
  /** everyone on the field, both teams, for the list of positions */
  players: readonly Player[];
  /** the play's own side: its positions are listed first when both are on view */
  side: Team;
  /** which side of the roster is on the field, or both; the header's badge and the SHOW pills set it */
  view: Vis;
  onView: (next: Vis) => void;
  /** a position in the list tapped: select that player on the field */
  onSelect: (id: string) => void;
  /** the tag field, the same one the route palette has */
  onRename: (id: string, label: string, commit: boolean) => void;
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
function RosterSidebarImpl({ lineups, onLineups, roster, onRoster, selected: sel, players, side, view, onView, onSelect, onRename }: Props) {
  const lineup = activeLineup(lineups);
  const parent = fromName(lineups, lineup);
  const pickId = useId(), nameId = useId(), fromId = useId(), viewName = useId();
  // a lineup just branched gets its name field, so the coach can say what it is for straight away
  const nameRef = useRef<HTMLInputElement>(null);
  const nameNext = useRef<string | null>(null);
  useEffect(() => {
    if (nameNext.current !== lineup.id) return;
    nameNext.current = null;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [lineup.id]);
  // Delete asks once, in place, since a lineup is not undoable: the pill becomes the question
  const [deleting, setDeleting] = useState(false);
  const branch = () => {
    const id = newId();
    const next = branched(lineups, lineup.id, id);
    if (!next) return;
    nameNext.current = id;
    setDeleting(false);
    onLineups(next);
  };
  const pick = (id: string) => { setDeleting(false); onLineups(withActive(lineups, id)); };
  const removeLineup = () => { setDeleting(false); onLineups(without(lineups, lineup.id)); };
  // one history entry per rename session, not per keystroke, as the palette's tag field does
  const renaming = useRef<string | null>(null);
  // a player's page: the name, and which selection it was opened over, so a tap on the field turns it back
  // to that position's chart with no effect to time it
  const [page, setPage] = useState<{ name: string; over: string | null } | null>(null);
  const player = page && page.over === (sel?.id ?? null) ? page.name : null;
  const names = playerNames(roster);
  // the page's positions are a way to their depth charts: the first player wearing that tag on that team,
  // brought onto the field first when their side is not on view
  const goTo = (team: Team, tag: string) => {
    const p = players.filter((q) => q.team === team && q.label === tag).sort(byLine)[0];
    setPage(null);
    if (!p) return;
    if (!shown(p, view)) onView(team);
    onSelect(p.id);
  };
  // "X starter, LC 2nd": where a player sits, for the list
  const sits = (name: string): string => standings(roster, name).map((s) => `${s.tag} ${depthWord(s.depth).toLowerCase()}`).join(", ");
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
  // a player already on the team goes on this chart by name, no typing: everyone on any lineup not down for it yet,
  // this lineup's spelling first (R8)
  const squad = teamNames([roster, ...lineups.lineups.filter((l) => l.id !== lineup.id).map((l) => l.slots)]);
  const open = sel?.label ? available(squad, depth) : [];
  const addFrom = (name: string) => { set(withPlayer(depth, name)); };
  const remove = (i: number) => { set(depth.filter((_, k) => k !== i)); };
  const up = (i: number) => {
    if (i <= 0) return;
    const next = [...depth];
    const a = next[i - 1] ?? "", b = next[i] ?? "";
    next[i - 1] = b;
    next[i] = a;
    set(next);
  };
  // the side on view, or both with the play's own side first; each team left to right as the wristbands count them
  const teams: Team[] = view === "both" ? (side === "defense" ? ["defense", "offense"] : ["offense", "defense"]) : [view];

  return (
    <>
      <span className={eyebrow}>ROSTER</span>
      <div className="flex flex-none flex-col gap-1.5" role="group" aria-label="Lineup">
        <label htmlFor={pickId} className="flex-none text-small">Lineup</label>
        <select id={pickId} value={lineup.id} onChange={(e: ChangeEvent<HTMLSelectElement>) => { pick(e.target.value); }} className={`${select} w-full flex-none`}>
          {lineups.lineups.map((l) => <option key={l.id} value={l.id}>{lineupName(l)}</option>)}
        </select>
        <label htmlFor={nameId} className="sr-only">Lineup name</label>
        <input
          id={nameId}
          ref={nameRef}
          value={lineup.name}
          maxLength={MAX_LINEUP_NAME}
          placeholder="Lineup name"
          autoComplete="off"
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onLineups(renamed(lineups, lineup.id, e.target.value)); }}
          className={`${input} flex-none`}
        />
        {parent && <span className="flex-none text-caption leading-note text-ink-muted">Branched from {parent}.</span>}
        <div className="flex flex-none flex-wrap gap-1.5">
          {deleting ? (
            <>
              <span className="flex min-h-11 items-center text-small">Delete {lineupName(lineup)}?</span>
              <button type="button" onClick={removeLineup} className={`${pill} min-h-11 px-3 py-1 text-small bg-yellow on-yellow hover:bg-yellow`}>Delete</button>
              <button type="button" onClick={() => { setDeleting(false); }} className={`${pill} min-h-11 px-3 py-1 text-small`}>Keep</button>
            </>
          ) : (
            <>
              <button
                type="button" onClick={branch} disabled={lineups.lineups.length >= MAX_LINEUPS}
                title="A new lineup, a copy of this one to change" className={`${pill} min-h-11 px-3 py-1 text-small`}
              >
                Branch lineup
              </button>
              {lineup.id !== MAIN_LINEUP && (
                <button type="button" onClick={() => { setDeleting(true); }} className={`${pill} min-h-11 px-3 py-1 text-small`}>Delete lineup</button>
              )}
            </>
          )}
        </div>
      </div>
      {player !== null && (
        <div className="flex flex-none flex-col gap-1.5" role="group" aria-label={`${player}'s positions`}>
          <h2 className="text-title font-normal leading-tight">{player}</h2>
          <span className={eyebrow}>POSITIONS</span>
          <ul className="flex flex-none flex-col gap-1">
            {standings(roster, player).map((st) => (
              <li key={`${st.team}-${st.tag}`}>
                <button
                  type="button"
                  onClick={() => { goTo(st.team, st.tag); }}
                  className={`${pill} flex min-h-11 w-full items-center gap-2 px-3 text-left text-small`}
                >
                  <span aria-hidden="true" className="h-5 w-5 flex-none rounded-full border-2 border-ink" style={{ background: teamFill(st.team) }} />
                  <span className="min-w-0 flex-1 truncate">{st.tag} · {depthWord(st.depth)}</span>
                </button>
              </li>
            ))}
          </ul>
          <span className="flex-none text-caption leading-note text-ink-muted">
            Where {player} sits on {lineupName(lineup)}. Tap a position to change its depth chart.
          </span>
          <button type="button" onClick={() => { setPage(null); }} className={`${pill} min-h-11 flex-none self-start px-3 py-1 text-small`}>
            ‹ Back
          </button>
        </div>
      )}
      {player === null && !sel && (
        <div className="flex flex-none flex-col items-center gap-[10px] rounded-tile border-2 border-dashed border-ink px-[10px] py-[18px]">
          <Sticker icon="roster" size={56} className="opacity-75" />
          <span className="text-center text-base leading-body text-ink-muted">
            Tap a position on the field to set who plays it.
            <br />
            Drag to line them up.
          </span>
        </div>
      )}
      {player === null && sel && (
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
              <div className="flex flex-none flex-wrap items-center gap-1.5">
                {open.length > 0 && (
                  <>
                    <label htmlFor={fromId} className="sr-only">Add from the team</label>
                    <select
                      id={fromId}
                      value=""
                      disabled={depth.length >= MAX_DEPTH}
                      title="Put a player already on the team down for this position"
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => { addFrom(e.target.value); }}
                      className={`${select} min-w-0 max-w-full flex-none`}
                    >
                      <option value="">Add from the team…</option>
                      {open.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </>
                )}
                <button
                  type="button"
                  onClick={add}
                  disabled={depth.length >= MAX_DEPTH}
                  title="A line for a name not on the team yet"
                  className={`${pill} min-h-11 flex-none px-3 py-1 text-small`}
                >
                  + New player
                </button>
              </div>
              <span className="flex-none text-caption leading-note text-ink-muted">
                Starter first; ▲ moves a player up. {open.length > 0 ? "Pick someone already on the team, or add a new player. " : ""}The starter&apos;s name shows under {sel.label} on every play. Kept on this device, never in links or printouts.
              </span>
            </div>
          )}
        </>
      )}
      {player === null && names.length > 0 && (
        <div className="flex flex-none flex-col gap-1.5" role="group" aria-label="Players">
          <span className={eyebrow}>PLAYERS</span>
          <ul className="flex flex-none flex-col gap-1">
            {names.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  onClick={() => { setPage({ name, over: sel?.id ?? null }); }}
                  aria-label={name}
                  className={`${pill} flex min-h-11 w-full items-center gap-2 px-3 text-left text-small`}
                >
                  <span className="min-w-0 flex-1 truncate">{name}</span>
                  <span className="min-w-0 max-w-[55%] truncate text-caption text-ink-muted">{sits(name)}</span>
                </button>
              </li>
            ))}
          </ul>
          <span className="flex-none text-caption leading-note text-ink-muted">Everyone on this lineup. Tap a name for every position they play.</span>
        </div>
      )}
      {player === null && (
        <div className="flex flex-none flex-col gap-1.5">
          <span className={eyebrow}>SHOW</span>
          <div role="radiogroup" aria-label="Show" className={segmented}>
            {VIEWS.map((v) => (
              <label key={v} title={VIEW[v].title} className={segment}>
                <input type="radio" name={viewName} value={v} checked={view === v} onChange={() => { onView(v); }} className={segmentInput} />
                {VIEW[v].label}
              </label>
            ))}
          </div>
          <span className="flex-none text-caption leading-note text-ink-muted">
            {view === "both" ? "Both sides of the roster on the field at once." : `The ${view} alone on the field; the roster has both sides.`}
          </span>
        </div>
      )}
      {player === null && teams.map((team) => {
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
    </>
  );
}

export const RosterSidebar = memo(RosterSidebarImpl);

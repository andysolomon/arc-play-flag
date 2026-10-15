"use client";

import { memo, useEffect, useId, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { byLine } from "@/lib/play/assignments";
import { teamFill } from "@/lib/play/geometry";
import {
  MAIN_LINEUP, MAX_LINEUPS, MAX_LINEUP_NAME, activeLineup, branched, fromName, lineupName, onTeam, renamed, renamedPlayer, teamFull,
  teamNames, withActive, withPlayer, withSlots, without, withoutPlayer,
} from "@/lib/play/lineup";
import { MAX_DEPTH, MAX_NAME, depthOf, depthWord, sameName, standings, starterOf, withDepth } from "@/lib/play/roster";
import { newId } from "@/lib/play/storage";
import type { Lineups, Player, Roster, Team } from "@/lib/play/types";
import { Sticker } from "./Sticker";
import { crumb, eyebrow, input, pill, select } from "./ui";

interface Props {
  /** the team's players, every lineup and which one the field shows */
  lineups: Lineups;
  onLineups: (next: Lineups) => void;
  /** the active lineup's slots, the ones the depth chart edits */
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
const row = `${pill} flex min-h-11 w-full items-center gap-2 px-3 text-left text-small`;
const small = `${pill} min-h-11 px-3 py-1 text-small`;
const note = "flex-none text-caption leading-note text-ink-muted";

/** "Devon, 2 deep", "Unassigned" or "No tag": a position's line in the list, and how its button is named. */
function says(roster: Roster, p: Player): string {
  if (!p.label) return "No tag";
  const who = starterOf(roster, p.team, p.label);
  const deep = depthOf(roster, p.team, p.label).length;
  if (!who) return deep > 1 ? `Unassigned, ${String(deep)} deep` : "Unassigned";
  return deep > 1 ? `${who}, ${String(deep)} deep` : who;
}

/** A token's colour as a dot beside a position's name. */
const Dot = ({ team }: { team: Team }) => (
  <span aria-hidden="true" className="h-5 w-5 flex-none rounded-full border-2 border-ink" style={{ background: teamFill(team) }} />
);

/**
 * The right sidebar in roster mode (docs/adr/008-roster-depth-chart.md). The team's players come first in
 * the coach's mind: a player joins the team by name, any time, and is then put on depth charts, from the
 * position tapped on the field (its chart is filled from the team) or from the player's own page. Every
 * position on the field is listed to jump between. The roster is the team's, kept on this device, so a
 * change here lands at once and is never undone.
 */
function RosterSidebarImpl({ lineups, onLineups, roster, onRoster, selected: sel, players, side, onSelect, onRename, onDone }: Props) {
  const lineup = activeLineup(lineups);
  const parent = fromName(lineups, lineup);
  const pickId = useId(), nameId = useId(), joinId = useId(), freshId = useId();
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

  // the team: everyone, the same on every lineup
  const names = teamNames(lineups);
  // the play's own side first, each team left to right as the wristbands count them
  const teams: Team[] = side === "defense" ? ["defense", "offense"] : ["offense", "defense"];
  // "X starter, LC 2nd": where a player sits on this lineup, for the lists
  const sits = (name: string): string =>
    standings(roster, name).map((s) => `${s.tag} ${depthWord(s.depth).toLowerCase()}`).join(", ") || "No position";

  // a player's page: the name, and which selection it was opened over, so a tap on the field turns it back
  // to that position's chart with no effect to time it; it closes once the name is off the team
  const [page, setPage] = useState<{ name: string; over: string | null } | null>(null);
  const player = page && page.over === (sel?.id ?? null) ? onTeam(lineups, page.name) : null;
  const [removing, setRemoving] = useState(false);
  // the page's name field: null while it shows the name as it is
  const [rename, setRename] = useState<string | null>(null);
  const [renameClash, setRenameClash] = useState<string | null>(null);
  const openPage = (name: string) => {
    setRemoving(false);
    setRename(null);
    setRenameClash(null);
    setPage({ name, over: sel?.id ?? null });
  };
  const saveName = (e: SyntheticEvent) => {
    e.preventDefault();
    if (player === null || rename === null || !rename.trim()) return;
    const next = renamedPlayer(lineups, player, rename);
    if (!next) { setRenameClash(rename.trim()); return; }
    onLineups(next);
    openPage(onTeam(next, rename) ?? rename.trim());
  };
  const removePlayer = () => {
    if (player === null) return;
    setRemoving(false);
    setPage(null);
    onLineups(withoutPlayer(lineups, player));
  };
  // the page's positions are a way to their depth charts: the first player wearing that tag on that team
  const goTo = (team: Team, tag: string) => {
    const p = players.filter((q) => q.team === team && q.label === tag).sort(byLine)[0];
    setPage(null);
    if (p) onSelect(p.id);
  };
  // the positions on the field a player is not down for yet: each tag once per team, the play's own side first
  const openings = (name: string): Player[] => {
    const held = standings(roster, name);
    const seen = new Set<string>();
    return teams.flatMap((team) => players.filter((p) => p.team === team && p.label).sort(byLine).filter((p) => {
      const k = `${p.team}-${p.label}`;
      if (seen.has(k) || held.some((h) => h.team === p.team && h.tag === p.label)) return false;
      seen.add(k);
      return true;
    }));
  };
  const putAt = (name: string, team: Team, tag: string) => {
    const depth = depthOf(roster, team, tag);
    if (depth.length >= MAX_DEPTH || depth.some((n) => sameName(n, name))) return;
    onRoster(withDepth(roster, team, tag, [...depth, name]));
  };

  // a player joining the team, from the PLAYERS list: the form takes the place of the button, and the
  // name opens its page, new or already there
  const [joining, setJoining] = useState(false);
  const [joinName, setJoinName] = useState("");
  const joinRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (joining) joinRef.current?.focus(); }, [joining]);
  const cancelJoin = () => { setJoining(false); setJoinName(""); };
  const join = (e: SyntheticEvent) => {
    e.preventDefault();
    const typed = joinName.trim();
    if (!typed) return;
    const next = withPlayer(lineups, typed);
    if (next) onLineups(next);
    cancelJoin();
    openPage(onTeam(next ?? lineups, typed) ?? typed);
  };

  // the position tapped: its depth chart, filled from the team
  const depth = sel?.label ? depthOf(roster, sel.team, sel.label) : [];
  const set = (next: readonly string[]) => {
    if (sel?.label) onRoster(withDepth(roster, sel.team, sel.label, next));
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
  // the chooser of team players to add to the chart, open over one position at a time
  const [choosing, setChoosing] = useState<string | null>(null);
  const chooser = sel?.label && choosing === sel.id && depth.length < MAX_DEPTH;
  const [fresh, setFresh] = useState("");
  const chooserRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chooser) chooserRef.current?.querySelector<HTMLElement>("button, input")?.focus();
  }, [chooser]);
  // Escape in the chooser closes it and keeps the position selected (the designer's own Escape deselects)
  const closeChooser = () => { setChoosing(null); setFresh(""); };
  const candidates = names.filter((n) => !depth.some((d) => sameName(d, n)));
  const addToChart = (name: string) => {
    set([...depth, name]);
    closeChooser();
  };
  // a name typed in the chooser joins the team and the chart in one write; one already on the team just goes on the chart
  const addFresh = (e: SyntheticEvent) => {
    e.preventDefault();
    const typed = fresh.trim();
    if (!typed || !sel?.label) return;
    const known = onTeam(lineups, typed);
    const base = known === null ? withPlayer(lineups, typed) : lineups;
    if (!base) return;
    const name = known ?? onTeam(base, typed) ?? typed;
    if (!depth.some((n) => sameName(n, name))) onLineups(withSlots(base, lineup.id, withDepth(roster, sel.team, sel.label, [...depth, name])));
    closeChooser();
  };

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
        {parent && <span className={note}>Branched from {parent}.</span>}
        <div className="flex flex-none flex-wrap gap-1.5">
          {deleting ? (
            <>
              <span className="flex min-h-11 items-center text-small">Delete {lineupName(lineup)}?</span>
              <button type="button" onClick={removeLineup} className={`${small} bg-yellow on-yellow hover:bg-yellow`}>Delete</button>
              <button type="button" onClick={() => { setDeleting(false); }} className={small}>Keep</button>
            </>
          ) : (
            <>
              <button
                type="button" onClick={branch} disabled={lineups.lineups.length >= MAX_LINEUPS}
                title="A new lineup, a copy of this one to change" className={small}
              >
                Branch lineup
              </button>
              {lineup.id !== MAIN_LINEUP && (
                <button type="button" onClick={() => { setDeleting(true); }} className={small}>Delete lineup</button>
              )}
            </>
          )}
        </div>
        <span className={note}>
          A branch starts as a copy of this lineup, for a day a player is away or a different opponent. The field shows the lineup picked here.
        </span>
      </div>

      {player !== null && (
        <>
          <div className="flex flex-none flex-col gap-1.5" role="group" aria-label={`${player}'s positions`}>
            <h2 className="text-title font-normal leading-tight">{player}</h2>
            <form className="flex flex-none items-center gap-1.5" onSubmit={saveName}>
              <input
                value={rename ?? player}
                maxLength={MAX_NAME}
                aria-label={`Rename ${player}`}
                autoComplete="off"
                autoCapitalize="words"
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setRename(e.target.value); setRenameClash(null); }}
                className={`${input} min-w-0 flex-1 px-3`}
              />
              <button type="submit" disabled={rename === null || !rename.trim() || rename.trim() === player} className={`${small} flex-none`}>
                Save name
              </button>
            </form>
            {renameClash !== null && (
              <span role="status" className="flex-none text-small leading-note">Somebody on the team is already called {renameClash}.</span>
            )}
            <span className={eyebrow}>POSITIONS</span>
            {standings(roster, player).length === 0 ? (
              <span className="flex-none text-small leading-note text-ink-muted">{player} is not down for any position on {lineupName(lineup)} yet.</span>
            ) : (
              <ul className="flex flex-none flex-col gap-1">
                {standings(roster, player).map((st) => (
                  <li key={`${st.team}-${st.tag}`}>
                    <button type="button" onClick={() => { goTo(st.team, st.tag); }} className={row}>
                      <Dot team={st.team} />
                      <span className="min-w-0 flex-1 truncate">{st.tag} · {depthWord(st.depth)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <span className={note}>Where {player} plays on {lineupName(lineup)}. Tap a position to change its depth chart.</span>
          </div>
          {openings(player).length > 0 && (
            <div className="flex flex-none flex-col gap-1.5" role="group" aria-label={`Put ${player} at a position`}>
              <span className={eyebrow}>PUT AT A POSITION</span>
              <ul className="flex flex-none flex-col gap-1">
                {openings(player).map((p) => {
                  const line = says(roster, p);
                  const full = depthOf(roster, p.team, p.label).length >= MAX_DEPTH;
                  return (
                    <li key={`${p.team}-${p.label}`}>
                      <button
                        type="button"
                        onClick={() => { putAt(player, p.team, p.label); }}
                        disabled={full}
                        aria-label={`Put ${player} at ${p.label}`}
                        title={full ? `${p.label} has ${String(MAX_DEPTH)} names already` : `Put ${player} on ${p.label}'s depth chart`}
                        className={row}
                      >
                        <Dot team={p.team} />
                        <span className="w-7 flex-none">{p.label}</span>
                        <span className={`min-w-0 flex-1 truncate ${line.startsWith("Unassigned") ? "text-ink-muted" : ""}`}>{line}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <span className={note}>Tap a position to put {player} on its depth chart: as the starter when nobody is down for it, else next up.</span>
            </div>
          )}
          <div className="flex flex-none flex-wrap gap-1.5">
            {removing ? (
              <>
                <span className="flex min-h-11 items-center text-small">Remove {player} from the team?</span>
                <button type="button" onClick={removePlayer} className={`${small} bg-yellow on-yellow hover:bg-yellow`}>Remove</button>
                <button type="button" onClick={() => { setRemoving(false); }} className={small}>Keep</button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { setPage(null); }} className={small}>‹ Back</button>
                <button type="button" onClick={() => { setRemoving(true); }} title="Off the team and every depth chart on every lineup" className={small}>
                  Remove from team
                </button>
              </>
            )}
          </div>
        </>
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
                    <li key={`${String(i)}-${name}`} className="flex items-center gap-1.5">
                      <span className={`${crumb} w-7 flex-none justify-center`} data-active={i === 0} aria-hidden="true">{String(i + 1)}</span>
                      <button
                        type="button"
                        onClick={() => { openPage(name); }}
                        aria-label={`${depthWord(i)} at ${sel.label}: ${name}`}
                        title={`${name}'s positions`}
                        className={`${pill} min-h-11 min-w-0 flex-1 truncate px-3 text-left text-base`}
                      >
                        {name}
                      </button>
                      <button
                        type="button"
                        onClick={() => { up(i); }}
                        disabled={i === 0}
                        title={i === 0 ? "The starter" : "Move up the depth chart"}
                        aria-label={`Move ${name} up`}
                        className={`${pill} min-h-11 min-w-11 flex-none px-2 text-base`}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => { remove(i); }}
                        title="Take off the depth chart (they stay on the team)"
                        aria-label={`Remove ${name}`}
                        className={`${pill} min-h-11 min-w-11 flex-none px-2 text-base`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {chooser ? (
                <div
                  ref={chooserRef}
                  role="group"
                  aria-label={`Add a player at ${sel.label}`}
                  className="flex flex-none flex-col gap-1.5 rounded-tile border-2 border-dashed border-ink p-2"
                >
                  {candidates.length > 0 ? (
                    <ul className="flex flex-none flex-col gap-1">
                      {candidates.map((name) => (
                        <li key={name}>
                          <button type="button" onClick={() => { addToChart(name); }} aria-label={`Add ${name} at ${sel.label}`} className={row}>
                            <span className="min-w-0 flex-1 truncate">{name}</span>
                            <span className="min-w-0 max-w-[55%] truncate text-caption text-ink-muted">{sits(name)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="flex-none text-small leading-note text-ink-muted">
                      {names.length ? `Everyone on the team is on ${sel.label}'s depth chart.` : "Nobody is on the team yet."}
                    </span>
                  )}
                  <form className="flex flex-none items-center gap-1.5" onSubmit={addFresh}>
                    <label htmlFor={freshId} className="sr-only">New player at {sel.label}</label>
                    <input
                      id={freshId}
                      value={fresh}
                      maxLength={MAX_NAME}
                      placeholder="New player"
                      autoComplete="off"
                      autoCapitalize="words"
                      onChange={(e: ChangeEvent<HTMLInputElement>) => { setFresh(e.target.value); }}
                      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeChooser(); } }}
                      className={`${input} min-w-0 flex-1 px-3`}
                    />
                    <button type="submit" disabled={!fresh.trim() || (onTeam(lineups, fresh) === null && teamFull(lineups))} className={`${small} flex-none`}>
                      Add
                    </button>
                  </form>
                  <span className={note}>Pick from the team, or type a new name: they join the team too.</span>
                  <button type="button" onClick={closeChooser} className={`${small} flex-none self-start`}>Cancel</button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setFresh(""); setChoosing(sel.id); }}
                  disabled={depth.length >= MAX_DEPTH}
                  className={`${small} flex-none self-start`}
                >
                  + Add a player
                </button>
              )}
              <span className={note}>
                Starter first; ▲ moves a player up. The starter&apos;s name shows under {sel.label} on every play. Kept on this device, never in links or printouts.
              </span>
            </div>
          )}
        </>
      )}

      {player === null && (
        <div className="flex flex-none flex-col gap-1.5" role="group" aria-label="Players">
          <span className={eyebrow}>PLAYERS</span>
          {names.length > 0 && (
            <ul className="flex flex-none flex-col gap-1">
              {names.map((name) => (
                <li key={name}>
                  <button type="button" onClick={() => { openPage(name); }} aria-label={name} className={row}>
                    <span className="min-w-0 flex-1 truncate">{name}</span>
                    <span className="min-w-0 max-w-[55%] truncate text-caption text-ink-muted">{sits(name)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {joining ? (
            <form className="flex flex-none items-center gap-1.5" onSubmit={join}>
              <label htmlFor={joinId} className="sr-only">Player name</label>
              <input
                id={joinId}
                ref={joinRef}
                value={joinName}
                maxLength={MAX_NAME}
                placeholder="Name"
                autoComplete="off"
                autoCapitalize="words"
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setJoinName(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancelJoin(); } }}
                className={`${input} min-w-0 flex-1 px-3`}
              />
              <button type="submit" disabled={!joinName.trim()} className={`${small} flex-none`}>Add</button>
              <button type="button" onClick={cancelJoin} className={`${small} flex-none`}>Cancel</button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => { setJoining(true); }}
              disabled={teamFull(lineups)}
              title="A player on the team, to put on the depth charts"
              className={`${small} flex-none self-start`}
            >
              + Add to team
            </button>
          )}
          <span className={note}>
            {names.length > 0
              ? `Everyone on the team, on every lineup, with where they play on ${lineupName(lineup)}. Tap a name to put them at a position.`
              : "Nobody is on the team yet. Add your players here, then put them on the depth charts."}
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
                      className={`${row} data-[active=true]:bg-yellow data-[active=true]:on-yellow data-[active=true]:hover:bg-yellow`}
                    >
                      <Dot team={p.team} />
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
      <button type="button" onClick={onDone} className={`${small} flex-none self-start`}>
        ‹ Back to routes
      </button>
    </>
  );
}

export const RosterSidebar = memo(RosterSidebarImpl);

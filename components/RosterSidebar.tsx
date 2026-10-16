"use client";

import { memo, useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type SyntheticEvent } from "react";
import { byLine } from "@/lib/play/assignments";
import { teamFill } from "@/lib/play/geometry";
import {
  MAIN_LINEUP, MAIN_NAME, MAX_LINEUPS, MAX_LINEUP_NAME, MAX_TEAM, SECOND_LINEUP, activeLineup, allLineups, branched, fromName, lineupName, onTeam,
  renamed, renamedPlayer, teamFull, teamNames, withActive, withPlayer, withSlots, without, withoutPlayer,
} from "@/lib/play/lineup";
import { MAX_DEPTH, MAX_NAME, depthOf, depthWord, isOffField, sameName, standings, starterOf, withDepth } from "@/lib/play/roster";
import { shown } from "@/lib/play/reducer";
import { newId } from "@/lib/play/storage";
import type { Lineups, Player, Roster, Team, Vis } from "@/lib/play/types";
import { VIEW } from "./Header";
import { Chevron, Menu, MenuHeading } from "./Menu";
import { Sticker } from "./Sticker";
import { crumb, eyebrow, input, menuChoice, menuItemDanger, pill, segment, segmentInput, segmented } from "./ui";

/** The views in the order the header's badge goes through them. */
const VIEWS: readonly Vis[] = ["offense", "defense", "both"];

interface Props {
  /** the team's players, every lineup and which one the field shows */
  lineups: Lineups;
  onLineups: (next: Lineups) => void;
  /** the active lineup's slots, the ones the depth chart edits */
  roster: Roster;
  onRoster: (next: Roster) => void;
  /** the position tapped on the field, whose depth chart is being set */
  selected: Player | null;
  /** the team's standard formation, both sides, then the tags it has no token for, for the list of positions */
  players: readonly Player[];
  /** which side of the roster is on the field, or both; the header's badge and the SHOW pills set it */
  view: Vis;
  onView: (next: Vis) => void;
  /** a position in the list tapped: select that player on the field */
  onSelect: (id: string) => void;
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

/** A fork, for branching a lineup: one line splitting in two. */
const Fork = () => (
  <svg aria-hidden viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 flex-none fill-none stroke-current">
    <circle cx="6" cy="5.5" r="2.5" />
    <circle cx="18" cy="5.5" r="2.5" />
    <circle cx="12" cy="18.5" r="2.5" />
    <path d="M6 8v1.5a2.5 2.5 0 0 0 2.5 2.5h7A2.5 2.5 0 0 0 18 9.5V8M12 12v4" />
  </svg>
);

/**
 * The right sidebar in roster mode (docs/adr/008-roster-depth-chart.md). The team's players come first in
 * the coach's mind: a player joins the team by name, any time, and is then put on depth charts, from the
 * position tapped on the field (its chart is filled from the team) or from the player's own page. Every
 * position on the field is listed to jump between. The roster is the team's, kept on this device, so a
 * change here lands at once and is never undone.
 */
function RosterSidebarImpl({ lineups, onLineups, roster, onRoster, selected: sel, players, view, onView, onSelect }: Props) {
  const lineup = activeLineup(lineups);
  const parent = fromName(lineups, lineup);
  // the Secondary Lineup is made from the starting lineup's depth charts: shown, branched, never changed itself (lineup.ts, S4)
  const made = lineup.id === SECOND_LINEUP;
  const source = parent ?? MAIN_NAME;
  const menuId = useId(), nameId = useId(), joinId = useId(), freshId = useId(), viewName = useId();
  // a lineup just branched gets its name field, so the coach can say what it is for straight away
  const nameRef = useRef<HTMLInputElement>(null);
  const nameNext = useRef<string | null>(null);
  useEffect(() => {
    if (nameNext.current !== lineup.id) return;
    nameNext.current = null;
    nameRef.current?.focus();
    nameRef.current?.select();
  }, [lineup.id]);
  // every lineup drops down from the name field, as the play name's list does, with Delete at the foot; a long
  // name wraps rather than being cut off, so two that differ only at the end are told apart before a pick
  const [listing, setListing] = useState(false);
  const listRoot = useRef<HTMLDivElement>(null);
  const listButton = useRef<HTMLButtonElement>(null);
  const closeList = useCallback(() => { setListing(false); }, []);
  // Delete asks once, in place, since a lineup is not undoable: the question opens under the row, on Keep
  const [deleting, setDeleting] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (deleting) keepRef.current?.focus(); }, [deleting]);
  const branch = () => {
    const id = newId();
    const next = branched(lineups, lineup.id, id);
    if (!next) return;
    nameNext.current = id;
    setDeleting(false);
    onLineups(next);
  };
  const pick = (id: string) => { closeList(); listButton.current?.focus(); setDeleting(false); onLineups(withActive(lineups, id)); };
  const askDelete = () => { closeList(); setDeleting(true); };
  const keepLineup = () => { setDeleting(false); listButton.current?.focus(); };
  const removeLineup = () => { setDeleting(false); listButton.current?.focus(); onLineups(without(lineups, lineup.id)); };

  // the team: everyone, the same on every lineup
  const names = teamNames(lineups);
  const full = teamFull(lineups);
  // offense then defense, each left to right as the wristbands count them; no play is open to put a side first
  const sides: Team[] = ["offense", "defense"];
  // the positions listed: the side on view, or both
  const teams: Team[] = view === "both" ? sides : [view];
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
  // the page's positions are a way to their depth charts: the first player wearing that tag on that team,
  // brought onto the field first when their side is not on view
  const goTo = (team: Team, tag: string) => {
    const p = players.filter((q) => q.team === team && q.label === tag).sort(byLine)[0];
    setPage(null);
    if (!p) return;
    if (!shown(p, view)) onView(team);
    onSelect(p.id);
  };
  // the positions a player is not down for yet, on both sides whatever is on view (a tap only writes the chart):
  // each tag once per team, offense first
  const openings = (name: string): Player[] => {
    const held = standings(roster, name);
    const seen = new Set<string>();
    return sides.flatMap((team) => players.filter((p) => p.team === team && p.label).sort(byLine).filter((p) => {
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
  const chooser = !made && sel?.label && choosing === sel.id && depth.length < MAX_DEPTH;
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
        <div className="flex flex-none items-center gap-1.5">
          <div ref={listRoot} className="relative min-w-0 flex-1">
            <label htmlFor={nameId} className="sr-only">Lineup name</label>
            <input
              id={nameId}
              ref={nameRef}
              value={lineup.name}
              readOnly={made}
              title={made ? `Made from ${source}: branch it to name and change your own` : undefined}
              maxLength={MAX_LINEUP_NAME}
              placeholder="Lineup name"
              autoComplete="off"
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onLineups(renamed(lineups, lineup.id, e.target.value)); }}
              className={`${input} pr-12`}
            />
            <button
              ref={listButton}
              type="button"
              aria-label="Lineups"
              title="Switch lineup"
              aria-haspopup="menu"
              aria-expanded={listing}
              aria-controls={listing ? menuId : undefined}
              onClick={() => { setListing((o) => !o); }}
              className="pressable absolute inset-y-0.5 right-0.5 flex w-11 cursor-pointer items-center justify-center rounded-pill text-ink hover:bg-yellow-soft data-[open=true]:bg-yellow-soft"
              data-open={listing}
            >
              <Chevron open={listing} />
            </button>
            {listing && (
              <Menu id={menuId} label="Lineups" root={listRoot} trigger={listButton} onClose={closeList}
                className="absolute left-0 right-0 top-full z-20 mt-1.5 max-h-[min(50vh,420px)] overflow-y-auto">
                <MenuHeading>LINEUPS</MenuHeading>
                {allLineups(lineups).map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={l.id === lineup.id}
                    onClick={() => { pick(l.id); }}
                    className={menuChoice}
                  >
                    <span className="min-w-0 flex-1 break-words py-2 leading-tight">{lineupName(l)}</span>
                  </button>
                ))}
                {lineup.id !== MAIN_LINEUP && !made && (
                  <>
                    <span className="mx-2 my-0.5 h-0.5 bg-divider" aria-hidden />
                    <button type="button" role="menuitem" onClick={askDelete} className={menuItemDanger}>
                      <span className="min-w-0 break-words py-2 leading-tight">Delete “{lineupName(lineup)}”</span>
                    </button>
                  </>
                )}
              </Menu>
            )}
          </div>
          <button
            type="button" onClick={branch} disabled={lineups.lineups.length >= MAX_LINEUPS}
            aria-label="Branch lineup"
            title={lineups.lineups.length >= MAX_LINEUPS ? `Up to ${String(MAX_LINEUPS)} lineups` : "Branch lineup: a new lineup, a copy of this one to change"}
            className={`${pill} flex h-11 w-11 flex-none items-center justify-center`}
          >
            <Fork />
          </button>
        </div>
        {parent && (
          <span className={note}>{made ? `Made from ${parent}'s depth charts: at each position the next player up starts.` : `Branched from ${parent}.`}</span>
        )}
        {deleting && (
          <div className="flex flex-none flex-wrap gap-1.5">
            <span className="flex min-h-11 items-center text-small">Delete {lineupName(lineup)}?</span>
            <button type="button" onClick={removeLineup} className={`${small} bg-yellow on-yellow hover:bg-yellow`}>Delete</button>
            <button ref={keepRef} type="button" onClick={keepLineup} className={small}>Keep</button>
          </div>
        )}
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
              <span className="flex-none text-small leading-note text-ink-muted">{player} is not down for any position on {lineupName(lineup)}{made ? "" : " yet"}.</span>
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
            <span className={note}>
              {made
                ? `Where ${player} plays on ${lineupName(lineup)}, made from ${source}'s depth charts. Tap a position to see its chart.`
                : `Where ${player} plays on ${lineupName(lineup)}. Tap a position to change its depth chart.`}
            </span>
          </div>
          {!made && openings(player).length > 0 && (
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
          </span>
        </div>
      )}

      {player === null && sel && (
        <>
          <div className="flex flex-none items-center gap-[10px]">
            {/* the coloured token wears the position's tag, as on the field; tags are a play's to rename, not the roster's */}
            <span
              aria-hidden="true"
              className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-full border-[2.5px] border-ink text-base text-ink"
              style={{ background: teamFill(sel.team) }}
            >
              {sel.label}
            </span>
            <h2 className="flex-1 text-title font-normal leading-tight">Who plays {sel.label}</h2>
          </div>
          {isOffField(sel) && (
            <span className={note}>
              {sel.label} has no spot in the standard formation, so it is not on the field. Its starter is named under whoever wears {sel.label} on a play.
            </span>
          )}
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
                      {!made && (
                        <>
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
                        </>
                      )}
                    </li>
                  ))}
                </ol>
              )}
              {made ? (
                <button type="button" onClick={() => { onLineups(withActive(lineups, MAIN_LINEUP)); }} className={`${small} flex-none self-start`}>
                  Change {sel.label} on {source}
                </button>
              ) : chooser ? (
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
                    <button type="submit" disabled={!fresh.trim() || (onTeam(lineups, fresh) === null && full)} className={`${small} flex-none`}>
                      Add
                    </button>
                  </form>
                  <span className={note}>
                    {full
                      ? `The team is full at ${String(MAX_TEAM)} players: pick from it, or remove a player from the team to add someone new.`
                      : "Pick from the team, or type a new name: they join the team too."}
                  </span>
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
                {made
                  ? `Made from ${source}'s depth chart at ${sel.label}: the next player up starts${isOffField(sel) ? "" : ", unless they start elsewhere on this side"}. Change it there, or branch this lineup to set your own.`
                  : <>Starter first; ▲ moves a player up. The starter&apos;s name shows under {sel.label} on every play. Kept on this device, never in links or printouts.</>}
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
              disabled={full}
              title={full ? `The team is full at ${String(MAX_TEAM)} players` : "A player on the team, to put on the depth charts"}
              className={`${small} flex-none self-start`}
            >
              + Add to team
            </button>
          )}
          {full && (
            <span className="flex-none text-small leading-note">
              The team is full at {String(MAX_TEAM)} players. Remove {names.length > MAX_TEAM ? String(names.length - MAX_TEAM + 1) : "one"} from
              the team to add another.
            </span>
          )}
          <span className={note}>
            {names.length > 0
              ? `Everyone on the team (${String(names.length)} of ${String(MAX_TEAM)}), on every lineup, with where they play on ${lineupName(lineup)}. ${made ? "Tap a name for their page." : "Tap a name to put them at a position."}`
              : "Nobody is on the team yet. Add your players here, then put them on the depth charts."}
          </span>
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
    </>
  );
}

export const RosterSidebar = memo(RosterSidebarImpl);

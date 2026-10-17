"use client";

import { memo, useId, useRef, useState, type ReactNode, type ChangeEvent } from "react";
import { LOS_CHOICES, inNoRunZone, losChoice } from "@/lib/play/field";
import { activeLineup, allLineups, hasNames, lineupName, showsNames, withActive, withNames } from "@/lib/play/lineup";
import { MAX_NOTES } from "@/lib/play/storage";
import { EndZoneName, EndZonePicker } from "./endzone/EndZonePicker";
import { Fold } from "./Fold";
import type { Mode } from "./Header";
import type { Lineups, Team, TeamSettings, Vis } from "@/lib/play/types";
import { IconTile, LinkTile } from "./IconTile";
import { PlaybookTile } from "./PlaybookTile";
import { PlayNameField } from "./PlayNameField";
import { Support } from "./Support";
import { TeamColorName, TeamColorPicker, TeamNameField } from "./TeamFields";
import { AccountPanel, TeamNote } from "./account/AccountPanel";
import { ThemeName, ThemePicker } from "./ThemePicker";
import { divider, eyebrow, pill, select, tileGrid } from "./ui";

interface Props {
  name: string;
  /** the saved play on the board, when it is one */
  playId: string | null;
  notes: string;
  notesOpen: boolean;
  side: Team;
  vis: Vis;
  onName: (name: string) => void;
  /** opens a play of the current playbook from the play name's list */
  onOpenPlay: (id: string) => void;
  /** adds the saved play on the board to the current playbook */
  onAddToBook: () => void;
  /** switches to a playbook from the Playbooks tile: its primary play opens, or an empty book clears the board */
  onSwitchBook: (id: string) => void;
  onNotes: (notes: string) => void;
  onToggleNotes: () => void;
  onNew: (side: Team) => void;
  onSave: () => void;
  onDuplicate: () => void;
  /** the play differs from its last Save, notes included */
  unsaved: boolean;
  /** the play is in the library and matches it */
  saved: boolean;
  /** what to do about a save that didn't land, while it hasn't */
  savePanel: ReactNode;
  onShare: () => void;
  onFlip: () => void;
  onClear: (team: Team) => void;
  onReset: (team: Team) => void;
  onShadow: (on: boolean) => void;
  /** the other team is drawn, faded, on this play's pictures */
  artShadow: boolean;
  onArtShadow: (on: boolean) => void;
  /** the team's field has the hatched no-run bands */
  noRunZones: boolean;
  onNoRunZones: (on: boolean) => void;
  /** the coach's team: its name and colour, the identity the whole app wears */
  team: TeamSettings;
  onTeam: (next: TeamSettings) => void;
  /** the yard line this play's ball is on, counted from the offense's own goal line */
  los: number;
  onLos: (los: number) => void;
  /** the play is a run called with the ball in a no-run zone (see runInNoRunZone) */
  flagged: boolean;
  /** drawing the play, or laying out the roster (docs/adr/008-roster-depth-chart.md) */
  mode: Mode;
  onMode: (mode: Mode) => void;
  /** the lineups: whether a play shows its starters' names, and from which lineup */
  lineups: Lineups;
  onLineups: (next: Lineups) => void;
}

function PlaySidebarImpl({
  name, playId, notes, notesOpen, side, vis, onName, onOpenPlay, onAddToBook, onSwitchBook, onNotes, onToggleNotes, onNew, onSave,
  onDuplicate, unsaved, saved, onShare, savePanel, onFlip, onClear, onReset, onShadow, artShadow, onArtShadow, noRunZones, onNoRunZones,
  team, onTeam, los, onLos, flagged, mode, onMode, lineups, onLineups,
}: Props) {
  const other = side === "defense" ? "offense" : "defense";
  const [choosing, setChoosing] = useState(false);
  const losId = useId(), losNote = useId(), lineupId = useId(), namesNote = useId();
  // the Playbooks tile's menu drops down under the whole tile grid
  const tiles = useRef<HTMLDivElement>(null);
  // names on a play need a roster first: the switch waits until some lineup has a name (lineup.ts, V6)
  const rostered = hasNames(lineups);
  const names = showsNames(lineups);
  const start = (next: Team) => {
    onNew(next);
    setChoosing(false);
  };
  // roster mode is the team's, with no play open: the play's own sections wait for it
  const rostering = mode === "roster";
  return (
    <>
      {!rostering && (
        <>
          <span className={eyebrow}>PLAY</span>
          <PlayNameField name={name} playId={playId} onName={onName} onOpenPlay={onOpenPlay} onAddToBook={onAddToBook} />
          {choosing ? (
            <>
              <span className="flex-none text-small leading-note text-ink">Offense or defense?</span>
              <div className="grid flex-none grid-cols-2 gap-2" role="group" aria-label="New play">
                <IconTile icon="offense" label="Offense" title="Start an offensive play" onClick={() => { start("offense"); }} />
                <IconTile icon="defense" label="Defense" title="Start a defensive call" onClick={() => { start("defense"); }} />
              </div>
              <button type="button" onClick={() => { setChoosing(false); }} className={`${pill} min-h-11 flex-none self-start px-3 py-1 text-small`}>
                Cancel
              </button>
              <span className="flex-none text-caption leading-note text-ink-muted">They are different plays. Pick one to start a fresh one.</span>
            </>
          ) : (
            <div ref={tiles} className="relative flex-none">
              <div className={tileGrid}>
                <IconTile icon="new" label="New play" title="Start a fresh play: offense or defense" onClick={() => { setChoosing(true); }} />
                <IconTile icon="save" label="Save" title={unsaved ? "Save changes to this play" : "Save this play"} dot={unsaved} onClick={onSave} />
                <IconTile icon="duplicate" label="Duplicate" onClick={onDuplicate} />
                <IconTile icon="notes" label="Notes" title="Coaching points for this play" active={notesOpen} dot={notes.trim().length > 0} onClick={onToggleNotes} />
                <PlaybookTile onSwitchBook={onSwitchBook} root={tiles} />
                <LinkTile icon="demo" label="Demo" href="/demo" title="Watch the complete feature tour" />
              </div>
            </div>
          )}
          {savePanel}
          {notesOpen && (
            <>
              <textarea
                value={notes}
                maxLength={MAX_NOTES}
                rows={4}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => { onNotes(e.target.value); }}
                placeholder="Coaching points. Shown on the binder page."
                aria-label="Coaching points"
                className="w-full flex-none resize-y rounded-note border-2 border-ink bg-white px-3 py-2 text-base leading-note text-ink placeholder:text-ink-muted"
              />
              <span className="flex-none text-caption leading-note text-ink-muted" aria-live="polite">
                {saved ? "Saved with the play." : unsaved ? "Not saved yet. Save keeps these notes with the play." : "Save keeps these notes with the play."}
              </span>
            </>
          )}
          <button type="button" onClick={onShare} title="Copy a link that opens this play read-only" className={`${pill} min-h-11 flex-none self-start px-3 py-1 text-small`}>
            Copy share link
          </button>
          <span className={divider} />
          <span className={eyebrow}>FIELD</span>
          <div className={tileGrid}>
            <IconTile icon="flip" label="Flip play" onClick={onFlip} />
            <IconTile icon="clear" label="Clear routes" onClick={() => { onClear(side); }} />
            <IconTile icon="reset" label="Reset spots" onClick={() => { onReset(side); }} />
          </div>
          <span className="flex-none text-caption leading-note text-ink-muted">Clear and reset only touch this play&apos;s team.</span>
          <label htmlFor={losId} className="flex-none text-small">Line of scrimmage</label>
          <select
            id={losId}
            value={String(los)}
            aria-describedby={losNote}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => { onLos(Number(e.target.value)); }}
            className={`${select} w-full flex-none`}
          >
            {LOS_CHOICES.map((n) => <option key={n} value={String(n)}>{losChoice(n)}</option>)}
          </select>
          <span id={losNote} aria-live="polite" className="flex-none text-caption leading-note text-ink-muted">
            {flagged
              ? "Saved with this play. The ball is in a no-run zone and this play is a run, so it is flagged: make it a pass or move the ball."
              : noRunZones && inNoRunZone(los)
                ? "Saved with this play. The ball is in a no-run zone, so no runs from here."
                : "Saved with this play. Yards count down to their goal line: every drive starts on the 40, midfield is the 20."}
          </span>
          <label className="flex min-h-11 flex-none cursor-pointer items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={noRunZones}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onNoRunZones(e.target.checked); }}
              className="h-5 w-5 flex-none cursor-pointer accent-ink"
            />
            No-run zones
          </label>
          <span className="flex-none text-caption leading-note text-ink-muted">Turn off if your league plays without them. Every play and printout follows.</span>
          <span className={divider} />
          <span className={eyebrow}>SHOW</span>
          {side === "defense" ? (
            <>
              <div className={tileGrid} role="group" aria-label="Shadow offense">
                <IconTile
                  icon="offOnly"
                  label="Shadow offense"
                  title="Show the offense faded. Tap a player to give them a route."
                  active={vis === "both"}
                  onClick={() => { onShadow(vis !== "both"); }}
                />
              </div>
              <span className="flex-none text-caption leading-note text-ink-muted">A faded look at the offense. Tap a player to give them a route.</span>
            </>
          ) : (
            <>
              <div className={tileGrid} role="group" aria-label="Shadow defense">
                <IconTile
                  icon="defOnly"
                  label="Shadow defense"
                  title="Show the defense faded. Tap a player to give them a coverage."
                  active={vis === "both"}
                  onClick={() => { onShadow(vis !== "both"); }}
                />
              </div>
              <span className="flex-none text-caption leading-note text-ink-muted">A faded look at the defense. Tap a player to give them a coverage.</span>
            </>
          )}
          <label className="flex min-h-11 flex-none cursor-pointer items-center gap-2 text-small">
            <input
              type="checkbox"
              checked={artShadow}
              onChange={(e: ChangeEvent<HTMLInputElement>) => { onArtShadow(e.target.checked); }}
              className="h-5 w-5 flex-none cursor-pointer accent-ink"
            />
            {other === "offense" ? "Offense" : "Defense"} in play art
          </label>
          <span className="flex-none text-caption leading-note text-ink-muted">Draws the {other} faded on this play&apos;s thumbnail, snapshot and printouts. Save keeps it with the play.</span>
          <span className={divider} />
        </>
      )}
      <span className={eyebrow}>ROSTER</span>
      <div className={tileGrid} role="group" aria-label="Roster">
        <IconTile
          icon="roster"
          label="Roster"
          title="Who plays each position, with depth"
          active={mode === "roster"}
          onClick={() => { onMode(mode === "roster" ? "play" : "roster"); }}
        />
      </div>
      <span className="flex-none text-caption leading-note text-ink-muted">
        Tap a position on the field and set who plays it, starter first. Kept on this device, never in a play, a link or a play&apos;s printout.
      </span>
      <label className={`flex min-h-11 flex-none items-center gap-2 text-small ${rostered ? "cursor-pointer" : "text-ink-muted"}`}>
        <input
          type="checkbox"
          checked={names}
          disabled={!rostered}
          aria-describedby={namesNote}
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onLineups(withNames(lineups, e.target.checked)); }}
          className="h-5 w-5 flex-none cursor-pointer accent-ink disabled:cursor-default"
        />
        Show player names
      </label>
      {names && (
        <>
          <label htmlFor={lineupId} className="flex-none text-small">Lineup</label>
          <select
            id={lineupId}
            value={activeLineup(lineups).id}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => { onLineups(withActive(lineups, e.target.value)); }}
            className={`${select} w-full flex-none`}
          >
            {allLineups(lineups).map((l) => <option key={l.id} value={l.id}>{lineupName(l)}</option>)}
          </select>
        </>
      )}
      <span id={namesNote} aria-live="polite" className="flex-none text-caption leading-note text-ink-muted">
        {!rostered
          ? "Build a roster first: tap Roster and set who plays a position. Then the names can show on a play."
          : names
            ? `The starters on ${lineupName(activeLineup(lineups))} show under the tags on every play, on this screen only.`
            : "Names stay off every play until you turn them on."}
      </span>
      <span className={divider} />
      <AccountPanel />
      <span className={divider} />
      <span className={eyebrow}>TEAM</span>
      <TeamNameField team={team} onTeam={onTeam} />
      <TeamNote />
      <span className={divider} />
      <Fold label="Team color" says={<TeamColorName color={team.color} />}>
        <TeamColorPicker team={team} onTeam={onTeam} legend={false} />
      </Fold>
      <span className={divider} />
      <Fold label="Theme" says={<ThemeName />}>
        <ThemePicker className="flex-none" unlockHref="/playbooks" />
      </Fold>
      <span className={divider} />
      <Fold label="End zone" says={<EndZoneName />}>
        <EndZonePicker className="flex-none" />
      </Fold>
      <span className={divider} />
      <Support />
    </>
  );
}

export const PlaySidebar = memo(PlaySidebarImpl);

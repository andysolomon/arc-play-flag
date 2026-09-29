"use client";

import { memo, useId, useState, type ReactNode, type ChangeEvent } from "react";
import { LOS_CHOICES, inNoRunZone, losChoice } from "@/lib/play/field";
import { MAX_NOTES } from "@/lib/play/storage";
import { EndZoneName, EndZonePicker } from "./endzone/EndZonePicker";
import { Fold } from "./Fold";
import type { Team, TeamSettings, Vis } from "@/lib/play/types";
import { IconTile, LinkTile } from "./IconTile";
import { Support } from "./Support";
import { TEAM_NOTE, TeamFields } from "./TeamFields";
import { ThemeName, ThemePicker } from "./ThemePicker";
import { divider, eyebrow, input, pill, select, tileGrid } from "./ui";

interface Props {
  name: string;
  notes: string;
  notesOpen: boolean;
  side: Team;
  vis: Vis;
  onName: (name: string) => void;
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
}

function PlaySidebarImpl({
  name, notes, notesOpen, side, vis, onName, onNotes, onToggleNotes, onNew, onSave, onDuplicate, unsaved, saved, onShare,
  savePanel, onFlip, onClear, onReset, onShadow, artShadow, onArtShadow, noRunZones, onNoRunZones, team, onTeam, los, onLos,
}: Props) {
  const other = side === "defense" ? "offense" : "defense";
  const [choosing, setChoosing] = useState(false);
  const losId = useId(), losNote = useId();
  const start = (next: Team) => {
    onNew(next);
    setChoosing(false);
  };
  return (
    <>
      <span className={eyebrow}>PLAY</span>
      <input
        value={name}
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onName(e.target.value); }}
        placeholder="Play name"
        aria-label="Play name"
        className={`flex-none ${input}`}
      />
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
        <div className={tileGrid}>
          <IconTile icon="new" label="New play" title="Start a fresh play: offense or defense" onClick={() => { setChoosing(true); }} />
          <IconTile icon="save" label="Save" title={unsaved ? "Save changes to this play" : "Save this play"} dot={unsaved} onClick={onSave} />
          <IconTile icon="duplicate" label="Duplicate" onClick={onDuplicate} />
          <IconTile icon="notes" label="Notes" title="Coaching points for this play" active={notesOpen} dot={notes.trim().length > 0} onClick={onToggleNotes} />
          <LinkTile icon="playbook" label="Playbooks" href="/playbooks" title="Build playbooks and print them" />
          <LinkTile icon="demo" label="Demo" href="/demo" title="Watch the complete feature tour" />
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
        {noRunZones && inNoRunZone(los)
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
      <span className={eyebrow}>TEAM</span>
      <TeamFields team={team} onTeam={onTeam} />
      <span className="flex-none text-caption leading-note text-ink-muted">{TEAM_NOTE}</span>
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

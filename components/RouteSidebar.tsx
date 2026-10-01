"use client";

import { memo, useId, useRef, type ChangeEvent } from "react";
import { DEFENSE_KEYS, PASS_KEYS, RUN_KEYS, isRun, mirrorable, tableFor } from "@/lib/play/routes";
import { teamFill, type SidelineCut } from "@/lib/play/geometry";
import type { Player, RouteType } from "@/lib/play/types";
import { Note } from "./Hint";
import { IconTile } from "./IconTile";
import { crumb, eyebrow, pill, tileGrid } from "./ui";
import { Sticker } from "./Sticker";

interface Props {
  selected: Player | null;
  /** who holds the ball, in order, the same player as often as they take it (lib/play/lateral.ts) */
  chain: readonly Player[];
  /** the place in the chain the selected player is being edited at (0 is the quarterback at the snap); null off it */
  visit: number | null;
  /** the Lateral tile: ask who takes it, or, from a time the ball goes on, take that lateral and the rest off */
  onLateral: () => void;
  /** a step of the ball path tapped: edit that time its player has the ball */
  onVisit: (index: number) => void;
  /** what the sideline cuts off the selected player's route, which is drawn to it with its depth intact */
  cut: SidelineCut | null;
  hint: string | null;
  onPick: (key: RouteType) => void;
  onMotion: () => void;
  onRemoveMotion: () => void;
  onDone: () => void;
  onPrimary: () => void;
  onMirror: () => void;
  onRename: (id: string, label: string, commit: boolean) => void;
  /**
   * an offensive play's ball is in a no-run zone and the league plays with them: a run from here is
   * flagged. Never on a defensive call, whose shadow offense is the other team's and never flagged.
   */
  noRunZone: boolean;
}

/** Yards as a coach reads them off the field, to the half yard. */
const yards = (v: number): string => String(Math.round(v * 2) / 2);

/** How the chain ends, as its breadcrumb says it: the last carrier throws, keeps it, or has no job yet. */
function chainEnd(last: Player | undefined): string {
  if (last?.route?.type === "throw") return "throw";
  if (last?.route && isRun(last.route.type)) return "keeps";
  return "?";
}

function RouteSidebarImpl({
  selected: sel, chain, visit, onLateral, onVisit, cut, hint, onPick, onMotion, onRemoveMotion, onDone, onPrimary, onMirror, onRename, noRunZone,
}: Props) {
  // one history entry per rename session, not per keystroke
  const renaming = useRef<string | null>(null);
  const noRunNote = useId();
  // the time in the chain the selected player is being edited at: 0 the quarterback at the snap, more a
  // lateral they take, -1 off the chain
  const at = sel && visit !== null && chain[visit]?.id === sel.id ? visit : -1;
  const laterals = chain.length > 1;
  // took a lateral: they have the ball, so their choices are throw, lateral again or keep it
  const hasBall = at > 0;
  // the ball goes on from them this time: their Lateral is on, and nothing else is their job yet
  const goesOn = at >= 0 && at < chain.length - 1;
  // they had it before this time: "has it again"
  const again = hasBall && chain.slice(0, at).some((p) => p.id === sel?.id);
  const isJob = (k: RouteType): boolean => !goesOn && sel?.route?.type === k;
  // offense splits into the passing tree and the run game; defense is one list. A carrier gets no pass route
  const keys: readonly RouteType[] = sel?.team === "offense" ? (hasBall ? [] : PASS_KEYS) : DEFENSE_KEYS;
  const runKeys: readonly RouteType[] = sel?.team === "offense" ? RUN_KEYS : [];
  const suffix = sel?.team === "offense" ? "Off" : "Def";
  // the read is someone the final throw goes to, never a player the ball is lateraled through
  const canPrimary = !!(sel && sel.team === "offense" && sel.route && !(laterals && chain.some((p) => p.id === sel.id)));
  const canMirror = mirrorable(sel);
  const primaryOn = !!sel?.route?.primary;
  const guidance = hint
    ? hint.startsWith("Lateral to who?")
      ? "Lateral to who? Choose a red player · Esc cancels."
      : hint.startsWith("Cover who?")
      ? "Choose a red offense player · Tab then Enter or Space · Esc cancels."
      : "Tap waypoints on the field · double-tap to finish · Finish (Enter) or Cancel (Esc)."
    : sel?.route?.type === "custom"
      ? "Select a waypoint to edit it · arrow keys move · Delete removes · undo/redo supported."
      : null;

  return (
    <>
      <span className={eyebrow}>ROUTES</span>
      {!sel && (
        <div className="flex flex-none flex-col items-center gap-[10px] rounded-tile border-2 border-dashed border-ink px-[10px] py-[18px]">
          <Sticker icon="football" size={56} className="opacity-75" />
          <span className="text-center text-base leading-body text-ink-muted">
            Tap a player to give them a route or coverage.
            <br />
            Drag to move them. Tap the QB to start a lateral.
          </span>
        </div>
      )}
      {sel && (
        <>
          <div className="flex flex-none items-center gap-[10px]">
            {/* the coloured token is the tag field: tap it to rename the player */}
            <input
              value={sel.label}
              maxLength={3}
              placeholder="Tag"
              aria-label="Player tag"
              title="Player tag (up to 3 letters)"
              onFocus={() => { renaming.current = null; }}
              onChange={(e: ChangeEvent<HTMLInputElement>) => {
                const commit = renaming.current !== sel.id;
                renaming.current = sel.id;
                onRename(sel.id, e.target.value, commit);
              }}
              // 16px is the smallest text a phone browser will focus without zooming the page
              className="h-[42px] w-[42px] flex-none rounded-full border-[2.5px] border-ink p-0 text-center text-base text-ink placeholder:text-ink/60"
              style={{ background: teamFill(sel.team) }}
            />
            <h2 className="flex-1 text-title font-normal leading-tight">
              {hasBall
                ? `${sel.label || "This player"} has ${again ? "it again" : "the ball"}`
                : sel.team === "offense" ? "Pick a route" : "Pick a coverage"}
            </h2>
          </div>
          {/* where the ball goes, carrier by carrier, and how it ends; a tap on a step edits that time they have it */}
          {laterals && chain.some((p) => p.id === sel.id) && (
            <ol aria-label="Ball path" className="flex flex-none flex-wrap items-center gap-1 text-small text-ink-muted">
              <li className={eyebrow}>BALL</li>
              {chain.map((p, i) => (
                <li key={i} className="flex items-center gap-1">
                  <span aria-hidden="true" className="text-ink-faint">→</span>
                  <button
                    type="button" className={`${crumb} min-h-11 min-w-11 cursor-pointer justify-center hover:bg-yellow-soft`} data-active={i === at}
                    aria-current={i === at ? "step" : undefined} aria-label={`${p.label || "Player"}, step ${String(i + 1)} of the ball path`}
                    onClick={() => { onVisit(i); }}
                  >
                    {p.label || "·"}
                  </button>
                </li>
              ))}
              <li className="flex items-center gap-1">
                <span aria-hidden="true" className="text-ink-faint">→</span>
                <span className={crumb} data-end={chainEnd(chain[chain.length - 1]) !== "?"}>{chainEnd(chain[chain.length - 1])}</span>
              </li>
            </ol>
          )}
          {/* the read and mirror sit under the heading so they are never scrolled out of reach */}
          {(canPrimary || canMirror) && (
            <div className="flex flex-none flex-wrap gap-1.5">
              {canPrimary && (
                <button
                  type="button"
                  onClick={onPrimary}
                  title="Colour this as the primary read"
                  aria-pressed={primaryOn}
                  data-active={primaryOn}
                  className={`${pill} min-h-11 px-3 py-1 text-small data-[active=true]:bg-rose-soft`}
                >
                  {primaryOn ? "★ Primary read" : "☆ Mark primary"}
                </button>
              )}
              {canMirror && (
                <button type="button" onClick={onMirror} title="Mirror this route left/right" className={`${pill} min-h-11 px-3 py-1 text-small`}>
                  ⇄ Mirror route
                </button>
              )}
            </div>
          )}
          {cut && sel.route && (
            <Note
              text={`The sideline cuts this ${tableFor(sel.team)[sel.route.type]?.label ?? "route"}: ${yards(cut.room)} of its ${yards(cut.reach)} yards across fit. Move ${sel.label || "this player"} inside to run all of it.`}
            />
          )}
          {sel.team === "offense" && (
            <div className="flex flex-none flex-col gap-1.5" role="group" aria-label="Pre-snap motion">
              <span className={eyebrow}>PRE-SNAP</span>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={onMotion} aria-label={sel.preSnap ? "Redraw pre-snap motion" : "Draw pre-snap motion"} className={`${pill} min-h-11 px-3 py-1 text-small`}>
                  {sel.preSnap ? "Redraw motion" : "Pre-snap motion"}
                </button>
                {sel.preSnap && <button type="button" onClick={onRemoveMotion} aria-label="Remove pre-snap motion" className={`${pill} min-h-11 px-3 py-1 text-small`}>Remove motion</button>}
              </div>
              <span className="text-caption leading-note text-ink-muted">Draw a dashed path behind the line. The route starts where motion ends. One player motions per play; choosing another transfers motion.</span>
            </div>
          )}
          {hasBall && (
            <>
              <span className={eyebrow}>WITH THE BALL</span>
              <span className="flex-none text-caption leading-note text-ink-muted">
                Took a lateral behind the line, so everything is still legal: a forward throw, another lateral, or keep it.
              </span>
              <div className={tileGrid} role="group" aria-label="With the ball">
                <IconTile icon="football" label="Throw" active={isJob("throw")} onClick={() => { onPick("throw"); }} />
                <IconTile icon="pitch" label="Lateral" active={goesOn} onClick={onLateral} />
                <IconTile icon="deselectOff" label="Done" onClick={onDone} />
              </div>
            </>
          )}
          {keys.length > 0 && (
            <div className={tileGrid} role="group" aria-label={sel.team === "offense" ? "Routes" : "Coverages"}>
              {keys.map((k) => (
                <IconTile
                  key={k}
                  icon={k === "custom" ? `custom${suffix}` : k}
                  label={tableFor(sel.team)[k]?.label ?? k}
                  active={isJob(k)}
                  onClick={() => { onPick(k); }}
                />
              ))}
              {runKeys.length === 0 && <IconTile icon={`deselect${suffix}`} label="Done" onClick={onDone} />}
            </div>
          )}
          {runKeys.length > 0 && (
            <>
              <span className={eyebrow}>{hasBall ? "OR KEEP IT" : "RUN"}</span>
              {/* still offered: a handoff or lateral that ends in a throw is a pass, legal from anywhere */}
              {noRunZone && (
                <span id={noRunNote} className="flex-none text-caption leading-note text-ink-muted">
                  The ball is in a no-run zone: a run from here is flagged. A handoff or lateral that ends in a throw is a pass.
                </span>
              )}
              <div className={tileGrid} role="group" aria-label="Runs">
                {runKeys.map((k) => (
                  <IconTile
                    key={k}
                    icon={k}
                    label={tableFor(sel.team)[k]?.label ?? k}
                    active={isJob(k)}
                    hatched={noRunZone}
                    describedBy={noRunZone ? noRunNote : undefined}
                    onClick={() => { onPick(k); }}
                  />
                ))}
                {/* the quarterback starts a chain here, where Pitch was; later carriers lateral from WITH THE BALL */}
                {at === 0 && <IconTile icon="pitch" label="Lateral" active={goesOn} onClick={onLateral} />}
                {!hasBall && <IconTile icon={`deselect${suffix}`} label="Done" onClick={onDone} />}
              </div>
            </>
          )}
        </>
      )}
      {guidance && <Note text={guidance} />}
    </>
  );
}

export const RouteSidebar = memo(RouteSidebarImpl);

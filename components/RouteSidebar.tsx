"use client";

import { memo, useId, useRef, type ChangeEvent } from "react";
import type { BlitzAim } from "@/lib/play/blitz";
import type { DeepSplit } from "@/lib/play/deep";
import { DEFENSE_KEYS, PASS_KEYS, QB_KEYS, RUN_KEYS, isQbAction, isRun, mirrorable, tableFor } from "@/lib/play/routes";
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
  /** the lateral that leaves the selected time with the ball is let go on the run (ADR 007) */
  onTheRun: boolean;
  /** the On the run tile: that lateral becomes a pitch on the run, or back to one from where they stand */
  onRunBefore: () => void;
  /** the selected blitzer: how their blitz is aimed, who it comes for now, and the back a backfield blitz would come for (lib/play/blitz.ts) */
  blitz: BlitzInfo | null;
  /** the QB, Backfield and Contain pills */
  onBlitzAim: (aim: "qb" | "backfield" | "contain") => void;
  /** Pick a player: like Man, ask for a red player on the field */
  onBlitzTarget: () => void;
  /** the selected deep zone: Auto (split with the other deep zones), a deep half or a deep third; null for anything else */
  deep: DeepSplit | "auto" | null;
  /** the Auto, Half and Third pills */
  onDeepSplit: (split: DeepSplit | null) => void;
  /** what the sideline cuts off the selected player's route, which is drawn to it with its depth intact */
  cut: SidelineCut | null;
  /**
   * the selected player can take a jet sweep (docs/adr/006-jet-sweep.md): an offensive player who is not the
   * quarterback or the centre and does not carry the ball in a lateral chain. Nobody else is offered the tile.
   */
  jet: boolean;
  /**
   * the selected player is the quarterback, who is offered a rollout and a boot at the snap
   * (docs/adr/011-qb-rollout-and-boot.md), and what the one they have does; null for anyone else
   */
  qb: QbInfo | null;
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

export interface QbInfo {
  /** the quarterback's rollout or boot as the play has it; null without one */
  act: {
    type: "rollout" | "boot";
    /** +1 to the quarterback's right */
    side: 1 | -1;
    /** who they fake or hand off to, by name; null with no runner on the play */
    fake: string | null;
    /** the call is a run: they hand off and carry it out as a decoy */
    decoy: boolean;
    /** someone has a route to throw to, so marking them as the read makes it a pass again */
    receivers: boolean;
    /** what turns a boot the other way: Flip play, ⇄ Mirror on the fake's run when flipping doesn't (Q11), or neither */
    turn: "flip" | "mirror" | null;
  } | null;
}

/** What the quarterback's rollout or boot does, under the QB tiles. */
function qbWords(name: string, act: NonNullable<QbInfo["act"]>): string {
  const way = act.side > 0 ? "right" : "left", other = act.side > 0 ? "left" : "right";
  const verb = act.type === "rollout" ? `rolls out ${way}` : `boots ${way}`;
  if (act.decoy) {
    const instead = act.receivers ? "mark a receiver as the read" : "give a receiver a route";
    return `${name} hands off to ${act.fake ?? "the runner"}, then ${verb} as a decoy. To throw instead, ${instead}.`;
  }
  if (act.type === "rollout") {
    const first = act.fake ? `fakes to ${act.fake} first, then rolls out ${way}` : `takes the snap and rolls out ${way}`;
    return `${name} ${first}, behind the line, to throw from the ring. ⇄ Mirror route rolls ${other}.`;
  }
  if (!act.fake) return `Nothing to fake yet: give a back a run, and ${name} fakes it first, then boots the other way. For now ${name} boots ${way}.`;
  const turn = act.turn === "flip" ? `Flip the play to boot ${other}` : act.turn === "mirror" ? `⇄ Mirror ${act.fake}'s run to boot ${other}` : `Move ${act.fake} to boot ${other}`;
  // a rollout goes right unless mirrored, so it goes with a fake to the right as it is, and mirrored with one to the left
  const roll = act.side < 0 ? "pick Rollout to go with the fake" : "pick Rollout and ⇄ Mirror it to go with the fake";
  return `${name} fakes the handoff to ${act.fake}, then boots out the other way, to the ${way}, to throw from the ring. ${turn}, or ${roll}.`;
}

export interface BlitzInfo {
  aim: BlitzAim;
  /** who the blitz comes for now, by name; null with no quarterback on the field */
  who: string | null;
  /** the back a backfield blitz comes for, by name; null with nobody lined up back there */
  back: string | null;
  /** a contain blitz: the edge on the rusher's side, as the picture shows it, and whether the sideline leaves room to contain it, or the other one */
  contain: { edge: "left" | "right"; room: boolean; other: boolean } | null;
}

/** What the blitz does, under the pills. */
function blitzWords(b: BlitzInfo): string {
  if (b.aim === "player") return `Comes for ${b.who ?? "that player"}, wherever they line up.`;
  if (b.aim === "backfield") {
    return b.back
      ? `Comes for the nearest back lined up near the ball: ${b.back} now. With nobody back there, the quarterback.`
      : "Comes for the nearest back lined up near the ball. Nobody is back there now, so it comes for the quarterback.";
  }
  if (b.aim === "contain" && b.contain) {
    const { edge, room, other } = b.contain;
    const far = edge === "left" ? "right" : "left";
    const here = room
      ? `Rushes the ${edge} edge outside the quarterback, then turns in, so they can't escape that way.`
      : `The sideline leaves no room outside the quarterback on the ${edge}, so it comes straight for them.`;
    if (other) return `${here} To contain the ${far} edge, line up ${far} of the quarterback.`;
    return room ? `${here} The sideline leaves no room to contain the ${far} edge.` : here;
  }
  return "Comes for the quarterback. Aim it at the backfield, contain an edge, or pick any red player.";
}

/** The DEEP pills, and what each says the zone does. */
const DEEP_PILLS: readonly { split: DeepSplit | null; label: string; title: string; words: string }[] = [
  { split: null, label: "Auto", title: "Split the deep field with the other deep zones", words: "Splits the deep field with the other deep zones: one owns it all, two take halves, three take thirds." },
  { split: "half", label: "Half", title: "Play the deep half nearest this defender", words: "Owns the deep half of the field on this side, however many others play deep." },
  { split: "third", label: "Third", title: "Play the deep third nearest this defender", words: "Owns the deep third of the field nearest them, however many others play deep." },
];

/** Yards as a coach reads them off the field, to the half yard. */
const yards = (v: number): string => String(Math.round(v * 2) / 2);

/** How the chain ends, as its breadcrumb says it: the last carrier throws, keeps it, or has no job yet. */
function chainEnd(last: Player | undefined): string {
  if (last?.route?.type === "throw") return "throw";
  if (last?.route && isRun(last.route.type)) return "keeps";
  return "?";
}

function RouteSidebarImpl({
  selected: sel, chain, visit, onLateral, onVisit, onTheRun, onRunBefore, blitz, onBlitzAim, onBlitzTarget, deep, onDeepSplit, cut, jet, qb, hint, onPick, onMotion, onRemoveMotion,
  onDone, onPrimary, onMirror, onRename, noRunZone,
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
  // the jet sweep is a handoff at the snap: only for a player who can take one, never a keep after a lateral
  const runKeys: readonly RouteType[] = sel?.team === "offense" ? RUN_KEYS.filter((k) => k !== "jet" || (jet && !hasBall)) : [];
  const suffix = sel?.team === "offense" ? "Off" : "Def";
  // the read is someone the final throw goes to, never a player the ball is lateraled through, nor a
  // quarterback on a rollout or boot, who throws it
  const canPrimary = !!(sel && sel.team === "offense" && sel.route && !isQbAction(sel.route.type) && !(laterals && chain.some((p) => p.id === sel.id)));
  const canMirror = mirrorable(sel);
  const primaryOn = !!sel?.route?.primary;
  const runNote = goesOn
    ? onTheRun
      ? `${sel?.label || "This player"} runs with the ball to the round handle and pitches from there. Drag it to move the pitch; it stays behind the line.`
      : "On the run: run with the ball first and pitch from where the run ends, the option."
    : null;
  const guidance = hint
    ? hint.startsWith("Lateral to who?")
      ? "Lateral to who? Choose a red player · Esc cancels."
      : hint.startsWith("Cover who?") || hint.startsWith("Blitz who?")
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
          {/* who the blitz comes for: the quarterback unless aimed at the backfield, containing the quarterback, or at a player the coach picks */}
          {blitz && sel.team === "defense" && (
            <div className="flex flex-none flex-col gap-1.5" role="group" aria-label="Blitz target">
              <span className={eyebrow}>BLITZ</span>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button" onClick={() => { onBlitzAim("qb"); }} title="Blitz the quarterback"
                  aria-pressed={blitz.aim === "qb"} data-active={blitz.aim === "qb"}
                  className={`${pill} min-h-11 px-3 py-1 text-small data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
                >
                  QB
                </button>
                <button
                  type="button" onClick={() => { onBlitzAim("backfield"); }} title="Blitz the nearest back in the backfield"
                  aria-pressed={blitz.aim === "backfield"} data-active={blitz.aim === "backfield"}
                  className={`${pill} min-h-11 px-3 py-1 text-small data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
                >
                  Backfield
                </button>
                <button
                  type="button" onClick={() => { onBlitzAim("contain"); }} title="Contain the quarterback: rush the edge outside them, then turn in"
                  aria-pressed={blitz.aim === "contain"} data-active={blitz.aim === "contain"}
                  className={`${pill} min-h-11 px-3 py-1 text-small data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
                >
                  Contain
                </button>
                <button
                  type="button" onClick={onBlitzTarget} title="Blitz one player: tap them on the field"
                  aria-pressed={blitz.aim === "player"} data-active={blitz.aim === "player"}
                  className={`${pill} min-h-11 px-3 py-1 text-small data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
                >
                  {blitz.aim === "player" ? `On ${blitz.who ?? "?"}` : "Pick a player"}
                </button>
              </div>
              <span className="text-caption leading-note text-ink-muted">{blitzWords(blitz)}</span>
            </div>
          )}
          {/* how much of the deep field the zone owns: split with the other deep zones, or called as a half or a third */}
          {deep && sel.team === "defense" && (
            <div className="flex flex-none flex-col gap-1.5" role="group" aria-label="Deep zone">
              <span className={eyebrow}>DEEP</span>
              <div className="flex flex-wrap gap-1.5">
                {DEEP_PILLS.map((d) => {
                  const on = deep === (d.split ?? "auto");
                  return (
                    <button
                      key={d.label} type="button" onClick={() => { onDeepSplit(d.split); }} title={d.title}
                      aria-pressed={on} data-active={on}
                      className={`${pill} min-h-11 px-3 py-1 text-small data-[active=true]:bg-yellow data-[active=true]:on-yellow`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
              <span className="text-caption leading-note text-ink-muted">{DEEP_PILLS.find((d) => deep === (d.split ?? "auto"))?.words}</span>
            </div>
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
          {/* the quarterback's own jobs at the snap come first: carry the ball out behind the line and throw */}
          {qb && at === 0 && (
            <>
              <span className={eyebrow}>QB</span>
              <div className={tileGrid} role="group" aria-label="Quarterback">
                {QB_KEYS.map((k) => (
                  <IconTile key={k} icon={k} label={tableFor("offense")[k]?.label ?? k} active={isJob(k)} onClick={() => { onPick(k); }} />
                ))}
              </div>
              {qb.act && isJob(qb.act.type) && (
                <span data-qb-note className="flex-none text-caption leading-note text-ink-muted">{qbWords(sel.label || "The QB", qb.act)}</span>
              )}
            </>
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
                {goesOn && <IconTile icon="stretch" label="On the run" active={onTheRun} onClick={onRunBefore} />}
                <IconTile icon="deselectOff" label="Done" onClick={onDone} />
              </div>
              {runNote && <span className="flex-none text-caption leading-note text-ink-muted">{runNote}</span>}
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
                {/* and, once it goes on, can run with it first: the option */}
                {at === 0 && goesOn && <IconTile icon="stretch" label="On the run" active={onTheRun} onClick={onRunBefore} />}
                {!hasBall && <IconTile icon={`deselect${suffix}`} label="Done" onClick={onDone} />}
              </div>
              {at === 0 && runNote && <span className="flex-none text-caption leading-note text-ink-muted">{runNote}</span>}
              {isJob("jet") && (
                <span data-jet-note className="flex-none text-caption leading-note text-ink-muted">
                  {sel.label || "This player"} is already crossing behind the line when the ball is snapped, and the QB hands it off as they pass.
                  A forward pass to a player behind the line isn&apos;t allowed, so a jet sweep is always a handoff.
                </span>
              )}
            </>
          )}
        </>
      )}
      {guidance && <Note text={guidance} />}
    </>
  );
}

export const RouteSidebar = memo(RouteSidebarImpl);

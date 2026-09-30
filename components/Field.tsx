"use client";

import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject,
} from "react";
import { getDeepField, serverDeepField, setDeepField, subscribeDeepField } from "@/lib/deepfield";
import { getEndZone, recordTouchdown, serverEndZone, subscribeEndZone, type EndZone } from "@/lib/endzone";
import { NO_RUN_FLAG, NO_RUN_STAMP, runInNoRunZone } from "@/lib/play/call";
import { END_ZONE_YARDS, GOAL_YARD, LOS_YARD } from "@/lib/play/field";
import { MAX_DEPTH, MIN_DEPTH, VW, cardWidth, clamp, depth, draftPath, fieldLayout, geom, lateralArcs, px, py, snap } from "@/lib/play/geometry";
import { catchClamp, catchNote, chainOf, clampCatch, releasePoint } from "@/lib/play/lateral";
import { getServerTeam, getTeam, subscribe as subscribeLibrary } from "@/lib/play/library";
import { ballAt, buildMotion, positionsAt, simulationPlayback, type Motion } from "@/lib/play/motion";
import type { Action, Targeting } from "@/lib/play/reducer";
import { isContext, shown } from "@/lib/play/reducer";
import { STAMP_FONT, STAMP_SPACING, manTags, stampBox, tagged } from "@/lib/play/marks";
import { MAX_ROUTE_POINTS, losGap } from "@/lib/play/routes";
import { atSnap, motionPoint } from "@/lib/play/pre-snap";
import { motionGeom } from "@/lib/play/geometry";
import { touchdownAt } from "@/lib/play/touchdown";
import type { Draft, Pair, Pane, Player, SnapMode, Team, Vis } from "@/lib/play/types";
import { zoneLayout } from "@/lib/play/zones";
import { CELEBRATION_MS, Celebration } from "./endzone/Celebration";
import { EndZoneArt } from "./endzone/EndZoneArt";
import { Football, PlayButton } from "./Playback";
import { PlayerToken } from "./PlayerToken";
import { FIELD } from "./fieldPaint";
import { LateralLayer } from "./LateralLayer";
import { ManTagLayer } from "./ManTagLayer";
import { RouteLayer } from "./RouteLayer";
import { pillMd, pillSm } from "./ui";

interface Props {
  players: readonly Player[];
  vis: Vis;
  /** the play's own side: the other team is faded when shown, and can still take an assignment */
  side: Team;
  selectedId: string | null;
  /** a tap on a red player answers Man (who they cover) or Lateral (who takes it) */
  targeting: Targeting | null;
  draft: Draft | null;
  dispatch: (a: Action) => void;
  onSelect: (id: string) => void;
  /** a lateral's catch was dragged or nudged somewhere illegal and snapped back: say why */
  onCatchNote?: (text: string) => void;
  svgRef: RefObject<SVGSVGElement | null>;
  snapMode?: SnapMode;
  showYardNumbers?: boolean;
  /** the hatched no-run bands; off for a team whose league plays without them */
  noRunZones?: boolean;
  /** the yard line this play's ball is on (SavedPlay.los); the own goal line when left out */
  los?: number;
  /** share page: draw only, no interaction */
  readOnly?: boolean;
  /** printed above the field; also shown on screen when `showTitle` is set */
  title?: string;
  /** sit the play name above the diagram instead of squeezing it into the header */
  showTitle?: boolean;
  /** Saved / Unsaved / Draft autosaved caption under the on-screen play name */
  status?: string;
}

interface Drag {
  id: string;
  team: Team;
  /** how close to the line of scrimmage this player may be dropped (see losGap) */
  gap: number;
  ox: number;
  oy: number;
  x0: number;
  y0: number;
  moved: boolean;
  last: { x: number; y: number } | null;
}

interface Live {
  id: string;
  x: number;
  y: number;
}

interface CatchDrag {
  /** the carrier whose lateral this catch is */
  id: string;
  moved: boolean;
  last: { x: number; y: number } | null;
  /** the rule the live spot is being held to, so the note and shake come once as it starts */
  clamp: "line" | "forward" | null;
}

interface WaypointDrag {
  id: string;
  index: number;
  x0: number;
  y0: number;
  moved: boolean;
  last: { x: number; y: number } | null;
}

const STEP: Record<string, readonly [number, number]> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

/** Name + status line above the diagram; subtracted from the pane so the field still fits. */
const TITLE_CHROME = 24;
/** The name + status line, for the toast to sit under instead of over. */
export const FIELD_TITLE_ID = "field-title";
/** The clip that keeps a route's turf-coloured lane inside a designed end zone. */
const LANE_CLIP = "ffez-lane";
/** Where the ▶ button floats over the field's bottom-right corner, in CSS pixels: 12 in from each edge, 48 across. */
const PLAY_BUTTON = { inset: 12, size: 48 };
/** The field's border, in CSS pixels: the diagram's units start inside it. */
const FIELD_BORDER = 3;

function FieldImpl({
  players, vis, side, selectedId, targeting, draft, dispatch, onSelect, onCatchNote, svgRef, snapMode = "half", showYardNumbers = true,
  noRunZones = true, los = LOS_YARD, readOnly = false, title, showTitle = false, status,
}: Props) {
  const paneRef = useRef<HTMLElement>(null);
  const [pane, setPane] = useState<Pane | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [liveWaypoint, setLiveWaypoint] = useState<{ id: string; index: number; x: number; y: number } | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<{ id: string; index: number } | null>(null);
  const [boingId, setBoingId] = useState<string | null>(null);
  const [liveCatch, setLiveCatch] = useState<{ id: string; pt: Pair } | null>(null);
  const [shakeId, setShakeId] = useState<string | null>(null);
  const shakeTimer = useRef(0);
  const catchDragRef = useRef<CatchDrag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const waypointDragRef = useRef<WaypointDrag | null>(null);
  const waypointRefs = useRef(new Map<number, SVGGElement>());
  const pendingWaypointFocus = useRef<number | null>(null);
  const rafRef = useRef(0);
  // playback: the plan plus seconds into it, or null when the whiteboard is still
  const [run, setRun] = useState<{ motion: Motion; t: number } | null>(null);
  const playRef = useRef(0);
  // a touchdown pass: which one this is on the device (it seeds the confetti) and what it opened
  const [party, setParty] = useState<{ seed: number; unlocked: EndZone | null } | null>(null);
  const endZone = useSyncExternalStore(subscribeEndZone, getEndZone, serverEndZone);
  const team = useSyncExternalStore(subscribeLibrary, getTeam, getServerTeam);
  const deepField = useSyncExternalStore(subscribeDeepField, getDeepField, serverDeepField);
  // classic is the band the field has always drawn; any other end zone paints its own design over it
  const designed = endZone !== "classic";

  // measure only stores the pane; all field geometry derives from it
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    let t = 0;
    const measure = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const pw = Math.max(240, el.clientWidth - 18);
        const ph = Math.max(220, el.clientHeight - 18 - (showTitle ? TITLE_CHROME : 0));
        setPane((prev) => (prev && Math.abs(prev.pw - pw) < 0.5 && Math.abs(prev.ph - ph) < 0.5 ? prev : { pw, ph }));
      }, 16);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, [showTitle]);

  // the dragged player's live spot overrides its committed spot until pointer-up
  const effective = useMemo(() => players.map((p) => {
    const moved = live?.id === p.id ? { ...p, x: live.x, y: live.y } : p;
    // a catch being dragged moves its lateral's arc and every job downstream of it, live
    if (liveCatch?.id === p.id && moved.route) return { ...moved, route: { ...moved.route, catch: liveCatch.pt } };
    if (liveWaypoint?.id !== p.id || moved.route?.type !== "custom" || !moved.route.pts) return moved;
    return {
      ...moved,
      route: {
        ...moved.route,
        pts: moved.route.pts.map((q, i) => (i === liveWaypoint.index ? [liveWaypoint.x, liveWaypoint.y] as const : q)),
      },
    };
  }), [players, live, liveWaypoint, liveCatch]);
  // the card fits the pane and the play; on a wide pane that is 16 yards past the line of scrimmage,
  // so drawing a custom route (a tap can't land past the card's top) and Deep field open the deepest card;
  // pre-snap motion stays in the backfield, so drawing it leaves the card as it is
  const fit = depth(effective, pane, MIN_DEPTH, los);
  const deepest = depth(effective, pane, MAX_DEPTH, los);
  const d = !readOnly && (deepField || (draft !== null && draft.kind !== "motion")) ? deepest : fit;
  // offered only where it shows more field, and not while anything is being drawn
  const offerDeep = !readOnly && draft === null && deepest > fit;
  const layout = useMemo(() => fieldLayout(d, showYardNumbers, noRunZones, los), [d, showYardNumbers, noRunZones, los]);
  const top = layout.top;
  const width = cardWidth(pane, d);
  const topRef = useRef(top);
  useLayoutEffect(() => { topRef.current = top; }, [top]);
  // the band a design paints on screen, and where it sits as a share of the diagram's height
  const band = designed ? layout.endZone : null;
  const vbh = Number(layout.viewBox.split(" ")[3]);
  const share = (n: number): string => (n / vbh).toFixed(5);

  const zones = useMemo(() => zoneLayout(effective, top), [effective, top]);
  // Man coverage always exposes its valid offense targets, even when the shadow is hidden.
  // They disappear again as soon as targeting ends.
  const visible = useMemo(
    () => effective.filter((p) => shown(p, vis) || (targeting !== null && p.team === "offense")),
    [effective, targeting, vis],
  );
  // who can take a lateral: a red player not already holding the ball
  const canTake = useMemo(() => {
    if (targeting !== "lateral") return new Set<string>();
    const held = new Set(chainOf(players).map((p) => p.id));
    return new Set(players.filter((p) => p.team === "offense" && !held.has(p.id)).map((p) => p.id));
  }, [players, targeting]);
  const targetOf = useCallback(
    (p: Player): "man" | "lateral" | null =>
      targeting === "man" && p.team === "offense" ? "man" : targeting === "lateral" && canTake.has(p.id) ? "lateral" : null,
    [canTake, targeting],
  );
  // a man defender whose receiver is off the field wears a name tag instead of an arrow to nobody
  const onField = useMemo(() => new Set(visible.map((p) => p.id)), [visible]);
  const tags = useMemo(() => manTags(visible, effective, top, layout.vh, zones), [visible, effective, top, layout.vh, zones]);
  // a run called from a no-run zone is flagged in the backfield corner every picture of it uses,
  // kept clear of the ▶ button on screen; a screen reader hears it with the diagram
  const flagged = runInNoRunZone({ side, players, los }, noRunZones);
  const flag = useMemo(() => {
    if (!flagged) return null;
    const k = VW / Math.max(1, (width ?? 430) - 2 * FIELD_BORDER);
    const reach = PLAY_BUTTON.inset + PLAY_BUTTON.size - FIELD_BORDER;
    const button = { x: VW - reach * k, y: layout.vh - reach * k, w: PLAY_BUTTON.size * k, h: PLAY_BUTTON.size * k };
    return stampBox(NO_RUN_STAMP, visible, top, layout.vh, [button]);
  }, [flagged, width, layout.vh, visible, top]);
  // and a screen reader hears the same, naming each defender as their token announces itself
  const tagWords = useMemo(() => {
    const who = (id: string): string => {
      const p = effective.find((q) => q.id === id);
      return `Defense ${p?.label || id}`;
    };
    return tags.length ? ` Man coverage: ${tags.map((t) => `${who(t.id)} ${t.text}`).join("; ")}.` : "";
  }, [tags, effective]);
  // each lateral as an arc from its release to its catch, drawn with its thrower
  const arcs = useMemo(() => lateralArcs(effective, top).filter((a) => onField.has(a.id)), [effective, top, onField]);
  const arcsFaded = arcs.length > 0 && side === "defense";
  const names = useMemo(() => Object.fromEntries(effective.map((p) => [p.id, p.label || p.id])), [effective]);
  const routes = useMemo(
    () => {
      const list = visible.flatMap((p) => {
        if (tagged(p, onField)) return [];
        const g = geom(p, effective, top, zones);
        return g ? [{ ...g, id: p.id, faded: isContext(p, side) }] : [];
      });
      // faded context sits under the play's own side
      return list.sort((a, b) => Number(b.faded) - Number(a.faded));
    },
    [visible, onField, effective, top, zones, side],
  );
  const draftD = useMemo(() => {
    if (!draft) return "";
    const p = effective.find((q) => q.id === draft.id);
    return p ? draftPath(draft.kind === "motion" ? p : atSnap(p), draft.pts, top) : "";
  }, [draft, effective, top]);
  const editableCustom = useMemo(() => {
    const p = effective.find((q) => q.id === selectedId);
    return p?.route?.type === "custom" ? p : null;
  }, [effective, selectedId]);
  const customPoints = editableCustom?.route?.pts ?? [];

  useEffect(() => {
    const index = pendingWaypointFocus.current;
    if (index === null || !waypointRefs.current.get(index)) return;
    pendingWaypointFocus.current = null;
    waypointRefs.current.get(index)?.focus();
  }, [customPoints.length]);

  const toYards = useCallback((cx: number, cy: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 15, y: 0 };
    const r = svg.getBoundingClientRect();
    const dep = 8 - topRef.current;
    return { x: ((cx - r.left) / r.width) * 30, y: topRef.current + ((cy - r.top) / r.height) * dep };
  }, [svgRef]);

  const applyDrag = useCallback(() => {
    rafRef.current = 0;
    const dr = dragRef.current;
    if (!dr?.last) return;
    const y = toYards(dr.last.x, dr.last.y);
    const c = clamp(y.x + dr.ox, y.y + dr.oy, dr.team, topRef.current, dr.gap);
    if (Math.abs(c.x - dr.x0) > 0.25 || Math.abs(c.y - dr.y0) > 0.25) dr.moved = true;
    if (dr.moved) setLive({ id: dr.id, x: c.x, y: c.y });
  }, [toYards]);

  const applyWaypointDrag = useCallback(() => {
    const dr = waypointDragRef.current;
    if (!dr?.last) return;
    const pt = toYards(dr.last.x, dr.last.y);
    const c = clamp(snap(pt.x, snapMode), snap(pt.y, snapMode), null, topRef.current);
    if (Math.abs(c.x - dr.x0) > 0.1 || Math.abs(c.y - dr.y0) > 0.1) dr.moved = true;
    if (dr.moved) setLiveWaypoint({ id: dr.id, index: dr.index, x: c.x, y: c.y });
  }, [snapMode, toYards]);

  const endDrag = useCallback(() => {
    const dr = dragRef.current;
    if (!dr) return;
    dragRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (dr.moved && dr.last) {
      const y = toYards(dr.last.x, dr.last.y);
      const c = clamp(y.x + dr.ox, y.y + dr.oy, dr.team, topRef.current, dr.gap);
      const s = clamp(snap(c.x, snapMode), snap(c.y, snapMode), dr.team, topRef.current, dr.gap);
      setLive(null);
      dispatch({ type: "move", id: dr.id, x: s.x, y: s.y, commit: true });
      setBoingId(dr.id);
      window.setTimeout(() => { setBoingId((b) => (b === dr.id ? null : b)); }, 380);
      return;
    }
    setLive(null);
    const p = players.find((q) => q.id === dr.id);
    if (!p) return;
    if (targeting === "lateral" && p.team === "offense") {
      // the player who takes it is selected next, to be given their job with the ball
      if (canTake.has(p.id)) { dispatch({ type: "target", id: p.id }); onSelect(p.id); }
      return;
    }
    if (targeting && p.team === "offense") { dispatch({ type: "target", id: p.id }); return; }
    onSelect(p.id);
  }, [canTake, dispatch, onSelect, players, snapMode, targeting, toYards]);

  const endWaypointDrag = useCallback(() => {
    const dr = waypointDragRef.current;
    if (!dr) return;
    waypointDragRef.current = null;
    if (dr.moved && dr.last) {
      const pt = toYards(dr.last.x, dr.last.y);
      const c = clamp(snap(pt.x, snapMode), snap(pt.y, snapMode), null, topRef.current);
      dispatch({ type: "customPointMove", id: dr.id, index: dr.index, pt: [c.x, c.y] });
    }
    setLiveWaypoint(null);
  }, [dispatch, snapMode, toYards]);

  // a catch that breaks a rule shakes and says which, once as it starts breaking it
  const snapBack = useCallback((id: string, rule: "line" | "forward") => {
    setShakeId(id);
    window.clearTimeout(shakeTimer.current);
    shakeTimer.current = window.setTimeout(() => { setShakeId(null); }, 400);
    onCatchNote?.(catchNote(rule, names[id] ?? ""));
  }, [names, onCatchNote]);
  useEffect(() => () => { window.clearTimeout(shakeTimer.current); }, []);

  /** The catch a pointer is over, in yards: snapped like a waypoint, then clamped behind its release and the line. */
  const catchAt = useCallback((id: string, cx: number, cy: number) => {
    const p = players.find((q) => q.id === id);
    const pt = toYards(cx, cy);
    const raw: Pair = [snap(pt.x, snapMode), snap(pt.y, snapMode)];
    const release = p ? releasePoint(p, players) : raw;
    return { pt: clampCatch(raw, release), rule: catchClamp(raw, release) };
  }, [players, snapMode, toYards]);

  const applyCatchDrag = useCallback(() => {
    const dr = catchDragRef.current;
    if (!dr?.last) return;
    dr.moved = true;
    const c = catchAt(dr.id, dr.last.x, dr.last.y);
    if (c.rule && c.rule !== dr.clamp) snapBack(dr.id, c.rule);
    dr.clamp = c.rule;
    setLiveCatch({ id: dr.id, pt: c.pt });
  }, [catchAt, snapBack]);

  const endCatchDrag = useCallback(() => {
    const dr = catchDragRef.current;
    if (!dr) return;
    catchDragRef.current = null;
    if (dr.moved && dr.last) dispatch({ type: "catchMove", id: dr.id, pt: catchAt(dr.id, dr.last.x, dr.last.y).pt });
    setLiveCatch(null);
  }, [catchAt, dispatch]);

  const onCatchDown = useCallback((id: string, e: PointerEvent<SVGGElement>) => {
    if (e.button !== 0 || playRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    catchDragRef.current = { id, moved: false, last: null, clamp: null };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  }, []);

  const onCatchKey = useCallback((id: string, e: KeyboardEvent<SVGGElement>) => {
    const step = STEP[e.key];
    const p = players.find((q) => q.id === id);
    const arc = arcs.find((a) => a.id === id);
    if (!step || !p || !arc || playRef.current) return;
    e.preventDefault();
    const distance = e.shiftKey ? 1 : 0.5;
    const raw: Pair = [arc.catch[0] + step[0] * distance, arc.catch[1] + step[1] * distance];
    const rule = catchClamp(raw, releasePoint(p, players));
    if (rule) snapBack(id, rule);
    dispatch({ type: "catchMove", id, pt: raw });
  }, [arcs, dispatch, players, snapBack]);

  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const dr = dragRef.current;
      const waypoint = waypointDragRef.current;
      const toss = catchDragRef.current;
      if (!dr && !waypoint && !toss) return;
      e.preventDefault();
      if (dr) {
        dr.last = { x: e.clientX, y: e.clientY };
        if (!rafRef.current) rafRef.current = requestAnimationFrame(applyDrag);
      }
      if (waypoint) {
        waypoint.last = { x: e.clientX, y: e.clientY };
        applyWaypointDrag();
      }
      if (toss) {
        toss.last = { x: e.clientX, y: e.clientY };
        applyCatchDrag();
      }
    };
    const up = () => { endDrag(); endWaypointDrag(); endCatchDrag(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [applyDrag, applyCatchDrag, applyWaypointDrag, endCatchDrag, endDrag, endWaypointDrag]);

  const onDown = useCallback((id: string, e: PointerEvent<SVGGElement>) => {
    if (e.button !== 0 || playRef.current) return;
    e.stopPropagation();
    const p = players.find((q) => q.id === id);
    if (!p) return;
    const pt = toYards(e.clientX, e.clientY);
    dragRef.current = { id, team: p.team, gap: losGap(p.route), ox: p.x - pt.x, oy: p.y - pt.y, x0: p.x, y0: p.y, moved: false, last: null };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  }, [players, toYards]);

  const onWaypointDown = useCallback((id: string, index: number, point: readonly [number, number], e: PointerEvent<SVGGElement>) => {
    if (e.button !== 0 || playRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedWaypoint({ id, index });
    waypointDragRef.current = { id, index, x0: point[0], y0: point[1], moved: false, last: null };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  }, []);

  const onKey = useCallback((id: string, e: KeyboardEvent<SVGGElement>) => {
    const p = players.find((q) => q.id === id);
    if (!p) return;
    const step = STEP[e.key];
    if (step && !playRef.current) {
      e.preventDefault();
      const c = clamp(p.x + step[0], p.y + step[1], p.team, topRef.current, losGap(p.route));
      dispatch({ type: "move", id, x: c.x, y: c.y, commit: true });
      if (selectedId !== id) onSelect(id);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (targeting === "lateral" && p.team === "offense") {
        if (canTake.has(id)) { dispatch({ type: "target", id }); onSelect(id); }
      } else if (targeting && p.team === "offense") dispatch({ type: "target", id });
      else onSelect(id);
    }
  }, [canTake, dispatch, onSelect, players, selectedId, targeting]);

  const onWaypointKey = useCallback((id: string, index: number, e: KeyboardEvent<SVGGElement>) => {
    const p = players.find((q) => q.id === id);
    const point = p?.route?.type === "custom" ? p.route.pts?.[index] : undefined;
    const pointCount = p?.route?.type === "custom" ? (p.route.pts?.length ?? 0) : 0;
    if (!point) return;
    const step = STEP[e.key];
    if (step && !playRef.current) {
      e.preventDefault();
      const distance = e.shiftKey ? 1 : 0.5;
      const c = clamp(point[0] + step[0] * distance, point[1] + step[1] * distance, null, topRef.current);
      dispatch({ type: "customPointMove", id, index, pt: [c.x, c.y] });
      setSelectedWaypoint({ id, index });
    } else if ((e.key === "Delete" || e.key === "Backspace") && pointCount > 1) {
      e.preventDefault();
      dispatch({ type: "customPointRemove", id, index });
      const nextIndex = Math.max(0, Math.min(index, pointCount - 2));
      setSelectedWaypoint({ id, index: nextIndex });
      pendingWaypointFocus.current = nextIndex;
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setSelectedWaypoint({ id, index });
    }
  }, [dispatch, players]);

  const onFieldClick = (e: MouseEvent<SVGSVGElement>) => {
    if (draft) {
      const pt = toYards(e.clientX, e.clientY);
      const c = clamp(snap(pt.x, snapMode), snap(pt.y, snapMode), null, top);
      const point = draft.kind === "motion" ? motionPoint([c.x, c.y]) : [c.x, c.y] as const;
      dispatch({ type: "draftPoint", pt: point });
      e.currentTarget.focus();
      return;
    }
    if (targeting) { dispatch({ type: "cancelTargeting" }); return; }
    dispatch({ type: "select", id: null });
  };

  const finishDraft = useCallback(() => { dispatch({ type: "draftFinish" }); }, [dispatch]);
  const cancelDraft = useCallback(() => { dispatch({ type: "draftCancel" }); }, [dispatch]);
  const addWaypoint = useCallback(() => {
    if (!editableCustom?.route?.pts || editableCustom.route.pts.length >= MAX_ROUTE_POINTS) return;
    const pts = editableCustom.route.pts;
    const last = pts.at(-1) ?? [editableCustom.x, editableCustom.y];
    const prev = pts.at(-2) ?? [editableCustom.x, editableCustom.y];
    const dx = last[0] - prev[0], dy = last[1] - prev[1];
    const length = Math.hypot(dx, dy);
    const raw = length > 0.01
      ? [last[0] + (dx / length) * 2, last[1] + (dy / length) * 2] as const
      : [last[0], last[1] - 2] as const;
    const c = clamp(snap(raw[0], snapMode), snap(raw[1], snapMode), null, topRef.current);
    const index = pts.length;
    pendingWaypointFocus.current = index;
    setSelectedWaypoint({ id: editableCustom.id, index });
    dispatch({ type: "customPointAdd", id: editableCustom.id, pt: [c.x, c.y] });
  }, [dispatch, editableCustom, snapMode]);
  const removeWaypoint = useCallback(() => {
    if (!editableCustom?.route?.pts || !selectedWaypoint || selectedWaypoint.id !== editableCustom.id || editableCustom.route.pts.length <= 1) return;
    const index = selectedWaypoint.index;
    const nextIndex = Math.max(0, Math.min(index, editableCustom.route.pts.length - 2));
    pendingWaypointFocus.current = nextIndex;
    setSelectedWaypoint({ id: editableCustom.id, index: nextIndex });
    dispatch({ type: "customPointRemove", id: editableCustom.id, index });
  }, [dispatch, editableCustom, selectedWaypoint]);

  useEffect(() => {
    if (!draft) return;
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dispatch({ type: "draftCancel" });
      } else if ((e.key === "Delete" || e.key === "Backspace") && draft.pts.length > 0) {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest("button, input, select, textarea, [role='button']")) return;
        e.preventDefault();
        dispatch({ type: "draftPointRemove" });
      } else if (e.key === "Enter" && draft.pts.length > 0) {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest("button, input, select, textarea, [role='button']")) return;
        e.preventDefault();
        dispatch({ type: "draftFinish" });
      }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); };
  }, [dispatch, draft]);

  const dragging = live !== null;
  const selectedWaypointIndex = selectedWaypoint?.index;
  const activeWaypoint = selectedWaypoint?.id === editableCustom?.id && selectedWaypointIndex !== undefined && selectedWaypointIndex < customPoints.length
    ? selectedWaypointIndex
    : null;
  const selectedPoint = activeWaypoint === null ? null : customPoints[activeWaypoint];
  const targetOwner = targeting ? players.find((p) => p.id === selectedId) : null;
  const targetOwnerName = targetOwner ? `${targetOwner.team === "offense" ? "Offense" : "Defense"} ${targetOwner.label || targetOwner.id}` : null;

  // playback runs on its own rAF clock; the plan is built once, from the committed play.
  // Live playback is a simulation: the primary read gets the ball most of the time, so a
  // coach who presses ▶ again can see the other reads too. Exports pin the primary.
  const playing = run !== null;
  const played = run ? positionsAt(run.motion, players, run.t) : null;
  const ball = run && played ? ballAt(run.motion, played, run.t) : null;
  const stop = useCallback(() => {
    if (playRef.current) { cancelAnimationFrame(playRef.current); playRef.current = 0; }
    setRun(null);
  }, []);
  const play = useCallback(() => {
    endDrag();
    dispatch({ type: "select", id: null });
    setParty(null);
    const motion = buildMotion(players, topRef.current, simulationPlayback(Math.random));
    // the moment a caught pass is first over the goal line, if it ever is: a touchdown. Only the
    // play's own offense scores; on a defensive call a completion by the shadow offense is being scored on
    const td = side === "offense" ? touchdownAt(motion, players, los) : null;
    let scored = false;
    let t0 = -1;
    const tick = (now: number) => {
      if (t0 < 0) t0 = now;
      const t = (now - t0) / 1000;
      if (td !== null && !scored && t >= td) {
        scored = true;
        const { touchdowns, unlocked } = recordTouchdown();
        setParty({ seed: touchdowns, unlocked });
      }
      if (t >= motion.dur) { playRef.current = 0; setRun(null); return; }
      setRun({ motion, t });
      playRef.current = requestAnimationFrame(tick);
    };
    setRun({ motion, t: 0 });
    playRef.current = requestAnimationFrame(tick);
  }, [dispatch, endDrag, los, players, side]);
  // a playback, and the touchdown it is watching for, belong to the spot it started on: moving the ball ends it
  useEffect(() => stop, [stop, los]);
  useEffect(() => {
    if (!party) return;
    const t = window.setTimeout(() => { setParty(null); }, CELEBRATION_MS);
    return () => { window.clearTimeout(t); };
  }, [party]);
  useEffect(() => {
    if (!playing) return;
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") stop(); };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); };
  }, [playing, stop]);

  return (
    <main ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden p-[9px] print:block print:overflow-visible print:p-0">
      {title !== undefined && !showTitle && <h1 className="hidden text-header font-normal print:mb-2 print:block">{title}</h1>}
      <div className="flex-none print:!w-full" style={{ width: width !== null ? `${width.toFixed(1)}px` : "min(100%, 430px)" }}>
        {title !== undefined && showTitle && (
          <div id={FIELD_TITLE_ID} className="mb-0.5 flex min-w-0 items-baseline justify-center gap-2 px-1 leading-tight print:mb-2">
            <h1 className="min-w-0 truncate text-header font-normal text-ink" title={title}>{title}</h1>
            {status !== undefined && (
              <span className={`shrink-0 text-caption ${status === "Saving failed" ? "text-offense" : "text-ink-muted"}`} aria-live="polite">
                {status}
              </span>
            )}
          </div>
        )}
        <div className="relative">
        {draft && !readOnly && (
          <div role="toolbar" aria-label={draft.kind === "motion" ? "Pre-snap motion controls" : "Custom route controls"} className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-1.5 print:hidden">
            <button type="button" onClick={finishDraft} disabled={draft.pts.length === 0} title="Finish route (Enter)" aria-keyshortcuts="Enter" className={`${pillMd} min-h-11 bg-yellow on-yellow`}>
              Finish
            </button>
            <button type="button" onClick={() => { dispatch({ type: "draftPointRemove" }); }} disabled={draft.pts.length === 0} title="Remove last waypoint (Delete)" aria-keyshortcuts="Delete Backspace" className={`${pillMd} min-h-11`}>
              Remove last
            </button>
            <button type="button" onClick={cancelDraft} title="Cancel route (Esc)" aria-keyshortcuts="Escape" className={`${pillMd} min-h-11`}>
              Cancel
            </button>
          </div>
        )}
        {editableCustom && !draft && !readOnly && (
          <div role="toolbar" aria-label="Waypoint controls" className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-1.5 print:hidden">
            <button type="button" onClick={addWaypoint} disabled={customPoints.length >= MAX_ROUTE_POINTS} title="Add a waypoint (undoable)" className={`${pillMd} min-h-11 bg-white`}>
              Add waypoint
            </button>
            <button type="button" onClick={removeWaypoint} disabled={activeWaypoint === null || customPoints.length <= 1} title="Remove selected waypoint (Delete, undoable)" aria-keyshortcuts="Delete Backspace" className={`${pillMd} min-h-11 bg-white`}>
              Remove waypoint
            </button>
          </div>
        )}
        {offerDeep && (
          <button
            type="button"
            onClick={() => { setDeepField(!deepField); }}
            aria-pressed={deepField}
            data-active={deepField}
            title={
              deepField
                ? "Fit the field to the play"
                : deepest >= 8 + GOAL_YARD + END_ZONE_YARDS - los
                  ? "Show the field to the end line"
                  : `Show ${String(deepest - 8)} yards downfield`
            }
            className={
              `${pillSm} absolute right-3 top-3 z-10 shadow-tile data-[active=true]:bg-yellow data-[active=true]:on-yellow ` +
              "data-[active=true]:hover:bg-yellow print:hidden"
            }
          >
            Deep field
          </button>
        )}
        <span className="sr-only" aria-live="polite">
          {targeting === "lateral" && targetOwnerName
            ? `Lateral from ${targetOwnerName}. Focus an offense player who isn't holding the ball and press Enter or Space. Escape cancels.`
            : targeting && targetOwnerName
            ? `Targeting for ${targetOwnerName}. Focus an offense player and press Enter or Space. Escape cancels.`
            : selectedPoint
              ? `Waypoint ${String((activeWaypoint ?? 0) + 1)} selected at ${selectedPoint[0].toFixed(1)}, ${selectedPoint[1].toFixed(1)} yards. Arrow keys move it; Delete removes it.`
              : ""}
        </span>
        {/*
          the chosen end zone's design, on screen only, on a layer of its own just the band's size under
          the diagram: animated inside the diagram (or on a layer the size of the field) it made Safari
          repaint every line, route and player on every frame, a few frames a second on a phone. Over
          the band the diagram is see-through; print and every export keep its own classic band.
          will-change gives the layer to the compositor outright, so players running over the band
          during a touchdown never repaint the design, and the design's own steps never repaint them.
        */}
        {band && (
          <svg
            data-ez-backdrop
            viewBox={`0 ${band.y.toFixed(1)} 660 ${band.h.toFixed(1)}`}
            preserveAspectRatio="none"
            aria-hidden
            className={
              "pointer-events-none absolute left-[3px] w-[calc(100%-6px)] will-change-transform print:hidden " +
              (band.y < 1 ? "rounded-t-[calc(var(--radius-field)-3px)]" : "")
            }
            style={{ top: `calc(3px + (100% - 6px) * ${share(band.y)})`, height: `calc((100% - 6px) * ${share(band.h)})` }}
          >
            <rect x="0" y={band.y.toFixed(1)} width="660" height={band.h.toFixed(1)} fill="#a7e5a7" style={{ fill: FIELD.endzone }} />
            <svg x="0" y={band.y.toFixed(1)} width="660" height={band.h.toFixed(1)} overflow="hidden">
              <EndZoneArt id={endZone} w={660} h={band.h} label={band.h > 30} celebrate={party !== null} />
            </svg>
          </svg>
        )}
        <svg
          ref={svgRef}
          viewBox={layout.viewBox}
          onClick={readOnly ? undefined : onFieldClick}
          onDoubleClick={readOnly ? undefined : () => { if (draft) dispatch({ type: "draftFinishDoubleTap" }); }}
          className={
            "relative block h-auto w-full touch-pan-y rounded-field border-[3px] border-ink shadow-field " +
            (band ? "print:bg-(--field-turf)" : "bg-(--field-turf)")
          }
          role={readOnly ? "img" : "group"}
          tabIndex={!readOnly && draft ? 0 : undefined}
          aria-keyshortcuts={!readOnly && draft ? "Enter Escape Delete Backspace" : undefined}
          aria-label="Play diagram"
        >
          <desc>
            {readOnly ? "Flag football play diagram." : "Interactive flag football play diagram. Tab to players and custom waypoints."}
            {tagWords}
            {visible.some(p => p.preSnap) ? " Dashed pre-snap motion runs before the snap; the route begins at its endpoint." : ""}
            {arcs.length ? ` Laterals, as dashed arcs behind the line: ${arcs.map((a) => `${names[a.id] ?? ""} to ${names[a.target] ?? ""}`).join(", then ")}.` : ""}
            {flagged ? ` ${NO_RUN_FLAG}: the ball is in a no-run zone and this play is a run.` : ""}
          </desc>
          <defs>
            <pattern id="ffhatch" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="11" stroke="#1b1a17" style={{ stroke: FIELD.line }} strokeWidth="1.6" opacity="0.19" />
            </pattern>
            {designed && layout.endZone && (
              <clipPath id={LANE_CLIP}>
                <rect x="0" y={layout.endZone.y.toFixed(1)} width="660" height={layout.endZone.h.toFixed(1)} />
              </clipPath>
            )}
          </defs>
          <g>
            {/* under a design the diagram paints the turf round the band and leaves the band see-through, so the design's layer shows; print keeps the band */}
            {band && (
              <g className="print:hidden">
                <rect x="0" y="0" width="660" height={band.y.toFixed(1)} style={{ fill: FIELD.turf }} />
                <rect x="0" y={(band.y + band.h).toFixed(1)} width="660" height={Math.max(0, vbh - band.y - band.h).toFixed(1)} style={{ fill: FIELD.turf }} />
              </g>
            )}
            {layout.endZone && (
              <rect
                x="0" y={layout.endZone.y.toFixed(1)} width="660" height={layout.endZone.h.toFixed(1)} fill="#a7e5a7" style={{ fill: FIELD.endzone }}
                className={designed ? "opacity-0 print:opacity-100" : undefined}
              />
            )}
            {layout.bands.map((b) => (
              <rect key={b.y} x="0" y={b.y.toFixed(1)} width="660" height={b.h.toFixed(1)} fill="url(#ffhatch)" />
            ))}
            {layout.lines.map((l) => (
              <line key={l.y} x1="0" y1={l.y.toFixed(1)} x2="660" y2={l.y.toFixed(1)} stroke="#1b1a17" style={{ stroke: FIELD.line }} strokeWidth={l.w} opacity={l.o} />
            ))}
            {layout.texts.length > 0 && (
              <g fontFamily="var(--font-hand)" fontSize={17} fill="#1b1a17" style={{ fill: FIELD.line }} fillOpacity={0.5}>
                {/* a designed end zone letters itself, and the goal line's yard number would sit on its art; both come back for print */}
                {layout.texts.map((t) => (
                  <text
                    key={t.key} x={t.x} y={t.y.toFixed(1)} letterSpacing={t.letterSpacing}
                    className={designed && layout.endZone && t.y < layout.endZone.y + layout.endZone.h ? "hidden print:inline" : undefined}
                  >
                    {t.t}
                  </text>
                ))}
              </g>
            )}
          </g>
          {/* under the routes, as on every picture, so it never hides the end of one */}
          {flag && (
            <g data-no-run-flag="" aria-hidden="true" pointerEvents="none">
              <rect
                x={flag.x.toFixed(1)} y={flag.y.toFixed(1)} width={flag.w.toFixed(1)} height={flag.h.toFixed(1)} rx={6}
                fill="#f2b705" stroke="#1b1a17" strokeWidth={2.5}
              />
              <text
                x={(flag.x + flag.w / 2).toFixed(1)} y={(flag.y + flag.h / 2 + 1).toFixed(1)} textAnchor="middle" dominantBaseline="central"
                fontFamily="var(--font-hand)" fontSize={STAMP_FONT} letterSpacing={STAMP_SPACING} fill="#1b1a17" className="select-none"
              >
                {NO_RUN_STAMP}
              </text>
            </g>
          )}
          {visible.map(p => {
            const g = motionGeom(p, top);
            return g ? <g key={p.id} data-pre-snap={p.id}><RouteLayer routes={[{ ...g, id: p.id, faded: isContext(p, side) }]} draftD="" /></g> : null;
          })}
          <RouteLayer routes={routes} draftD={draftD} lane={designed && layout.endZone ? LANE_CLIP : null} />
          {arcs.length > 0 && <LateralLayer arcs={arcs} part="arcs" faded={arcsFaded} />}
          {editableCustom && !draft && customPoints.map((point, index) => {
            const active = activeWaypoint === index;
            return (
              <g
                key={`${editableCustom.id}-${String(index)}`}
                ref={(node) => {
                  if (node) waypointRefs.current.set(index, node);
                  else waypointRefs.current.delete(index);
                }}
                transform={`translate(${px(point[0]).toFixed(1)},${py(point[1], top).toFixed(1)})`}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Delete Backspace"
                aria-label={`Waypoint ${String(index + 1)} of ${String(customPoints.length)} for ${editableCustom.team === "offense" ? "Offense" : "Defense"} ${editableCustom.label || editableCustom.id}. Arrow keys move; Delete removes.`}
                onFocus={() => { setSelectedWaypoint({ id: editableCustom.id, index }); }}
                onPointerDown={(e) => { onWaypointDown(editableCustom.id, index, point, e); }}
                onClick={(e) => { e.stopPropagation(); setSelectedWaypoint({ id: editableCustom.id, index }); }}
                onKeyDown={(e) => { onWaypointKey(editableCustom.id, index, e); }}
                className="group cursor-grab touch-none outline-none"
                data-export="skip"
              >
                <circle r={34} fill="transparent" />
                <circle r={active ? 11 : 9} fill="#fffdf6" stroke="#1b1a17" style={{ fill: FIELD.waypoint, stroke: FIELD.outline }} strokeWidth={3} />
                <circle r={15} fill="none" stroke="#f2b705" style={{ stroke: FIELD.ring }} strokeWidth={4} className="opacity-0 group-focus-visible:opacity-100" />
              </g>
            );
          })}
          {visible.map((p) => (
            <PlayerToken
              key={p.id}
              player={p}
              x={px(played?.[p.id]?.x ?? p.x)}
              y={py(played?.[p.id]?.y ?? p.y, top)}
              selected={p.id === selectedId}
              target={targetOf(p)}
              focusOnTarget={targetOf(p) !== null && p.id === visible.find((q) => targetOf(q) !== null)?.id}
              boing={boingId === p.id}
              dragging={dragging}
              readOnly={readOnly || draft !== null}
              drawing={draft !== null}
              faded={isContext(p, side)}
              onPointerDown={onDown}
              onKeyDown={onKey}
            />
          ))}
          {/* over the players, so no neighbour hides one; none while they run, since the tags would stay behind */}
          {!playing && <ManTagLayer tags={tags} />}
          {/* each catch point's handle, over the players so one never hides it; not while running, drawing or on the share page */}
          {!playing && !readOnly && draft === null && arcs.length > 0 && (
            <LateralLayer arcs={arcs} part="handles" names={names} shake={shakeId} faded={arcsFaded} onHandleDown={onCatchDown} onHandleKey={onCatchKey} />
          )}
          {ball && <Football x={px(ball.x)} y={py(ball.y, top)} lift={ball.lift} />}
        </svg>
        {party && (
          <Celebration
            key={party.seed}
            zone={endZone}
            teamColor={team.color}
            seed={party.seed}
            unlocked={party.unlocked}
            originY={layout.endZone ? (layout.endZone.y + layout.endZone.h / 2) / layout.vh : 0}
          />
        )}
        <span className="sr-only" aria-live="polite">
          {party ? `Touchdown!${party.unlocked ? ` The ${party.unlocked.name} end zone is open.` : ""}` : ""}
        </span>
        <PlayButton playing={playing} onClick={playing ? stop : play} />
        </div>
      </div>
    </main>
  );
}

export const Field = memo(FieldImpl);

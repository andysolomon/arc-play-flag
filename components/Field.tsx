"use client";

import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject,
} from "react";
import { cardWidth, clamp, depth, draftPath, fieldLayout, geom, px, py, snap } from "@/lib/play/geometry";
import { ballAt, buildMotion, positionsAt, type Motion } from "@/lib/play/motion";
import type { Action } from "@/lib/play/reducer";
import { shown } from "@/lib/play/reducer";
import { MAX_ROUTE_POINTS, losGap } from "@/lib/play/routes";
import type { Draft, Pane, Player, SnapMode, Team, Vis } from "@/lib/play/types";
import { zoneLayout } from "@/lib/play/zones";
import { Football, PlayButton } from "./Playback";
import { PlayerToken } from "./PlayerToken";
import { RouteLayer } from "./RouteLayer";
import { pillMd } from "./ui";

interface Props {
  players: readonly Player[];
  vis: Vis;
  selectedId: string | null;
  targeting: boolean;
  draft: Draft | null;
  dispatch: (a: Action) => void;
  onSelect: (id: string) => void;
  svgRef: RefObject<SVGSVGElement | null>;
  snapMode?: SnapMode;
  showYardNumbers?: boolean;
  /** share page: draw only, no interaction */
  readOnly?: boolean;
  /** printed above the field (print stylesheet only) */
  title?: string;
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

function FieldImpl({
  players, vis, selectedId, targeting, draft, dispatch, onSelect, svgRef, snapMode = "half", showYardNumbers = true,
  readOnly = false, title,
}: Props) {
  const paneRef = useRef<HTMLElement>(null);
  const [pane, setPane] = useState<Pane | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [liveWaypoint, setLiveWaypoint] = useState<{ id: string; index: number; x: number; y: number } | null>(null);
  const [selectedWaypoint, setSelectedWaypoint] = useState<{ id: string; index: number } | null>(null);
  const [boingId, setBoingId] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const waypointDragRef = useRef<WaypointDrag | null>(null);
  const waypointRefs = useRef(new Map<number, SVGGElement>());
  const pendingWaypointFocus = useRef<number | null>(null);
  const rafRef = useRef(0);
  // playback: the plan plus seconds into it, or null when the whiteboard is still
  const [run, setRun] = useState<{ motion: Motion; t: number } | null>(null);
  const playRef = useRef(0);

  // measure only stores the pane; all field geometry derives from it
  useLayoutEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    let t = 0;
    const measure = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        const pw = Math.max(240, el.clientWidth - 18);
        const ph = Math.max(220, el.clientHeight - 18);
        setPane((prev) => (prev && Math.abs(prev.pw - pw) < 0.5 && Math.abs(prev.ph - ph) < 0.5 ? prev : { pw, ph }));
      }, 16);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => { ro.disconnect(); window.clearTimeout(t); };
  }, []);

  // the dragged player's live spot overrides its committed spot until pointer-up
  const effective = useMemo(() => players.map((p) => {
    const moved = live?.id === p.id ? { ...p, x: live.x, y: live.y } : p;
    if (liveWaypoint?.id !== p.id || moved.route?.type !== "custom" || !moved.route.pts) return moved;
    return {
      ...moved,
      route: {
        ...moved.route,
        pts: moved.route.pts.map((q, i) => (i === liveWaypoint.index ? [liveWaypoint.x, liveWaypoint.y] as const : q)),
      },
    };
  }), [players, live, liveWaypoint]);
  const d = depth(effective, pane);
  const layout = useMemo(() => fieldLayout(d, showYardNumbers), [d, showYardNumbers]);
  const top = layout.top;
  const width = cardWidth(pane, d);
  const topRef = useRef(top);
  useLayoutEffect(() => { topRef.current = top; }, [top]);

  const zones = useMemo(() => zoneLayout(effective, top), [effective, top]);
  // Man coverage always exposes its valid offense targets, even when the coach is
  // working in Defense-only view. They disappear again as soon as targeting ends.
  const visible = useMemo(
    () => effective.filter((p) => shown(p, vis) || (targeting && p.team === "offense")),
    [effective, targeting, vis],
  );
  const routes = useMemo(
    () => visible.flatMap((p) => { const g = geom(p, effective, top, zones); return g ? [{ ...g, id: p.id }] : []; }),
    [visible, effective, top, zones],
  );
  const draftD = useMemo(() => {
    if (!draft) return "";
    const p = effective.find((q) => q.id === draft.id);
    return p ? draftPath(p, draft.pts, top) : "";
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
    if (targeting && p.team === "offense") { dispatch({ type: "target", id: p.id }); return; }
    onSelect(p.id);
  }, [dispatch, onSelect, players, snapMode, targeting, toYards]);

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

  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const dr = dragRef.current;
      const waypoint = waypointDragRef.current;
      if (!dr && !waypoint) return;
      e.preventDefault();
      if (dr) {
        dr.last = { x: e.clientX, y: e.clientY };
        if (!rafRef.current) rafRef.current = requestAnimationFrame(applyDrag);
      }
      if (waypoint) {
        waypoint.last = { x: e.clientX, y: e.clientY };
        applyWaypointDrag();
      }
    };
    const up = () => { endDrag(); endWaypointDrag(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [applyDrag, applyWaypointDrag, endDrag, endWaypointDrag]);

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
      if (targeting && p.team === "offense") dispatch({ type: "target", id });
      else onSelect(id);
    }
  }, [dispatch, onSelect, players, selectedId, targeting]);

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
      dispatch({ type: "draftPoint", pt: [c.x, c.y] });
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

  // playback runs on its own rAF clock; the plan is built once, from the committed play
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
    const motion = buildMotion(players, topRef.current);
    let t0 = -1;
    const tick = (now: number) => {
      if (t0 < 0) t0 = now;
      const t = (now - t0) / 1000;
      if (t >= motion.dur) { playRef.current = 0; setRun(null); return; }
      setRun({ motion, t });
      playRef.current = requestAnimationFrame(tick);
    };
    setRun({ motion, t: 0 });
    playRef.current = requestAnimationFrame(tick);
  }, [dispatch, endDrag, players]);
  useEffect(() => stop, [stop]);
  useEffect(() => {
    if (!playing) return;
    const key = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") stop(); };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); };
  }, [playing, stop]);

  return (
    <main ref={paneRef} className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden p-[9px] print:block print:overflow-visible print:p-0">
      {title !== undefined && <h1 className="hidden text-header font-normal print:mb-2 print:block">{title}</h1>}
      <div className="relative flex-none print:!w-full" style={{ width: width !== null ? `${width.toFixed(1)}px` : "min(100%, 430px)" }}>
        {draft && !readOnly && (
          <div role="toolbar" aria-label="Custom route controls" className="absolute bottom-3 left-3 z-10 flex flex-wrap gap-1.5 print:hidden">
            <button type="button" onClick={finishDraft} disabled={draft.pts.length === 0} title="Finish route (Enter)" aria-keyshortcuts="Enter" className={`${pillMd} min-h-11 bg-yellow`}>
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
        <span className="sr-only" aria-live="polite">
          {targeting && targetOwnerName
            ? `Targeting for ${targetOwnerName}. Focus an offense player and press Enter or Space. Escape cancels.`
            : selectedPoint
              ? `Waypoint ${String((activeWaypoint ?? 0) + 1)} selected at ${selectedPoint[0].toFixed(1)}, ${selectedPoint[1].toFixed(1)} yards. Arrow keys move it; Delete removes it.`
              : ""}
        </span>
        <svg
          ref={svgRef}
          viewBox={layout.viewBox}
          onClick={readOnly ? undefined : onFieldClick}
          onDoubleClick={readOnly ? undefined : () => { if (draft) dispatch({ type: "draftFinishDoubleTap" }); }}
          className="block h-auto w-full touch-pan-y rounded-field border-[3px] border-ink bg-turf shadow-field"
          role={readOnly ? "img" : "group"}
          tabIndex={!readOnly && draft ? 0 : undefined}
          aria-keyshortcuts={!readOnly && draft ? "Enter Escape Delete Backspace" : undefined}
          aria-label="Play diagram"
        >
          <desc>{readOnly ? "Flag football play diagram" : "Interactive flag football play diagram. Tab to players and custom waypoints."}</desc>
          <defs>
            <pattern id="ffhatch" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="11" stroke="#1b1a17" strokeWidth="1.6" opacity="0.19" />
            </pattern>
          </defs>
          <g>
            {layout.endZone && <rect x="0" y={layout.endZone.y.toFixed(1)} width="660" height={layout.endZone.h.toFixed(1)} fill="#a7e5a7" />}
            {layout.bands.map((b) => (
              <rect key={b.y} x="0" y={b.y.toFixed(1)} width="660" height={b.h.toFixed(1)} fill="url(#ffhatch)" />
            ))}
            {layout.lines.map((l) => (
              <line key={l.y} x1="0" y1={l.y.toFixed(1)} x2="660" y2={l.y.toFixed(1)} stroke="#1b1a17" strokeWidth={l.w} opacity={l.o} />
            ))}
            {layout.texts.length > 0 && (
              <g fontFamily="var(--font-hand)" fontSize={17} fill="#1b1a17" fillOpacity={0.5}>
                {layout.texts.map((t) => (
                  <text key={t.key} x={t.x} y={t.y.toFixed(1)} letterSpacing={t.letterSpacing}>{t.t}</text>
                ))}
              </g>
            )}
          </g>
          <RouteLayer routes={routes} draftD={draftD} />
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
                <circle r={active ? 11 : 9} fill="#fffdf6" stroke="#1b1a17" strokeWidth={3} />
                <circle r={15} fill="none" stroke="#f2b705" strokeWidth={4} className="opacity-0 group-focus-visible:opacity-100" />
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
              target={targeting && p.team === "offense"}
              focusOnTarget={targeting && p.team === "offense" && p.id === visible.find((q) => q.team === "offense")?.id}
              boing={boingId === p.id}
              dragging={dragging}
              readOnly={readOnly}
              onPointerDown={onDown}
              onKeyDown={onKey}
            />
          ))}
          {ball && <Football x={px(ball.x)} y={py(ball.y, top)} lift={ball.lift} />}
        </svg>
        <PlayButton playing={playing} onClick={playing ? stop : play} />
      </div>
    </main>
  );
}

export const Field = memo(FieldImpl);

"use client";

import {
  memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject,
} from "react";
import { cardWidth, clamp, depth, draftPath, fieldLayout, geom, px, py, snap } from "@/lib/play/geometry";
import { ballAt, buildMotion, positionsAt, type Motion } from "@/lib/play/motion";
import type { Action } from "@/lib/play/reducer";
import { shown } from "@/lib/play/reducer";
import { losGap } from "@/lib/play/routes";
import type { Draft, Pane, Player, SnapMode, Team, Vis } from "@/lib/play/types";
import { zoneLayout } from "@/lib/play/zones";
import { Football, PlayButton } from "./Playback";
import { PlayerToken } from "./PlayerToken";
import { RouteLayer } from "./RouteLayer";

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
  const [boingId, setBoingId] = useState<string | null>(null);
  const dragRef = useRef<Drag | null>(null);
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
  const effective = useMemo(
    () => (live ? players.map((p) => (p.id === live.id ? { ...p, x: live.x, y: live.y } : p)) : players),
    [players, live],
  );
  const d = depth(effective, pane);
  const layout = useMemo(() => fieldLayout(d, showYardNumbers), [d, showYardNumbers]);
  const top = layout.top;
  const width = cardWidth(pane, d);
  const topRef = useRef(top);
  useLayoutEffect(() => { topRef.current = top; }, [top]);

  const zones = useMemo(() => zoneLayout(effective, top), [effective, top]);
  const visible = useMemo(() => effective.filter((p) => shown(p, vis)), [effective, vis]);
  const routes = useMemo(
    () => visible.flatMap((p) => { const g = geom(p, effective, top, zones); return g ? [{ ...g, id: p.id }] : []; }),
    [visible, effective, top, zones],
  );
  const draftD = useMemo(() => {
    if (!draft) return "";
    const p = effective.find((q) => q.id === draft.id);
    return p ? draftPath(p, draft.pts, top) : "";
  }, [draft, effective, top]);

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

  useEffect(() => {
    const move = (e: globalThis.PointerEvent) => {
      const dr = dragRef.current;
      if (!dr) return;
      e.preventDefault();
      dr.last = { x: e.clientX, y: e.clientY };
      if (!rafRef.current) rafRef.current = requestAnimationFrame(applyDrag);
    };
    const up = () => { endDrag(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [applyDrag, endDrag]);

  const onDown = useCallback((id: string, e: PointerEvent<SVGGElement>) => {
    if (e.button !== 0 || playRef.current) return;
    e.stopPropagation();
    const p = players.find((q) => q.id === id);
    if (!p) return;
    const pt = toYards(e.clientX, e.clientY);
    dragRef.current = { id, team: p.team, gap: losGap(p.route), ox: p.x - pt.x, oy: p.y - pt.y, x0: p.x, y0: p.y, moved: false, last: null };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not supported */ }
  }, [players, toYards]);

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
      onSelect(id);
    }
  }, [dispatch, onSelect, players, selectedId]);

  const onFieldClick = (e: MouseEvent<SVGSVGElement>) => {
    if (draft) {
      const pt = toYards(e.clientX, e.clientY);
      const c = clamp(snap(pt.x, snapMode), snap(pt.y, snapMode), null, top);
      dispatch({ type: "draftPoint", pt: [c.x, c.y] });
      return;
    }
    if (targeting) { dispatch({ type: "cancelTargeting" }); return; }
    dispatch({ type: "select", id: null });
  };

  const dragging = live !== null;

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
        <svg
          ref={svgRef}
          viewBox={layout.viewBox}
          onClick={readOnly ? undefined : onFieldClick}
          onDoubleClick={readOnly ? undefined : () => { if (draft) dispatch({ type: "draftFinish" }); }}
          className="block h-auto w-full touch-pan-y rounded-field border-[3px] border-ink bg-turf shadow-field"
          role="img"
          aria-label="Play diagram"
        >
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
          {visible.map((p) => (
            <PlayerToken
              key={p.id}
              player={p}
              x={px(played?.[p.id]?.x ?? p.x)}
              y={py(played?.[p.id]?.y ?? p.y, top)}
              selected={p.id === selectedId}
              target={targeting && p.team === "offense"}
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

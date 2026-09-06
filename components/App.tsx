"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { initialState, reducer, selected } from "@/lib/play/reducer";
import { Field } from "./Field";
import { Header } from "./Header";
import { Hint } from "./Hint";
import { PlaySidebar } from "./PlaySidebar";
import { RouteSidebar } from "./RouteSidebar";
import { Sidebar, type Open } from "./Sidebar";

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);

/** Media-query state that hydrates without a mismatch (server snapshot is false). */
function useMedia(query: string): boolean {
  const subscribe = useCallback((cb: () => void) => {
    const mq = window.matchMedia(query);
    mq.addEventListener("change", cb);
    return () => { mq.removeEventListener("change", cb); };
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

export function App() {
  const [s, dispatch] = useReducer(reducer, undefined, initialState);
  const [leftOpen, setLeftOpen] = useState<Open>("auto");
  const [rightOpen, setRightOpen] = useState<Open>("auto");
  const svgRef = useRef<SVGSVGElement>(null);
  const wide = useMedia("(min-width: 900px)");
  const narrow = useMedia("(max-width: 759px)");
  const narrowRef = useRef(narrow);
  useEffect(() => { narrowRef.current = narrow; }, [narrow]);

  // narrow screens show one sidebar at a time
  const openLeft = useCallback((open: boolean) => {
    setLeftOpen(open);
    if (open && narrowRef.current) setRightOpen(false);
  }, []);
  const openRight = useCallback((open: boolean) => {
    setRightOpen(open);
    if (open && narrowRef.current) setLeftOpen(false);
  }, []);
  const isOpen = (o: Open, side: "left" | "right"): boolean => (o === "auto" ? side === "left" && wide : o);

  const onSelect = useCallback((id: string) => {
    dispatch({ type: "select", id });
    openRight(true);
  }, [openRight]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { dispatch({ type: "select", id: null }); return; }
      if (isEditable(e.target)) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
      } else if ((e.metaKey || e.ctrlKey) && k === "y") {
        e.preventDefault();
        dispatch({ type: "redo" });
      }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); };
  }, []);

  const sel = selected(s);
  const hint = s.targeting ? "Cover who? Tap a red player." : s.draft ? "Tap waypoints on the field · double-tap to finish" : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <Header
        name={s.name}
        leftOpen={isOpen(leftOpen, "left")}
        rightOpen={isOpen(rightOpen, "right")}
        canUndo={s.past.length > 0}
        canRedo={s.future.length > 0}
        onToggleLeft={() => { openLeft(!isOpen(leftOpen, "left")); }}
        onToggleRight={() => { openRight(!isOpen(rightOpen, "right")); }}
        onUndo={() => { dispatch({ type: "undo" }); }}
        onRedo={() => { dispatch({ type: "redo" }); }}
      />
      <div className="flex min-h-0 flex-1 items-stretch">
        <Sidebar id="play-sidebar" side="left" open={leftOpen} label="Play tools">
          <PlaySidebar
            name={s.name}
            vis={s.vis}
            savedNames={[]}
            onName={(name) => { dispatch({ type: "setName", name }); }}
            onSave={() => undefined}
            onDuplicate={() => undefined}
            onExport={() => undefined}
            onLoad={() => undefined}
            onFlip={() => { dispatch({ type: "flip" }); }}
            onClear={(team) => { dispatch({ type: "clearRoutes", team }); }}
            onReset={(team) => { dispatch({ type: "resetFormation", team }); }}
            onVis={(vis) => { dispatch({ type: "setVis", vis }); }}
          />
        </Sidebar>
        <Field
          players={s.players}
          vis={s.vis}
          selectedId={s.selectedId}
          targeting={s.targeting}
          draft={s.draft}
          dispatch={dispatch}
          onSelect={onSelect}
          svgRef={svgRef}
        />
        <Sidebar id="route-sidebar" side="right" open={rightOpen} label="Route palette">
          <RouteSidebar
            selected={sel}
            hint={hint}
            onPick={(key) => { dispatch({ type: "pick", key }); }}
            onDone={() => { dispatch({ type: "select", id: null }); }}
            onPrimary={() => { dispatch({ type: "togglePrimary" }); }}
            onMirror={() => { dispatch({ type: "mirror" }); }}
            onRename={(id, label, commit) => { dispatch({ type: "rename", id, label, commit }); }}
          />
        </Sidebar>
      </div>
      <Hint text={hint} />
    </div>
  );
}

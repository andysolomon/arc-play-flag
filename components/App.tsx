"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { exportPng } from "@/lib/export";
import { initialState, reducer, selected } from "@/lib/play/reducer";
import { getNames, getServerNames, saveToLibrary, subscribe } from "@/lib/play/library";
import { decodeShare, encodeShare } from "@/lib/play/share";
import { readAll, readDraft, writeDraft } from "@/lib/play/storage";
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
  const savedNames = useSyncExternalStore(subscribe, getNames, getServerNames);
  const hydratedRef = useRef(false);
  const [toast, setToast] = useState<string | null>(null);
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

  // autosave on every commit — but not before the draft has been restored (the
  // restore effect below runs after this one on mount)
  useEffect(() => {
    if (hydratedRef.current) writeDraft({ name: s.name, players: [...s.players] });
  }, [s.name, s.players]);
  useEffect(() => {
    const d = readDraft();
    if (d) dispatch({ type: "hydrate", name: d.name, players: d.players });
    hydratedRef.current = true;
    // "Open in designer" from a share page: /?p=<id> loads the play (undoable) and cleans the URL
    const shared = new URLSearchParams(window.location.search).get("p");
    const rec = shared ? decodeShare(shared) : null;
    if (rec) {
      dispatch({ type: "load", name: rec.name, players: rec.players });
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const save = useCallback((name: string) => { saveToLibrary(name, s.players); }, [s.players]);
  const onSave = useCallback(() => { save(s.name || "Untitled play"); }, [save, s.name]);
  const onDuplicate = useCallback(() => {
    const n = (s.name || "Untitled play") + " copy";
    dispatch({ type: "setName", name: n });
    save(n);
  }, [save, s.name]);
  const onLoad = useCallback((name: string) => {
    const rec = readAll()[name];
    if (rec) dispatch({ type: "load", name, players: rec.players });
  }, []);
  const onShare = useCallback(() => {
    const url = `${window.location.origin}/p/${encodeShare({ name: s.name || "Untitled play", players: [...s.players] })}`;
    const done = () => {
      setToast("Link copied");
      window.setTimeout(() => { setToast(null); }, 1600);
    };
    navigator.clipboard.writeText(url).then(done, () => { window.prompt("Copy this link", url); });
  }, [s.name, s.players]);
  const onExport = useCallback(() => {
    dispatch({ type: "select", id: null });
    window.setTimeout(() => {
      const svg = svgRef.current;
      if (svg) void exportPng(svg, s.name || "play");
    }, 60);
  }, [s.name]);

  // offline on the sideline: a tiny service worker caches the shell and static assets
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);

  const sel = selected(s);
  const hint = s.targeting ? "Cover who? Tap a red player." : s.draft ? "Tap waypoints on the field · double-tap to finish" : null;

  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
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
        <Sidebar id="play-sidebar" side="left" open={leftOpen} isOpen={isOpen(leftOpen, "left")} label="Play tools">
          <PlaySidebar
            name={s.name}
            vis={s.vis}
            savedNames={savedNames}
            onName={(name) => { dispatch({ type: "setName", name }); }}
            onSave={onSave}
            onDuplicate={onDuplicate}
            onExport={onExport}
            onLoad={onLoad}
            onShare={onShare}
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
          title={s.name}
        />
        <Sidebar id="route-sidebar" side="right" open={rightOpen} isOpen={isOpen(rightOpen, "right")} label="Route palette">
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
      <Hint text={toast ?? hint} />
    </div>
  );
}

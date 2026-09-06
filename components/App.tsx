"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { initialState, reducer, selected } from "@/lib/play/reducer";
import { getPlays, getServerPlays, playById, savePlay, subscribe } from "@/lib/play/library";
import { decodeShare, encodeShare } from "@/lib/play/share";
import { readDraft, writeDraft } from "@/lib/play/storage";
import { Field } from "./Field";
import { Header } from "./Header";
import { Hint } from "./Hint";
import { PlayExport } from "./PlayExport";
import { PlaySidebar } from "./PlaySidebar";
import { RouteSidebar } from "./RouteSidebar";
import { Sidebar } from "./Sidebar";

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
  // both sidebars start closed: the app opens on a clear field
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const plays = useSyncExternalStore(subscribe, getPlays, getServerPlays);
  const hydratedRef = useRef(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const toastTimer = useRef(0);
  const say = useCallback((text: string, ms = 1600) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => { setToast(null); }, ms);
  }, []);
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
    if (hydratedRef.current) writeDraft({ id: s.id, name: s.name, notes: s.notes, players: [...s.players] });
  }, [s.id, s.name, s.notes, s.players]);
  useEffect(() => {
    const d = readDraft();
    if (d) dispatch({ type: "hydrate", id: d.id, name: d.name, notes: d.notes, players: d.players });
    hydratedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    // "Open in designer" from a share page: /?p=<id> loads the play (undoable) and cleans the URL
    const shared = params.get("p");
    const rec = shared ? decodeShare(shared) : null;
    if (rec) {
      dispatch({ type: "load", name: rec.name, players: rec.players });
      window.history.replaceState(null, "", "/");
    }
    // "Open" from the playbook gallery: /?open=<play id>
    const saved = playById(params.get("open"));
    if (saved) {
      dispatch({ type: "load", id: saved.id, name: saved.name, notes: saved.notes, players: saved.players });
      window.history.replaceState(null, "", "/");
    }
  }, []);

  const onSave = useCallback(() => {
    const rec = savePlay({ id: s.id, name: s.name || "Untitled play", notes: s.notes, players: [...s.players] });
    if (!s.id) dispatch({ type: "saved", id: rec.id });
    say("Saved");
  }, [say, s.id, s.name, s.notes, s.players]);
  const onDuplicate = useCallback(() => {
    const n = (s.name || "Untitled play") + " copy";
    const rec = savePlay({ id: null, name: n, notes: s.notes, players: [...s.players] });
    dispatch({ type: "setName", name: n });
    dispatch({ type: "saved", id: rec.id });
    say("Saved a copy");
  }, [say, s.name, s.notes, s.players]);
  const onLoad = useCallback((id: string) => {
    const rec = playById(id);
    if (rec) dispatch({ type: "load", id: rec.id, name: rec.name, notes: rec.notes, players: rec.players });
  }, []);
  const onShare = useCallback(() => {
    const url = `${window.location.origin}/p/${encodeShare({ name: s.name || "Untitled play", players: [...s.players] })}`;
    navigator.clipboard.writeText(url).then(() => { say("Link copied"); }, () => { window.prompt("Copy this link", url); });
  }, [say, s.name, s.players]);
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
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        canUndo={s.past.length > 0}
        canRedo={s.future.length > 0}
        onToggleLeft={() => { openLeft(!leftOpen); }}
        onToggleRight={() => { openRight(!rightOpen); }}
        onUndo={() => { dispatch({ type: "undo" }); }}
        onRedo={() => { dispatch({ type: "redo" }); }}
      />
      <div className="flex min-h-0 flex-1 items-stretch">
        <Sidebar id="play-sidebar" side="left" open={leftOpen} label="Play tools">
          <PlaySidebar
            name={s.name}
            notes={s.notes}
            notesOpen={notesOpen}
            vis={s.vis}
            plays={plays}
            onName={(name) => { dispatch({ type: "setName", name }); }}
            onNotes={(notes) => { dispatch({ type: "setNotes", notes }); }}
            onToggleNotes={() => { setNotesOpen((o) => !o); }}
            onSave={onSave}
            onDuplicate={onDuplicate}
            onExport={() => { setExportOpen((open) => !open); }}
            exportOpen={exportOpen}
            exportPanel={exportOpen ? <PlayExport id={s.id} name={s.name} players={s.players} /> : null}
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
      <Hint text={toast ?? hint} />
    </div>
  );
}

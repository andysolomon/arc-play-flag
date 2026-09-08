"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { initialState, reducer, selected, shown, unsaved } from "@/lib/play/reducer";
import type { RouteType } from "@/lib/play/types";
import { getPlays, getServerPlays, playById, savePlay, subscribe } from "@/lib/play/library";
import { decodeShare, encodeShare } from "@/lib/play/share";
import { mirrorRoute } from "@/lib/play/routes";
import { StorageError, failureMessage, kebab, newId, readDraft, writeDraft } from "@/lib/play/storage";
import { Field } from "./Field";
import { Header } from "./Header";
import { Hint } from "./Hint";
import { PlayExport } from "./PlayExport";
import { PlaySidebar } from "./PlaySidebar";
import { RouteSidebar } from "./RouteSidebar";
import { SaveFailure } from "./SaveFailure";
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
  // the last Save or Duplicate that didn't land; cleared by the next one that does
  const [saveFailure, setSaveFailure] = useState<StorageError | null>(null);
  const draftBroken = useRef(false);
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

  // a tap anywhere but a sidebar or the header folds both sidebars away
  useEffect(() => {
    if (!leftOpen && !rightOpen) return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("aside, header")) return;
      setLeftOpen(false);
      setRightOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => { document.removeEventListener("pointerdown", outside, true); };
  }, [leftOpen, rightOpen]);

  const onSelect = useCallback((id: string) => {
    dispatch({ type: "select", id });
    openRight(true);
  }, [openRight]);
  // on a phone the palette covers the field, so it folds away once a route is chosen
  const onPick = useCallback((key: RouteType) => {
    dispatch({ type: "pick", key });
    if (narrowRef.current) setRightOpen(false);
  }, []);
  const onPrimary = useCallback(() => {
    dispatch({ type: "togglePrimary" });
    if (narrowRef.current) setRightOpen(false);
  }, []);
  // a custom route mirrored off the field is pulled back to the edge: say so, since the shape changes
  const onMirror = useCallback(() => {
    const p = selected(s);
    dispatch({ type: "mirror" });
    if (p?.route && mirrorRoute(p.route, p.x).clamped) say("Mirrored · pulled back inside the field", 2200);
  }, [s, say]);
  const onClear = useCallback(() => {
    dispatch({ type: "clearRoutes", team: s.vis === "both" ? null : s.vis });
  }, [s.vis]);

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
  // restore effect below runs after this one on mount). A write that doesn't land is
  // said once, not on every keystroke, and again only after autosave has recovered.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      writeDraft({ id: s.id, name: s.name, notes: s.notes, players: [...s.players] });
      draftBroken.current = false;
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      if (!draftBroken.current) say(`Autosave is off · ${failureMessage(e)}`, 3200);
      draftBroken.current = true;
    }
  }, [say, s.id, s.name, s.notes, s.players]);
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
    const r = savePlay({ id: s.id, name: s.name || "Untitled play", notes: s.notes, players: [...s.players] });
    if (!r.ok) { setSaveFailure(r.error); say(failureMessage(r.error), 3200); return; }
    // only a write that landed gets to name this document
    if (!s.id) dispatch({ type: "saved", id: r.value.id });
    setSaveFailure(null);
    say("Saved");
  }, [say, s.id, s.name, s.notes, s.players]);
  const onDuplicate = useCallback(() => {
    const n = (s.name || "Untitled play") + " copy";
    const r = savePlay({ id: null, name: n, notes: s.notes, players: [...s.players] });
    if (!r.ok) { setSaveFailure(r.error); say(failureMessage(r.error), 3200); return; }
    dispatch({ type: "setName", name: n });
    dispatch({ type: "saved", id: r.value.id });
    setSaveFailure(null);
    say("Saved a copy");
  }, [say, s.name, s.notes, s.players]);
  // the way out when the device won't keep the play: a one-play playbook file that "Import a file…" takes back
  const onDownload = useCallback(() => {
    const name = s.name || "Untitled play";
    const play = { id: s.id ?? newId(), name, notes: s.notes, players: [...s.players] };
    void Promise.all([import("@/lib/export/playbook-file"), import("@/lib/export/raster")]).then(([{ encodePlaybookFile }, { download }]) => {
      const json = encodePlaybookFile({ id: newId(), name: `${name} (recovered)`, plays: [play.id] }, [play], null);
      download(new Blob([json], { type: "application/json" }), `${kebab(name)}.playbook.json`);
    });
  }, [s.id, s.name, s.notes, s.players]);
  // opening another play (or a fresh one) over unsaved work is undoable as a whole:
  // undo brings back the previous play's diagram, name, notes and identity together
  const dirty = unsaved(s, playById(s.id));
  const onNew = useCallback(() => {
    dispatch({ type: "newPlay" });
    say("New play · undo brings the last one back", 2400);
  }, [say]);
  const onLoad = useCallback((id: string) => {
    const rec = playById(id);
    if (!rec) return;
    const was = s.name || "Untitled play";
    dispatch({ type: "load", id: rec.id, name: rec.name, notes: rec.notes, players: rec.players });
    if (dirty) say(`Opened “${rec.name}” · undo brings “${was}” back`, 2800);
  }, [dirty, say, s.name]);
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
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        canUndo={s.past.length > 0}
        canRedo={s.future.length > 0}
        canClear={s.players.some((p) => p.route && shown(p, s.vis))}
        onClear={onClear}
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
            onNew={onNew}
            onSave={onSave}
            onDuplicate={onDuplicate}
            onExport={() => { setExportOpen((open) => !open); }}
            exportOpen={exportOpen}
            exportPanel={exportOpen ? <PlayExport id={s.id} name={s.name} players={s.players} /> : null}
            savePanel={saveFailure ? <SaveFailure message={failureMessage(saveFailure)} onRetry={onSave} onDownload={onDownload} /> : null}
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
            onPick={onPick}
            onDone={() => { dispatch({ type: "select", id: null }); }}
            onPrimary={onPrimary}
            onMirror={onMirror}
            onRename={(id, label, commit) => { dispatch({ type: "rename", id, label, commit }); }}
          />
        </Sidebar>
      </div>
      <Hint text={toast ?? hint} />
    </div>
  );
}

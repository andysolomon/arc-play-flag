"use client";

import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { install, record } from "@/lib/diagnostics";
import { initialState, reducer, selected, shown, unsaved } from "@/lib/play/reducer";
import { encodeRecoveryFile } from "@/lib/export/playbook-file";
import { download } from "@/lib/export/raster";
import type { RouteType, Vis } from "@/lib/play/types";
import { playSvg } from "@/lib/render/play-svg";
import { getPlays, getServerPlays, playById, savePlay, subscribe } from "@/lib/play/library";
import { decodeShare, encodeShare } from "@/lib/play/share";
import { mirrorRoute } from "@/lib/play/routes";
import { StorageError, failureMessage, newId, readDraft, writeDraft } from "@/lib/play/storage";
import { Field } from "./Field";
import { FIRST_USE_KEY, FirstUse } from "./FirstUse";
import { Header } from "./Header";
import { Hint } from "./Hint";
import { PlayExport } from "./PlayExport";
import { PlaySidebar } from "./PlaySidebar";
import { RouteSidebar } from "./RouteSidebar";
import { SaveFailure } from "./SaveFailure";
import { Sidebar } from "./Sidebar";
import { pillSm } from "./ui";

const examplePlayers = () => initialState().players.map((p) => {
  if (p.id === "o3") return { ...p, route: { type: "slant" as const, primary: true } };
  if (p.id === "o4") return { ...p, route: { type: "out" as const } };
  return p;
});

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable);

const visibilityChoices: readonly { value: Vis; label: string }[] = [
  { value: "offense", label: "Offense" },
  { value: "defense", label: "Defense" },
  { value: "both", label: "Both teams" },
];

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
  const [shareOpen, setShareOpen] = useState(false);
  const [shareVis, setShareVis] = useState<Vis>("both");
  const [notesOpen, setNotesOpen] = useState(false);
  const [firstUse, setFirstUse] = useState(false);
  // the last Save or Duplicate that didn't land; cleared by the next one that does
  const [saveFailure, setSaveFailure] = useState<StorageError | null>(null);
  const draftBroken = useRef(false);
  const [draftWrite, setDraftWrite] = useState<{ fingerprint: string; ok: boolean } | null>(null);
  const draftFingerprint = JSON.stringify([s.id, s.name, s.notes, s.players]);
  const restoredDraft = useRef(false);
  const toastTimer = useRef(0);
  const say = useCallback((text: string, ms = 1600) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => { setToast(null); }, ms);
  }, []);
  // phones + iPads: drawers overlay the field; only one open at a time
  const compact = useMedia("(max-width: 1023px)");
  const compactRef = useRef(compact);
  useEffect(() => { compactRef.current = compact; }, [compact]);

  const closePanels = useCallback(() => {
    setLeftOpen(false);
    setRightOpen(false);
  }, []);
  const openLeft = useCallback((open: boolean) => {
    setLeftOpen(open);
    if (open && compactRef.current) setRightOpen(false);
  }, []);
  const openRight = useCallback((open: boolean) => {
    setRightOpen(open);
    if (open && compactRef.current) setLeftOpen(false);
  }, []);

  // a tap on the field (not a control, sidebar, or header) folds both panels away.
  // overlay drawers sit above the field, so their own taps hit the aside and stay open.
  useEffect(() => {
    if (!leftOpen && !rightOpen) return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest("aside, header, button, [role='button']")) return;
      closePanels();
    };
    document.addEventListener("pointerdown", outside, true);
    return () => { document.removeEventListener("pointerdown", outside, true); };
  }, [closePanels, leftOpen, rightOpen]);

  const onSelect = useCallback((id: string) => {
    dispatch({ type: "select", id });
    openRight(true);
  }, [openRight]);
  // on a phone/tablet the palette covers the field, so it folds away once a route is chosen
  const onPick = useCallback((key: RouteType) => {
    dispatch({ type: "pick", key });
    if (compactRef.current) setRightOpen(false);
  }, []);
  const onPrimary = useCallback(() => {
    dispatch({ type: "togglePrimary" });
    if (compactRef.current) setRightOpen(false);
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
    let writeOk = true;
    try {
      writeDraft({ id: s.id, name: s.name, notes: s.notes, players: [...s.players] });
      draftBroken.current = false;
    } catch (e) {
      if (!(e instanceof StorageError)) throw e;
      if (!draftBroken.current) { say(`Autosave is off · ${failureMessage(e)}`, 3200); record("storage", e); }
      draftBroken.current = true;
      writeOk = false;
    }
    let active = true;
    queueMicrotask(() => { if (active) setDraftWrite({ fingerprint: draftFingerprint, ok: writeOk }); });
    return () => { active = false; };
  }, [draftFingerprint, say, s.id, s.name, s.notes, s.players]);
  useEffect(() => {
    const d = readDraft();
    let firstUseTimer = 0;
    let openToolsTimer = 0;
    restoredDraft.current = d !== null;
    if (d) dispatch({ type: "hydrate", id: d.id, name: d.name, notes: d.notes, players: d.players });
    hydratedRef.current = true;
    try {
      if (!d && getPlays().length === 0 && window.localStorage.getItem(FIRST_USE_KEY) !== "done") {
        firstUseTimer = window.setTimeout(() => { setFirstUse(true); }, 0);
      }
    } catch {
      // Storage may be unavailable in a private window; the guide still works for this visit.
      if (!d && getPlays().length === 0) firstUseTimer = window.setTimeout(() => { setFirstUse(true); }, 0);
    }
    const params = new URLSearchParams(window.location.search);
    // "Open in designer" from a share page: /?p=<id> loads the play (undoable) and cleans the URL
    const shared = params.get("p");
    const rec = shared ? decodeShare(shared) : null;
    if (rec) {
      dispatch({ type: "load", name: rec.name, players: rec.players });
      // A formation/share payload is an intentional handoff into the designer;
      // keep the tools visible so the coach can immediately inspect or name it.
      openToolsTimer = window.setTimeout(() => { setLeftOpen(true); }, 0);
      window.history.replaceState(null, "", "/");
    }
    // "Open" from the playbook gallery: /?open=<play id>
    const saved = playById(params.get("open"));
    if (saved) {
      dispatch({ type: "load", id: saved.id, name: saved.name, notes: saved.notes, players: saved.players });
      window.history.replaceState(null, "", "/");
    }
    return () => {
      window.clearTimeout(firstUseTimer);
      window.clearTimeout(openToolsTimer);
    };
  }, []);

  const onSave = useCallback(() => {
    const r = savePlay({ id: s.id, name: s.name || "Untitled play", notes: s.notes, players: [...s.players] });
    if (!r.ok) { setSaveFailure(r.error); say(failureMessage(r.error), 3200); record("storage", r.error); return; }
    // only a write that landed gets to name this document
    if (!s.id) dispatch({ type: "saved", id: r.value.id });
    setSaveFailure(null);
    say("Saved");
  }, [say, s.id, s.name, s.notes, s.players]);
  const onDuplicate = useCallback(() => {
    const n = (s.name || "Untitled play") + " copy";
    const r = savePlay({ id: null, name: n, notes: s.notes, players: [...s.players] });
    if (!r.ok) { setSaveFailure(r.error); say(failureMessage(r.error), 3200); record("storage", r.error); return; }
    dispatch({ type: "setName", name: n });
    dispatch({ type: "saved", id: r.value.id });
    setSaveFailure(null);
    say("Saved a copy");
  }, [say, s.name, s.notes, s.players]);
  // the way out when the device won't keep the play: a one-play playbook file that "Import a file…" takes back
  const onDownload = useCallback(() => {
    const play = { id: s.id ?? newId(), name: s.name, notes: s.notes, players: [...s.players] };
    const file = encodeRecoveryFile(play);
    download(new Blob([file.json], { type: "application/json" }), file.filename);
  }, [s.id, s.name, s.notes, s.players]);
  // opening another play (or a fresh one) over unsaved work is undoable as a whole:
  // undo brings back the previous play's diagram, name, notes and identity together
  const dirty = unsaved(s, playById(s.id));
  const persistence = saveFailure
    ? "failed"
    : !dirty && s.id
      ? "saved"
      : draftWrite?.fingerprint === draftFingerprint && !draftWrite.ok
        ? "failed"
      : draftWrite?.fingerprint === draftFingerprint
        ? "autosaved"
        : "unsaved";
  const dismissFirstUse = useCallback(() => {
    setFirstUse(false);
    try { window.localStorage.setItem(FIRST_USE_KEY, "done"); } catch { /* dismiss for this visit */ }
  }, []);
  const onExample = useCallback(() => {
    if (restoredDraft.current || dirty) {
      dismissFirstUse();
      say("Example skipped · your draft is untouched", 2600);
      return;
    }
    dispatch({ type: "load", name: "Riverside Otters Quick Slant", notes: "Fictional example — change any route.", players: examplePlayers() });
    dispatch({ type: "select", id: "o3" });
    openRight(true);
    dismissFirstUse();
  }, [dirty, dismissFirstUse, openRight, say]);
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
  const shareUrl = useCallback((vis: Vis) =>
    `${window.location.origin}/p/${encodeShare({ name: s.name || "Untitled play", players: [...s.players] }, vis)}`,
  [s.name, s.players]);
  const copyShare = useCallback(() => {
    const url = shareUrl(shareVis);
    setShareOpen(false);
    navigator.clipboard.writeText(url).then(() => { say("Link copied"); }, () => { window.prompt("Copy this link", url); });
  }, [say, shareUrl, shareVis]);
  const openShare = useCallback(() => {
    setShareVis("both");
    setShareOpen(true);
  }, []);
  // errors nobody caught are remembered (scrubbed, on this device only) for "Report a problem"
  useEffect(() => install(), []);
  const sel = selected(s);
  const hint = s.targeting ? "Cover who? Tap a red player." : s.draft ? "Tap waypoints on the field · double-tap to finish" : null;

  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <Header
        name={s.name || "Untitled play"}
        persistence={persistence}
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
      <div className="relative flex min-h-0 flex-1 items-stretch">
        {firstUse && !leftOpen && !rightOpen && <FirstUse onDismiss={dismissFirstUse} onExample={onExample} />}
        <Sidebar id="play-sidebar" side="left" open={leftOpen} label="Play tools" overlay={compact}>
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
            onShare={openShare}
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
        <Sidebar id="route-sidebar" side="right" open={rightOpen} label="Route palette" overlay={compact}>
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
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-3" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            className="flex max-h-full w-full max-w-[440px] flex-col gap-3 overflow-y-auto rounded-tile border-2 border-ink bg-cream p-4 shadow-tile"
          >
            <div className="flex items-center gap-2">
              <h2 id="share-title" className="text-header font-normal">Share snapshot</h2>
              <span className="flex-1" />
              <button type="button" className={`${pillSm} !text-ink`} onClick={() => { setShareOpen(false); }} aria-label="Close share dialog">✕</button>
            </div>
            <p className="text-small leading-note text-ink-muted">
              Choose exactly what the link shows. It is a snapshot of this play now, not a live view; later edits are not added to it.
            </p>
            <fieldset className="flex flex-wrap gap-2" aria-label="Teams visible in shared snapshot">
              <legend className="mb-1 w-full text-small">Visible teams</legend>
              {visibilityChoices.map((choice) => (
                <label key={choice.value} className={`${pillSm} flex cursor-pointer items-center gap-1.5 has-[:checked]:bg-yellow`}>
                  <input
                    type="radio"
                    name="share-visibility"
                    value={choice.value}
                    checked={shareVis === choice.value}
                    onChange={() => { setShareVis(choice.value); }}
                  />
                  {choice.label}
                </label>
              ))}
            </fieldset>
            <div
              role="img"
              aria-label={`${visibilityChoices.find((choice) => choice.value === shareVis)?.label ?? "Both teams"} snapshot preview`}
              className="mx-auto w-full max-w-[360px] overflow-hidden rounded-field border-2 border-ink bg-turf [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: playSvg(s.players, { show: shareVis, box: { pw: 660, ph: 360 } }) }}
            />
            <button type="button" className={`${pillSm} self-start px-4 py-1`} onClick={copyShare}>Copy snapshot link</button>
          </section>
        </div>
      )}
    </div>
  );
}

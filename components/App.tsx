"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { install, record } from "@/lib/diagnostics";
import { editedVisit, initialState, reducer, selected, unsaved, type Action } from "@/lib/play/reducer";
import { encodeRecoveryFile } from "@/lib/export/playbook-file";
import { download } from "@/lib/export/raster";
import { names } from "@/lib/play/assignments";
import { blitzAim, blitzTarget, nearestBack } from "@/lib/play/blitz";
import { NO_RUN_FLAG, runInNoRunZone } from "@/lib/play/call";
import { inNoRunZone, withLos } from "@/lib/play/field";
import { sidelineCut } from "@/lib/play/geometry";
import { canJet, chainLinks, chainOf, runsBefore } from "@/lib/play/lateral";
import type { Player, RouteType, Team, TeamSettings } from "@/lib/play/types";
import { playSvg } from "@/lib/render/play-svg";
import {
  addPlayToPlaybook, currentBook, getCurrentBookId, getPlays, getServerTeam, getTeam, playById, playbookById, primaryPlay, savePlay,
  setCurrentBook, setTeam, subscribe,
} from "@/lib/play/library";
import type { SavedPlay } from "@/lib/play/types";
import { decodeShare, encodeShare } from "@/lib/play/share";
import { mirrorRoute, routeDef } from "@/lib/play/routes";
import { atSnap } from "@/lib/play/pre-snap";
import { StorageError, artShadow, failureMessage, hasNoRunZones, newId, readDraft, writeDraft } from "@/lib/play/storage";
import { FIELD_TITLE_ID, Field } from "./Field";
import { FIRST_USE_KEY, FirstUse } from "./FirstUse";
import { Header } from "./Header";
import { Hint } from "./Hint";
import { PlaySidebar } from "./PlaySidebar";
import { RouteSidebar } from "./RouteSidebar";
import { SaveFailure } from "./SaveFailure";
import { Sidebar } from "./Sidebar";
import { pillSm } from "./ui";

const persistenceLabel: Record<"saved" | "unsaved" | "autosaved" | "failed", string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  autosaved: "Draft autosaved",
  failed: "Saving failed",
};

const examplePlayers = () => initialState().players.map((p) => {
  if (p.id === "o3") return { ...p, route: { type: "slant" as const, primary: true } };
  if (p.id === "o4") return { ...p, route: { type: "out" as const } };
  return p;
});

/**
 * The route an edit leaves cut short at the sideline, by name, or null: a route newly cut, another
 * route, or the same one cut further. One the edit cuts no further than before goes unsaid.
 */
function cutNews(was: Player | undefined, now: Player | undefined): string | null {
  const cut = now ? sidelineCut(now) : null;
  if (!now?.route || !cut) return null;
  const before = was ? sidelineCut(was) : null;
  const same = before && was?.route?.type === now.route.type && !!was.route.mirror === !!now.route.mirror;
  if (same && cut.room >= before.room - 0.01) return null;
  return routeDef(now.team, now.route.type)?.label ?? null;
}

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
  // a league rule, so it is the team's: the same field for every play, on screen and on paper
  const team = useSyncExternalStore(subscribe, getTeam, getServerTeam);
  const noRunZones = hasNoRunZones(team);
  // both sidebars start closed: the app opens on a clear field
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const hydratedRef = useRef(false);
  const [toast, setToast] = useState<{ text: string; flag: boolean } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [firstUse, setFirstUse] = useState(false);
  // the last Save or Duplicate that didn't land; cleared by the next one that does
  const [saveFailure, setSaveFailure] = useState<StorageError | null>(null);
  const draftBroken = useRef(false);
  const [draftWrite, setDraftWrite] = useState<{ fingerprint: string; ok: boolean } | null>(null);
  const draftFingerprint = JSON.stringify([s.id, s.name, s.notes, s.side, s.artShadow, s.los, s.players]);
  const restoredDraft = useRef(false);
  const toastTimer = useRef(0);
  const say = useCallback((text: string, ms = 1600, flag = false) => {
    setToast({ text, flag });
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
  // a preset route keeps its depth and stops at the sideline; when a pick, a mirror or a move cuts it
  // short there, the toast says so once it is drawn, and the palette says by how much
  const playersRef = useRef(s.players);
  const cutWatch = useRef<{ id: string; was: Player | undefined; what?: string } | null>(null);
  const watchCut = useCallback((id: string, what?: string) => {
    cutWatch.current = { id, was: playersRef.current.find((p) => p.id === id), what };
  }, []);
  useEffect(() => {
    playersRef.current = s.players;
    const w = cutWatch.current;
    if (!w) return;
    cutWatch.current = null;
    const news = cutNews(w.was, s.players.find((p) => p.id === w.id));
    if (news) say(`${w.what ?? news} · cut short at the sideline`, 2200);
  }, [s.players, say]);
  // a player dragged or stepped with the arrow keys can take their route to the sideline
  const fieldDispatch = useCallback((a: Action) => {
    if (a.type === "move" && a.commit) watchCut(a.id);
    dispatch(a);
  }, [watchCut]);
  // on a phone/tablet the palette covers the field, so it folds away once a route is chosen
  const onPick = useCallback((key: RouteType) => {
    if (s.selectedId && key !== "man" && key !== "custom") watchCut(s.selectedId);
    dispatch({ type: "pick", key });
    if (compactRef.current) setRightOpen(false);
  }, [s.selectedId, watchCut]);
  // like Man, Lateral asks for a red player on the field, so on a phone the palette folds away for it
  const onLateral = useCallback(() => {
    dispatch({ type: "lateral" });
    if (compactRef.current) setRightOpen(false);
  }, []);
  const onVisit = useCallback((index: number) => { dispatch({ type: "selectVisit", index }); }, []);
  // a pitch on the run puts a handle on the field to drag, so on a phone the palette folds away for it
  const onRunBefore = useCallback(() => {
    dispatch({ type: "runBefore" });
    if (compactRef.current) setRightOpen(false);
  }, []);
  // the BLITZ pills: QB and Backfield aim it; Pick a player asks for a red player on the field, like Man
  const onBlitzAim = useCallback((aim: "qb" | "backfield") => { dispatch({ type: "blitzAim", aim }); }, []);
  const onBlitzTarget = useCallback(() => {
    dispatch({ type: "blitzTarget" });
    if (compactRef.current) setRightOpen(false);
  }, []);
  const onPrimary = useCallback(() => {
    dispatch({ type: "togglePrimary" });
    if (compactRef.current) setRightOpen(false);
  }, []);
  // a custom route mirrored off the field is pulled back to the edge, and a preset one mirrored toward
  // the sideline is cut short there: say so, since the shape changes
  const onMirror = useCallback(() => {
    const p = selected(s);
    if (p?.route && p.route.type !== "custom") watchCut(p.id, "Mirrored");
    dispatch({ type: "mirror" });
    if (p?.route && mirrorRoute(p.route, atSnap(p).x).clamped) say("Mirrored · pulled back inside the field", 2200);
  }, [s, say, watchCut]);
  const onClear = useCallback(() => {
    dispatch({ type: "clearRoutes", team: s.side });
  }, [s.side]);

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
      writeDraft(withLos({ id: s.id, name: s.name, notes: s.notes, side: s.side, ...artShadow(s.artShadow), players: [...s.players] }, s.los));
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
  }, [draftFingerprint, say, s.id, s.name, s.notes, s.side, s.artShadow, s.los, s.players]);
  useEffect(() => {
    const d = readDraft();
    let firstUseTimer = 0;
    let openToolsTimer = 0;
    restoredDraft.current = d !== null;
    if (d) dispatch({ type: "hydrate", id: d.id, name: d.name, notes: d.notes, side: d.side, artShadow: d.artShadow, los: d.los, players: d.players });
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
    // "Open in designer" from a share page: /?p=<id> loads the play and cleans the URL
    const shared = params.get("p");
    const rec = shared ? decodeShare(shared) : null;
    if (rec) {
      dispatch({ type: "load", name: rec.name, notes: rec.notes, side: rec.side, artShadow: rec.artShadow, los: rec.los, players: rec.players, shadow: true });
      // A formation/share payload is an intentional handoff into the designer;
      // keep the tools visible so the coach can immediately inspect or name it.
      openToolsTimer = window.setTimeout(() => { setLeftOpen(true); }, 0);
      window.history.replaceState(null, "", "/");
    }
    // "Open in designer" from inside a book: /?open=<play id>&book=<book id> makes that book the current one
    const book = params.get("book");
    if (book && setCurrentBook(book)) window.history.replaceState(null, "", "/");
    // "Open" from the playbook gallery: /?open=<play id>
    const saved = playById(params.get("open"));
    if (saved) {
      dispatch({
        type: "load", id: saved.id, name: saved.name, notes: saved.notes, side: saved.side, artShadow: saved.artShadow, los: saved.los, players: saved.players,
      });
      window.history.replaceState(null, "", "/");
    }
    return () => {
      window.clearTimeout(firstUseTimer);
      window.clearTimeout(openToolsTimer);
    };
  }, []);

  const onSave = useCallback(() => {
    const r = savePlay({
      id: s.id, name: s.name || "Untitled play", notes: s.notes, side: s.side, ...artShadow(s.artShadow), los: s.los, players: [...s.players],
    });
    if (!r.ok) { setSaveFailure(r.error); say(failureMessage(r.error), 3200); record("storage", r.error); return; }
    // only a write that landed gets to name this document
    if (!s.id) dispatch({ type: "saved", id: r.value.id });
    setSaveFailure(null);
    say("Saved");
  }, [say, s.id, s.name, s.notes, s.side, s.artShadow, s.los, s.players]);
  const onDuplicate = useCallback(() => {
    const n = (s.name || "Untitled play") + " copy";
    const r = savePlay({ id: null, name: n, notes: s.notes, side: s.side, ...artShadow(s.artShadow), los: s.los, players: [...s.players] });
    if (!r.ok) { setSaveFailure(r.error); say(failureMessage(r.error), 3200); record("storage", r.error); return; }
    dispatch({ type: "setName", name: n });
    dispatch({ type: "saved", id: r.value.id });
    setSaveFailure(null);
    say("Saved a copy");
  }, [say, s.name, s.notes, s.side, s.artShadow, s.los, s.players]);
  // the way out when the device won't keep the play: a one-play playbook file that "Import a file…" takes back
  const onDownload = useCallback(() => {
    const play = withLos({ id: s.id ?? newId(), name: s.name, notes: s.notes, side: s.side, ...artShadow(s.artShadow), players: [...s.players] }, s.los);
    const file = encodeRecoveryFile(play);
    download(new Blob([file.json], { type: "application/json" }), file.filename);
  }, [s.id, s.name, s.notes, s.side, s.artShadow, s.los, s.players]);
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
  const onNew = useCallback((side: Team) => {
    dispatch({ type: "newPlay", side });
    say("New play");
  }, [say]);
  // a saved play put on the board whole, as "Open" from the gallery does; the one already there is left alone
  const openPlay = useCallback((play: SavedPlay) => {
    if (play.id === s.id) return;
    dispatch({ type: "load", id: play.id, name: play.name, notes: play.notes, side: play.side, artShadow: play.artShadow, los: play.los, players: play.players });
  }, [s.id]);
  // the play name's list: a play of the current playbook picked
  const onOpenPlay = useCallback((id: string) => {
    const play = playById(id);
    if (!play) { say("That play isn't on this device any more", 2600); return; }
    openPlay(play);
    say(`Opened “${play.name}”`);
  }, [openPlay, say]);
  const onAddToBook = useCallback(() => {
    const book = currentBook();
    if (!book || !s.id) return;
    const r = addPlayToPlaybook(book.id, s.id);
    if (!r.ok) { say(failureMessage(r.error), 3200); record("storage", r.error); return; }
    say(`Added to “${book.name}”`);
  }, [s.id, say]);
  // the Playbooks tile's menu: switching books opens the new book's primary play, or clears the board
  // when it has none (docs/adr/008-playbook-switcher.md); the book already current is left as it is
  const onSwitchBook = useCallback((id: string) => {
    const book = playbookById(id);
    if (!book) return;
    if (id === getCurrentBookId()) { say(`Already in “${book.name}”`); return; }
    setCurrentBook(id);
    const primary = primaryPlay(book);
    if (!primary) {
      dispatch({ type: "newPlay", side: s.side });
      say(`Switched to “${book.name}” · board cleared`, 2600);
    } else if (primary.id === s.id) {
      say(`Switched to “${book.name}”`);
    } else {
      openPlay(primary);
      say(`Switched to “${book.name}” · opened “${primary.name}”`, 2600);
    }
  }, [openPlay, s.id, s.side, say]);
  const shareUrl = useCallback(() =>
    `${window.location.origin}/p/${encodeShare({ name: s.name || "Untitled play", notes: s.notes, side: s.side, ...artShadow(s.artShadow), los: s.los, players: [...s.players] }, noRunZones)}`,
  [s.name, s.notes, s.side, s.artShadow, s.los, s.players, noRunZones]);
  // where this play's ball is spotted: saved with the play, never undone (like its name)
  const onLos = useCallback((los: number) => { dispatch({ type: "setLos", los }); }, []);
  // the team's settings: its name and colour, and the field's no-run zones
  const onTeam = useCallback((next: TeamSettings) => {
    const r = setTeam(next);
    if (!r.ok) { say(failureMessage(r.error), 3200); record("storage", r.error); }
  }, [say]);
  const onNoRunZones = useCallback((on: boolean) => { onTeam({ ...getTeam(), noRunZones: on }); }, [onTeam]);
  const copyShare = useCallback(() => {
    const url = shareUrl();
    setShareOpen(false);
    navigator.clipboard.writeText(url).then(() => { say("Link copied"); }, () => { window.prompt("Copy this link", url); });
  }, [say, shareUrl]);
  const openShare = useCallback(() => { setShareOpen(true); }, []);
  const onArtShadow = useCallback((on: boolean) => { dispatch({ type: "setArtShadow", on }); }, []);
  const other = s.side === "defense" ? "offense" : "defense";
  // a run called where the league allows none: flagged on the field, in Play tools and on every picture.
  // It is said once as it happens, however it happens: a run picked, the ball moved onto the 5, the read
  // moved onto the runner, the receivers cleared, the zones turned back on, or a flagged play opened.
  const flagged = runInNoRunZone(s, noRunZones);
  const wasFlagged = useRef(false);
  useEffect(() => {
    if (flagged && !wasFlagged.current) say(`Flagged · ${NO_RUN_FLAG.toLowerCase()}`, 3200);
    wasFlagged.current = flagged;
  }, [flagged, say]);
  // errors nobody caught are remembered (scrubbed, on this device only) for "Report a problem"
  useEffect(() => install(), []);
  const sel = selected(s);
  const selCut = useMemo(() => (sel ? sidelineCut(sel) : null), [sel]);
  // who holds the ball, in order: the palette shows a carrier their jobs with it and the path it takes
  const chain = useMemo(() => chainOf(s.players), [s.players]);
  const visit = editedVisit(s, chain);
  // whether the toss that leaves the edited time with the ball is a pitch on the run (ADR 007)
  const onTheRun = useMemo(() => {
    const link = visit === null ? undefined : chainLinks(s.players)[visit];
    return link ? runsBefore(link) : false;
  }, [s.players, visit]);
  // who can take a jet sweep: not the quarterback, the centre or a carrier (docs/adr/006-jet-sweep.md)
  const jetAble = useMemo(() => (sel ? canJet(sel, s.players) : false), [sel, s.players]);
  // a lateral's catch dragged somewhere illegal is snapped back, and the coach is told why, on a flag's yellow
  const onCatchNote = useCallback((text: string) => { say(text, 2600, true); }, [say]);
  // who the selected blitzer comes for, for the palette's BLITZ pills (lib/play/blitz.ts)
  const blitz = useMemo(() => {
    if (sel?.team !== "defense" || sel.route?.type !== "blitz") return null;
    const who = names({ players: s.players });
    const t = blitzTarget(sel.route, s.players);
    const back = nearestBack(s.players);
    return { aim: blitzAim(sel.route), who: t ? who.get(t.id) ?? null : null, back: back ? who.get(back.id) ?? null : null };
  }, [sel, s.players]);
  const hint = s.targeting === "lateral" ? "Lateral to who? Tap a red player." : s.targeting === "blitz" ? "Blitz who? Tap a red player."
    : s.targeting ? "Cover who? Tap a red player." : s.draft ? s.draft.kind === "motion"
    ? "Pre-snap motion · tap waypoints behind the line · Finish when done"
    : "Tap waypoints on the field · double-tap to finish" : null;

  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <Header
        side={s.side}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        canUndo={s.past.length > 0}
        canRedo={s.future.length > 0}
        canClear={s.players.some((p) => (p.route || p.preSnap) && p.team === s.side)}
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
            playId={s.id}
            notes={s.notes}
            notesOpen={notesOpen}
            side={s.side}
            vis={s.vis}
            onName={(name) => { dispatch({ type: "setName", name }); }}
            onOpenPlay={onOpenPlay}
            onAddToBook={onAddToBook}
            onSwitchBook={onSwitchBook}
            onNotes={(notes) => { dispatch({ type: "setNotes", notes }); }}
            onToggleNotes={() => { setNotesOpen((o) => !o); }}
            onNew={onNew}
            onSave={onSave}
            onDuplicate={onDuplicate}
            unsaved={dirty}
            saved={!dirty && s.id !== null}
            savePanel={saveFailure ? <SaveFailure message={failureMessage(saveFailure)} onRetry={onSave} onDownload={onDownload} /> : null}
            onShare={openShare}
            onFlip={() => { dispatch({ type: "flip" }); }}
            onClear={(team) => { dispatch({ type: "clearRoutes", team }); }}
            onReset={(team) => { dispatch({ type: "resetFormation", team }); }}
            onShadow={(on) => { dispatch({ type: "setShadow", on }); }}
            artShadow={s.artShadow}
            onArtShadow={onArtShadow}
            noRunZones={noRunZones}
            onNoRunZones={onNoRunZones}
            team={team}
            onTeam={onTeam}
            los={s.los}
            onLos={onLos}
            flagged={flagged}
          />
        </Sidebar>
        <Field
          players={s.players}
          vis={s.vis}
          side={s.side}
          selectedId={s.selectedId}
          targeting={s.targeting}
          draft={s.draft}
          dispatch={fieldDispatch}
          onSelect={onSelect}
          onCatchNote={onCatchNote}
          lateralFrom={s.targeting === "lateral" && visit !== null ? chain[visit]?.id ?? null : null}
          svgRef={svgRef}
          title={s.name || "Untitled play"}
          showTitle
          status={persistenceLabel[persistence]}
          noRunZones={noRunZones}
          los={s.los}
        />
        <Sidebar id="route-sidebar" side="right" open={rightOpen} label="Route palette" overlay={compact}>
          <RouteSidebar
            selected={sel}
            chain={chain}
            visit={visit}
            onLateral={onLateral}
            onVisit={onVisit}
            onTheRun={onTheRun}
            onRunBefore={onRunBefore}
            blitz={blitz}
            onBlitzAim={onBlitzAim}
            onBlitzTarget={onBlitzTarget}
            cut={selCut}
            jet={jetAble}
            hint={hint}
            onPick={onPick}
            onMotion={() => { dispatch({ type: "drawMotion" }); if (compactRef.current) setRightOpen(false); }}
            onRemoveMotion={() => { dispatch({ type: "removeMotion" }); }}
            onDone={() => { dispatch({ type: "select", id: null }); }}
            onPrimary={onPrimary}
            onMirror={onMirror}
            onRename={(id, label, commit) => { dispatch({ type: "rename", id, label, commit }); }}
            noRunZone={s.side === "offense" && noRunZones && inNoRunZone(s.los)}
          />
        </Sidebar>
      </div>
      <Hint text={toast?.text ?? hint} flag={toast?.flag} below={FIELD_TITLE_ID} />
      {shareOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-3" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-title"
            className="flex max-h-full w-full max-w-[440px] flex-col gap-3 overflow-y-auto rounded-tile border-2 border-ink bg-cream p-4 shadow-tile"
          >
            <div className="flex flex-none items-center gap-2">
              <h2 id="share-title" className="text-header font-normal">Share snapshot</h2>
              <span className="flex-1" />
              <button type="button" className={`${pillSm} !text-ink`} onClick={() => { setShareOpen(false); }} aria-label="Close share dialog">✕</button>
            </div>
            <p className="flex-none text-small leading-note text-ink-muted">
              It is a snapshot of this play now, not a live view; later edits are not added to it. The other team is always saved with the link and appears, faded, when the play is opened in the designer.
            </p>
            <p className="flex-none text-small leading-note text-ink-muted">
              {s.notes.trim() ? "Your coaching notes go with it, under the play." : "This play has no coaching notes yet; any you add in Play tools go with the link."}
            </p>
            <div
              role="img"
              aria-label={`${s.side === "defense" ? "Defense" : "Offense"} snapshot preview${s.artShadow ? `, the ${other} faded` : ""}`}
              className="mx-auto w-full max-w-[360px] flex-none overflow-hidden rounded-field border-2 border-ink bg-turf [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
              dangerouslySetInnerHTML={{ __html: playSvg(s.players, { show: s.artShadow ? "both" : s.side, side: s.side, noRunZones, los: s.los, box: { pw: 660, ph: 360 } }) }}
            />
            <label className="flex min-h-11 flex-none cursor-pointer items-center gap-2 text-small">
              <input
                type="checkbox"
                checked={s.artShadow}
                onChange={(e) => { onArtShadow(e.target.checked); }}
                className="h-5 w-5 flex-none cursor-pointer accent-ink"
              />
              {other === "offense" ? "Offense" : "Defense"} in play art
            </label>
            <span className="-mt-2 flex-none text-caption leading-note text-ink-muted">
              Draws the {other} faded in the snapshot, and on this play&apos;s thumbnail and printouts once it is saved.
            </span>
            <button type="button" className={`${pillSm} flex-none self-start px-4 py-1`} onClick={copyShare}>Copy snapshot link</button>
          </section>
        </div>
      )}
    </div>
  );
}

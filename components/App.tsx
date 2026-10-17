"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { firstUseDone, setFirstUseDone } from "@/lib/account/prefs";
import { subscribePulls } from "@/lib/account/sync";
import { deviceWritten } from "@/lib/device-writes";
import { install, record } from "@/lib/diagnostics";
import { getLosChoice, serverLosChoice, setLosChoice, subscribeLosChoice } from "@/lib/los";
import { editedVisit, flipped, initialState, reducer, selected, unsaved, type Action } from "@/lib/play/reducer";
import { encodeRecoveryFile } from "@/lib/export/playbook-file";
import { download } from "@/lib/export/raster";
import { names } from "@/lib/play/assignments";
import { blitzAim, blitzTarget, containEdge, edgePath, nearestBack } from "@/lib/play/blitz";
import { deepSplit, type DeepSplit } from "@/lib/play/deep";
import { NO_RUN_FLAG, runInNoRunZone } from "@/lib/play/call";
import { ROSTER_LOS, inNoRunZone, withLos } from "@/lib/play/field";
import { qbAction, quarterback, sidelineCut } from "@/lib/play/geometry";
import { canJet, chainLinks, chainOf, runsBefore } from "@/lib/play/lateral";
import { activeLineup, formationOf, rosterPositions, showsNames, withSlots, withSpot } from "@/lib/play/lineup";
import { offFieldId, starters } from "@/lib/play/roster";
import type { Lineups, Player, Roster, RouteType, Team, TeamSettings, Vis } from "@/lib/play/types";
import { playSvg } from "@/lib/render/play-svg";
import {
  addPlayToPlaybook, currentBook, getCurrentBookId, getLineups, getPlays, getServerLineups, getServerTeam, getTeam, playById, playbookById,
  primaryPlay, savePlay, setCurrentBook, setLineups, setTeam, subscribe,
} from "@/lib/play/library";
import { getAccountState, subscribeAccount } from "@/lib/account/sync";
import { clearNotice, setPresencePlay } from "@/lib/org/sync";
import type { SavedPlay } from "@/lib/play/types";
import { decodeShare, encodeShare } from "@/lib/play/share";
import { isBallJob, isRun, mirrorRoute, mirrorable, routeDef } from "@/lib/play/routes";
import { atSnap } from "@/lib/play/pre-snap";
import { StorageError, artShadow, failureMessage, hasNoRunZones, newId, readDraft, writeDraft } from "@/lib/play/storage";
import { FIELD_TITLE_ID, Field } from "./Field";
import { EditablePlayTitle } from "./EditablePlayTitle";
import { PlaySwitcher } from "./PlaySwitcher";
import { FirstUse } from "./FirstUse";
import { Header, VIEW, type Mode } from "./Header";
import { Hint } from "./Hint";
import { PlaySidebar } from "./PlaySidebar";
import { RosterSidebar } from "./RosterSidebar";
import { RouteSidebar, type BlitzInfo, type QbInfo } from "./RouteSidebar";
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
  // who plays each position, in lineups (docs/adr/008-roster-depth-chart.md); the field shows the active one
  const lineups = useSyncExternalStore(subscribe, getLineups, getServerLineups);
  const lineup = useMemo(() => activeLineup(lineups), [lineups]);
  // the organization's other coaches see which play is on this board, and this coach hears what they did (ADR 013, rule 8)
  useEffect(() => { setPresencePlay(s.id); }, [s.id]);
  const [mode, setMode] = useState<Mode>("play");
  const rostering = mode === "roster";
  // roster mode shows one side of the roster, or both: the play's own side to start, never a faded shadow
  const [view, setView] = useState<Vis>("offense");
  const rosteringRef = useRef(rostering);
  useEffect(() => { rosteringRef.current = rostering; }, [rostering]);
  // roster mode is the team's, not a play's: the standard formation, both sides with the standard tags, each
  // at its home spot or where the coach dragged it on the roster, and a selection of its own. The play open in
  // the designer is left exactly as it was (lib/play/lineup.ts, F6).
  const formation = useMemo(() => formationOf(lineups), [lineups]);
  const [rosterPick, setRosterPick] = useState<string | null>(null);
  // a depth chart kept for a tag the formation has no token for (FS, H) stays in reach from the panel: every
  // tag a lineup keeps a chart for, the open play wears or a saved play wears (lib/play/roster.ts, R9)
  const positions = useMemo(
    () => (rostering ? rosterPositions(lineups, [...s.players, ...getPlays().flatMap((p) => p.players)]) : formation),
    [rostering, formation, lineups, s.players],
  );
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
  const [saveFailure, setSaveFailure] = useState<{ error: StorageError; duplicate: boolean } | null>(null);
  const draftBroken = useRef(false);
  const [draftWrite, setDraftWrite] = useState<{ fingerprint: string; ok: boolean } | null>(null);
  const draftFingerprint = JSON.stringify([s.id, s.name, s.notes, s.side, s.artShadow, s.los, s.players]);
  const restoredDraft = useRef(false);
  // the header's Save, for ⌘S / Ctrl+S: set once the save it makes is defined below
  const saveRef = useRef<() => void>(() => {});
  const toastTimer = useRef(0);
  const say = useCallback((text: string, ms = 1600, flag = false) => {
    setToast({ text, flag });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => { setToast(null); }, ms);
  }, []);
  // the roster's picture or sheet being drawn, and what the roster panel says of it: kept here, so leaving roster
  // mode mid-export neither loses its word nor lets a second one start (docs/adr/010-roster-exports.md)
  const [rosterExport, setRosterExport] = useState({ busy: false, news: "" });
  // what another coach did, said once as a toast: a listener on the account store, so nothing re-renders for it
  useEffect(() => subscribeAccount(() => {
    const n = getAccountState().notice;
    if (n) { say(n, 4000); clearNotice(); }
  }), [say]);
  const exportingRef = useRef(false);
  const onRosterExport = useCallback((label: string, job: () => Promise<void>) => {
    if (exportingRef.current) return;
    exportingRef.current = true;
    setRosterExport({ busy: true, news: `${label}…` });
    Promise.resolve().then(job)
      .then(() => "Saved", (e: unknown) => { record("export", e); return "That export failed. Try again on a bigger screen."; })
      .then((news) => { exportingRef.current = false; setRosterExport({ busy: false, news }); }, () => undefined);
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
  const onRosterSelect = useCallback((id: string) => {
    setRosterPick(id);
    openRight(true);
  }, [openRight]);
  // a preset route keeps its depth and stops at the sideline; when a pick, a mirror or a move cuts it
  // short there, the toast says so once it is drawn, and the palette says by how much
  // the account brought another device's desk down (docs/adr/014-whole-desk-in-account.md, A21): the board redraws from its
  // draft. A team with a clear board leaves this board as it is: the next touch here is the board, and goes up.
  useEffect(() => subscribePulls(() => {
    const d = readDraft();
    if (!d) return;
    dispatch({ type: "hydrate", id: d.id, name: d.name, notes: d.notes, side: d.side, artShadow: d.artShadow, los: d.los, players: d.players });
    restoredDraft.current = true;
    setFirstUse(false);
  }), []);
  const playersRef = useRef(s.players);
  // a note the field says with the move itself (a teammate stepped past) leads the cut's toast, never lost under it
  const fieldNote = useRef<string | null>(null);
  const cutWatch = useRef<{ id: string; was: Player | undefined; what?: string; note: string | null } | null>(null);
  const watchCut = useCallback((id: string, what?: string) => {
    cutWatch.current = { id, was: playersRef.current.find((p) => p.id === id), what, note: fieldNote.current };
  }, []);
  useEffect(() => {
    playersRef.current = s.players;
    const w = cutWatch.current;
    if (!w) return;
    cutWatch.current = null;
    const news = cutNews(w.was, s.players.find((p) => p.id === w.id));
    const cut = news ? `${w.what ?? news} · cut short at the sideline` : null;
    if (cut && w.note) say(`${w.note} ${cut}`, 2600, true);
    else if (cut) say(cut, 2200);
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
  // the BLITZ pills: QB, Backfield and Contain aim it; Pick a player asks for a red player on the field, like Man
  const onBlitzAim = useCallback((aim: "qb" | "backfield" | "contain") => { dispatch({ type: "blitzAim", aim }); }, []);
  // the DEEP pills: Auto splits the field with the other deep zones, Half and Third call it
  const onDeepSplit = useCallback((split: DeepSplit | null) => { dispatch({ type: "deepSplit", split }); }, []);
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
      if (e.key === "Escape") {
        if (rosteringRef.current) setRosterPick(null);
        else dispatch({ type: "select", id: null });
        return;
      }
      // ⌘S / Ctrl+S is the header's Save, typing in the play name included, never the browser's "Save page as";
      // a layout whose S key types no Latin letter is matched by the key's place. Roster mode has no play to save
      const sKey = e.key === "s" || e.key === "S" || (e.code === "KeyS" && !/^[a-z]$/i.test(e.key));
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && sKey) {
        e.preventDefault();
        if (!e.repeat && !rosteringRef.current) saveRef.current();
        return;
      }
      if (isEditable(e.target)) return;
      // the play's history is the play's: nothing in roster mode is on it, so nothing there undoes it
      if (rosteringRef.current) return;
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
      deviceWritten();
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
  // the ball is where the board's setting puts it (lib/los.ts), for every play opened here, from the first paint on
  const losChoice = useSyncExternalStore(subscribeLosChoice, getLosChoice, serverLosChoice);
  useEffect(() => { dispatch({ type: "setLos", los: losChoice }); }, [losChoice]);
  useEffect(() => {
    const d = readDraft();
    let firstUseTimer = 0;
    let openToolsTimer = 0;
    restoredDraft.current = d !== null;
    if (d) dispatch({ type: "hydrate", id: d.id, name: d.name, notes: d.notes, side: d.side, artShadow: d.artShadow, los: d.los, players: d.players });
    hydratedRef.current = true;
    // storage may be unavailable in a private window; the guide then shows for this visit
    if (!d && getPlays().length === 0 && !firstUseDone()) firstUseTimer = window.setTimeout(() => { setFirstUse(true); }, 0);
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

  // whether the save landed
  const onSave = useCallback((): boolean => {
    const r = savePlay({
      id: s.id, name: s.name || "Untitled play", notes: s.notes, side: s.side, ...artShadow(s.artShadow), los: s.los, players: [...s.players],
    });
    if (!r.ok) {
      // a team the coach may only look at: the words say so, and there is nothing to retry (ADR 013, rule 9)
      if (r.error.reason === "readonly") { say(failureMessage(r.error), 3200); return false; }
      setSaveFailure({ error: r.error, duplicate: false }); say(failureMessage(r.error), 3200); record("storage", r.error); return false;
    }
    // only a write that landed gets to name this document
    if (!s.id) dispatch({ type: "saved", id: r.value.id });
    setSaveFailure(null);
    say("Saved");
    return true;
  }, [say, s.id, s.name, s.notes, s.side, s.artShadow, s.los, s.players]);
  // Save from the header (or ⌘S) with Play tools shut: a save that doesn't land opens Play tools on its
  // warning, where the play can still be downloaded or the save tried again
  const onHeaderSave = useCallback(() => {
    if (!onSave()) openLeft(true);
  }, [onSave, openLeft]);
  useEffect(() => { saveRef.current = onHeaderSave; }, [onHeaderSave]);
  const onDuplicate = useCallback(() => {
    const n = (s.name || "Untitled play") + " copy";
    const r = savePlay({ id: null, name: n, notes: s.notes, side: s.side, ...artShadow(s.artShadow), los: s.los, players: [...s.players] });
    if (!r.ok) {
      if (r.error.reason === "readonly") { say(failureMessage(r.error), 3200); return; }
      setSaveFailure({ error: r.error, duplicate: true }); say(failureMessage(r.error), 3200); record("storage", r.error); openLeft(true); return;
    }
    dispatch({ type: "setName", name: n });
    dispatch({ type: "saved", id: r.value.id });
    setSaveFailure(null);
    say("Saved a copy");
  }, [say, s.name, s.notes, s.side, s.artShadow, s.los, s.players, openLeft]);
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
    setFirstUseDone(true);
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
  // a saved play put on the board whole, as "Open" from the gallery does; the one already there is left alone.
  // Roster mode hides the routes and titles the field "Roster", so a play picked there is shown in play mode
  const openPlay = useCallback((play: SavedPlay) => {
    setMode("play");
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
  // when it has none (docs/adr/009-playbook-switcher.md); the book already current is left as it is
  const onSwitchBook = useCallback((id: string) => {
    const book = playbookById(id);
    if (!book) return;
    if (id === getCurrentBookId()) { say(`Already in “${book.name}”`); return; }
    setCurrentBook(id);
    const primary = primaryPlay(book);
    if (!primary) {
      setMode("play");
      dispatch({ type: "newPlay", side: s.side });
      say(`Switched to “${book.name}” · board cleared`, 2600);
    } else if (primary.id === s.id) {
      openPlay(primary);
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
  // the board's setting moves, and the effect above moves the ball with it
  const onLos = useCallback((los: number) => { setLosChoice(los); }, []);
  // the team's settings: its name and colour, and the field's no-run zones
  const onTeam = useCallback((next: TeamSettings) => {
    const r = setTeam(next);
    if (!r.ok) { say(failureMessage(r.error), 3200); record("storage", r.error); }
  }, [say]);
  const onNoRunZones = useCallback((on: boolean) => { onTeam({ ...getTeam(), noRunZones: on }); }, [onTeam]);
  // a line of a depth chart, or a lineup made, named, picked or deleted, lands at once, like the team's name, and is never undone
  const onLineups = useCallback((next: Lineups) => {
    const r = setLineups(next);
    if (!r.ok) { say(failureMessage(r.error), 3200); record("storage", r.error); }
  }, [say]);
  const onRoster = useCallback((next: Roster) => { onLineups(withSlots(lineups, lineup.id, next)); }, [lineup.id, lineups, onLineups]);
  // the field's edits in roster mode: a position picked, the turf tapped to let it go, or a position dragged or
  // stepped with the arrow keys, which stands it there on the roster, on every lineup, like a line of a depth
  // chart: at once and never undone. The play's own history never hears of it (lib/play/lineup.ts, F6, F7)
  const rosterDispatch = useCallback((a: Action) => {
    if (a.type === "select") setRosterPick(a.id);
    if (a.type !== "move" || !a.commit) return;
    const p = formation.find((q) => q.id === a.id);
    if (p) onLineups(withSpot(lineups, p.team, p.label, a.x, a.y));
  }, [formation, lineups, onLineups]);
  // the starter at each position on the field, from the active lineup, shortened to fit under the token;
  // on a play only once the coach has turned the names on, in roster mode always
  const fieldPlayers = rostering ? formation : s.players;
  const starterNames = useMemo(() => starters(lineup.slots, fieldPlayers), [lineup.slots, fieldPlayers]);
  const namesOn = showsNames(lineups);
  // roster mode leaves whatever was being drawn and opens the panel on the positions; a player tapped in the
  // palette opens the depth chart of the standard position wearing the same tag, when there is one, and the
  // side on view is that player's, else the play's own
  const onMode = useCallback((next: Mode) => {
    setMode(next);
    if (next === "roster") {
      dispatch({ type: "draftCancel" });
      dispatch({ type: "cancelTargeting" });
      const was = selected(s);
      setRosterPick(!was?.label ? null : formation.find((p) => p.team === was.team && p.label === was.label)?.id ?? offFieldId(was.team, was.label));
      setView(was?.team ?? s.side);
      openRight(true);
    }
  }, [formation, openRight, s]);
  // the header's Back to play: out of roster mode as the Roster tile goes, except that on a phone or tablet, where
  // the drawers cover the field, both fold so the play is in view. Back goes with the mode, so focus goes to the
  // field's title once it reads the play's name again, never to the page; it is focusable only until focus moves on
  // from it, so on a play it stays words. It is ringed only when the keyboard pressed Back: after a tap or a click it
  // stays quiet until then, whatever a browser's own rule would do. The window losing focus blurs it too but leaves it
  // the page's focus, so that blur changes nothing
  const titleRef = useRef<HTMLHeadingElement>(null);
  const backToPlay = useRef<"keyboard" | "pointer" | null>(null);
  const onBack = useCallback((keyboard: boolean) => {
    backToPlay.current = keyboard ? "keyboard" : "pointer";
    if (compactRef.current) closePanels();
    onMode("play");
  }, [closePanels, onMode]);
  useEffect(() => {
    const title = titleRef.current;
    if (!rostering && backToPlay.current && title) {
      title.tabIndex = -1;
      title.toggleAttribute("data-quiet-focus", backToPlay.current === "pointer");
      const movedOn = () => {
        if (document.activeElement === title) return;
        title.removeAttribute("tabindex");
        title.removeAttribute("data-quiet-focus");
        title.removeEventListener("blur", movedOn);
      };
      title.addEventListener("blur", movedOn);
      title.focus({ preventScroll: true });
    }
    backToPlay.current = null;
  }, [rostering]);
  // a side taken off the field takes its picked position with it, as hiding the shadow does
  const pickedTeam = positions.find((p) => p.id === rosterPick)?.team ?? null;
  const onView = useCallback((next: Vis) => {
    if (pickedTeam && next !== "both" && next !== pickedTeam) setRosterPick(null);
    setView(next);
  }, [pickedTeam]);
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
  // the quarterback's rollout and boot, and what the one they have does (docs/adr/011-qb-rollout-and-boot.md)
  const qbInfo = useMemo((): QbInfo | null => {
    if (sel?.team !== "offense" || sel.id !== quarterback(s.players)?.id) return null;
    const act = qbAction(s.players);
    if (!act) return { act: null };
    const who = names({ players: s.players });
    const receivers = s.players.some((p) => p.team === "offense" && p.id !== act.qb.id && p.route && !isRun(p.route.type) && !isBallJob(p.route.type));
    // what turns a boot: Flip play, unless the fake goes the same way flipped (a runner lined up on the QB's x), then
    // ⇄ Mirror on the fake's run, each tried on the play as it would be (docs/adr/011-qb-rollout-and-boot.md, Q11)
    const turns = (players: readonly Player[]): boolean => qbAction(players)?.side === -act.side;
    const fake = act.fake;
    const turn = act.type !== "boot" || !fake ? null
      : turns(flipped(s.players)) ? "flip"
      : mirrorable(fake) && turns(s.players.map((p) => (p.id === fake.id && p.route ? { ...p, route: mirrorRoute(p.route, atSnap(p).x).route } : p))) ? "mirror"
      : null;
    return { act: { type: act.type, side: act.side, fake: fake ? who.get(fake.id) ?? null : null, decoy: act.decoy, receivers, turn } };
  }, [sel, s.players]);
  // a lateral's catch dragged somewhere illegal is snapped back, or a player kept off a teammate, and the
  // coach is told why, on a flag's yellow
  const onFieldNote = useCallback((text: string) => {
    say(text, 2600, true);
    // kept only while the press or drop that said it is still being handled, for its move's cut (above)
    fieldNote.current = text;
    queueMicrotask(() => { fieldNote.current = null; });
  }, [say]);
  // who the selected blitzer comes for, for the palette's BLITZ pills (lib/play/blitz.ts)
  const blitz = useMemo(() => {
    if (sel?.team !== "defense" || sel.route?.type !== "blitz") return null;
    const who = names({ players: s.players });
    const t = blitzTarget(sel.route, s.players);
    const back = nearestBack(s.players);
    const aim = blitzAim(sel.route);
    // a contain blitz's edge, and whether the sideline leaves room on it and on the other (lib/play/blitz.ts, C2, C4)
    const edge = containEdge(sel, s.players);
    const contain: BlitzInfo["contain"] = aim === "contain"
      ? { edge: edge < 0 ? "left" : "right", room: edgePath(edge, s.players) !== null, other: edgePath(edge < 0 ? 1 : -1, s.players) !== null }
      : null;
    return { aim, who: t ? who.get(t.id) ?? null : null, back: back ? who.get(back.id) ?? null : null, contain };
  }, [sel, s.players]);
  const hint = rostering ? null : s.targeting === "lateral" ? "Lateral to who? Tap a red player." : s.targeting === "blitz" ? "Blitz who? Tap a red player."
    : s.targeting ? "Cover who? Tap a red player." : s.draft ? s.draft.kind === "motion"
    ? "Pre-snap motion · tap waypoints behind the line · Finish when done"
    : "Tap waypoints on the field · double-tap to finish" : null;

  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <Header
        mode={mode}
        view={view}
        onView={() => { onView(VIEW[view].next); }}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        canUndo={!rostering && s.past.length > 0}
        canRedo={!rostering && s.future.length > 0}
        canClear={s.players.some((p) => (p.route || p.preSnap) && p.team === s.side)}
        onClear={onClear}
        unsaved={dirty}
        onSave={onHeaderSave}
        onDuplicate={onDuplicate}
        onToggleLeft={() => { openLeft(!leftOpen); }}
        onToggleRight={() => { openRight(!rightOpen); }}
        onBack={onBack}
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
            savePanel={saveFailure ? <SaveFailure message={failureMessage(saveFailure.error)} onRetry={saveFailure.duplicate ? onDuplicate : onSave} onDownload={onDownload} /> : null}
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
            mode={mode}
            onMode={onMode}
            lineups={lineups}
            onLineups={onLineups}
          />
        </Sidebar>
        <Field
          players={fieldPlayers}
          // the roster is both sides of the team: roster mode shows the side on view, or both, every position tappable
          vis={rostering ? view : s.vis}
          side={s.side}
          selectedId={rostering ? rosterPick : s.selectedId}
          targeting={rostering ? null : s.targeting}
          draft={rostering ? null : s.draft}
          dispatch={rostering ? rosterDispatch : fieldDispatch}
          onSelect={rostering ? onRosterSelect : onSelect}
          onNote={onFieldNote}
          lateralFrom={s.targeting === "lateral" && visit !== null ? chain[visit]?.id ?? null : null}
          svgRef={svgRef}
          title={rostering ? "Roster" : s.name || "Untitled play"}
          titleControl={rostering ? undefined : <EditablePlayTitle name={s.name} onName={(name) => { dispatch({ type: "setName", name }); }} />}
          showTitle
          titleRef={titleRef}
          status={rostering ? lineup.name.trim() || "Untitled lineup" : persistenceLabel[persistence]}
          // roster mode has no play open (ADR 008), so the switcher waits for play mode, as Play tools' list does
          switcher={rostering ? undefined : <PlaySwitcher name={s.name} playId={s.id} onOpenPlay={onOpenPlay} onAddToBook={onAddToBook} />}
          noRunZones={noRunZones}
          los={rostering ? ROSTER_LOS : s.los}
          starters={rostering || namesOn ? starterNames : undefined}
          roster={rostering}
        />
        <Sidebar id="route-sidebar" side="right" open={rightOpen} label={rostering ? "Roster panel" : "Route palette"} overlay={compact}>
          {rostering ? (
            <RosterSidebar
              lineups={lineups}
              onLineups={onLineups}
              roster={lineup.slots}
              onRoster={onRoster}
              selected={positions.find((p) => p.id === rosterPick) ?? null}
              players={positions}
              view={view}
              onView={onView}
              onSelect={onRosterSelect}
              team={team}
              exporting={rosterExport}
              onExport={onRosterExport}
            />
          ) : (
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
            deep={sel?.team === "defense" && sel.route?.type === "zoneDeep" ? deepSplit(sel.route) ?? "auto" : null}
            onDeepSplit={onDeepSplit}
            cut={selCut}
            jet={jetAble}
            qb={qbInfo}
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
          )}
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

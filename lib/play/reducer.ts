import { LOS_YARD, losOf, readLos } from "./field";
import { atSnap, motionPoint, withoutMotion } from "./pre-snap";
import { emptyHistory, push, redo as redoStep, undo as undoStep, type Doc, type History, type HistoryStep } from "./history";
import { carriers, chainLinks, chainOf, clampCatch, quarterback, settleChain, visits } from "./lateral";
import { MAX_ROUTE_POINTS, clampPoint, defaults, flipRoute, isRun, keepRead, legalSpot, mirrorRoute, mirrorable, routeDef, trimFlags } from "./routes";
import type { Draft, Hop, Pair, Player, Route, RouteType, SavedPlay, Team, Vis } from "./types";

/** What a tap on a red player is waiting to answer: who a man defender covers, or who takes a lateral. */
export type Targeting = "man" | "lateral";

export interface PlayState extends Doc, History {
  artShadow: boolean;
  /** the field's shadow is on only because ticking the pictures' choice put it there */
  shadowForArt: boolean;
  /** the saved play this one came from, so Save updates it instead of adding another */
  id: string | null;
  selectedId: string | null;
  /**
   * The place in the lateral chain being edited, for a player who has the ball more than once: 0 is the
   * quarterback at the snap. Null means the selected player's last time with it.
   */
  visit: number | null;
  targeting: Targeting | null;
  draft: Draft | null;
  vis: Vis;
}

export type Action =
  | { type: "move"; id: string; x: number; y: number; commit: boolean }
  | { type: "select"; id: string | null }
  | { type: "cancelTargeting" }
  | { type: "pick"; key: RouteType }
  | { type: "drawMotion" }
  | { type: "removeMotion" }
  | { type: "target"; id: string }
  /**
   * the Lateral tile: the selected carrier's last time with it asks who takes it, like Man; a time they
   * toss it on takes off that lateral and every one after
   */
  | { type: "lateral" }
  /** a place in the ball path picked, to edit that time the player has it */
  | { type: "selectVisit"; index: number }
  /** a lateral's catch point dragged or nudged: clamped behind its release and the line */
  | { type: "catchMove"; hop: number; pt: Pair }
  | { type: "setRoute"; id: string; route: Route | null }
  | { type: "draftPoint"; pt: Pair }
  | { type: "draftPointRemove" }
  | { type: "draftFinish" }
  | { type: "draftFinishDoubleTap" }
  | { type: "draftCancel" }
  | { type: "customPointAdd"; id: string; pt: Pair }
  | { type: "customPointMove"; id: string; index: number; pt: Pair }
  | { type: "customPointRemove"; id: string; index: number }
  | { type: "togglePrimary" }
  | { type: "mirror" }
  | { type: "rename"; id: string; label: string; commit: boolean }
  | { type: "flip" }
  | { type: "clearRoutes"; team: Team | null }
  | { type: "resetFormation"; team: Team | null }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; id?: string | null; name: string; notes?: string; side?: Team; artShadow?: boolean; los?: number; players: Player[]; shadow?: boolean }
  /** a fresh, unsaved play on the default formation. History from the play you left is dropped. */
  | { type: "newPlay"; side: Team }
  | { type: "hydrate"; id?: string | null; name: string; notes?: string; side?: Team; artShadow?: boolean; los?: number; players: Player[] }
  | { type: "setName"; name: string }
  | { type: "setNotes"; notes: string }
  /** the yard line this play's ball is on; like the name, never undone */
  | { type: "setLos"; los: number }
  /** after a save: remember which record this play now is */
  | { type: "saved"; id: string }
  /** show or hide the other team, faded, as a formation reference */
  | { type: "setShadow"; on: boolean }
  /** draw the other team, faded, on this play's pictures too; showing it on the field as well */
  | { type: "setArtShadow"; on: boolean };

export function initialState(): PlayState {
  return {
    id: null,
    name: "New play",
    notes: "",
    side: "offense",
    artShadow: false,
    shadowForArt: false,
    los: LOS_YARD,
    players: defaults(),
    selectedId: null,
    visit: null,
    targeting: null,
    draft: null,
    vis: "offense",
    ...emptyHistory,
  };
}

export function selected(s: PlayState): Player | null {
  return s.players.find((p) => p.id === s.selectedId) ?? null;
}

/** Whether the document holds work its saved record doesn't (or, never saved, anything past a blank new play). */
export function unsaved(s: PlayState, saved: SavedPlay | null): boolean {
  if (saved) {
    return s.name !== saved.name || s.notes !== saved.notes || s.side !== saved.side || s.artShadow !== (saved.artShadow === true)
      || s.los !== losOf(saved) || JSON.stringify(s.players) !== JSON.stringify(saved.players);
  }
  return s.past.length > 0 || s.notes !== "" || s.side !== "offense" || s.artShadow || s.los !== LOS_YARD
    || (s.name !== "New play" && s.name !== "");
}

/** Whether a player is drawn under the current Show filter. */
export function shown(p: Player, vis: Vis): boolean {
  return vis === "both" || p.team === vis;
}

/** The other team is on the field, faded, as a formation reference. */
export function shadowing(side: Team, vis: Vis): boolean {
  return (side === "offense" || side === "defense") && vis === "both";
}

/** A defensive call opens with the shadow offense. An offensive play opens without the shadow defense. The same side keeps that choice. */
function visFor(side: Team, prev?: Pick<PlayState, "side" | "vis">): Vis {
  if (prev?.side === side && (prev.vis === side || prev.vis === "both")) return prev.vis;
  return side === "defense" ? "both" : "offense";
}

/**
 * The opposite team is faded on the field and left off playbook drawings.
 * A coach can still select one and give them a route or coverage.
 */
export function isContext(p: Player, side: Team): boolean {
  return p.team !== side;
}

function patch(players: readonly Player[], id: string, upd: Partial<Player>): readonly Player[] {
  return players.map((p) => (p.id === id ? { ...p, ...upd } : p));
}

function commit(s: PlayState): PlayState {
  return { ...s, ...push(s, s) };
}

/** Opening a play of the same side keeps the shadow preference; a different side uses that side's default. */
function follow(s: PlayState, doc: Doc): Pick<PlayState, "vis"> {
  return { vis: visFor(doc.side, s) };
}

/**
 * The incoming play's own pictures choice, never the one from the play you left. A play whose
 * pictures include the other team opens with it on the field, so the coach sees what prints.
 */
function opened(s: PlayState, doc: Doc): Pick<PlayState, "artShadow" | "shadowForArt" | "vis"> {
  const artShadow = doc.artShadow === true;
  // a shadow the pictures' choice put on the field was never the coach's own preference
  const base = follow(s.shadowForArt ? { ...s, vis: s.side } : s, doc).vis;
  return { artShadow, shadowForArt: artShadow && base !== "both", vis: artShadow ? "both" : base };
}

/** The field's shadow shown or hidden; hiding it takes that player off the field, so stop editing them. */
function withVis(s: PlayState, vis: PlayState["vis"]): PlayState {
  const picked = selected(s);
  if (picked && !shown(picked, vis)) return { ...s, vis, selectedId: null, visit: null, targeting: null, draft: null };
  return { ...s, vis };
}

/** Replaces the whole document and drops undo and redo, which belong to the play you left. */
function openPlay(s: PlayState, doc: Doc): PlayState {
  return { ...s, ...emptyHistory, ...doc, ...opened(s, doc), ...cleared };
}

function step(s: PlayState, st: HistoryStep | null): PlayState {
  return st ? { ...s, ...st.history, ...st.doc, ...follow(s, st.doc), ...cleared } : s;
}

/** Sets a route, and backs a new blitzer off to the blitz line if they were lined up closer. */
function setRoute(s: PlayState, id: string, route: Route | null): PlayState {
  const c = commit(s);
  return { ...c, players: c.players.map((p) => (p.id === id ? legalSpot({ ...p, route }) : p)) };
}

function finishDraft(s: PlayState, dropDuplicate: boolean): PlayState {
  const d = s.draft;
  if (!d) return s;
  let pts = d.pts;
  if (dropDuplicate && pts.length > 1) {
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    if (a && b && a[0] === b[0] && a[1] === b[1]) pts = pts.slice(0, -1);
  }
  let next = s;
  if (pts.length) {
    if (d.kind === "motion") {
      const c = commit(s);
      next = { ...c, players: c.players.map(p => p.id === d.id && p.team === "offense"
        ? { ...p, preSnap: { pts: pts.map(motionPoint) } } : withoutMotion(p)) };
    } else {
      // a custom route drawn over X's Out (or over an earlier custom route) is still X's route: the read stays (#109)
      next = setRoute(s, d.id, keepRead(s.players.find((p) => p.id === d.id)?.route, { type: "custom", pts: [...pts] }));
    }
  }
  return { ...next, draft: null };
}

function customRoute(s: PlayState, id: string): Route | null {
  const route = s.players.find((p) => p.id === id)?.route;
  return route?.type === "custom" ? route : null;
}

const cleared = { selectedId: null, visit: null, targeting: null, draft: null } as const;

/** The place in the chain the selected player is being edited at: the one picked, else their last; null off it. */
export function editedVisit(s: Pick<PlayState, "players" | "selectedId" | "visit">, chain = chainOf(s.players)): number | null {
  if (s.selectedId === null) return null;
  if (s.visit !== null && chain[s.visit]?.id === s.selectedId) return s.visit;
  return visits(chain, s.selectedId).at(-1) ?? null;
}

/** The quarterback's laterals that make up the chain, the first `n` of them. */
function hopsUpTo(players: readonly Player[], n: number): Hop[] {
  const qb = quarterback(players);
  return chainLinks(players).slice(0, n).map((l) => qb?.laterals?.[l.index] ?? { to: l.to.id });
}

/** The players with the quarterback's laterals replaced, the key gone when there are none. */
function withHops(players: readonly Player[], hops: readonly Hop[]): Player[] {
  const qb = quarterback(players);
  return players.map((p) => {
    if (p.id !== qb?.id) return p;
    const out: Player = { ...p, laterals: [...hops] };
    if (!hops.length) delete out.laterals;
    return out;
  });
}

/**
 * Every edit lands with its lateral chain settled (lib/play/lateral.ts): a move of a player or the ball,
 * a catch dragged, a lateral retargeted, a formation reset or flipped each re-clamp every catch in
 * chain order, since each catch depends on the one before it. A play with nothing to settle is untouched.
 */
export function reducer(s: PlayState, a: Action): PlayState {
  const next = reduce(s, a);
  if (next.players === s.players) return next;
  const players = settleChain(next.players);
  return players === next.players ? next : { ...next, players };
}

function reduce(s: PlayState, a: Action): PlayState {
  switch (a.type) {
    case "move": {
      const base = a.commit ? commit(s) : s;
      return { ...base, players: patch(base.players, a.id, { x: a.x, y: a.y }) };
    }
    case "select": {
      if (a.id === null) return { ...s, selectedId: null, visit: null, targeting: null, draft: null };
      const picked = s.players.find((p) => p.id === a.id);
      // either team can be selected, including the faded shadow, so they can take an assignment
      if (!picked) return s;
      return { ...s, selectedId: a.id, visit: null, targeting: null, draft: null };
    }
    case "selectVisit": {
      const p = chainOf(s.players)[a.index];
      return p ? { ...s, selectedId: p.id, visit: a.index, targeting: null, draft: null } : s;
    }
    case "cancelTargeting":
      return { ...s, targeting: null };
    case "drawMotion": {
      const p = selected(s);
      return p?.team === "offense" ? { ...s, targeting: null, draft: { id: p.id, pts: [], kind: "motion" } } : s;
    }
    case "removeMotion": {
      const p = selected(s);
      if (!p?.preSnap) return s;
      const c = commit(s);
      return { ...c, draft: null, players: c.players.map(q => q.id === p.id ? withoutMotion(q) : q) };
    }
    case "pick": {
      const p = selected(s);
      if (!p) return s;
      const chain = chainOf(s.players);
      const at = editedVisit(s, chain);
      if (at !== null && at < chain.length - 1 && a.key !== "man") {
        // a job for a time the ball goes on from them ends the chain there, with that job
        const c = commit(s);
        const cut = withHops(c.players, hopsUpTo(c.players, at));
        if (a.key === "custom") return { ...c, players: patch(cut, p.id, { route: null }), visit: at, draft: { id: p.id, pts: [] }, targeting: null };
        return { ...c, players: cut.map((q) => (q.id === p.id ? legalSpot({ ...q, route: { type: a.key } }) : q)), visit: at };
      }
      if (p.route && p.route.type === a.key && a.key !== "custom") return setRoute(s, p.id, null);
      if (a.key === "man") return { ...s, targeting: "man", draft: null };
      if (a.key === "custom") return { ...s, draft: { id: p.id, pts: [] }, targeting: null };
      // a preset picked over the current route keeps the read; picking the same one again takes the route away, read and all
      return setRoute(s, p.id, keepRead(p.route, { type: a.key }));
    }
    case "lateral": {
      const p = selected(s);
      const chain = chainOf(s.players);
      const at = editedVisit(s, chain);
      if (!p || p.team !== "offense" || at === null) return s;
      // the last time they have it: like Man, ask who takes it
      if (at === chain.length - 1) return { ...s, visit: at, targeting: "lateral", draft: null };
      // a time they toss it on: that lateral and every one after come off, and they have no job yet
      const c = commit(s);
      return { ...c, visit: at, targeting: null, players: patch(withHops(c.players, hopsUpTo(c.players, at)), p.id, { route: null }) };
    }
    case "target": {
      const def = selected(s);
      const t = s.players.find((q) => q.id === a.id);
      if (!s.targeting || !t || t.team !== "offense") return s;
      if (s.targeting === "lateral") {
        // any other red player takes it, the same one again included, and is selected to be given their
        // job with it. The lateral goes after the carrier's time with it (anything after is replaced), with
        // a catch of its own; a pass route the target had is gone, since they have the ball now
        const chain = chainOf(s.players);
        const at = editedVisit(s, chain);
        if (!def || at === null || chain[at]?.id === t.id) return s;
        const c = commit(s);
        const players = withHops(c.players, [...hopsUpTo(c.players, at), { to: t.id }]).map((p) => {
          if (p.id === t.id && p.route && !isRun(p.route.type)) return { ...p, route: null };
          return p;
        });
        return { ...c, targeting: null, selectedId: t.id, visit: at + 1, players };
      }
      const next = def ? setRoute(s, def.id, { type: "man", target: t.id }) : s;
      return { ...next, targeting: null };
    }
    case "catchMove": {
      const link = chainLinks(s.players)[a.hop];
      const hops = hopsUpTo(s.players, Infinity);
      const hop = hops[a.hop];
      if (!link || !hop) return s;
      const pt = clampCatch(a.pt, link.release);
      if (hop.catch?.[0] === pt[0] && hop.catch[1] === pt[1]) return s;
      const c = commit(s);
      return { ...c, players: withHops(c.players, hops.map((h, i) => (i === a.hop ? { to: h.to, catch: pt } : h))) };
    }
    case "setRoute":
      return setRoute(s, a.id, a.route);
    case "draftPoint":
      if (!s.draft || s.draft.pts.length >= MAX_ROUTE_POINTS) return s;
      return { ...s, draft: { ...s.draft, pts: [...s.draft.pts, s.draft.kind === "motion" ? motionPoint(a.pt) : clampPoint(a.pt)] } };
    case "draftPointRemove":
      if (!s.draft?.pts.length) return s;
      return { ...s, draft: { ...s.draft, pts: s.draft.pts.slice(0, -1) } };
    case "draftFinish":
      return finishDraft(s, false);
    case "draftFinishDoubleTap":
      return finishDraft(s, true);
    case "draftCancel":
      return s.draft ? { ...s, draft: null } : s;
    case "customPointAdd": {
      const route = customRoute(s, a.id);
      if (!route || (route.pts?.length ?? 0) >= MAX_ROUTE_POINTS) return s;
      const c = commit(s);
      return { ...c, players: patch(c.players, a.id, { route: { ...route, pts: [...(route.pts ?? []), clampPoint(a.pt)] } }) };
    }
    case "customPointMove": {
      const route = customRoute(s, a.id);
      const pts = route?.pts;
      if (!route || !pts?.[a.index]) return s;
      const pt = clampPoint(a.pt);
      if (pts[a.index]?.[0] === pt[0] && pts[a.index]?.[1] === pt[1]) return s;
      const c = commit(s);
      return {
        ...c,
        players: patch(c.players, a.id, { route: { ...route, pts: pts.map((q, i) => (i === a.index ? pt : q)) } }),
      };
    }
    case "customPointRemove": {
      const route = customRoute(s, a.id);
      const pts = route?.pts;
      if (!route || !pts?.[a.index] || pts.length <= 1) return s;
      const c = commit(s);
      return { ...c, players: patch(c.players, a.id, { route: { ...route, pts: pts.filter((_, i) => i !== a.index) } }) };
    }
    case "togglePrimary": {
      const sel = selected(s);
      // a carrier in a lateral chain is never the read: the final throw goes to someone else
      if (!sel || sel.team !== "offense" || !sel.route || carriers(s.players).has(sel.id)) return s;
      const on = !sel.route.primary;
      const c = commit(s);
      return {
        ...c,
        players: c.players.map((p) => {
          if (!p.route) return p;
          // a read taken off a player leaves no `primary: false` behind, so the play stores as it reads (#113)
          if (p.id === sel.id) return { ...p, route: trimFlags({ ...p.route, primary: on }) };
          if (!p.route.primary) return p;
          return { ...p, route: trimFlags({ ...p.route, primary: false }) };
        }),
      };
    }
    case "mirror": {
      const sel = selected(s);
      if (!sel?.route || !mirrorable(sel)) return s;
      const c = commit(s);
      return { ...c, players: patch(c.players, sel.id, { route: mirrorRoute(sel.route, atSnap(sel).x).route }) };
    }
    case "rename": {
      const base = a.commit ? commit(s) : s;
      return { ...base, players: patch(base.players, a.id, { label: a.label.slice(0, 3).toUpperCase() }) };
    }
    case "flip": {
      const c = commit(s);
      return {
        ...c,
        players: c.players.map((p) => ({ ...p, x: 30 - p.x, route: p.route ? flipRoute(p.route) : null,
          ...(p.preSnap ? { preSnap: { pts: p.preSnap.pts.map(q => [30 - q[0], q[1]] as const) } } : {}),
          // every lateral's catch flips with the field (R13)
          ...(p.laterals ? { laterals: p.laterals.map((h) => (h.catch ? { to: h.to, catch: [30 - h.catch[0], h.catch[1]] as const } : h)) } : {}) })),
      };
    }
    case "clearRoutes": {
      const inScope = (p: Player): boolean => !a.team || p.team === a.team;
      if (!s.players.some((p) => (p.route || p.preSnap || p.laterals) && inScope(p))) return s;
      const c = commit(s);
      const clear = (p: Player): Player => {
        const out = { ...withoutMotion(p), route: null };
        delete out.laterals;
        return out;
      };
      return {
        ...c,
        players: c.players.map((p) => (inScope(p) ? clear(p) : p)),
        draft: null,
        targeting: null,
      };
    }
    case "resetFormation": {
      const d = defaults();
      const inScope = (p: Player): boolean => !a.team || p.team === a.team;
      // the default spot, except that a blitzer stays back on the blitz line
      const home = (p: Player): Player => {
        const base = d.find((q) => q.id === p.id);
        return base ? legalSpot({ ...p, x: base.x, y: base.y }) : p;
      };
      // nothing to do if every player in scope already sits at its home spot
      const moved = s.players.some((p) => {
        if (!inScope(p)) return false;
        const h = home(p);
        return h.x !== p.x || h.y !== p.y;
      });
      if (!moved) return s;
      const c = commit(s);
      return { ...c, players: c.players.map((p) => (inScope(p) ? home(p) : p)) };
    }
    case "undo":
      return step(s, undoStep(s, s));
    case "redo":
      return step(s, redoStep(s, s));
    case "newPlay":
      return openPlay(s, { id: null, name: "New play", notes: "", side: a.side, artShadow: false, los: LOS_YARD, players: defaults() });
    case "load": {
      const next = openPlay(s, {
        id: a.id ?? null, name: a.name, notes: a.notes ?? "", side: a.side ?? "offense", artShadow: a.artShadow === true, los: readLos(a.los),
        players: a.players,
      });
      // A shared snapshot opens with the other team faded, whichever side this play is.
      return a.shadow && next.vis !== "both" ? { ...next, vis: "both" } : next;
    }
    case "hydrate": {
      const doc: Doc = {
        id: a.id ?? null, name: a.name, notes: a.notes ?? "", side: a.side ?? "offense", artShadow: a.artShadow === true, los: readLos(a.los),
        players: a.players,
      };
      return { ...s, ...doc, ...opened(s, doc) };
    }
    case "setName":
      return { ...s, name: a.name };
    case "setNotes":
      return { ...s, notes: a.notes };
    case "setLos": {
      const los = readLos(a.los);
      return los === s.los ? s : { ...s, los };
    }
    case "saved":
      return { ...s, id: a.id };
    case "setShadow": {
      const vis = a.on ? "both" as const : s.side;
      if (vis === s.vis) return s;
      // the coach's own choice now, whatever put the shadow there
      return withVis({ ...s, shadowForArt: false }, vis);
    }
    case "setArtShadow":
      // not an edit to the diagram, so not undoable, like the name. Ticking shows the field's
      // shadow so the coach sees what prints; unticking hides it again only if ticking showed it.
      if (a.on === s.artShadow) return s;
      if (a.on) return { ...s, artShadow: true, shadowForArt: s.vis !== "both", vis: "both" };
      return withVis({ ...s, artShadow: false, shadowForArt: false }, s.shadowForArt ? s.side : s.vis);
  }
}

/** Route definition for the selected player's current route, if any. */
export function selectedDef(s: PlayState) {
  const p = selected(s);
  return p?.route ? routeDef(p.team, p.route.type) : null;
}

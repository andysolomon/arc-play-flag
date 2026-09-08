import { emptyHistory, push, redo as redoStep, undo as undoStep, type History } from "./history";
import { defaults, legalSpot, mirrorable, routeDef } from "./routes";
import type { Draft, Pair, Player, Route, RouteType, Team, Vis } from "./types";

export interface PlayState extends History {
  /** the saved play this one came from, so Save updates it instead of adding another */
  id: string | null;
  name: string;
  notes: string;
  players: readonly Player[];
  selectedId: string | null;
  targeting: boolean;
  draft: Draft | null;
  vis: Vis;
}

export type Action =
  | { type: "move"; id: string; x: number; y: number; commit: boolean }
  | { type: "select"; id: string | null }
  | { type: "cancelTargeting" }
  | { type: "pick"; key: RouteType }
  | { type: "target"; id: string }
  | { type: "setRoute"; id: string; route: Route | null }
  | { type: "draftPoint"; pt: Pair }
  | { type: "draftFinish" }
  | { type: "togglePrimary" }
  | { type: "mirror" }
  | { type: "rename"; id: string; label: string; commit: boolean }
  | { type: "flip" }
  | { type: "clearRoutes"; team: Team | null }
  | { type: "resetFormation"; team: Team | null }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "load"; id?: string | null; name: string; notes?: string; players: Player[] }
  | { type: "hydrate"; id?: string | null; name: string; notes?: string; players: Player[] }
  | { type: "setName"; name: string }
  | { type: "setNotes"; notes: string }
  /** after a save: remember which record this play now is */
  | { type: "saved"; id: string }
  | { type: "setVis"; vis: Vis };

export function initialState(): PlayState {
  return {
    id: null,
    name: "New play",
    notes: "",
    players: defaults(),
    selectedId: null,
    targeting: false,
    draft: null,
    vis: "both",
    ...emptyHistory,
  };
}

export function selected(s: PlayState): Player | null {
  return s.players.find((p) => p.id === s.selectedId) ?? null;
}

/** Whether a player is drawn under the current Show filter. */
export function shown(p: Player, vis: Vis): boolean {
  return vis === "both" || p.team === vis;
}

function patch(players: readonly Player[], id: string, upd: Partial<Player>): readonly Player[] {
  return players.map((p) => (p.id === id ? { ...p, ...upd } : p));
}

function commit(s: PlayState): PlayState {
  return { ...s, ...push(s, s.players) };
}

/** Sets a route, and backs a new blitzer off to the blitz line if they were lined up closer. */
function setRoute(s: PlayState, id: string, route: Route | null): PlayState {
  const c = commit(s);
  return { ...c, players: c.players.map((p) => (p.id === id ? legalSpot({ ...p, route }) : p)) };
}

const cleared = { selectedId: null, targeting: false, draft: null } as const;

export function reducer(s: PlayState, a: Action): PlayState {
  switch (a.type) {
    case "move": {
      const base = a.commit ? commit(s) : s;
      return { ...base, players: patch(base.players, a.id, { x: a.x, y: a.y }) };
    }
    case "select":
      return { ...s, selectedId: a.id, targeting: false, draft: null };
    case "cancelTargeting":
      return { ...s, targeting: false };
    case "pick": {
      const p = selected(s);
      if (!p) return s;
      if (p.route && p.route.type === a.key && a.key !== "custom") return setRoute(s, p.id, null);
      if (a.key === "man") return { ...s, targeting: true, draft: null };
      if (a.key === "custom") return { ...s, draft: { id: p.id, pts: [] }, targeting: false };
      return setRoute(s, p.id, { type: a.key });
    }
    case "target": {
      const def = selected(s);
      const t = s.players.find((q) => q.id === a.id);
      if (!s.targeting || !t || t.team !== "offense") return s;
      const next = def ? setRoute(s, def.id, { type: "man", target: t.id }) : s;
      return { ...next, targeting: false };
    }
    case "setRoute":
      return setRoute(s, a.id, a.route);
    case "draftPoint":
      return s.draft ? { ...s, draft: { id: s.draft.id, pts: [...s.draft.pts, a.pt] } } : s;
    case "draftFinish": {
      const d = s.draft;
      if (!d) return s;
      const pts = d.pts.slice(0, Math.max(1, d.pts.length - 1));
      const next = pts.length ? setRoute(s, d.id, { type: "custom", pts }) : s;
      return { ...next, draft: null };
    }
    case "togglePrimary": {
      const sel = selected(s);
      if (!sel || sel.team !== "offense" || !sel.route) return s;
      const on = !sel.route.primary;
      const c = commit(s);
      return {
        ...c,
        players: c.players.map((p) => {
          if (!p.route) return p;
          if (p.id === sel.id) return { ...p, route: { ...p.route, primary: on } };
          if (!p.route.primary) return p;
          return { ...p, route: { ...p.route, primary: false } };
        }),
      };
    }
    case "mirror": {
      const sel = selected(s);
      if (!sel?.route || !mirrorable(sel)) return s;
      const r = sel.route;
      const route: Route =
        r.type === "custom"
          ? { type: "custom", pts: (r.pts ?? []).map((q) => [2 * sel.x - q[0], q[1]] as const) }
          : { ...r, mirror: !r.mirror };
      const c = commit(s);
      return { ...c, players: patch(c.players, sel.id, { route }) };
    }
    case "rename": {
      const base = a.commit ? commit(s) : s;
      return { ...base, players: patch(base.players, a.id, { label: a.label.slice(0, 3).toUpperCase() }) };
    }
    case "flip": {
      const c = commit(s);
      return {
        ...c,
        players: c.players.map((p) => {
          const r: Route | null =
            p.route?.pts ? { type: p.route.type, pts: p.route.pts.map((q) => [30 - q[0], q[1]] as const) } : p.route;
          return { ...p, x: 30 - p.x, route: r };
        }),
      };
    }
    case "clearRoutes": {
      const inScope = (p: Player): boolean => !a.team || p.team === a.team;
      if (!s.players.some((p) => p.route && inScope(p))) return s;
      const c = commit(s);
      return {
        ...c,
        players: c.players.map((p) => (inScope(p) ? { ...p, route: null } : p)),
        draft: null,
        targeting: false,
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
    case "undo": {
      const step = undoStep(s, s.players);
      return step ? { ...s, ...step.history, players: step.players, ...cleared } : s;
    }
    case "redo": {
      const step = redoStep(s, s.players);
      return step ? { ...s, ...step.history, players: step.players, ...cleared } : s;
    }
    case "load":
      return { ...s, ...push(s, s.players), id: a.id ?? null, name: a.name, notes: a.notes ?? "", players: a.players, ...cleared };
    case "hydrate":
      return { ...s, id: a.id ?? null, name: a.name, notes: a.notes ?? "", players: a.players };
    case "setName":
      return { ...s, name: a.name };
    case "setNotes":
      return { ...s, notes: a.notes };
    case "saved":
      return { ...s, id: a.id };
    case "setVis":
      return { ...s, vis: a.vis };
  }
}

/** Route definition for the selected player's current route, if any. */
export function selectedDef(s: PlayState) {
  const p = selected(s);
  return p?.route ? routeDef(p.team, p.route.type) : null;
}

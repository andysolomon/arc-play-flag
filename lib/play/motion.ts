import { quarterback, routeYards } from "./geometry";
import type { Pair, Player, Pt } from "./types";
import { zoneLayout } from "./zones";

/** Yards per second a player covers during playback — brisk, but slow enough to read. */
export const SPEED = 6.5;
/** How long the snap takes to reach the quarterback. */
export const SNAP = 0.3;
/** How long the play holds at the end before everyone jogs back to their spots. */
export const HOLD = 0.8;
/** Yards a man defender keeps between themself and the receiver: one token's width. */
export const SHADOW = 2.2;

interface Track {
  pts: Pt[];
  /** cumulative yards at each waypoint */
  cum: number[];
  len: number;
  /** man coverage: the offensive player being shadowed */
  target?: string;
}

export interface Motion {
  /** total playback length in seconds, hold included */
  dur: number;
  tracks: Record<string, Track>;
  /** who snaps the ball, who takes it, and who it is thrown to */
  center: string | null;
  qb: string | null;
  receiver: string | null;
  throwAt: number;
  catchAt: number;
}

export interface Ball {
  x: number;
  y: number;
  /** 0 on the ground, 1 at the top of the arc */
  lift: number;
}

const cl = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

function track(pts: readonly Pair[], target?: string): Track {
  const out: Pt[] = [];
  for (const q of pts) {
    const l = out[out.length - 1];
    if (!l || Math.abs(l.x - q[0]) > 0.01 || Math.abs(l.y - q[1]) > 0.01) out.push({ x: q[0], y: q[1] });
  }
  const cum = [0];
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (a && b) cum.push((cum[i - 1] ?? 0) + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { pts: out, cum, len: cum[cum.length - 1] ?? 0, target };
}

/** Where along a track a player is after `s` seconds of running. */
function along(t: Track, s: number): Pt {
  const first = t.pts[0];
  if (!first) return { x: 15, y: 0 };
  const d = cl(s * SPEED, 0, t.len);
  for (let i = 1; i < t.pts.length; i++) {
    const c0 = t.cum[i - 1] ?? 0, c1 = t.cum[i] ?? 0;
    if (d <= c1) {
      const a = t.pts[i - 1], b = t.pts[i];
      if (!a || !b) break;
      const k = c1 - c0 > 0 ? (d - c0) / (c1 - c0) : 1;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return t.pts[t.pts.length - 1] ?? first;
}

/**
 * Plan a playback from the committed play: every routed player gets a track in yards,
 * the ball is snapped to the quarterback and thrown to the primary receiver — leading
 * them, so it lands where they will be when it arrives.
 */
export function buildMotion(players: readonly Player[], top: number): Motion {
  const zones = zoneLayout(players, top);
  const tracks: Record<string, Track> = {};
  for (const p of players) {
    if (!p.route) continue;
    const zone = zones[p.id];
    if (zone) {
      tracks[p.id] = track([[p.x, p.y], [zone.cx, zone.cy]]);
      continue;
    }
    if (p.route.type === "man") {
      // shadow the receiver from a token's width away, so both stay readable
      const t = players.find((q) => q.id === p.route?.target);
      if (!t) continue;
      const dx = t.x - p.x, dy = t.y - p.y, L = Math.hypot(dx, dy) || 1;
      const back = Math.min(L, SHADOW);
      tracks[p.id] = track([[p.x, p.y], [t.x - (dx / L) * back, t.y - (dy / L) * back]], t.id);
      continue;
    }
    const pts = routeYards(p, players, top);
    if (pts) tracks[p.id] = track(pts);
  }
  const run = cl(Object.values(tracks).reduce((m, t) => Math.max(m, t.len), 0) / SPEED, 1, 4.5);

  const qb = quarterback(players);
  const center =
    players.find((p) => p.team === "offense" && p.label === "C") ??
    players.find((p) => p.id === "o1" && p.team === "offense");
  const receiver = players.find((p) => p.team === "offense" && p.route?.primary && p.id !== qb?.id) ?? null;

  const m: Motion = {
    dur: run + HOLD,
    tracks,
    center: center && center.id !== qb?.id ? center.id : null,
    qb: qb?.id ?? null,
    receiver: receiver?.id ?? null,
    throwAt: Infinity,
    catchAt: Infinity,
  };
  if (qb && receiver) {
    // throw once the receiver is most of the way through the route, then lead them
    const rt = tracks[receiver.id];
    const arrive = rt ? rt.len / SPEED : 0;
    m.throwAt = Math.max(SNAP + 0.15, Math.min(arrive * 0.7, run));
    const guess = positionsAt(m, players, m.throwAt + 0.6)[receiver.id] ?? receiver;
    const flight = cl(Math.hypot(guess.x - qb.x, guess.y - qb.y) / 16, 0.35, 1.1);
    m.catchAt = m.throwAt + flight;
    m.dur = Math.max(run, m.catchAt + 0.5) + HOLD;
  }
  return m;
}

/** Every player's spot `t` seconds into the play (players without a route stay put). */
export function positionsAt(m: Motion, players: readonly Player[], t: number): Record<string, Pt> {
  const pos: Record<string, Pt> = {};
  const runFor = Math.max(0, t);
  // offense first: man defenders shadow where their receiver is right now
  for (const p of players) {
    const tr = m.tracks[p.id];
    if (p.team === "offense") pos[p.id] = tr ? along(tr, runFor) : { x: p.x, y: p.y };
  }
  for (const p of players) {
    if (p.team === "offense") continue;
    const tr = m.tracks[p.id];
    if (!tr) { pos[p.id] = { x: p.x, y: p.y }; continue; }
    const at = along(tr, runFor);
    const target = tr.target ? players.find((q) => q.id === tr.target) : undefined;
    const now = target ? pos[target.id] : undefined;
    if (target && now) {
      // close on the receiver's starting spot, then stick with them wherever they go
      const closing = tr.len > 0 ? cl((runFor * SPEED) / tr.len, 0, 1) : 1;
      pos[p.id] = { x: at.x + (now.x - target.x) * closing, y: at.y + (now.y - target.y) * closing };
    } else {
      pos[p.id] = at;
    }
  }
  return pos;
}

/** Where the ball is `t` seconds in: snapped, held, thrown in an arc, then caught. */
export function ballAt(m: Motion, pos: Record<string, Pt>, t: number): Ball | null {
  const qb = m.qb ? pos[m.qb] : undefined;
  const c = m.center ? pos[m.center] : undefined;
  if (!qb) return c ? { ...c, lift: 0 } : null;
  if (c && t < SNAP) {
    const k = cl(t / SNAP, 0, 1);
    return { x: c.x + (qb.x - c.x) * k, y: c.y + (qb.y - c.y) * k, lift: 0 };
  }
  const rcv = m.receiver ? pos[m.receiver] : undefined;
  if (!rcv || t < m.throwAt) return { ...qb, lift: 0 };
  if (t >= m.catchAt) return { ...rcv, lift: 0 };
  const k = (t - m.throwAt) / (m.catchAt - m.throwAt);
  return { x: qb.x + (rcv.x - qb.x) * k, y: qb.y + (rcv.y - qb.y) * k, lift: Math.sin(Math.PI * k) };
}

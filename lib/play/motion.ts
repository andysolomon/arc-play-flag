import { quarterback, routeYards } from "./geometry";
import { isRun } from "./routes";
import type { Pair, Player, Pt } from "./types";
import { zoneLayout } from "./zones";

/** Yards per second a player covers during playback — brisk, but slow enough to read. */
export const SPEED = 6.5;
/** How long the play holds at the end before everyone jogs back to their spots. */
export const HOLD = 0.8;
/** Yards a man defender keeps between themself and the receiver: one token's width. */
export const SHADOW = 2.2;
/** How long a delay runner waits at the snap before going. */
export const DELAY = 0.8;
/** How often the quarterback throws to the primary read when one is marked. */
export const PRIMARY_ODDS = 0.8;
/** A play-action fake takes this long to sell. */
const FAKE = 0.25;

interface Track {
  pts: Pt[];
  /** cumulative yards at each waypoint */
  cum: number[];
  len: number;
  /** seconds to wait at the snap before running */
  wait: number;
  /** man coverage: the offensive player being shadowed */
  target?: string;
}

export type PlayKind = "run" | "pass" | "hold";

export interface Motion {
  /** total playback length in seconds, hold included */
  dur: number;
  tracks: Record<string, Track>;
  kind: PlayKind;
  /** who snaps the ball and who takes it */
  center: string | null;
  qb: string | null;
  /** how long the snap takes, and whether it flies (shotgun) */
  snapAt: number;
  shotgun: boolean;
  /** run: the ball carrier; play-action pass: the runner the QB fakes to */
  runner: string | null;
  /** when the runner meets the quarterback, and how long the exchange takes */
  handAt: number;
  handFor: number;
  /** pass: who the ball is thrown to */
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
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Pt, b: Pt, k: number): Pt => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

function track(pts: readonly Pair[], wait = 0, target?: string): Track {
  const out: Pt[] = [];
  for (const q of pts) {
    const l = out[out.length - 1];
    if (!l || Math.abs(l.x - q[0]) > 0.01 || Math.abs(l.y - q[1]) > 0.01) out.push({ x: q[0], y: q[1] });
  }
  const cum = [0];
  for (let i = 1; i < out.length; i++) {
    const a = out[i - 1], b = out[i];
    if (a && b) cum.push((cum[i - 1] ?? 0) + dist(a, b));
  }
  return { pts: out, cum, len: cum[cum.length - 1] ?? 0, wait, target };
}

/** Where along a track a player is `d` yards in. */
function at(t: Track, d: number): Pt {
  const first = t.pts[0];
  if (!first) return { x: 15, y: 0 };
  const dd = cl(d, 0, t.len);
  for (let i = 1; i < t.pts.length; i++) {
    const c0 = t.cum[i - 1] ?? 0, c1 = t.cum[i] ?? 0;
    if (dd <= c1) {
      const a = t.pts[i - 1], b = t.pts[i];
      if (!a || !b) break;
      return lerp(a, b, c1 - c0 > 0 ? (dd - c0) / (c1 - c0) : 1);
    }
  }
  return t.pts[t.pts.length - 1] ?? first;
}

/** Where along a track a player is after `s` seconds. */
const along = (t: Track, s: number): Pt => at(t, (s - t.wait) * SPEED);

/** Seconds until a runner is closest to the quarterback, and how far away they still are. */
function meshPoint(t: Track, qb: Pt): { at: number; gap: number } {
  let best = 0, gap = Infinity;
  for (let d = 0; d <= t.len; d += 0.1) {
    const g = dist(at(t, d), qb);
    if (g < gap) { gap = g; best = d; }
  }
  return { at: t.wait + best / SPEED, gap };
}

const pickOne = <T>(list: readonly T[], rand: () => number): T | undefined =>
  list[Math.min(list.length - 1, Math.floor(rand() * list.length))];

/**
 * Plan a playback from the committed play. Every routed player gets a track in yards.
 * The centre snaps to the quarterback; a run route makes it a run (the ball is handed
 * or tossed at the mesh point), otherwise it's a pass to one of the receivers — the
 * primary read most of the time — with a play-action fake when a runner is in the mix.
 * `rand` decides the coin flips, so tests can pin them.
 */
export function buildMotion(players: readonly Player[], top: number, rand: () => number = Math.random): Motion {
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
      tracks[p.id] = track([[p.x, p.y], [t.x - (dx / L) * back, t.y - (dy / L) * back]], 0, t.id);
      continue;
    }
    const pts = routeYards(p, players, top);
    if (pts) tracks[p.id] = track(pts, p.route.type === "delay" ? DELAY : 0);
  }
  const run = cl(Object.values(tracks).reduce((m, t) => Math.max(m, t.wait + t.len / SPEED), 0), 1, 5);

  const qb = quarterback(players);
  const center =
    players.find((p) => p.team === "offense" && p.label === "C") ??
    players.find((p) => p.id === "o1" && p.team === "offense");
  const snapGap = qb && center && center.id !== qb.id ? dist(qb, center) : 0;

  const m: Motion = {
    dur: run + HOLD,
    tracks,
    kind: "hold",
    center: center && center.id !== qb?.id ? center.id : null,
    qb: qb?.id ?? null,
    snapAt: cl(snapGap / 10, 0.12, 0.45),
    shotgun: snapGap > 2,
    runner: null, handAt: Infinity, handFor: 0,
    receiver: null, throwAt: Infinity, catchAt: Infinity,
  };
  if (!qb) return m;

  const offense = players.filter((p) => p.team === "offense" && p.route && tracks[p.id]);
  const runners = offense.filter((p) => p.route && isRun(p.route.type));
  const receivers = offense.filter((p) => p.route && !isRun(p.route.type) && p.id !== qb.id);
  const primary = offense.find((p) => p.route?.primary);
  const primaryRun = primary?.route ? isRun(primary.route.type) : false;

  // the call: a run when the run is the read or there's nobody to throw to; a coin flip
  // when both are on the board and nothing is marked
  const isRunPlay =
    runners.length > 0 && (primaryRun || receivers.length === 0 || (!primary && rand() < 0.5));
  const runner = isRunPlay && primaryRun ? primary : runners.length > 0 ? pickOne(runners, rand) : undefined;
  if (runner) {
    m.runner = runner.id;
    const tr = tracks[runner.id];
    if (runner.id === qb.id || !tr) {
      m.handAt = m.snapAt;
    } else {
      const mesh = meshPoint(tr, qb);
      m.handAt = Math.max(m.snapAt, mesh.at);
      m.handFor = mesh.gap > 1.5 ? cl(mesh.gap / 12, 0.2, 0.5) : 0.12;
    }
  }
  if (isRunPlay) {
    m.kind = "run";
    return m;
  }
  if (receivers.length === 0) return m;

  // the throw: the primary read most of the time, otherwise anyone who's out in a route
  m.kind = "pass";
  const others = receivers.filter((p) => p.id !== primary?.id);
  const receiver =
    primary && !primaryRun && (others.length === 0 || rand() < PRIMARY_ODDS) ? primary : pickOne(others, rand);
  if (!receiver) return m;
  m.receiver = receiver.id;
  const rt = tracks[receiver.id];
  const arrive = rt ? rt.wait + rt.len / SPEED : 0;
  m.throwAt = Math.max(m.snapAt + 0.15, Math.min(arrive * 0.7, run), runner ? m.handAt + FAKE + 0.1 : 0);
  // lead the receiver: aim where they'll be when the ball gets there
  const guess = positionsAt(m, players, m.throwAt + 0.6)[receiver.id] ?? receiver;
  const flight = cl(dist(guess, qb) / 16, 0.35, 1.1);
  m.catchAt = m.throwAt + flight;
  m.dur = Math.max(run, m.catchAt + 0.5) + HOLD;
  return m;
}

/** Every player's spot `t` seconds into the play (players without a route stay put). */
export function positionsAt(m: Motion, players: readonly Player[], t: number): Record<string, Pt> {
  const pos: Record<string, Pt> = {};
  const s = Math.max(0, t);
  // offense first: man defenders shadow where their receiver is right now
  for (const p of players) {
    const tr = m.tracks[p.id];
    if (p.team === "offense") pos[p.id] = tr ? along(tr, s) : { x: p.x, y: p.y };
  }
  for (const p of players) {
    if (p.team === "offense") continue;
    const tr = m.tracks[p.id];
    if (!tr) { pos[p.id] = { x: p.x, y: p.y }; continue; }
    const here = along(tr, s);
    const target = tr.target ? players.find((q) => q.id === tr.target) : undefined;
    const now = target ? pos[target.id] : undefined;
    if (target && now) {
      // close on the receiver's starting spot, then stick with them wherever they go
      const closing = tr.len > 0 ? cl((s * SPEED) / tr.len, 0, 1) : 1;
      pos[p.id] = { x: here.x + (now.x - target.x) * closing, y: here.y + (now.y - target.y) * closing };
    } else {
      pos[p.id] = here;
    }
  }
  return pos;
}

/** Where the ball is `t` seconds in: snapped, handed or faked, thrown in an arc, then caught. */
export function ballAt(m: Motion, pos: Record<string, Pt>, t: number): Ball | null {
  const qb = m.qb ? pos[m.qb] : undefined;
  const c = m.center ? pos[m.center] : undefined;
  if (!qb) return c ? { ...c, lift: 0 } : null;
  if (c && t < m.snapAt) {
    const k = cl(t / m.snapAt, 0, 1);
    return { ...lerp(c, qb, k), lift: m.shotgun ? 0.45 * Math.sin(Math.PI * k) : 0 };
  }
  const runner = m.runner ? pos[m.runner] : undefined;
  if (m.kind === "run" && runner) {
    if (t < m.handAt) return { ...qb, lift: 0 };
    if (t >= m.handAt + m.handFor) return { ...runner, lift: 0 };
    const k = (t - m.handAt) / m.handFor;
    return { ...lerp(qb, runner, k), lift: m.handFor > 0.15 ? 0.4 * Math.sin(Math.PI * k) : 0 };
  }
  if (runner && Math.abs(t - m.handAt) < FAKE) {
    // play-action: the ball dips toward the runner and comes right back
    const k = 1 - Math.abs(t - m.handAt) / FAKE;
    return { ...lerp(qb, runner, 0.6 * k), lift: 0 };
  }
  const rcv = m.receiver ? pos[m.receiver] : undefined;
  if (!rcv || t < m.throwAt) return { ...qb, lift: 0 };
  if (t >= m.catchAt) return { ...rcv, lift: 0 };
  const k = (t - m.throwAt) / (m.catchAt - m.throwAt);
  return { ...lerp(qb, rcv, k), lift: Math.sin(Math.PI * k) };
}

import { quarterback, routeYards } from "./geometry";
import { chainLinks, type Link } from "./lateral";
import { isBallJob, isRun } from "./routes";
import { atSnap, motionPoints } from "./pre-snap";
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
/** How often live playback throws to the primary read when one is marked. */
export const PRIMARY_ODDS = 0.8;
/** A play-action fake takes this long to sell. */
const FAKE = 0.25;
/** How long a carrier takes to set their feet before throwing. */
const SET_UP = 0.2;
/** How long a carrier holds a lateral they've caught before tossing it on. */
const BEAT = 0.15;
/** A lateral is a low toss: the top of its arc, as a share of a thrown ball's. */
const TOSS_LIFT = 0.3;

interface Track {
  pts: Pt[];
  /** cumulative yards at each waypoint */
  cum: number[];
  len: number;
  /** seconds to wait at the snap before running */
  wait: number;
  /** man coverage: the offensive player being shadowed */
  target?: string;
  /**
   * a lateral chain's carrier: in order, they stop `d` yards in (where they stand, or a catch) until
   * `until` seconds after the snap, waiting for the ball or holding it until they toss it on, then go on
   */
  holds?: Hold[];
}

interface Hold {
  d: number;
  until: number;
}

/**
 * One lateral in playback: let go from `release` at `at`, and caught at the catch point at `land`. The
 * ball flies between those two fixed points. Ways it could go wrong:
 * - T1 the thrower moves on once it's gone (a quarterback drifting back to take it again) and drags the
 *   ball in the air with them: it would bow off its line, and a level toss would dip deeper and back.
 * - T2 the ball leaves from somewhere other than the thrower's hands: `release` is where they hold it, at
 *   their spot or their catch, the same point the arc on the field is drawn from.
 */
export interface Toss {
  from: string;
  to: string;
  at: number;
  land: number;
  release: Pt;
  catch: Pt;
}

export type PlayKind = "run" | "pass" | "hold";

export interface Motion {
  /** Seconds before the snap begins, and the independent pre-snap paths. */
  preSnapFor?: number;
  preSnapTracks?: Record<string, Track>;
  /** total playback length in seconds, hold included */
  dur: number;
  /** the card's top edge the play was laid out against: the end line once the ball is near their goal */
  top: number;
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
  /** each lateral in the chain, in order (lib/play/lateral.ts); none on a play without one */
  laterals: Toss[];
  /** pass: who throws it — the quarterback, or the last carrier of a lateral chain */
  passer: string | null;
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

/**
 * Teaching playback demonstrates the drawn read consistently, so it always shows the play
 * as drawn. Simulation playback is what the ▶ button runs: the
 * primary read gets the ball `PRIMARY_ODDS` of the time and the other drawn receivers share
 * the rest, using the supplied random source so tests can pin the flips.
 */
export type PlaybackMode =
  | { kind: "teaching" }
  | { kind: "simulation"; random: () => number };

const TEACHING_PLAYBACK: PlaybackMode = { kind: "teaching" };

/** Opt into probabilistic outcomes, with an injectable source for reproducible tests. */
export const simulationPlayback = (random: () => number): PlaybackMode => ({ kind: "simulation", random });

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

/** How far along a track a player is after `s` seconds, stopping at each hold until it ends. */
function distAt(t: Track, s: number): number {
  let time = t.wait, d = 0;
  for (const h of t.holds ?? []) {
    const arrive = time + (h.d - d) / SPEED;
    if (s < arrive) return d + (s - time) * SPEED;
    time = Math.max(arrive, h.until);
    d = h.d;
    if (s < time) return d;
  }
  return d + (s - time) * SPEED;
}

/** Where along a track a player is after `s` seconds. */
const along = (t: Track, s: number): Pt => at(t, distAt(t, s));

/** Seconds after the snap a track's player reaches one of its holds, every hold before it kept. */
function reach(t: Track, stop: Hold): number {
  let time = t.wait, d = 0;
  for (const h of t.holds ?? []) {
    const arrive = time + (h.d - d) / SPEED;
    if (h === stop) return arrive;
    time = Math.max(arrive, h.until);
    d = h.d;
  }
  return time + (stop.d - d) / SPEED;
}

/** Seconds after the snap a track is run to its end, every hold included. */
function endOf(t: Track): number {
  let time = t.wait, d = 0;
  for (const h of t.holds ?? []) {
    time = Math.max(time + (h.d - d) / SPEED, h.until);
    d = h.d;
  }
  return time + (t.len - d) / SPEED;
}

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
 * primary read when one is marked: always in teaching mode, `PRIMARY_ODDS` of the time in
 * simulation — with a play-action fake when a runner is in the mix. A lateral chain runs
 * each toss in order after the snap, then the last carrier sets up and throws or keeps it
 * (see chainPlay). The teaching default is deterministic; simulation mode enables the coin flips.
 */
export function buildMotion(
  players: readonly Player[],
  top: number,
  mode: PlaybackMode = TEACHING_PLAYBACK,
): Motion {
  const preSnapTracks: Record<string, Track> = {};
  for (const p of players) {
    const pts = motionPoints(p);
    if (pts.length) preSnapTracks[p.id] = track([[p.x, p.y], ...pts]);
  }
  const preSnapFor = Object.values(preSnapTracks).reduce((n, tr) => Math.max(n, tr.len / SPEED), 0);
  const m = buildAfterSnap(players.map(atSnap), top, mode);
  if (!preSnapFor) return m;
  return { ...m, preSnapFor, preSnapTracks, dur: m.dur + preSnapFor,
    snapAt: m.snapAt + preSnapFor, handAt: m.handAt + preSnapFor,
    throwAt: m.throwAt + preSnapFor, catchAt: m.catchAt + preSnapFor,
    laterals: m.laterals.map((l) => ({ ...l, at: l.at + preSnapFor, land: l.land + preSnapFor })) };
}

function buildAfterSnap(players: readonly Player[], top: number, mode: PlaybackMode): Motion {
  const random = mode.kind === "simulation" ? mode.random : null;
  const zones = zoneLayout(players, top);
  const tracks: Record<string, Track> = {};
  const links = chainLinks(players);
  const tosses = chainTracks(links, players, top, tracks);
  for (const p of players) {
    if (!p.route || tracks[p.id]) continue;
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
    top,
    tracks,
    kind: "hold",
    center: center && center.id !== qb?.id ? center.id : null,
    qb: qb?.id ?? null,
    snapAt: cl(snapGap / 10, 0.12, 0.45),
    shotgun: snapGap > 2,
    runner: null, handAt: Infinity, handFor: 0, laterals: [],
    passer: qb?.id ?? null, receiver: null, throwAt: Infinity, catchAt: Infinity,
  };
  if (!qb) return m;
  if (links.length) return chainPlay(m, players, tracks, links, tosses, random, run);

  const offense = players.filter((p) => p.team === "offense" && p.route && tracks[p.id]);
  const runners = offense.filter((p) => p.route && isRun(p.route.type));
  const receivers = offense.filter((p) => p.route && !isRun(p.route.type) && !isBallJob(p.route.type) && p.id !== qb.id);
  const primary = offense.find((p) => p.route?.primary);
  const primaryRun = primary?.route ? isRun(primary.route.type) : false;

  // The teaching call follows the marked read. An unmarked mixed call demonstrates the
  // pass with its run action; only explicitly requested simulation flips between outcomes.
  const isRunPlay =
    runners.length > 0 && (primaryRun || receivers.length === 0 || (!primary && random !== null && random() < 0.5));
  const runner = isRunPlay && primaryRun
    ? primary
    : runners.length > 0
      ? random ? pickOne(runners, random) : runners[0]
      : undefined;
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

  // a quarterback on a throw route rolls out to the set point and throws from there
  const rollout = qb.route?.type === "throw" ? tracks[qb.id] : undefined;
  const setAt = rollout ? endOf(rollout) + SET_UP : 0;

  // Teaching always throws to the marked read, or the first drawn receiver when no read
  // is marked. Simulation throws to the marked read PRIMARY_ODDS of the time and spreads
  // the rest over the other drawn receivers.
  m.kind = "pass";
  const others = receivers.filter((p) => p.id !== primary?.id);
  const receiver = primary && !primaryRun
    ? !random || others.length === 0 || random() < PRIMARY_ODDS ? primary : pickOne(others, random)
    : random ? pickOne(receivers, random) : receivers[0];
  if (!receiver) return m;
  m.receiver = receiver.id;
  const rt = tracks[receiver.id];
  const arrive = rt ? rt.wait + rt.len / SPEED : 0;
  m.throwAt = Math.max(m.snapAt + 0.15, Math.min(arrive * 0.7, run), runner ? m.handAt + FAKE + 0.1 : 0, setAt);
  // lead the receiver: aim where they'll be when the ball gets there
  const guess = positionsAt(m, players, m.throwAt + 0.6)[receiver.id] ?? receiver;
  const from = (m.passer ? positionsAt(m, players, m.throwAt)[m.passer] : undefined) ?? qb;
  const flight = cl(dist(guess, from) / 16, 0.35, 1.1);
  m.catchAt = m.throwAt + flight;
  m.dur = Math.max(run, m.catchAt + 0.5) + HOLD;
  return m;
}

/** For each lateral in order: the hold where its thrower has it, and the hold at its catch. */
interface TossHolds {
  from: Hold;
  to: Hold;
}

/**
 * Every carrier's track on a lateral chain: from their spot to each catch that is theirs in turn, with a
 * hold at each (and at the quarterback's spot, which they toss it from first), then, for the last carrier,
 * their job from the last catch. The holds' ends are set once the tosses are timed (chainPlay).
 */
function chainTracks(links: readonly Link[], players: readonly Player[], top: number, tracks: Record<string, Track>): TossHolds[] {
  const legs = new Map<string, { pts: Pair[]; len: number; holds: Hold[] }>();
  const leg = (p: Player) => {
    const known = legs.get(p.id);
    if (known) return known;
    const fresh = { pts: [[p.x, p.y] as Pair], len: 0, holds: [] as Hold[] };
    legs.set(p.id, fresh);
    return fresh;
  };
  // the hold where each carrier has it now
  const now = new Map<string, Hold>();
  const out: TossHolds[] = [];
  for (const l of links) {
    let from = now.get(l.from.id);
    if (!from) {
      from = { d: 0, until: 0 };
      leg(l.from).holds.push(from);
    }
    const target = leg(l.to);
    const prev = target.pts[target.pts.length - 1] ?? l.catch;
    target.len += Math.hypot(l.catch[0] - prev[0], l.catch[1] - prev[1]);
    target.pts.push(l.catch);
    const to = { d: target.len, until: 0 };
    target.holds.push(to);
    now.set(l.to.id, to);
    out.push({ from, to });
  }
  const last = links[links.length - 1]?.to;
  if (last) leg(last).pts.push(...(routeYards(last, players, top) ?? []));
  for (const [id, l] of legs) tracks[id] = { ...track(l.pts), holds: l.holds };
  return out;
}

/**
 * A lateral chain after the snap. Each toss leaves its carrier a beat after they have it, timed so it
 * lands as the target gets to the catch (they drift there from the snap, or from where they last let it
 * go when it comes back to them), and goes low and backward. Then the last carrier throws (they set up
 * behind the line and hit the read, never a carrier), keeps it (a run, from the catch), or, with no job
 * yet, just holds it. Everyone off the chain runs their route from the snap.
 */
function chainPlay(
  m: Motion, players: readonly Player[], tracks: Record<string, Track>, links: readonly Link[], holds: readonly TossHolds[],
  random: (() => number) | null, run: number,
): Motion {
  let held = m.snapAt;
  links.forEach((l, i) => {
    const h = holds[i];
    const tr = tracks[l.to.id];
    const arrive = tr && h ? reach(tr, h.to) : 0;
    const flight = cl(Math.hypot(l.catch[0] - l.release[0], l.catch[1] - l.release[1]) / 12, 0.3, 0.8);
    const at = Math.max(held + BEAT, arrive - flight);
    const land = at + flight;
    // the thrower holds it until it leaves; the target waits at the catch until it's theirs
    if (h) {
      h.from.until = at;
      h.to.until = land;
    }
    m.laterals.push({ from: l.from.id, to: l.to.id, at, land, release: { x: l.release[0], y: l.release[1] }, catch: { x: l.catch[0], y: l.catch[1] } });
    held = land;
  });
  const last = links[links.length - 1]?.to;
  if (!last) return m;
  const carried = tracks[last.id];
  const done = carried ? endOf(carried) : held;
  const job = last.route;
  m.runner = null;
  m.passer = last.id;
  if (job && isRun(job.type)) {
    m.kind = "run";
    m.runner = last.id;
    m.handAt = held;
    m.dur = Math.max(run, done, held + 0.5) + HOLD;
    return m;
  }
  m.kind = "hold";
  m.dur = Math.max(run, done, held + 0.5) + HOLD;
  if (job?.type !== "throw") return m;

  const chain = new Set([links[0]?.from.id, ...links.map((l) => l.to.id)]);
  const receivers = players.filter((p) =>
    p.team === "offense" && p.route && tracks[p.id] && !chain.has(p.id) && !isRun(p.route.type) && !isBallJob(p.route.type));
  if (!receivers.length) return m;
  m.kind = "pass";
  const primary = receivers.find((p) => p.route?.primary);
  const others = receivers.filter((p) => p.id !== primary?.id);
  const receiver = primary
    ? !random || others.length === 0 || random() < PRIMARY_ODDS ? primary : pickOne(others, random)
    : random ? pickOne(receivers, random) : receivers[0];
  if (!receiver) return m;
  m.receiver = receiver.id;
  const rt = tracks[receiver.id];
  const arrive = rt ? endOf(rt) : 0;
  m.throwAt = Math.max(held + 0.15, done + SET_UP, Math.min(arrive * 0.7, run));
  const guess = positionsAt(m, players, m.throwAt + 0.6)[receiver.id] ?? receiver;
  const from = positionsAt(m, players, m.throwAt)[last.id] ?? last;
  m.catchAt = m.throwAt + cl(dist(guess, from) / 16, 0.35, 1.1);
  m.dur = Math.max(run, done, m.catchAt + 0.5) + HOLD;
  return m;
}

/** Every player's spot `t` seconds into the play (players without a route stay put). */
export function positionsAt(m: Motion, players: readonly Player[], t: number): Record<string, Pt> {
  const pos: Record<string, Pt> = {};
  const preSnapFor = m.preSnapFor ?? 0;
  if (t < preSnapFor) {
    for (const p of players) {
      const tr = m.preSnapTracks?.[p.id];
      pos[p.id] = tr ? along(tr, Math.max(0, t)) : { x: p.x, y: p.y };
    }
    return pos;
  }
  const s = Math.max(0, t - preSnapFor);
  players = players.map(atSnap);
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
      // trailing a deep route, they stop where a drag would, short of the card's top (the end line near their goal)
      pos[p.id] = { x: here.x + (now.x - target.x) * closing, y: Math.max(m.top + 1.2, here.y + (now.y - target.y) * closing) };
    } else {
      pos[p.id] = here;
    }
  }
  return pos;
}

/**
 * Where the ball is `t` seconds in: snapped, handed or faked, thrown in an arc, then
 * caught. On a lateral chain it is tossed back, low, to each catch point in turn, and
 * thrown (or carried) from the last carrier's hands.
 */
export function ballAt(m: Motion, pos: Record<string, Pt>, t: number): Ball | null {
  const qb = m.qb ? pos[m.qb] : undefined;
  const c = m.center ? pos[m.center] : undefined;
  const preSnapFor = m.preSnapFor ?? 0;
  if (t < preSnapFor) return c ? { ...c, lift: 0 } : qb ? { ...qb, lift: 0 } : null;
  if (!qb) return c ? { ...c, lift: 0 } : null;
  if (c && t < m.snapAt) {
    const k = cl((t - preSnapFor) / (m.snapAt - preSnapFor), 0, 1);
    return { ...lerp(c, qb, k), lift: m.shotgun ? 0.45 * Math.sin(Math.PI * k) : 0 };
  }
  const runner = m.runner ? pos[m.runner] : undefined;
  if (m.laterals.length) {
    for (const l of m.laterals) {
      if (t < l.at) return { ...(pos[l.from] ?? qb), lift: 0 };
      if (t < l.land) {
        // from where it was let go (T1): the thrower may already be on their way to take it again
        const k = (t - l.at) / (l.land - l.at);
        return { ...lerp(l.release, l.catch, k), lift: TOSS_LIFT * Math.sin(Math.PI * k) };
      }
    }
    const last = m.laterals[m.laterals.length - 1];
    const carrier = last ? pos[last.to] : undefined;
    if (m.kind !== "pass") return carrier ? { ...carrier, lift: 0 } : null;
  } else if (runner && m.kind === "run") {
    if (t < m.handAt) return { ...qb, lift: 0 };
    if (t < m.handAt + m.handFor) {
      const k = (t - m.handAt) / m.handFor;
      return { ...lerp(qb, runner, k), lift: m.handFor > 0.15 ? 0.4 * Math.sin(Math.PI * k) : 0 };
    }
    return { ...runner, lift: 0 };
  } else if (runner && Math.abs(t - m.handAt) < FAKE) {
    // play-action: the ball dips toward the runner and comes right back
    const k = 1 - Math.abs(t - m.handAt) / FAKE;
    return { ...lerp(qb, runner, 0.6 * k), lift: 0 };
  }
  const from = (m.passer ? pos[m.passer] : undefined) ?? qb;
  const rcv = m.receiver ? pos[m.receiver] : undefined;
  if (!rcv || t < m.throwAt) return { ...from, lift: 0 };
  if (t >= m.catchAt) return { ...rcv, lift: 0 };
  const k = (t - m.throwAt) / (m.catchAt - m.throwAt);
  return { ...lerp(from, rcv, k), lift: Math.sin(Math.PI * k) };
}

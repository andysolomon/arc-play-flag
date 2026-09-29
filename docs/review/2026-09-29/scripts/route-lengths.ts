import { routeYards } from "/home/user/arc-play-flag/lib/play/geometry";
import { defaults, ROUTES } from "/home/user/arc-play-flag/lib/play/routes";
const players = defaults();
const top = 8 - 45;
const out: string[] = [];
for (const who of ["o3", "o4", "o5", "o1"]) {
  const base = players.find(p => p.id === who)!;
  for (const type of ["out", "corner", "wheel", "flat", "go", "slant", "post", "in"] as const) {
    const p = { ...base, route: { type } };
    const pts = routeYards(p as any, players, top)!;
    const design = ROUTES[type].pts!;
    const dLen = design.reduce((s, q, i) => i ? s + Math.hypot(q[0]-design[i-1][0], q[1]-design[i-1][1]) : 0, 0);
    const len = pts.reduce((s, q, i) => i ? s + Math.hypot(q[0]-pts[i-1][0], q[1]-pts[i-1][1]) : 0, 0);
    const depth = Math.min(...pts.map(q => q[1])) - p.y;
    out.push(`${base.label.padEnd(2)} x=${String(base.x).padEnd(2)} ${type.padEnd(7)} length ${len.toFixed(1).padStart(5)} of ${dLen.toFixed(1).padStart(5)} yds (${Math.round(100*len/dLen)}%) depth ${(-depth).toFixed(1)} end=${pts.at(-1)!.map(v=>v.toFixed(1)).join(',')}`);
  }
}
console.log(out.join("\n"));

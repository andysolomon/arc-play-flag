import { px, py } from "@/lib/play/geometry";
import { buildMotion } from "@/lib/play/motion";
import type { BallStep, Player } from "@/lib/play/types";

/** Numbered dashed ball paths, distinct from solid movement routes, shared by every picture. */
export function ballPlanArt(players: readonly Player[], steps: readonly BallStep[] | undefined, top: number, highlight: string | null = null): string {
  if (!steps?.length) return "";
  const motion = buildMotion(players, top, undefined, steps);
  const keys = motion.exchanges.map(e => {
    const a = e.from < e.to ? e.fromPt : e.toPt, b = e.from < e.to ? e.toPt : e.fromPt;
    return `${e.type}/${[e.from, e.to].sort().join("/")}/${a.x.toFixed(1)},${a.y.toFixed(1)}/${b.x.toFixed(1)},${b.y.toFixed(1)}`;
  });
  const groups = new Map<string, number[]>();
  keys.forEach((key, i) => {
    const numbers = groups.get(key) ?? [];
    numbers.push(i + 1);
    groups.set(key, numbers);
  });
  const seen = new Map<string, number>();
  return motion.exchanges.map((e, i) => {
    const key = keys[i] ?? "";
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    const numbers = groups.get(key) ?? [i + 1];
    // Repeated transfers along the same path share a readable range, rather than
    // piling sixteen badges on top of two adjacent player tokens.
    const consecutive = numbers.every((n, j) => j === 0 || n === (numbers[j - 1] ?? 0) + 1);
    const fullLabel = numbers.length > 1 && consecutive ? `${String(numbers[0])}–${String(numbers.at(-1))}` : numbers.join(",");
    const label = fullLabel.length > 12 ? `${fullLabel.slice(0, 10)}…` : fullLabel;
    const a = { x: px(e.fromPt.x), y: py(e.fromPt.y, top) };
    const b = { x: px(e.toPt.x), y: py(e.toPt.y, top) };
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const tip = { x: b.x - ux * 10, y: b.y - uy * 10 };
    const base = { x: tip.x - ux * 12, y: tip.y - uy * 12 };
    const f = (n: number) => n.toFixed(1);
    const point = (x: number, y: number) => `${f(x)},${f(y)}`;
    const badgeX = (a.x + b.x) / 2, badgeY = (a.y + b.y) / 2 - 15;
    const badgeWidth = Math.max(22, label.length * 8 + 12);
    const faded = highlight && highlight !== e.from && highlight !== e.to ? ' opacity="0.28"' : "";
    return `<g data-ball-step="${String(i + 1)}" pointer-events="none"${faded}><title>${String(i + 1)}: ${e.type === "pass" ? "Forward pass" : "Lateral"}</title>` +
      `<path d="M${point(a.x, a.y)} L${point(b.x, b.y)}" fill="none" stroke="#1b1a17" stroke-width="3" stroke-dasharray="5 6"/>` +
      `<polygon points="${point(tip.x, tip.y)} ${point(base.x - uy * 5, base.y + ux * 5)} ${point(base.x + uy * 5, base.y - ux * 5)}" fill="#1b1a17"/>` +
      (nth === 1 ? `<g><title>Ball steps ${fullLabel}</title><rect x="${f(badgeX - badgeWidth / 2)}" y="${f(badgeY - 11)}" width="${f(badgeWidth)}" height="22" rx="11" fill="#f2b705" stroke="#1b1a17" stroke-width="2"/>` +
      `<text x="${f(badgeX)}" y="${f(badgeY)}" text-anchor="middle" dominant-baseline="central" font-size="14" fill="#1b1a17">${label}</text></g>` : "") + "</g>";
  }).join("");
}

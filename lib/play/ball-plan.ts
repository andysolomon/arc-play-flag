import { quarterback } from "./geometry";
import type { BallStep, Player } from "./types";

/** No cap on the number of exchanges. Never drop an individual step and change its source. */
export function readBallPlan(raw: unknown): { ballPlan?: BallStep[] } {
  if (!Array.isArray(raw) || !raw.length) return {};
  const ballPlan: BallStep[] = [];
  for (const v of raw as unknown[]) {
    if (!v || typeof v !== "object" || !("type" in v) || !("target" in v) || !("delay" in v)
      || (v.type !== "lateral" && v.type !== "pass") || typeof v.target !== "string" || v.target.length > 40
      || typeof v.delay !== "number" || !Number.isFinite(v.delay) || v.delay < 0) return {};
    ballPlan.push({ type: v.type, target: v.target, delay: v.delay });
  }
  return { ballPlan };
}

/** Carrier at the end of the written list; repeated recipients, including QB, are allowed. */
export function finalCarrier(players: readonly Player[], steps: readonly BallStep[]): string | null {
  return steps.at(-1)?.target ?? quarterback(players)?.id ?? null;
}

export function ballPlanLine(players: readonly Player[], steps: readonly BallStep[]): string | null {
  if (!steps.length) return null;
  const who = (id: string | null): string => players.find(p => p.id === id)?.label || id || "QB";
  let from = quarterback(players)?.id ?? null;
  const words = steps.map(s => {
    const line = `${who(from)} ${s.type === "pass" ? "forward pass" : "lateral"} to ${who(s.target)}`;
    from = s.target;
    return line;
  });
  if (steps.at(-1)?.type !== "pass") words.push(`${who(from)} keeps it`);
  return `Ball: ${words.join("; ")}.`;
}

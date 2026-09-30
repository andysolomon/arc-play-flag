"use client";

import { ballPlanLine, finalCarrier } from "@/lib/play/ball-plan";
import { quarterback } from "@/lib/play/geometry";
import { buildMotion } from "@/lib/play/motion";
import type { BallStep, Player } from "@/lib/play/types";
import { input, pill } from "./ui";

interface Props {
  players: readonly Player[];
  ballPlan?: BallStep[];
  onChange: (steps: BallStep[]) => void;
}

/** Ball jobs are separate from movement routes: any carrier can lateral or pass. */
export function BallAssignments({ players, ballPlan, onChange }: Props) {
  const steps = ballPlan ?? [];
  const offense = players.filter(p => p.team === "offense");
  const carrier = finalCarrier(players, steps);
  const passed = steps.some(s => s.type === "pass");
  const error = steps.length ? buildMotion(players, -37, undefined, steps).ballError : null;
  const add = (type: BallStep["type"]) => {
    const from = offense.find(p => p.id === carrier);
    const candidates = offense.filter(p => p.id !== carrier);
    const target = type === "pass"
      ? candidates.find(p => p.route?.primary) ?? candidates.find(p => p.route) ?? candidates[0]
      : candidates.find(p => p.y >= (from?.y ?? 0)) ?? candidates[0];
    if (target) onChange([...steps, { type, target: target.id, delay: 0.2 }]);
  };
  const change = (index: number, value: Partial<BallStep>) => { onChange(steps.map((s, i) => i === index ? { ...s, ...value } : s)); };
  const qb = quarterback(players)?.id ?? null;
  return (
    <details className="flex-none rounded-tile border-2 border-ink bg-cream p-2">
      <summary className="min-h-11 cursor-pointer text-base">Ball assignments</summary>
      <div className="flex flex-col gap-2 pt-2">
        <p className="text-caption leading-note text-ink-muted">Add as many laterals as you need, then a forward pass or a run. Both ends of a lateral stay behind the LOS. Use movement routes and the wait to set the exchange spot.</p>
        {ballPlanLine(players, steps) && <p className="break-words text-small leading-note">{ballPlanLine(players, steps)}</p>}
        {steps.map((step, index) => {
          const source = index > 0 ? steps[index - 1]?.target : qb;
          const who = offense.find(p => p.id === source)?.label || source || "QB";
          return (
            <div key={index} role="group" aria-label={`Ball step ${String(index + 1)}`} className="flex flex-col gap-1 rounded-tile border border-ink p-2">
              <span className="text-small">{index + 1}. {who} {step.type === "pass" ? "throws forward to" : "laterals to"}</span>
              <select aria-label={`Receiver for ball step ${String(index + 1)}`} value={step.target} onChange={e => { change(index, { target: e.target.value }); }} className={`${input} min-h-11 w-full min-w-0`}>
                {!offense.some(p => p.id === step.target && p.id !== source) && <option value={step.target}>Choose receiver</option>}
                {offense.filter(p => p.id !== source).map(p => <option key={p.id} value={p.id}>{p.label || p.id}</option>)}
              </select>
              <label className="flex flex-wrap items-center gap-2 text-caption">Wait (seconds)
                <input aria-label={`Wait for ball step ${String(index + 1)}`} type="number" min="0" step="0.1" value={step.delay}
                  onChange={e => { const delay = Number(e.target.value); if (Number.isFinite(delay) && delay >= 0) change(index, { delay }); }} className={`${input} min-h-11 w-20 min-w-0`} />
              </label>
              <button type="button" className={`${pill} min-h-11 px-2 text-small`} onClick={() => { onChange(steps.filter((_, i) => i !== index)); }}>Remove step {index + 1}</button>
            </div>
          );
        })}
        {error && <p role="alert" className="text-small leading-note text-ink">{error}</p>}
        <button type="button" disabled={passed || !carrier || offense.length < 2} className={`${pill} min-h-11 px-2 text-small disabled:opacity-50`} onClick={() => { add("lateral"); }}>Add lateral</button>
        <button type="button" disabled={passed || !carrier || offense.length < 2} className={`${pill} min-h-11 px-2 text-small disabled:opacity-50`} onClick={() => { add("pass"); }}>Add forward pass</button>
        {!!steps.length && <button type="button" className={`${pill} min-h-11 px-2 text-small`} onClick={() => { onChange([]); }}>Clear ball assignments</button>}
      </div>
    </details>
  );
}

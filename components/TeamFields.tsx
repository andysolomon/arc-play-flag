"use client";

import { useId, type ChangeEvent } from "react";
import type { TeamSettings } from "@/lib/play/types";
import { input, pill, segmentInput, tile } from "./ui";

/** Fixed team accents; selecting one always stores the same color in either theme. */
const TEAM_COLORS = [
  { name: "Red", color: "#e5675e" },
  { name: "Orange", color: "#ea7c24" },
  { name: "Gold", color: "#f2b705" },
  { name: "Green", color: "#2e7d32" },
  { name: "Teal", color: "#2a9d8f" },
  { name: "Blue", color: "#4a8fe0" },
  { name: "Navy", color: "#183153" },
  { name: "Purple", color: "#6a34b8" },
  { name: "Pink", color: "#cf4d83" },
  { name: "Maroon", color: "#7f243d" },
  { name: "Black", color: "#1b1a17" },
  { name: "White", color: "#ffffff" },
] as const;

interface Props {
  team: TeamSettings;
  onTeam: (next: TeamSettings) => void;
}

/**
 * The team's name and colour: the one thing a coach gives the whole app. The name is painted
 * across a styled end zone and goes on cards, slides and printed pages; the colour paints the
 * Home Team end zone, the touchdown banner and the exports' accents. Kept on this device.
 */
export function TeamFields({ team, onTeam }: Props) {
  const colorName = useId();
  const selected = TEAM_COLORS.find(c => c.color === team.color.toLowerCase());
  return (
    <div className="flex flex-none flex-col gap-2">
      <input
        value={team.name} maxLength={40} placeholder="Team name" aria-label="Team name"
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onTeam({ ...team, name: e.target.value }); }}
        className={input}
      />
      <fieldset aria-label="Team color" className="w-full min-w-0 max-w-[320px]">
        <legend className="mb-2 text-small">
          Team color <span className="text-ink-muted">· {selected?.name ?? `Custom · ${team.color}`}</span>
        </legend>
        <div className="grid grid-cols-4 gap-2">
          {TEAM_COLORS.map(c => (
            <label key={c.color} title={c.name} data-active={selected?.color === c.color}
              className={`${tile} relative min-w-0 justify-center py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink`}>
              <input type="radio" name={colorName} value={c.color} checked={selected?.color === c.color}
                onChange={() => { onTeam({ ...team, color: c.color }); }} className={segmentInput} />
              <span aria-hidden className="h-5 w-5 rounded-full border-2 border-ink" style={{ background: c.color }} />
              <span className="text-caption leading-tight">{c.name}</span>
              {selected?.color === c.color && <span aria-hidden className="absolute right-1 top-0.5 text-caption leading-tight">✓</span>}
            </label>
          ))}
        </div>
        <label data-active={!selected}
          className={`${pill} relative mt-2 flex min-h-12 cursor-pointer items-center gap-2 px-3 text-small data-[active=true]:bg-yellow data-[active=true]:on-yellow data-[active=true]:hover:bg-yellow has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink`}>
          <span className="h-5 w-5 flex-none rounded-full border-2 border-ink" style={{ background: team.color }} aria-hidden />
          Custom color…
          {!selected && <span aria-hidden className="ml-auto">✓</span>}
          <input
            type="color" value={team.color} aria-label="Custom color wheel"
            onChange={(e: ChangeEvent<HTMLInputElement>) => { onTeam({ ...team, color: e.target.value }); }}
            className={segmentInput}
          />
        </label>
      </fieldset>
    </div>
  );
}

/** What the name and colour reach, for the note under the fields. */
export const TEAM_NOTE = "Your name is painted across a styled end zone and goes on cards, slides and printed pages. Saved on this device.";

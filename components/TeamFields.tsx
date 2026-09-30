"use client";

import { useId, useState, type ChangeEvent } from "react";
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

/** Store six lowercase digits, accepting the common shorthand and an optional #. */
function hexColor(value: string): string | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!match?.[1]) return null;
  const digits = match[1].toLowerCase();
  return `#${digits.length === 3 ? Array.from(digits, c => c + c).join("") : digits}`;
}

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
  const customId = useId(), hexId = useId(), hexNoteId = useId();
  const [customOpen, setCustomOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [hexError, setHexError] = useState(false);
  const selected = TEAM_COLORS.find(c => c.color === team.color.toLowerCase());
  const chooseColor = (color: string) => {
    setHexDraft(null);
    setHexError(false);
    onTeam({ ...team, color });
  };
  const applyHex = () => {
    const color = hexColor(hexDraft ?? team.color);
    if (color) chooseColor(color);
    else setHexError(true);
  };
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
                onChange={() => { setCustomOpen(false); chooseColor(c.color); }} className={segmentInput} />
              <span aria-hidden className="h-5 w-5 rounded-full border-2 border-ink" style={{ background: c.color }} />
              <span className="text-caption leading-tight">{c.name}</span>
              {selected?.color === c.color && <span aria-hidden className="absolute right-1 top-0.5 text-caption leading-tight">✓</span>}
            </label>
          ))}
        </div>
        <button type="button" data-active={!selected} aria-expanded={customOpen} aria-controls={customId}
          onClick={() => { setHexDraft(null); setHexError(false); setCustomOpen(!customOpen); }}
          className={`${pill} mt-2 flex min-h-12 w-full items-center gap-2 px-3 text-left text-small data-[active=true]:bg-yellow data-[active=true]:on-yellow data-[active=true]:hover:bg-yellow`}>
          <span className="h-5 w-5 flex-none rounded-full border-2 border-ink" style={{ background: team.color }} aria-hidden />
          Custom color…
          {!selected && <span aria-hidden className="ml-auto">✓</span>}
        </button>
        {customOpen && (
          <div id={customId} className="mt-2 flex flex-col gap-2 rounded-tile border-2 border-ink bg-white p-3">
            <label htmlFor={hexId} className="text-small">Hex color</label>
            <div className="flex items-center gap-2">
              <input id={hexId} type="text" value={hexDraft ?? team.color} placeholder="#RRGGBB" maxLength={7}
                autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
                aria-invalid={hexError} aria-describedby={hexNoteId}
                onChange={e => { setHexDraft(e.target.value); setHexError(false); }}
                onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyHex(); } }}
                className={`${input} min-w-0 flex-1`} style={{ fontFamily: "ui-monospace, monospace" }} />
              <button type="button" onClick={applyHex} className={`${pill} min-h-11 px-3 text-small`}>Apply</button>
            </div>
            {hexError
              ? <p id={hexNoteId} role="alert" className="m-0 text-caption leading-note">Use 3 or 6 hex digits, e.g. #1A73E8.</p>
              : <p id={hexNoteId} className="m-0 text-caption leading-note text-ink-muted">3 or 6 digits; # is optional.</p>}
            <label className={`${pill} relative flex min-h-12 cursor-pointer items-center gap-2 px-3 text-small has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink`}>
              <span className="h-5 w-5 flex-none rounded-full border-2 border-ink" style={{ background: team.color }} aria-hidden />
              Color wheel…
              <input type="color" value={team.color} aria-label="Custom color wheel"
                onChange={(e: ChangeEvent<HTMLInputElement>) => { chooseColor(e.target.value); }} className={segmentInput} />
            </label>
          </div>
        )}
      </fieldset>
    </div>
  );
}

/** What the name and colour reach, for the note under the fields. */
export const TEAM_NOTE = "Your name is painted across a styled end zone and goes on cards, slides and printed pages. Saved on this device.";

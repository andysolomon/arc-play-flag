"use client";

import type { ChangeEvent } from "react";
import type { TeamSettings } from "@/lib/play/types";
import { input, pill } from "./ui";

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
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={team.name} maxLength={40} placeholder="Team name" aria-label="Team name"
        onChange={(e: ChangeEvent<HTMLInputElement>) => { onTeam({ ...team, name: e.target.value }); }}
        className={`${input} min-w-0 flex-1 basis-[180px]`}
      />
      <label className={`${pill} relative flex min-h-11 cursor-pointer items-center gap-2 px-3 text-small`}>
        <span className="h-5 w-5 rounded-full border-2 border-ink" style={{ background: team.color }} aria-hidden />
        Team colour
        <input
          type="color" value={team.color} aria-label="Team colour"
          onChange={(e: ChangeEvent<HTMLInputElement>) => { onTeam({ ...team, color: e.target.value }); }}
          className="absolute h-0 w-0 opacity-0"
        />
      </label>
    </div>
  );
}

/** What the name and colour reach, for the note under the fields. */
export const TEAM_NOTE = "Your name is painted across a styled end zone and goes on cards, slides and printed pages. Saved on this device.";

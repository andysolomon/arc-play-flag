"use client";

import { useId, useSyncExternalStore } from "react";
import { THEME_CHOICES, getThemeChoice, setThemeChoice, subscribeThemeChoice, type ThemeChoice } from "@/lib/theme";
import { segment, segmentInput, segmented } from "./ui";

const COPY: Record<ThemeChoice, { label: string; title: string }> = {
  auto: { label: "Auto", title: "Match this device's light or dark setting" },
  light: { label: "Light", title: "Ink on paper" },
  dark: { label: "Dark", title: "Chalk on a dark board, easier on the eyes at night" },
};

// prerendered pages don't know the device's choice; it lands right after hydration
const serverChoice = (): ThemeChoice => "auto";

/** Light, dark, or whatever this device is set to. Kept on this device only. */
export function ThemePicker({ className = "" }: { className?: string }) {
  const name = useId();
  const choice = useSyncExternalStore(subscribeThemeChoice, getThemeChoice, serverChoice);
  return (
    <div role="radiogroup" aria-label="Theme" className={`${segmented} ${className}`}>
      {THEME_CHOICES.map((c) => (
        <label key={c} title={COPY[c].title} className={segment}>
          <input type="radio" name={name} value={c} checked={choice === c} onChange={() => { setThemeChoice(c); }} className={segmentInput} />
          {COPY[c].label}
        </label>
      ))}
    </div>
  );
}

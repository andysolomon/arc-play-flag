"use client";

import type { Vis } from "@/lib/play/types";
import { pill } from "../ui";

const CHOICES: readonly { key: Vis; label: string }[] = [
  { key: "both", label: "Both" },
  { key: "offense", label: "Offense" },
  { key: "defense", label: "Defense" },
];

/** Which team the gallery thumbnails draw. */
export function ShowToggle({ value, onChange }: { value: Vis; onChange: (v: Vis) => void }) {
  return (
    <div role="group" aria-label="Show" className="flex items-center gap-1">
      <span className="text-caption text-ink-muted">Show</span>
      {CHOICES.map((c) => (
        <button
          key={c.key}
          type="button"
          aria-pressed={value === c.key}
          onClick={() => { onChange(c.key); }}
          className={`${pill} px-3 py-0.5 text-small aria-pressed:bg-yellow`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

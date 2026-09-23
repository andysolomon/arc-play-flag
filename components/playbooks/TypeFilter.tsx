"use client";

import { useId } from "react";
import type { PlayFilter } from "@/lib/play/library";

const OPTIONS: readonly { value: PlayFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "pass", label: "Pass" }, { value: "run", label: "Run" }, { value: "defense", label: "Defense" },
];

/** One tap per play type: a segmented pill in place of a dropdown, so the choice is always visible. */
export function TypeFilter({ value, onChange, label }: { value: PlayFilter; onChange: (next: PlayFilter) => void; label: string }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className="flex min-h-11 overflow-hidden rounded-pill border-2 border-ink bg-white">
      {OPTIONS.map((o) => (
        <label key={o.value} className="relative flex flex-1 cursor-pointer items-center justify-center px-3 text-small has-[:checked]:bg-yellow has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-3px] has-[:focus-visible]:outline-ink hover:bg-yellow-soft has-[:checked]:hover:bg-yellow">
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => { onChange(o.value); }} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

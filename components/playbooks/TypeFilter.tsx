"use client";

import { useId } from "react";
import type { PlayFilter } from "@/lib/play/library";
import { segment, segmentInput, segmented } from "../ui";

const OPTIONS: readonly { value: PlayFilter; label: string }[] = [
  { value: "all", label: "All" }, { value: "pass", label: "Pass" }, { value: "run", label: "Run" }, { value: "defense", label: "Defense" },
];

/** One tap per play type: a segmented pill in place of a dropdown, so the choice is always visible. */
export function TypeFilter({ value, onChange, label }: { value: PlayFilter; onChange: (next: PlayFilter) => void; label: string }) {
  const name = useId();
  return (
    <div role="radiogroup" aria-label={label} className={segmented}>
      {OPTIONS.map((o) => (
        <label key={o.value} className={segment}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => { onChange(o.value); }} className={segmentInput} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

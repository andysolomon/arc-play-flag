"use client";

import Link from "next/link";
import { useId, useSyncExternalStore } from "react";
import { getPlaybooks, getServerPlaybooks, subscribe } from "@/lib/play/library";
import {
  PREMIUM_THEMES, THEME_CHOICES, getFieldChoice, getThemeChoice, setFieldChoice, setThemeChoice, subscribeFieldChoice, subscribeThemeChoice,
  type FieldChoice, type ThemeChoice,
} from "@/lib/theme";
import { eyebrow, segment, segmentInput, segmented } from "./ui";

const COPY: Record<(typeof THEME_CHOICES)[number], { label: string; title: string }> = {
  auto: { label: "Auto", title: "Match this device's light or dark setting" },
  light: { label: "Light", title: "Ink on paper" },
  dark: { label: "Dark", title: "Chalk on a dark board, easier on the eyes at night" },
};

// prerendered pages don't know the device's choice; it lands right after hydration
const serverChoice = (): ThemeChoice => "auto";
const serverField = (): FieldChoice => "standard";

/** A swatch: the frame is drawn in the page's theme, everything inside it in the swatch's own. */
const swatch =
  "relative flex cursor-pointer flex-col overflow-hidden rounded-tile border-2 border-ink shadow-tile transition-transform duration-[120ms] " +
  "hover:-translate-y-0.5 has-[:checked]:shadow-[0_0_0_3px_var(--color-yellow)] has-[:disabled]:cursor-not-allowed " +
  "has-[:disabled]:hover:translate-y-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink " +
  "motion-reduce:transition-none";

/** A checkbox drawn as a switch: the track fills with the highlighter and the knob slides across. */
const toggle =
  "relative h-7 w-12 flex-none cursor-pointer appearance-none rounded-pill border-2 border-ink bg-white transition-colors duration-[120ms] " +
  "before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:border-2 before:border-ink before:bg-cream " +
  "before:transition-transform before:duration-[120ms] checked:bg-yellow checked:before:translate-x-5 " +
  "disabled:cursor-not-allowed disabled:bg-paper-2 disabled:before:bg-paper-2 motion-reduce:transition-none motion-reduce:before:transition-none";

function Lock() {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round">
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

/**
 * Light, dark, or whatever this device is set to, then the premium themes, which open once
 * this device holds a playbook. Kept on this device only. A premium theme already in use stays
 * checked and drawn even if every playbook is later deleted; only picking a new one is locked.
 * `unlockHref` points a locked picker at the place to make that first playbook.
 * Under a premium theme, "Themed field" repaints the live field too; exports stay green.
 */
export function ThemePicker({ className = "", unlockHref }: { className?: string; unlockHref?: string }) {
  const name = useId();
  const hint = useId();
  const choice = useSyncExternalStore(subscribeThemeChoice, getThemeChoice, serverChoice);
  const unlocked = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks).length > 0;
  const field = useSyncExternalStore(subscribeFieldChoice, getFieldChoice, serverField);
  const premium = PREMIUM_THEMES.some((t) => t.id === choice);
  const fieldHint = useId();
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-2">
        <div className={segmented}>
          {THEME_CHOICES.map((c) => (
            <label key={c} title={COPY[c].title} className={segment}>
              <input type="radio" name={name} value={c} checked={choice === c} onChange={() => { setThemeChoice(c); }} className={segmentInput} />
              {COPY[c].label}
            </label>
          ))}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          <span className={eyebrow}>PREMIUM</span>
          {!unlocked && (
            <span className="inline-flex items-center gap-1 text-caption text-ink-muted"><Lock />Locked</span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {PREMIUM_THEMES.map((t) => {
            const locked = !unlocked && choice !== t.id;
            return (
              <label key={t.id} title={locked ? `${t.blurb}. Make a playbook to unlock.` : t.blurb} className={swatch}>
                <input
                  type="radio" name={name} value={t.id} checked={choice === t.id} disabled={locked}
                  aria-describedby={locked ? hint : undefined}
                  onChange={() => { setThemeChoice(t.id); }}
                  className={`${segmentInput} disabled:cursor-not-allowed`}
                />
                <span data-theme={t.id} className="flex flex-col text-ink">
                  <span aria-hidden className="flex items-center gap-1.5 bg-paper px-2 pb-1.5 pt-2">
                    <span className="text-title leading-tight">Aa</span>
                    <span className="h-3.5 w-6 rounded-pill border-2 border-ink bg-yellow" />
                    <span className="h-3.5 w-3.5 rounded-full bg-link" />
                    <span className="h-3.5 w-3.5 rounded-full bg-ink-muted" />
                    {choice === t.id && <span className="ml-auto text-small leading-tight">✓</span>}
                    {locked && <span className="ml-auto text-ink-muted"><Lock /></span>}
                  </span>
                  <span className="truncate border-t-2 border-divider bg-cream px-2 pb-1.5 pt-1 text-small leading-tight">{t.name}</span>
                </span>
              </label>
            );
          })}
        </div>
        <span id={hint} className="text-caption leading-note text-ink-muted">
          {unlocked ? (
            "Unlocked by your playbook. Eight hand-tuned palettes, after Omarchy's."
          ) : (
            <>
              Make a playbook to unlock eight hand-tuned palettes, after Omarchy&apos;s.
              {unlockHref && <> <Link href={unlockHref}>Make a playbook ›</Link></>}
            </>
          )}
        </span>
      </div>
      <label className={`flex min-h-11 items-center gap-3 ${premium ? "cursor-pointer" : "cursor-not-allowed"}`}>
        <input
          type="checkbox" role="switch" checked={field === "themed"} disabled={!premium} aria-describedby={fieldHint}
          onChange={(e) => { setFieldChoice(e.target.checked ? "themed" : "standard"); }}
          className={toggle}
        />
        <span className="flex flex-col">
          <span className={`text-small leading-tight ${premium ? "" : "text-ink-muted"}`}>Themed field</span>
          <span id={fieldHint} className="text-caption leading-note text-ink-muted">
            {premium ? "Paint the field in this theme's colours. Exports and prints keep the green field." : "Pick a premium theme to paint its field."}
          </span>
        </span>
      </label>
    </div>
  );
}

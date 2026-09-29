"use client";

import Link from "next/link";
import { useId, useSyncExternalStore } from "react";
import { getPlaybooks, getServerPlaybooks, subscribe } from "@/lib/play/library";
import {
  PREMIUM_THEMES, THEME_CHOICES, getFieldChoice, getThemeChoice, setFieldChoice, setThemeChoice, subscribeFieldChoice, subscribeThemeChoice,
  type BaseTheme, type FieldChoice, type PremiumTheme, type ThemeChoice,
} from "@/lib/theme";
import { eyebrow, segment, segmentInput, segmented } from "./ui";

const COPY: Record<(typeof THEME_CHOICES)[number], { label: string; title: string }> = {
  auto: { label: "Auto", title: "Match this device's light or dark setting" },
  light: { label: "Light", title: "Ink on paper" },
  dark: { label: "Dark", title: "Chalk on a dark board, easier on the eyes at night" },
};

const GROUPS: readonly { tone: BaseTheme; label: string }[] = [
  { tone: "dark", label: "Dark" },
  { tone: "light", label: "Light" },
];

// prerendered pages don't know the device's choice; it lands right after hydration
const serverChoice = (): ThemeChoice => "auto";
const serverField = (): FieldChoice => "standard";

/*
 * Whether the premium gallery is unfolded. Shut by default so the sidebar stays short, and
 * kept for the tab (sessionStorage) so a fold the coach opened survives a reload and every
 * drawer fold in between. One store for every picker on the page.
 */
const FOLD_KEY = "ffpd.theme-fold.v1";
let foldOpen: boolean | null = null;
const foldListeners = new Set<() => void>();
function getFold(): boolean {
  if (foldOpen === null) {
    try { foldOpen = sessionStorage.getItem(FOLD_KEY) === "open"; } catch { foldOpen = false; }
  }
  return foldOpen;
}
function setFold(open: boolean): void {
  foldOpen = open;
  try {
    if (open) sessionStorage.setItem(FOLD_KEY, "open");
    else sessionStorage.removeItem(FOLD_KEY);
  } catch { /* the fold still moves; it just isn't remembered */ }
  foldListeners.forEach((l) => { l(); });
}
function subscribeFold(cb: () => void): () => void {
  foldListeners.add(cb);
  return () => { foldListeners.delete(cb); };
}
const serverFold = (): boolean => false;

/** A swatch: the frame is drawn in the page's theme, everything inside it in the swatch's own. */
const swatch =
  "relative flex cursor-pointer flex-col overflow-hidden rounded-tile border-2 border-ink shadow-tile transition-transform duration-[120ms] " +
  "hover:-translate-y-0.5 has-[:checked]:shadow-[0_0_0_3px_var(--color-yellow)] has-[:disabled]:cursor-not-allowed " +
  "has-[:disabled]:hover:translate-y-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink " +
  "motion-reduce:transition-none";

/** The row that stands in for the gallery: a tile-shaped button, so it reads as one of the tiles. */
const summary =
  "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-tile border-2 border-ink bg-white px-2.5 text-left shadow-tile " +
  "transition-transform duration-[120ms] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink " +
  "motion-reduce:transition-none";

/** A checkbox drawn as a switch: the track fills with the highlighter and the knob slides across. */
const toggle =
  "relative h-7 w-12 flex-none cursor-pointer appearance-none rounded-pill border-2 border-ink bg-white transition-colors duration-[120ms] " +
  "before:absolute before:left-0.5 before:top-0.5 before:h-5 before:w-5 before:rounded-full before:border-2 before:border-ink before:bg-cream " +
  "before:transition-transform before:duration-[120ms] checked:bg-yellow checked:before:translate-x-5 " +
  "disabled:cursor-not-allowed disabled:bg-paper-2 disabled:before:bg-paper-2 motion-reduce:transition-none motion-reduce:before:transition-none";

function Lock({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={`h-3.5 w-3.5 flex-none fill-none stroke-current ${className}`} strokeWidth={2} strokeLinecap="round">
      <rect x="3" y="7" width="10" height="7.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden viewBox="0 0 16 16" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
      className={`h-3.5 w-3.5 flex-none fill-none stroke-current transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
    >
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

/** The theme's paper and highlighter at thumbnail size, for the summary row. */
function MiniSwatch({ theme }: { theme: PremiumTheme }) {
  return (
    <span aria-hidden className="flex-none overflow-hidden rounded-[6px] border-2 border-ink">
      <span data-theme={theme.id} className="flex h-5 w-8 items-center justify-center gap-1 bg-paper text-[11px] leading-none text-ink">
        Aa<span className="h-2 w-2 rounded-full bg-yellow" />
      </span>
    </span>
  );
}

/** Three highlighters from the gallery, for a summary row with nothing chosen yet. */
function Dots() {
  return (
    <span aria-hidden className="flex flex-none items-center -space-x-1">
      {(["tokyo-night", "gruvbox", "rose-pine"] as const).map((id) => (
        <span key={id} data-theme={id} className="h-3.5 w-3.5 rounded-full border-2 border-ink bg-yellow" />
      ))}
    </span>
  );
}

/**
 * Light, dark, or whatever this device is set to, then the premium gallery behind one row that
 * folds open, grouped Dark and Light, with the theme in use named on the row. Premium themes
 * open once this device holds a playbook; a theme already in use stays checked and drawn even
 * if every playbook is later deleted, only picking a new one is locked. `unlockHref` points a
 * locked picker at the place to make that first playbook. Under a premium theme, "Themed field"
 * sits outside the fold, always one tap away; exports stay green. All kept on this device only.
 */
export function ThemePicker({ className = "", unlockHref }: { className?: string; unlockHref?: string }) {
  const name = useId();
  const hint = useId();
  const foldId = useId();
  const fieldHint = useId();
  const choice = useSyncExternalStore(subscribeThemeChoice, getThemeChoice, serverChoice);
  const unlocked = useSyncExternalStore(subscribe, getPlaybooks, getServerPlaybooks).length > 0;
  const field = useSyncExternalStore(subscribeFieldChoice, getFieldChoice, serverField);
  const open = useSyncExternalStore(subscribeFold, getFold, serverFold);
  const chosen = PREMIUM_THEMES.find((t) => t.id === choice) ?? null;
  const count = `${String(PREMIUM_THEMES.length)} premium themes`;

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

        <button
          type="button"
          aria-expanded={open}
          aria-controls={foldId}
          aria-label={chosen ? `Premium themes: ${chosen.name}` : unlocked ? "Premium themes" : "Premium themes, locked"}
          onClick={() => { setFold(!open); }}
          className={summary}
        >
          {chosen ? <MiniSwatch theme={chosen} /> : unlocked ? <Dots /> : <Lock />}
          <span className="min-w-0 flex-1 truncate text-small leading-tight">{chosen ? chosen.name : count}</span>
          <span className="flex flex-none items-center gap-1 text-caption text-ink-muted">
            {open ? "Done" : chosen ? "Change" : "Browse"}
            <Chevron open={open} />
          </span>
        </button>
        {!unlocked && (
          <span className="text-caption leading-note text-ink-muted">
            Make a playbook to unlock {chosen ? "the others" : "them"}.
            {unlockHref && <> <Link href={unlockHref}>Make a playbook ›</Link></>}
          </span>
        )}

        <div id={foldId} className="fold" data-open={open}>
          <div>
            <div className="flex flex-col gap-2 px-1 pb-1 pt-0.5">
              {GROUPS.map((g) => (
                <div key={g.tone} role="group" aria-label={`${g.label} themes`} className="flex flex-col gap-2">
                  <span className={`${eyebrow} flex items-center gap-2 after:h-0.5 after:flex-1 after:bg-divider`}>{g.label.toUpperCase()}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {PREMIUM_THEMES.filter((t) => t.tone === g.tone).map((t) => {
                      // a theme in use stays available with no playbook; the rest wait for one
                      const off = !unlocked && choice !== t.id;
                      return (
                        <label key={t.id} title={off ? `${t.blurb}. Make a playbook to unlock.` : t.blurb} className={swatch}>
                          <input
                            type="radio" name={name} value={t.id} checked={choice === t.id} disabled={off}
                            aria-describedby={off ? hint : undefined}
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
                              {off && <span className="ml-auto text-ink-muted"><Lock /></span>}
                            </span>
                            <span className="truncate border-t-2 border-divider bg-cream px-2 pb-1.5 pt-1 text-small leading-tight">{t.name}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
              <span id={hint} className="text-caption leading-note text-ink-muted">
                {unlocked ? "Hand-tuned palettes, after Omarchy's. Unlocked by your playbook." : "Locked until this device has a playbook."}
              </span>
            </div>
          </div>
        </div>
      </div>

      {(unlocked || chosen) && (
        <label className={`flex min-h-11 items-center gap-3 ${chosen ? "cursor-pointer" : "cursor-not-allowed"}`}>
          <input
            type="checkbox" role="switch" checked={field === "themed"} disabled={!chosen} aria-describedby={fieldHint}
            onChange={(e) => { setFieldChoice(e.target.checked ? "themed" : "standard"); }}
            className={toggle}
          />
          <span className="flex flex-col">
            <span className={`text-small leading-tight ${chosen ? "" : "text-ink-muted"}`}>Themed field</span>
            <span id={fieldHint} className="text-caption leading-note text-ink-muted">
              {chosen ? "Paint the field in this theme's colours. Exports and prints keep the green field." : "Pick a premium theme to paint its field."}
            </span>
          </span>
        </label>
      )}
    </div>
  );
}

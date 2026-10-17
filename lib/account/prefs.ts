import { DEEP_FIELD_KEY, getDeepField, setDeepField } from "@/lib/deepfield";
import { deviceWritten } from "@/lib/device-writes";
import { ENDZONE_KEY, TOUCHDOWNS_KEY, getEndZone, getTouchdowns, setEndZone, setTouchdowns } from "@/lib/endzone";
import { LOS_KEY, getLosChoice, setLosChoice } from "@/lib/los";
import { FIELD_KEY, THEME_KEY, getFieldChoice, getThemeChoice, setFieldChoice, setThemeChoice } from "@/lib/theme";
import type { CoachPrefs } from "./types";

/**
 * The coach's look as this device holds it (ADR 014): read from each module's own key, and written
 * through each module's own setter, so every screen redraws the way it does for a tap. The account
 * engine (sync.ts) reads it to push, and writes it to bring the account's down.
 */

/** The getting-started guide has been dismissed or taken on this device (components/FirstUse.tsx). */
export const FIRST_USE_KEY = "ffpd.first-use.v1";

export function firstUseDone(): boolean {
  try { return localStorage.getItem(FIRST_USE_KEY) === "done"; } catch { return false; }
}

/** Remembers that the guide was seen, or not. A blocked storage costs it only its memory past this visit. */
export function setFirstUseDone(done: boolean): void {
  try {
    if (done) localStorage.setItem(FIRST_USE_KEY, "done");
    else localStorage.removeItem(FIRST_USE_KEY);
  } catch { /* the guide shows again next visit, at worst */ }
  deviceWritten();
}

/** The look as it stands on this device. */
export function devicePrefs(): CoachPrefs {
  return {
    theme: getThemeChoice(), field: getFieldChoice(), endZone: getEndZone(), deepField: getDeepField(), los: getLosChoice(), touchdowns: getTouchdowns(),
    firstUseDone: firstUseDone(),
  };
}

/** Puts a look on this device, each choice through its own setter so the page redraws; what is already so is left alone. */
export function applyPrefs(p: CoachPrefs): void {
  const now = devicePrefs();
  if (now.theme !== p.theme) setThemeChoice(p.theme);
  if (now.field !== p.field) setFieldChoice(p.field);
  if (now.endZone !== p.endZone) setEndZone(p.endZone);
  if (now.deepField !== p.deepField) setDeepField(p.deepField);
  if (now.los !== p.los) setLosChoice(p.los);
  if (now.touchdowns !== p.touchdowns) setTouchdowns(p.touchdowns);
  if (now.firstUseDone !== p.firstUseDone) setFirstUseDone(p.firstUseDone);
}

/**
 * Back to what a coach gets before they pick anything, for a sign-out or a deleted team (the look is in
 * the account): the keys go, and nothing is redrawn, since the page is about to load fresh. Going through
 * the setters here would redraw the board on its way out, and the board's autosave would write the draft
 * back after the device was cleared.
 */
export function clearPrefs(): void {
  for (const k of [THEME_KEY, FIELD_KEY, ENDZONE_KEY, TOUCHDOWNS_KEY, DEEP_FIELD_KEY, LOS_KEY, FIRST_USE_KEY]) {
    try { localStorage.removeItem(k); } catch { /* nothing to keep */ }
  }
}

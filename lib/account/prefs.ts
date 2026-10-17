import { getDeepField, setDeepField } from "@/lib/deepfield";
import { deviceWritten } from "@/lib/device-writes";
import { getEndZone, getTouchdowns, setEndZone, setTouchdowns } from "@/lib/endzone";
import { getFieldChoice, getThemeChoice, setFieldChoice, setThemeChoice } from "@/lib/theme";
import { DEFAULT_PREFS } from "./data";
import type { CoachPrefs } from "./types";

/**
 * The coach's look as this device holds it (ADR 013): read from each module's own key, and written
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
    theme: getThemeChoice(), field: getFieldChoice(), endZone: getEndZone(), deepField: getDeepField(), touchdowns: getTouchdowns(), firstUseDone: firstUseDone(),
  };
}

/** Puts a look on this device, each choice through its own setter so the page redraws; what is already so is left alone. */
export function applyPrefs(p: CoachPrefs): void {
  const now = devicePrefs();
  if (now.theme !== p.theme) setThemeChoice(p.theme);
  if (now.field !== p.field) setFieldChoice(p.field);
  if (now.endZone !== p.endZone) setEndZone(p.endZone);
  if (now.deepField !== p.deepField) setDeepField(p.deepField);
  if (now.touchdowns !== p.touchdowns) setTouchdowns(p.touchdowns);
  if (now.firstUseDone !== p.firstUseDone) setFirstUseDone(p.firstUseDone);
}

/** Back to what a coach gets before they pick anything (a sign-out: the look is in the account). */
export function clearPrefs(): void {
  applyPrefs(DEFAULT_PREFS);
}

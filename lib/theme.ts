/**
 * Light or dark, chosen per device. "auto" follows the device's own setting
 * (prefers-color-scheme) and is what a coach gets until they pick one.
 */
export type ThemeChoice = "auto" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "ffpd.theme.v1";
export const THEME_CHOICES: readonly ThemeChoice[] = ["auto", "light", "dark"];
/** The header's cream in each theme, for the browser and installed-app chrome. Keep in step with app/globals.css. */
export const THEME_COLOR: Readonly<Record<Theme, string>> = { light: "#fffdf6", dark: "#24221d" };

export const parseThemeChoice = (raw: unknown): ThemeChoice => (raw === "light" || raw === "dark" ? raw : "auto");

/**
 * Marks <html> with the theme to draw and points the browser chrome at the matching colour.
 * Reads the saved choice unless one is passed. Self-contained on purpose (only its arguments
 * and browser globals): the root layout inlines its source so the first paint is already right.
 * The theme-color tag is this function's alone: one React rendered would be re-added on hydration.
 */
export function applyTheme(key: string, colors: Readonly<Record<Theme, string>>, chosen?: string | null): void {
  let choice = chosen;
  if (choice === undefined) {
    try { choice = localStorage.getItem(key); } catch { choice = null; }
  }
  const theme = choice === "dark" || (choice !== "light" && matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.append(meta);
  }
  meta.setAttribute("content", colors[theme]);
}

/** Applies the theme now, then again whenever the device setting or another tab's choice changes. */
function bootTheme(apply: typeof applyTheme, key: string, colors: Readonly<Record<Theme, string>>): void {
  const run = (): void => { apply(key, colors); };
  run();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", run);
  addEventListener("storage", (e: StorageEvent) => { if (e.key === key || e.key === null) run(); });
}

/** Inlined at the top of every page, before any bundle loads, so a dark-mode visit never flashes paper. */
export const themeScript = `(${bootTheme.toString()})(${applyTheme.toString()},${JSON.stringify(THEME_KEY)},${JSON.stringify(THEME_COLOR)})`;

const listeners = new Set<() => void>();
// storage can be blocked (private mode, site data off); the choice then lasts until the page closes
let unsaved: ThemeChoice | null = null;

export function getThemeChoice(): ThemeChoice {
  if (unsaved) return unsaved;
  try { return parseThemeChoice(localStorage.getItem(THEME_KEY)); } catch { return "auto"; }
}

/** Keeps the choice on this device and redraws in it; "auto" forgets any choice. */
export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "auto") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
    unsaved = null;
  } catch {
    unsaved = choice;
  }
  applyTheme(THEME_KEY, THEME_COLOR, choice);
  listeners.forEach((l) => { l(); });
}

/** For useSyncExternalStore: this tab's choices and other tabs' (the inline script redraws for those). */
export function subscribeThemeChoice(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent): void => { if (e.key === THEME_KEY || e.key === null) onChange(); };
  listeners.add(onChange);
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    removeEventListener("storage", onStorage);
  };
}

/**
 * Light or dark, chosen per device. "auto" follows the device's own setting
 * (prefers-color-scheme) and is what a coach gets until they pick one.
 * Past those two sit the premium themes, after Omarchy's collection: each one
 * redraws every token in app/globals.css, and a coach earns them by making a playbook.
 */
export type BaseTheme = "light" | "dark";

export interface PremiumTheme {
  readonly id: string;
  readonly name: string;
  /** which sticker set it wears: chalk on the dark ones, ink on the light ones */
  readonly tone: BaseTheme;
  /** its header colour (--color-cream), for the browser chrome */
  readonly color: string;
  readonly blurb: string;
}

/** Keep in step with the [data-theme] blocks in app/globals.css. */
export const PREMIUM_THEMES = [
  { id: "tokyo-night", name: "Tokyo Night", tone: "dark", color: "#1f2335", blurb: "City lights after dark: indigo board, electric blue highlighter" },
  { id: "catppuccin", name: "Catppuccin", tone: "dark", color: "#181825", blurb: "Mocha: soft pastels on a deep base, mauve highlighter" },
  { id: "gruvbox", name: "Gruvbox", tone: "dark", color: "#32302f", blurb: "Retro groove: warm earth tones, a gold highlighter" },
  { id: "nord", name: "Nord", tone: "dark", color: "#3b4252", blurb: "Arctic slate with a frost-blue highlighter" },
  { id: "kanagawa", name: "Kanagawa", tone: "dark", color: "#2a2a37", blurb: "The Great Wave: sumi ink, fuji white, carp yellow" },
  { id: "matte-black", name: "Matte Black", tone: "dark", color: "#1a1a1a", blurb: "Near-black and quiet, one amber highlighter" },
  { id: "rose-pine", name: "Rosé Pine", tone: "light", color: "#fffaf3", blurb: "Dawn: parchment, pine ink and a rose highlighter" },
  { id: "flexoki", name: "Flexoki", tone: "light", color: "#fffcf0", blurb: "Inky paper for daylight, a mustard highlighter" },
] as const satisfies readonly PremiumTheme[];

export type PremiumThemeId = (typeof PREMIUM_THEMES)[number]["id"];
export type Theme = BaseTheme | PremiumThemeId;
export type ThemeChoice = "auto" | Theme;

export const THEME_KEY = "ffpd.theme.v1";
/** The segmented choices; the premium themes are listed apart, in PREMIUM_THEMES. */
export const THEME_CHOICES = ["auto", "light", "dark"] as const satisfies readonly ThemeChoice[];
/** The header's cream in each theme, for the browser and installed-app chrome. Keep in step with app/globals.css. */
export const THEME_COLOR: Readonly<Record<Theme, string>> = {
  light: "#fffdf6",
  dark: "#24221d",
  ...(Object.fromEntries(PREMIUM_THEMES.map((t) => [t.id, t.color])) as Record<PremiumThemeId, string>),
};

/** A theme this app draws, or "auto" for anything else (a junk value, a theme a later release dropped). */
export const parseThemeChoice = (raw: unknown): ThemeChoice =>
  typeof raw === "string" && Object.prototype.hasOwnProperty.call(THEME_COLOR, raw) ? (raw as Theme) : "auto";

/**
 * Marks <html> with the theme to draw and points the browser chrome at the matching colour.
 * Reads the saved choice unless one is passed. Self-contained on purpose (only its arguments
 * and browser globals): the root layout inlines its source so the first paint is already right.
 * The theme-color tag is this function's alone: one React rendered would be re-added on hydration.
 */
export function applyTheme(key: string, colors: Readonly<Record<string, string>>, chosen?: string | null): void {
  let choice = chosen;
  if (choice === undefined) {
    try { choice = localStorage.getItem(key); } catch { choice = null; }
  }
  // any theme with a colour is drawn as chosen; nothing, "auto" or junk follows the device
  const theme = typeof choice === "string" && Object.prototype.hasOwnProperty.call(colors, choice)
    ? choice
    : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.append(meta);
  }
  meta.setAttribute("content", colors[theme] ?? "");
}

/**
 * The field under a premium theme: "themed" repaints the live field in the theme's own turf, inks
 * and team colours (app/globals.css); anything else keeps the standard green field. Screen only,
 * and never an export: lib/render/play-svg.ts draws every card, PDF and thumbnail on the green.
 */
export type FieldChoice = "standard" | "themed";
export const FIELD_KEY = "ffpd.field.v1";

/** Marks <html> with the field to paint. Self-contained, like applyTheme, for the same inlining. */
export function applyField(key: string, chosen?: string | null): void {
  let choice = chosen;
  if (choice === undefined) {
    try { choice = localStorage.getItem(key); } catch { choice = null; }
  }
  document.documentElement.dataset.field = choice === "themed" ? "themed" : "standard";
}

/** Applies the theme and field now, then again whenever the device setting or another tab's choice changes. */
function bootTheme(
  apply: typeof applyTheme, key: string, colors: Readonly<Record<string, string>>, paintField: typeof applyField, fieldKey: string,
): void {
  const run = (): void => { apply(key, colors); paintField(fieldKey); };
  run();
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", run);
  addEventListener("storage", (e: StorageEvent) => { if (e.key === key || e.key === fieldKey || e.key === null) run(); });
}

/** Inlined at the top of every page, before any bundle loads, so a dark-mode visit never flashes paper. */
export const themeScript =
  `(${bootTheme.toString()})(${applyTheme.toString()},${JSON.stringify(THEME_KEY)},${JSON.stringify(THEME_COLOR)},` +
  `${applyField.toString()},${JSON.stringify(FIELD_KEY)})`;

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

const fieldListeners = new Set<() => void>();
let unsavedField: FieldChoice | null = null;

export function getFieldChoice(): FieldChoice {
  if (unsavedField) return unsavedField;
  try { return localStorage.getItem(FIELD_KEY) === "themed" ? "themed" : "standard"; } catch { return "standard"; }
}

/** Keeps the field choice on this device and repaints; "standard" forgets it. */
export function setFieldChoice(choice: FieldChoice): void {
  try {
    if (choice === "standard") localStorage.removeItem(FIELD_KEY);
    else localStorage.setItem(FIELD_KEY, choice);
    unsavedField = null;
  } catch {
    unsavedField = choice;
  }
  applyField(FIELD_KEY, choice);
  fieldListeners.forEach((l) => { l(); });
}

export function subscribeFieldChoice(onChange: () => void): () => void {
  const onStorage = (e: StorageEvent): void => { if (e.key === FIELD_KEY || e.key === null) onChange(); };
  fieldListeners.add(onChange);
  addEventListener("storage", onStorage);
  return () => {
    fieldListeners.delete(onChange);
    removeEventListener("storage", onStorage);
  };
}

/**
 * What the app remembers about a failure, and nothing else.
 *
 * There is no error backend: a diagnostic is kept in memory and, when the browser allows
 * it, in a short list in localStorage, so a coach can paste it into a GitHub issue from
 * "Report a problem". Every string that reaches a diagnostic is scrubbed first: quoted
 * text (play names, notes, JSON snippets), share payloads (`/p/<id>`, `?p=`), long
 * tokens and email addresses are replaced, the route keeps its path but never its
 * query or a share id, and no storage value is ever read into one. Nothing here throws:
 * a failure to record a failure is swallowed, so drawing and saving are never blocked.
 */

export const DIAGNOSTICS_KEY = "ffpd.diagnostics.v1";
export const MAX_DIAGNOSTICS = 20;
export const REPO = "andysolomon/arc-play-flag";
/** The short commit this build was made from (Vercel), or "local". Inlined at build time. */
export const RELEASE = process.env.NEXT_PUBLIC_RELEASE ?? "local";
export const RELEASE_ENV = process.env.NEXT_PUBLIC_RELEASE_ENV ?? "development";

export type DiagnosticKind = "error" | "rejection" | "boundary" | "storage" | "export";
export type StorageState = "ok" | "full" | "unavailable";

export interface BrowserContext {
  /** the user agent, capped */
  ua: string;
  /** "390×844 @3x" */
  viewport: string;
  online: boolean | null;
  storage: StorageState;
  /** opened from the home screen as an installed app */
  standalone: boolean;
}

export interface Diagnostic {
  at: string;
  kind: DiagnosticKind;
  name: string;
  message: string;
  stack: string;
  /** Next's hash for a server-side error, when there is one */
  digest: string | null;
  /** the path with any share id or query removed */
  route: string;
  release: string;
  browser: BrowserContext | null;
}

const MAX_NAME = 60;
const MAX_MESSAGE = 240;
const MAX_STACK_LINES = 12;
const MAX_STACK = 1500;
const MAX_ROUTE = 80;
const MAX_UA = 200;

/** Every replacement runs on every string that goes into a diagnostic, in this order. */
const SCRUB: readonly (readonly [RegExp, string])[] = [
  // share ids in a path, and the ids the designer and playbooks read from the query
  [/\/p\/[A-Za-z0-9_\-%=]+/g, "/p/[id]"],
  [/([?&#](?:p|open|book)=)[^&\s"'#]*/g, "$1[id]"],
  // anything long enough to be a base64url payload
  [/[A-Za-z0-9_-]{40,}/g, "[payload]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
  // quoted text is where names, notes and JSON snippets show up in messages
  [/"[^"\n]*"|'[^'\n]*'|“[^”\n]*”|‘[^’\n]*’|`[^`\n]*`/g, "“…”"],
];

const cap = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** A string with names, notes, ids, payloads and addresses taken out. */
export function scrubText(s: string): string {
  let out = s;
  for (const [re, to] of SCRUB) out = out.replace(re, to);
  return out;
}

/** The path a URL points at, with the share id collapsed and the query and hash dropped. */
export function scrubRoute(url: string): string {
  let path: string;
  try {
    path = new URL(url, "http://local").pathname;
  } catch {
    return "/[unreadable]";
  }
  if (path === "/p" || path.startsWith("/p/")) return "/p/[id]";
  path = path.replace(/\/+$/, "") || "/";
  return cap(scrubText(path), MAX_ROUTE);
}

function scrubStack(stack: string): string {
  const lines = stack.split("\n").slice(0, MAX_STACK_LINES).map((l) => scrubText(l.trimEnd()));
  return cap(lines.join("\n"), MAX_STACK);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The parts of a thrown value that are safe to keep. Objects that aren't errors keep only their type. */
function describe(thrown: unknown): { name: string; message: string; stack: string; digest: string | null } {
  if (thrown instanceof Error) {
    const digest = isRecord(thrown) && typeof thrown.digest === "string" ? cap(scrubText(thrown.digest), MAX_NAME) : null;
    return {
      name: cap(scrubText(thrown.name || "Error"), MAX_NAME),
      message: cap(scrubText(thrown.message), MAX_MESSAGE),
      stack: typeof thrown.stack === "string" ? scrubStack(thrown.stack) : "",
      digest,
    };
  }
  if (typeof thrown === "string") return { name: "string", message: cap(scrubText(thrown), MAX_MESSAGE), stack: "", digest: null };
  if (typeof thrown === "number" || typeof thrown === "boolean" || thrown === null || thrown === undefined) {
    return { name: typeof thrown, message: String(thrown), stack: "", digest: null };
  }
  // an object or a function: its contents could be anything, so none of them travel
  const ctor = isRecord(thrown) && typeof thrown.constructor === "function" ? thrown.constructor.name : typeof thrown;
  return { name: cap(scrubText(ctor || typeof thrown), MAX_NAME), message: "[non-error value]", stack: "", digest: null };
}

export interface Env {
  /** the page's URL; only its scrubbed path is kept */
  href: string;
  release?: string;
  browser: BrowserContext | null;
  now?: Date;
}

/** One diagnostic from whatever was thrown. Pure, so the scrubbing is testable. */
export function toDiagnostic(kind: DiagnosticKind, thrown: unknown, env: Env): Diagnostic {
  return {
    at: (env.now ?? new Date()).toISOString(),
    kind,
    ...describe(thrown),
    route: scrubRoute(env.href),
    release: env.release ?? RELEASE,
    browser: env.browser,
  };
}

const KINDS: readonly DiagnosticKind[] = ["error", "rejection", "boundary", "storage", "export"];
const STATES: readonly StorageState[] = ["ok", "full", "unavailable"];
const str = (v: unknown, n: number): string => (typeof v === "string" ? cap(scrubText(v), n) : "");

/** A stored entry read back as data: re-scrubbed and re-capped, or dropped when it isn't one. */
export function normalizeDiagnostic(raw: unknown): Diagnostic | null {
  if (!isRecord(raw) || typeof raw.at !== "string" || !KINDS.includes(raw.kind as DiagnosticKind)) return null;
  const b = raw.browser;
  const browser: BrowserContext | null = isRecord(b)
    ? {
      ua: str(b.ua, MAX_UA),
      viewport: str(b.viewport, 40),
      online: typeof b.online === "boolean" ? b.online : null,
      storage: STATES.includes(b.storage as StorageState) ? (b.storage as StorageState) : "unavailable",
      standalone: b.standalone === true,
    }
    : null;
  return {
    at: cap(raw.at, 40),
    kind: raw.kind as DiagnosticKind,
    name: str(raw.name, MAX_NAME) || "Error",
    message: str(raw.message, MAX_MESSAGE),
    stack: typeof raw.stack === "string" ? scrubStack(raw.stack) : "",
    digest: typeof raw.digest === "string" ? cap(scrubText(raw.digest), MAX_NAME) : null,
    route: typeof raw.route === "string" ? scrubRoute(raw.route) : "/[unknown]",
    release: str(raw.release, 40) || "unknown",
    browser,
  };
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Whether this browser will take a write right now. Never throws. */
export function storageState(storage: StorageLike | null = browserStorage()): StorageState {
  if (!storage) return "unavailable";
  const probe = `${DIAGNOSTICS_KEY}.probe`;
  try {
    storage.setItem(probe, "1");
    storage.removeItem(probe);
    return "ok";
  } catch (e) {
    const quota = isRecord(e) && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22 || e.code === 1014);
    return quota ? "full" : "unavailable";
  }
}

/** The browser as it is right now, or null off the browser. Never throws. */
export function browserContext(): BrowserContext | null {
  if (typeof window === "undefined") return null;
  try {
    return {
      ua: cap(navigator.userAgent, MAX_UA),
      viewport: `${String(window.innerWidth)}×${String(window.innerHeight)} @${String(Math.round(window.devicePixelRatio * 10) / 10)}x`,
      online: typeof navigator.onLine === "boolean" ? navigator.onLine : null,
      storage: storageState(),
      standalone: window.matchMedia("(display-mode: standalone)").matches,
    };
  } catch {
    return null;
  }
}

let ring: Diagnostic[] = [];
let seeded = false;

function readStored(storage: StorageLike | null): Diagnostic[] {
  if (!storage) return [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(DIAGNOSTICS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeDiagnostic).filter((d): d is Diagnostic => d !== null).slice(-MAX_DIAGNOSTICS);
  } catch {
    return [];
  }
}

function seed(storage: StorageLike | null): void {
  if (seeded) return;
  seeded = true;
  ring = readStored(storage);
}

/**
 * Remembers a failure: in memory always, in localStorage when it can be written.
 * Returns what was recorded, or null when even that failed. Never throws.
 */
export function record(kind: DiagnosticKind, thrown: unknown, storage: StorageLike | null = browserStorage()): Diagnostic | null {
  try {
    seed(storage);
    const href = typeof window === "undefined" ? "/" : window.location.href;
    const d = toDiagnostic(kind, thrown, { href, browser: browserContext() });
    ring = [...ring, d].slice(-MAX_DIAGNOSTICS);
    try {
      storage?.setItem(DIAGNOSTICS_KEY, JSON.stringify(ring));
    } catch {
      /* a full or missing storage keeps the in-memory copy only */
    }
    return d;
  } catch {
    return null;
  }
}

/** The most recent diagnostics, oldest first. Never throws. */
export function recent(storage: StorageLike | null = browserStorage()): readonly Diagnostic[] {
  try {
    seed(storage);
    return ring;
  } catch {
    return [];
  }
}

/** Forgets every diagnostic; the next read seeds from storage again. */
export function clearDiagnostics(storage: StorageLike | null = browserStorage()): void {
  ring = [];
  seeded = false;
  try {
    storage?.removeItem(DIAGNOSTICS_KEY);
  } catch {
    /* nothing to clear */
  }
}

let uninstall: (() => void) | null = null;

/** Listens for errors nobody caught. Installs once; returns the matching uninstall. */
export function install(): () => void {
  if (uninstall) return uninstall;
  if (typeof window === "undefined") return () => undefined;
  const onError = (e: ErrorEvent) => { record("error", e.error ?? e.message); };
  const onRejection = (e: PromiseRejectionEvent) => { record("rejection", e.reason); };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  uninstall = () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    uninstall = null;
  };
  return uninstall;
}

const yesNo = (b: boolean | null, yes: string, no: string): string => (b === null ? "" : b ? yes : no);

function describeBrowser(b: BrowserContext | null): string[] {
  if (!b) return ["- Browser: unknown"];
  const bits = [b.viewport, yesNo(b.online, "online", "offline"), `storage ${b.storage}`, b.standalone ? "installed app" : "in a tab"].filter(Boolean);
  return [`- Browser: ${b.ua}`, `- Screen: ${bits.join(" · ")}`];
}

export interface ReportContext {
  release?: string;
  releaseEnv?: string;
  route?: string;
  browser?: BrowserContext | null;
}

/** The body of a GitHub issue: the release, page and browser, then the last few diagnostics. */
export function reportBody(diags: readonly Diagnostic[], ctx: ReportContext = {}): string {
  const release = ctx.release ?? RELEASE;
  const env = ctx.releaseEnv ?? RELEASE_ENV;
  const route = ctx.route ?? (typeof window === "undefined" ? "unknown" : scrubRoute(window.location.href));
  const browser = ctx.browser === undefined ? browserContext() : ctx.browser;
  const lines = [
    "### What happened",
    "",
    "_What were you doing, and what did you expect? Please don't paste your plays or notes: this report never includes them._",
    "",
    "### App",
    "",
    `- Release: \`${release}\` (${env})`,
    `- Page: \`${route}\``,
    ...describeBrowser(browser),
    "",
    "### Recent errors",
    "",
  ];
  if (!diags.length) lines.push("_None recorded._");
  diags.forEach((d, i) => {
    lines.push(`${String(i + 1)}. ${d.at} · ${d.kind} · ${d.name}: ${d.message || "(no message)"} · \`${d.route}\` · \`${d.release}\`${d.digest ? ` · digest ${d.digest}` : ""}`);
    if (d.stack) lines.push("", "   ```", ...d.stack.split("\n").map((l) => `   ${l}`), "   ```", "");
  });
  return lines.join("\n");
}

/** GitHub's limit on a URL it will open; the body is trimmed from the oldest error until it fits. */
export const MAX_REPORT_URL = 7000;

/** A "new issue" link for the repo with the report prefilled. Never throws. */
export function reportUrl(diags: readonly Diagnostic[] = recent(), ctx: ReportContext = {}): string {
  const base = `https://github.com/${REPO}/issues/new`;
  try {
    const title = encodeURIComponent("Problem report");
    let list = diags.slice(-5);
    for (;;) {
      const url = `${base}?title=${title}&body=${encodeURIComponent(reportBody(list, ctx))}`;
      if (url.length <= MAX_REPORT_URL || !list.length) return url;
      list = list.slice(1);
    }
  } catch {
    return base;
  }
}

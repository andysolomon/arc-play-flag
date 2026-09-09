import { describe, expect, test } from "bun:test";
import {
  DIAGNOSTICS_KEY, MAX_DIAGNOSTICS, MAX_REPORT_URL, clearDiagnostics, normalizeDiagnostic, recent, record, reportBody, reportUrl,
  scrubRoute, scrubText, storageState, toDiagnostic, type Diagnostic, type StorageLike,
} from "./diagnostics";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** A storage whose every call throws, the way a locked-down or broken browser does. */
function broken(): StorageLike {
  const boom = (): never => { throw new Error("SecurityError: storage is disabled"); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

const PAYLOAD = "eyJuYW1lIjoiVHJpcHMgcmlnaHQiLCJwbGF5ZXJzIjpbeyJpZCI6Im8xIn1dfQ";
const env = { href: "https://arc-play-flag.vercel.app/", release: "abc1234", browser: null, now: new Date("2026-09-08T12:00:00Z") };

describe("scrubRoute", () => {
  test("keeps the path and drops the query, so /?p=<payload> never travels", () => {
    expect(scrubRoute(`https://arc-play-flag.vercel.app/?p=${PAYLOAD}`)).toBe("/");
    expect(scrubRoute("https://arc-play-flag.vercel.app/playbooks?book=k3j2h1#top")).toBe("/playbooks");
    expect(scrubRoute("/?open=abc")).toBe("/");
  });
  test("collapses a share id to /p/[id]", () => {
    expect(scrubRoute(`https://arc-play-flag.vercel.app/p/${PAYLOAD}`)).toBe("/p/[id]");
    expect(scrubRoute("/p/short")).toBe("/p/[id]");
    expect(scrubRoute("/p")).toBe("/p/[id]");
    expect(scrubRoute("/demo/")).toBe("/demo");
  });
  test("caps an unexpectedly long path", () => {
    expect(scrubRoute("/" + "a/".repeat(100)).length).toBeLessThanOrEqual(80);
  });
});

describe("scrubText", () => {
  test("takes quoted text out, which is where play names and notes appear in messages", () => {
    expect(scrubText("Opened “Trips right” · undo brings “Bunch left” back")).toBe("Opened “…” · undo brings “…” back");
    expect(scrubText(`Unexpected token 'T', "Trips right" is not valid JSON`)).toBe("Unexpected token “…”, “…” is not valid JSON");
    expect(scrubText("play `Bunch` failed")).toBe("play “…” failed");
  });
  test("takes share ids and long payloads out of URLs and text", () => {
    expect(scrubText(`fetch https://arc-play-flag.vercel.app/p/${PAYLOAD} failed`)).toBe("fetch https://arc-play-flag.vercel.app/p/[id] failed");
    expect(scrubText(`at /?p=${PAYLOAD}&x=1`)).toBe("at /?p=[id]&x=1");
    expect(scrubText("open /playbooks?book=abc123")).toBe("open /playbooks?book=[id]");
    expect(scrubText(`token ${PAYLOAD}`)).toBe("token [payload]");
    expect(scrubText("mail coach@example.com now")).toBe("mail [email] now");
  });
  test("leaves ordinary error text alone", () => {
    expect(scrubText("Cannot read properties of undefined (reading x)")).toBe("Cannot read properties of undefined (reading x)");
    expect(scrubText("storage quota: ffpd.plays.v2")).toBe("storage quota: ffpd.plays.v2");
  });
});

describe("toDiagnostic", () => {
  test("keeps name, scrubbed message, scrubbed and capped stack, digest, route and release", () => {
    const e = new Error(`Couldn't open "Trips right" from /p/${PAYLOAD}`) as Error & { digest?: string };
    e.digest = "1234567890";
    e.stack = ["Error: x", ...Array.from({ length: 30 }, (_, i) => `    at fn${String(i)} (https://arc-play-flag.vercel.app/p/${PAYLOAD}:1:${String(i)})`)].join("\n");
    const d = toDiagnostic("boundary", e, { ...env, href: `https://arc-play-flag.vercel.app/p/${PAYLOAD}` });
    expect(d).toMatchObject({ at: "2026-09-08T12:00:00.000Z", kind: "boundary", name: "Error", digest: "1234567890", route: "/p/[id]", release: "abc1234", browser: null });
    expect(d.message).toBe("Couldn't open “…” from /p/[id]");
    expect(d.stack.split("\n")).toHaveLength(12);
    expect(d.stack).not.toContain(PAYLOAD);
    expect(d.stack).toContain("/p/[id]");
  });
  test("keeps only the type of a thrown object, since its fields could be anything", () => {
    const d = toDiagnostic("rejection", { name: "Trips right", players: [] }, env);
    expect(d.name).toBe("Object");
    expect(d.message).toBe("[non-error value]");
    expect(JSON.stringify(d)).not.toContain("Trips");
    expect(toDiagnostic("rejection", "Opened “Trips right”", env).message).toBe("Opened “…”");
    expect(toDiagnostic("rejection", undefined, env)).toMatchObject({ name: "undefined", message: "undefined" });
  });
  test("caps a runaway message", () => {
    expect(toDiagnostic("error", new Error("word ".repeat(300)), env).message.length).toBe(240);
  });
});

describe("record and recent", () => {
  test("keeps the last entries in memory and in storage, newest last", () => {
    const s = memory();
    clearDiagnostics(s);
    for (let i = 0; i < MAX_DIAGNOSTICS + 3; i++) record("error", new Error(`e${String(i)}`), s);
    const all = recent(s);
    expect(all).toHaveLength(MAX_DIAGNOSTICS);
    expect(all[0]?.message).toBe("e3");
    expect(all[all.length - 1]?.message).toBe(`e${String(MAX_DIAGNOSTICS + 2)}`);
    const stored: unknown = JSON.parse(s.data.get(DIAGNOSTICS_KEY) ?? "");
    expect(Array.isArray(stored) && stored.length).toBe(MAX_DIAGNOSTICS);
  });
  test("still records in memory when storage is missing or throws", () => {
    clearDiagnostics(null);
    expect(record("storage", new Error("storage unavailable: ffpd.plays.v2"), null)?.message).toBe("storage unavailable: ffpd.plays.v2");
    expect(recent(null)).toHaveLength(1);
    const b = broken();
    expect(() => { clearDiagnostics(b); }).not.toThrow();
    expect(record("error", new Error("still here"), b)?.message).toBe("still here");
    expect(recent(b).map((d) => d.message)).toEqual(["still here"]);
    expect(storageState(b)).toBe("unavailable");
    expect(storageState(null)).toBe("unavailable");
    expect(storageState(memory())).toBe("ok");
  });
  test("reports a full storage as full and keeps going", () => {
    const full: StorageLike = {
      getItem: () => null,
      setItem: () => { const e = new Error("quota"); e.name = "QuotaExceededError"; throw e; },
      removeItem: () => undefined,
    };
    clearDiagnostics(full);
    expect(storageState(full)).toBe("full");
    expect(record("storage", new Error("storage quota: ffpd.plays.v2"), full)).not.toBeNull();
    expect(recent(full)).toHaveLength(1);
  });
  test("reads stored entries back as data: junk is dropped and text is scrubbed again", () => {
    const s = memory();
    s.setItem(DIAGNOSTICS_KEY, JSON.stringify([
      { at: "2026-09-08T12:00:00.000Z", kind: "error", name: "Error", message: `“Trips right” /p/${PAYLOAD}`, route: `/p/${PAYLOAD}?p=x`, release: "abc", browser: { ua: "UA", online: "yes", storage: "weird" } },
      { at: 5, kind: "error" },
      "junk",
      { at: "2026-09-08T12:00:01.000Z", kind: "nope", name: "Error" },
    ]));
    clearDiagnostics(null);
    const all = recent(s);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "error", message: "“…” /p/[id]", route: "/p/[id]", release: "abc", browser: { ua: "UA", online: null, storage: "unavailable", standalone: false } });
    expect(normalizeDiagnostic({ at: 5, kind: "error" })).toBeNull();
    expect(normalizeDiagnostic("junk")).toBeNull();
    expect(normalizeDiagnostic({ at: "x", kind: "nope" })).toBeNull();
    expect(normalizeDiagnostic(null)).toBeNull();
    // a broken storage seeds to nothing rather than throwing
    clearDiagnostics(null);
    expect(recent(broken())).toEqual([]);
  });
});

describe("report", () => {
  const diag: Diagnostic = {
    at: "2026-09-08T12:00:00.000Z", kind: "boundary", name: "TypeError", message: "x is not a function", stack: "TypeError: x is not a function\n    at f (chunk.js:1:2)",
    digest: null, route: "/", release: "abc1234", browser: null,
  };
  const ctx = { release: "abc1234", releaseEnv: "production", route: "/playbooks", browser: { ua: "TestUA", viewport: "390×844 @3x", online: false, storage: "ok" as const, standalone: true } };
  test("lists release, page, browser and each error with its stack", () => {
    const body = reportBody([diag], ctx);
    expect(body).toContain("- Release: `abc1234` (production)");
    expect(body).toContain("- Page: `/playbooks`");
    expect(body).toContain("- Browser: TestUA");
    expect(body).toContain("390×844 @3x · offline · storage ok · installed app");
    expect(body).toContain("1. 2026-09-08T12:00:00.000Z · boundary · TypeError: x is not a function · `/` · `abc1234`");
    expect(body).toContain("   at f (chunk.js:1:2)");
    expect(body).toContain("never includes them");
    expect(reportBody([], ctx)).toContain("_None recorded._");
    expect(reportBody([], { ...ctx, browser: null })).toContain("- Browser: unknown");
  });
  test("opens a new issue on the repo with the body prefilled, and trims to fit a URL", () => {
    const url = reportUrl([diag], ctx);
    expect(url.startsWith("https://github.com/andysolomon/arc-play-flag/issues/new?title=Problem%20report&body=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("x is not a function");
    const big = Array.from({ length: 5 }, (_, i) => ({ ...diag, message: `e${String(i)}`, stack: "at x\n".repeat(200) }));
    const trimmed = reportUrl(big, ctx);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_REPORT_URL);
    // the newest error survives the trim
    expect(decodeURIComponent(trimmed)).toContain("TypeError: e4 ·");
  });
});

import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const ORIGIN = "https://play.test";
const SOURCE = readFileSync(join(import.meta.dir, "sw.js"), "utf8");

const keyFor = (input: RequestInfo | URL): string => {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const url = new URL(raw, ORIGIN);
  return url.pathname + url.search;
};

class MemoryCache {
  readonly entries = new Map<string, Response>();

  delete(input: RequestInfo | URL): Promise<boolean> {
    return Promise.resolve(this.entries.delete(keyFor(input)));
  }

  match(input: RequestInfo | URL): Promise<Response | undefined> {
    return Promise.resolve(this.entries.get(keyFor(input))?.clone());
  }

  put(input: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(keyFor(input), response.clone());
    return Promise.resolve();
  }
}

class MemoryCaches {
  readonly stores = new Map<string, MemoryCache>();

  open(name: string): Promise<MemoryCache> {
    let cache = this.stores.get(name);
    if (!cache) {
      cache = new MemoryCache();
      this.stores.set(name, cache);
    }
    return Promise.resolve(cache);
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.stores.keys()]);
  }

  delete(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.delete(name));
  }

  async match(input: RequestInfo | URL): Promise<Response | undefined> {
    for (const cache of this.stores.values()) {
      const response = await cache.match(input);
      if (response) return response;
    }
  }
}

type WorkerEvent = "install" | "activate" | "fetch" | "message";
type Listener = (event: Record<string, unknown>) => void;
type Fetcher = (input: RequestInfo | URL) => Promise<Response>;

function harness() {
  const listeners = new Map<WorkerEvent, Listener>();
  const caches = new MemoryCaches();
  const fetched: string[] = [];
  const posted: unknown[] = [];
  let skipped = false;
  let claimed = false;
  let fetcher: Fetcher = (input) => {
    const key = keyFor(input);
    const html = key === "/"
      ? '<script src="/_next/static/designer.js"></script><link href="/_next/static/app.css"><img srcSet="/responsive/src-small.png 400w, /responsive/src-large.png 800w, https://cdn.test/src-remote.png 1200w" imageSrcSet="/responsive/image-small.png 1x, /responsive/image-large.png 2x, https://cdn.test/image-remote.png 3x">'
      : key === "/playbooks"
        ? '<script src="/_next/static/playbooks.js"></script>'
        : key === "/demo"
          ? '<script src="/_next/static/demo.js"></script>'
          : key === "/_next/static/app.css"
            ? '@font-face { src: url("./fonts/test-latin-400.woff2") format("woff2"); }\n@font-face { src: url("./fonts/test-latin-700.woff2") format("woff2"); }'
          : "asset";
    return Promise.resolve(new Response(html, {
      status: 200,
      headers: key === "/_next/static/app.css" ? { "content-type": "text/css" } : undefined,
    }));
  };

  const self = {
    location: { origin: ORIGIN },
    addEventListener(type: WorkerEvent, listener: Listener) { listeners.set(type, listener); },
    skipWaiting() { skipped = true; return Promise.resolve(); },
    clients: {
      claim() { claimed = true; return Promise.resolve(); },
      matchAll() { return Promise.resolve([{ postMessage: (value: unknown) => posted.push(value) }]); },
    },
  };

  runInNewContext(SOURCE, {
    self,
    caches,
    URL,
    Response,
    Headers,
    fetch: (input: RequestInfo | URL) => {
      fetched.push(keyFor(input));
      return fetcher(input);
    },
    console,
    Set,
    Promise,
    Number,
    Error,
  });

  const lifetime = async (type: "install" | "activate") => {
    let promise: Promise<unknown> | undefined;
    listeners.get(type)?.({ waitUntil(next: Promise<unknown>) { promise = next; } });
    if (!promise) throw new Error(`${type} did not extend its lifetime`);
    await promise;
  };

  const request = (path: string, options: { mode?: string; range?: string } = {}) => ({
    method: "GET",
    mode: options.mode ?? "same-origin",
    url: ORIGIN + path,
    headers: new Headers(options.range ? { range: options.range } : undefined),
  }) as Request;

  const dispatchFetch = async (next: Request): Promise<Response> => {
    let response: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners.get("fetch")?.({
      request: next,
      respondWith(value: Promise<Response>) { response = value; },
      waitUntil(value: Promise<unknown>) { waits.push(value); },
    });
    if (!response) throw new Error("fetch was not handled");
    const result = await response;
    await Promise.all(waits);
    return result;
  };

  return {
    caches,
    fetched,
    posted,
    request,
    dispatchFetch,
    lifetime,
    setFetch(next: Fetcher) { fetcher = next; },
    get skipped() { return skipped; },
    get claimed() { return claimed; },
  };
}

describe("offline service worker", () => {
  let worker: ReturnType<typeof harness>;

  beforeEach(() => { worker = harness(); });

  test("claims readiness only after every route, advertised demo, icon, and discovered build asset is cached", async () => {
    await worker.lifetime("install");

    const shell = await worker.caches.open("ffpd-shell-v5");
    expect(await shell.match("/__ffpd_offline_ready__")).toBeDefined();
    expect(worker.fetched).toContain("/");
    expect(worker.fetched).toContain("/playbooks");
    expect(worker.fetched).toContain("/demo");
    expect(worker.fetched).toContain("/demos/save-export.mp4");
    expect(worker.fetched).toContain("/icons/zoneFlat.png");
    expect(worker.fetched).toContain("/_next/static/designer.js");
    expect(worker.fetched).toContain("/_next/static/playbooks.js");
    expect(worker.fetched).toContain("/_next/static/demo.js");
    expect(worker.fetched).toContain("/_next/static/app.css");
    expect(worker.fetched).toContain("/_next/static/fonts/test-latin-400.woff2");
    expect(worker.fetched).toContain("/_next/static/fonts/test-latin-700.woff2");
    for (const asset of [
      "/responsive/src-small.png",
      "/responsive/src-large.png",
      "/responsive/image-small.png",
      "/responsive/image-large.png",
    ]) {
      expect(worker.fetched).toContain(asset);
      expect(await shell.match(asset)).toBeDefined();
    }
    expect(worker.fetched).not.toContain("/src-remote.png");
    expect(worker.fetched).not.toContain("/image-remote.png");
    expect(await shell.match("/_next/static/fonts/test-latin-400.woff2")).toBeDefined();
    expect(await shell.match("/_next/static/fonts/test-latin-700.woff2")).toBeDefined();
    for (const file of readdirSync(join(import.meta.dir, "icons"))) expect(worker.fetched).toContain(`/icons/${file}`);
    for (const file of readdirSync(join(import.meta.dir, "demos"))) expect(worker.fetched).toContain(`/demos/${file}`);
    expect(worker.skipped).toBe(true);
  });

  test("a missing required asset aborts install without a ready marker", async () => {
    worker.setFetch((input) => Promise.resolve(keyFor(input) === "/demos/save-export.mp4"
      ? new Response("missing", { status: 404 })
      : new Response("asset", { status: 200 })));

    let failure: unknown;
    try {
      await worker.lifetime("install");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("Offline asset unavailable");
    expect(await (await worker.caches.open("ffpd-shell-v5")).match("/__ffpd_offline_ready__")).toBeUndefined();
    expect(worker.skipped).toBe(false);
  });

  test("preserves exact shared responses and refuses to substitute another play", async () => {
    worker.setFetch((input) => Promise.resolve(new Response(`snapshot:${keyFor(input)}`, { status: 200 })));
    const visited = await worker.dispatchFetch(worker.request("/p/exact-play", { mode: "navigate" }));
    expect(await visited.text()).toBe("snapshot:/p/exact-play");

    worker.setFetch(() => Promise.reject(new TypeError("offline")));
    const cached = await worker.dispatchFetch(worker.request("/p/exact-play", { mode: "navigate" }));
    expect(await cached.text()).toBe("snapshot:/p/exact-play");

    const missing = await worker.dispatchFetch(worker.request("/p/different-play", { mode: "navigate" }));
    expect(missing.status).toBe(503);
    expect(await missing.text()).toContain("Shared play unavailable offline");
  });

  test("serves cached media ranges and contains failed background refreshes", async () => {
    const shell = await worker.caches.open("ffpd-shell-v5");
    await shell.put("/demos/run-play.webm", new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), {
      headers: { "content-type": "video/webm" },
    }));
    worker.setFetch(() => Promise.reject(new TypeError("offline")));

    const partial = await worker.dispatchFetch(worker.request("/demos/run-play.webm", { range: "bytes=2-5" }));
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe("bytes 2-5/8");
    expect([...new Uint8Array(await partial.arrayBuffer())]).toEqual([2, 3, 4, 5]);

    const whole = await worker.dispatchFetch(worker.request("/demos/run-play.webm"));
    expect(whole.status).toBe(200);
  });

  test("deletes only superseded shell caches and leaves shared snapshots and foreign caches intact", async () => {
    await worker.caches.open("ffpd-shell-v5");
    await worker.caches.open("ffpd-shell-v4");
    await worker.caches.open("ffpd-shell-v3");
    await worker.caches.open("ffpd-v3");
    await worker.caches.open("ffpd-snapshots-v1");
    await worker.caches.open("another-app");

    await worker.lifetime("activate");

    expect(await worker.caches.keys()).toEqual(["ffpd-shell-v5", "ffpd-snapshots-v1", "another-app"]);
    expect(worker.claimed).toBe(true);
    expect(worker.posted).toContainEqual({ type: "FFPD_OFFLINE_STATUS", status: "ready" });
  });
});

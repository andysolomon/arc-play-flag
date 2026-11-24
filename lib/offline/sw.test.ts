import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { stampWorker } from "./release";

const ORIGIN = "https://play.test";
// what scripts/stamp-sw.ts ships for a build whose release is "test"
const SOURCE = stampWorker(readFileSync(join(import.meta.dir, "sw.js"), "utf8"), "test");

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

  has(name: string): Promise<boolean> {
    return Promise.resolve(this.stores.has(name));
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

type Listener = (event: Record<string, unknown>) => void;
type Fetcher = (input: RequestInfo | URL) => Promise<Response>;

function harness() {
  const listeners = new Map<string, Listener>();
  const caches = new MemoryCaches();
  let fetcher: Fetcher = () => Promise.reject(new TypeError("no network in this test"));

  const self = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    addEventListener(type: string, listener: Listener) { listeners.set(type, listener); },
  };

  runInNewContext(SOURCE, {
    self,
    caches,
    URL,
    Response,
    Headers,
    fetch: (input: RequestInfo | URL) => fetcher(input),
    console,
    Set,
    Promise,
    Number,
    Error,
  });

  const request = (path: string, mode = "navigate") => ({
    method: "GET",
    mode,
    url: ORIGIN + path,
    headers: new Headers(),
  }) as Request;

  const install = async () => {
    let done: Promise<unknown> | undefined;
    listeners.get("install")?.({ waitUntil(next: Promise<unknown>) { done = next; } });
    await done;
  };

  const status = async (): Promise<unknown[]> => {
    const replies: unknown[] = [];
    let done: Promise<unknown> | undefined;
    listeners.get("message")?.({
      data: { type: "FFPD_OFFLINE_STATUS_REQUEST" },
      source: { postMessage: (value: unknown) => replies.push(value) },
      waitUntil(next: Promise<unknown>) { done = next; },
    });
    await done;
    return replies;
  };

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
    request,
    install,
    status,
    dispatchFetch,
    setFetch(next: Fetcher) { fetcher = next; },
  };
}

// The rest of the worker is proven in the browser: e2e/journeys/offline.journey.ts and update.journey.ts.
// Chromium holds a new release's activation until the old worker's requests finish, so the race below cannot be staged there.
describe("offline service worker", () => {
  let worker: ReturnType<typeof harness>;

  beforeEach(() => { worker = harness(); });

  test("preserves exact shared responses and refuses to substitute another play", async () => {
    worker.setFetch((input) => Promise.resolve(new Response(`snapshot:${keyFor(input)}`, { status: 200 })));
    const visited = await worker.dispatchFetch(worker.request("/p/exact-play"));
    expect(await visited.text()).toBe("snapshot:/p/exact-play");

    worker.setFetch(() => Promise.reject(new TypeError("offline")));
    const cached = await worker.dispatchFetch(worker.request("/p/exact-play"));
    expect(await cached.text()).toBe("snapshot:/p/exact-play");

    const missing = await worker.dispatchFetch(worker.request("/p/different-play"));
    expect(missing.status).toBe(503);
    expect(await missing.text()).toContain("Shared play unavailable offline");
  });

  test("hosted book links are never cached and cannot substitute a local book offline", async () => {
    const path = "/s/abcdefghijklmnop";
    worker.setFetch(() => Promise.resolve(new Response("shared book")));
    expect(await (await worker.dispatchFetch(worker.request(path))).text()).toBe("shared book");
    expect(await worker.caches.match(path)).toBeUndefined();
    worker.setFetch(() => Promise.reject(new TypeError("offline")));
    const response = await worker.dispatchFetch(worker.request(path));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Shared playbook unavailable offline");
  });

  test("a superseded worker never re-creates the shell a newer release swept", async () => {
    worker.setFetch(() => Promise.resolve(new Response("asset", { status: 200 })));
    await worker.install();
    await worker.caches.delete("ffpd-shell-test");

    expect((await worker.dispatchFetch(worker.request("/_next/static/late.js", "same-origin"))).status).toBe(200);
    expect((await worker.dispatchFetch(worker.request("/"))).status).toBe(200);
    expect(await worker.status()).toEqual([{ type: "FFPD_OFFLINE_STATUS", status: "unavailable", release: "test" }]);
    expect(await worker.caches.keys()).not.toContain("ffpd-shell-test");
  });
});

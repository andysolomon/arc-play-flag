import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { stampWorker } from "./release";

const ORIGIN = "https://play.test";
const PUBLIC = join(import.meta.dir, "../../public");
const TEMPLATE = readFileSync(join(import.meta.dir, "sw.js"), "utf8");
// what scripts/stamp-sw.ts ships for a build whose release is "test"
const SOURCE = stampWorker(TEMPLATE, "test");

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

type WorkerEvent = "install" | "activate" | "fetch" | "message";
type Listener = (event: Record<string, unknown>) => void;
type Fetcher = (input: RequestInfo | URL) => Promise<Response>;

function harness() {
  const listeners = new Map<WorkerEvent, Listener>();
  const caches = new MemoryCaches();
  const fetched: string[] = [];
  let skipped = false;
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
    location: { origin: ORIGIN, href: ORIGIN + "/sw.js" },
    addEventListener(type: WorkerEvent, listener: Listener) { listeners.set(type, listener); },
    skipWaiting() { skipped = true; return Promise.resolve(); },
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

  const install = async () => {
    let promise: Promise<unknown> | undefined;
    listeners.get("install")?.({ waitUntil(next: Promise<unknown>) { promise = next; } });
    if (!promise) throw new Error("install did not extend its lifetime");
    await promise;
  };

  const request = (path: string, mode = "same-origin") => ({
    method: "GET",
    mode,
    url: ORIGIN + path,
    headers: new Headers(),
  }) as Request;

  const dispatchMessage = async (data: unknown): Promise<unknown[]> => {
    const replies: unknown[] = [];
    let wait: Promise<unknown> | undefined;
    listeners.get("message")?.({
      data,
      source: { postMessage: (value: unknown) => replies.push(value) },
      waitUntil(value: Promise<unknown>) { wait = value; },
    });
    await wait;
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
    fetched,
    request,
    dispatchFetch,
    dispatchMessage,
    install,
    setFetch(next: Fetcher) { fetcher = next; },
    get skipped() { return skipped; },
  };
}

describe("offline service worker", () => {
  let worker: ReturnType<typeof harness>;

  beforeEach(() => { worker = harness(); });

  test("claims readiness only after every route, advertised demo, icon, and discovered build asset is cached", async () => {
    await worker.install();

    const shell = await worker.caches.open("ffpd-shell-test");
    expect(await shell.match("/__ffpd_offline_ready__")).toBeDefined();
    expect(worker.fetched).toContain("/");
    expect(worker.fetched).toContain("/playbooks");
    expect(worker.fetched).toContain("/demo");
    expect(worker.fetched).toContain("/demos/save-share.mp4");
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
    for (const file of readdirSync(join(PUBLIC, "icons"))) expect(worker.fetched).toContain(`/icons/${file}`);
    for (const file of readdirSync(join(PUBLIC, "demos"))) expect(worker.fetched).toContain(`/demos/${file}`);
    // a complete install still waits for the page: the coach decides when to reload
    expect(worker.skipped).toBe(false);
  });

  test("a superseded worker never re-creates the shell a newer release swept", async () => {
    await worker.install();
    await worker.caches.delete("ffpd-shell-test");

    const asset = await worker.dispatchFetch(worker.request("/_next/static/late.js"));
    expect(asset.status).toBe(200);
    const page = await worker.dispatchFetch(worker.request("/", "navigate"));
    expect(page.status).toBe(200);
    expect(await worker.dispatchMessage({ type: "FFPD_OFFLINE_STATUS_REQUEST" }))
      .toEqual([{ type: "FFPD_OFFLINE_STATUS", status: "unavailable", release: "test" }]);
    expect(await worker.caches.keys()).not.toContain("ffpd-shell-test");
  });

  test("stores each optimizer url as the source icon and never calls the optimizer", async () => {
    worker.setFetch((input) => {
      const key = keyFor(input);
      if (key.startsWith("/_next/image")) return Promise.reject(new Error("optimizer stalled"));
      const html = key === "/"
        ? '<img src="/_next/image?url=%2Ficons%2FzoneFlat.png&amp;w=40&amp;q=75" srcSet="/_next/image?url=%2Ficons%2FzoneFlat.png&amp;w=56&amp;q=75 56w">'
        : key === "/icons/zoneFlat.png"
          ? "png-bytes"
          : "asset";
      return Promise.resolve(new Response(html, { status: 200 }));
    });

    await worker.install();
    const shell = await worker.caches.open("ffpd-shell-test");
    const sized = await shell.match("/_next/image?url=%2Ficons%2FzoneFlat.png&w=56&q=75");
    expect(sized).toBeDefined();
    expect(await sized?.text()).toBe("png-bytes");
    expect(await (await shell.match("/_next/image?url=%2Ficons%2FzoneFlat.png&w=40&q=75"))?.text()).toBe("png-bytes");
    expect(worker.fetched.some((path) => path.startsWith("/_next/image"))).toBe(false);
  });
});

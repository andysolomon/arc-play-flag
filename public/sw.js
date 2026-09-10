/* Verified offline shell for the sideline. Keep this dependency-free. */
const CACHE = "ffpd-shell-v5";
const SNAPSHOTS = "ffpd-snapshots-v1";
const READY = "/__ffpd_offline_ready__";
const SHELLS = ["/", "/playbooks", "/demo"];
const DEMOS = ["build-play", "run-play", "build-defense", "save-export", "playbooks"];
const ICONS = [
  "app-192", "app-512", "app-maskable-512", "blitz", "clear", "corner", "counter", "cross", "curl", "curlFlat",
  "customDef", "customOff", "defOnly", "delay", "demo", "deselectDef", "deselectOff", "dive", "duplicate", "export",
  "flat", "flip", "football", "go", "handoff", "in", "man", "midRead", "new", "notes", "offOnly", "out", "pitch",
  "playbook", "post", "reset", "reverse", "save", "slant", "spy", "stretch", "wheel", "zoneDeep", "zoneFlat",
];
const REQUIRED = [
  ...SHELLS,
  "/manifest.webmanifest",
  ...ICONS.map((name) => `/icons/${name}.png`),
  ...DEMOS.flatMap((slug) => ["webm", "mp4", "webp"].map((extension) => `/demos/${slug}.${extension}`)),
];

const requiredResponse = async (path) => {
  const response = await fetch(path, { cache: "reload" });
  if (!response.ok || response.status === 206) throw new Error(`Offline asset unavailable: ${path}`);
  return response;
};

const localAssets = (html) => {
  const assets = new Set();
  for (const match of html.matchAll(/((?:src|href|srcSet|imageSrcSet))=["']([^"']+)["']/gi)) {
    const candidates = /srcset$/i.test(match[1])
      ? match[2].split(",").map((candidate) => candidate.trim().split(/\s+/, 1)[0]).filter(Boolean)
      : [match[2]];
    for (const candidate of candidates) {
      const value = candidate.replaceAll("&amp;", "&");
      const url = new URL(value, self.location.origin);
      if (url.origin === self.location.origin && url.pathname !== "/sw.js") assets.add(url.pathname + url.search);
    }
  }
  return assets;
};

const cssAssets = (css, basePath) => {
  const assets = new Set();
  const base = new URL(basePath, self.location.origin);
  const add = (value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    try {
      const url = new URL(trimmed, base);
      if (url.origin === self.location.origin && url.pathname !== "/sw.js") assets.add(url.pathname + url.search);
    } catch {
      // Invalid CSS URLs are ignored just as a browser ignores the malformed declaration.
    }
  };

  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    add(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const match of css.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    add(match[1] ?? match[2] ?? "");
  }
  return assets;
};

const isStylesheet = (path, response) => {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  return contentType === "text/css" || new URL(path, self.location.origin).pathname.toLowerCase().endsWith(".css");
};

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.delete(READY);

    // Route HTML is inspected because Next.js fingerprints its scripts, styles and
    // fonts at build time. Public assets are explicit so lazy demo media and controls
    // are part of the same all-or-nothing readiness contract.
    const discovered = new Set();
    for (const path of REQUIRED) {
      const response = await requiredResponse(path);
      if (SHELLS.includes(path)) {
        for (const asset of localAssets(await response.clone().text())) discovered.add(asset);
      }
      await cache.put(path, response);
    }
    for (const path of discovered) {
      if (REQUIRED.includes(path)) continue;
      const response = await requiredResponse(path);
      if (isStylesheet(path, response)) {
        for (const asset of cssAssets(await response.clone().text(), path)) discovered.add(asset);
      }
      await cache.put(path, response);
    }

    await cache.put(READY, new Response("ready", { headers: { "content-type": "text/plain" } }));
    await self.skipWaiting();
  })());
});

const isOwnedOldCache = (name) => name !== CACHE && (name.startsWith("ffpd-shell-") || /^ffpd-v\d+$/.test(name));

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Installation cannot reach this point until the new shell is complete. Exact
    // shared snapshots live separately and therefore survive shell cache upgrades.
    const keys = await caches.keys();
    await Promise.all(keys.filter(isOwnedOldCache).map((key) => caches.delete(key)));
    await self.clients.claim();
    const clients = await self.clients.matchAll({ type: "window" });
    for (const client of clients) client.postMessage({ type: "FFPD_OFFLINE_STATUS", status: "ready" });
  })());
});

const shellFor = (url) => {
  if (url.pathname === "/" || url.pathname === "") return "/";
  if (/^\/playbooks\/?$/.test(url.pathname)) return "/playbooks";
  if (/^\/demo\/?$/.test(url.pathname)) return "/demo";
  return null;
};

const isShared = (url) => /^\/p\/[^/]+\/?$/.test(url.pathname);
const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/image") ||
  url.pathname === "/manifest.webmanifest" || url.pathname.startsWith("/icons/") || url.pathname.startsWith("/demos/");

const unavailable = (shared) => new Response(`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${shared ? "Shared play unavailable" : "Page unavailable"}</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f4efe2;color:#17202a;font:22px system-ui,sans-serif">
<main style="max-width:32rem;padding:2rem;text-align:center"><h1>${shared ? "Shared play unavailable offline" : "Page unavailable offline"}</h1>
<p>${shared ? "This exact shared play was not saved on this device. Reconnect and open its link once before using it offline." : "Reconnect and visit this page once before using it offline."}</p>
<p><a href="/" style="color:inherit">Open the designer</a></p></main></body></html>`, {
  status: 503,
  headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
});

const cacheNavigation = async (url, response, shell) => {
  if (!response.ok) return;
  const cache = await caches.open(shell ? CACHE : SNAPSHOTS);
  await cache.put(shell || url.pathname + url.search, response.clone());
};

const cachedNavigation = async (url, shell) => {
  if (shell) return (await caches.open(CACHE)).match(shell);
  return (await caches.open(SNAPSHOTS)).match(url.pathname + url.search);
};

const navigationResponse = async (request, url, shell) => {
  try {
    const response = await fetch(request);
    if (response.ok) await cacheNavigation(url, response, shell);
    return response;
  } catch {
    return (await cachedNavigation(url, shell)) || unavailable(isShared(url));
  }
};

const cachedStatic = async (request) => {
  const current = await (await caches.open(CACHE)).match(request);
  return current || caches.match(request);
};

const refreshStatic = async (request) => {
  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) await (await caches.open(CACHE)).put(request, response.clone());
  } catch {
    // A stale response remains useful; failed refreshes must not reject waitUntil.
  }
};

const ranged = async (request, response) => {
  const header = request.headers.get("range");
  if (!header || response.status !== 200) return response;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  const body = await response.arrayBuffer();
  const size = body.byteLength;
  if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });

  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[2] && match[1] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  }
  end = Math.min(end, size - 1);
  const headers = new Headers(response.headers);
  headers.set("accept-ranges", "bytes");
  headers.set("content-range", `bytes ${start}-${end}/${size}`);
  headers.set("content-length", String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, statusText: "Partial Content", headers });
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    const shell = shellFor(url);
    if (shell || isShared(url)) event.respondWith(navigationResponse(request, url, shell));
    else event.respondWith(fetch(request).catch(() => unavailable(false)));
    return;
  }
  if (!isStatic(url)) return;

  const hitPromise = cachedStatic(request);
  if (!request.headers.has("range")) {
    event.waitUntil(hitPromise.then((hit) => hit ? refreshStatic(request) : undefined));
  }
  event.respondWith((async () => {
    const hit = await hitPromise;
    if (hit) {
      if (request.headers.has("range")) return ranged(request, hit);
      return hit;
    }
    const response = await fetch(request);
    if (response.ok && response.status === 200) await (await caches.open(CACHE)).put(request, response.clone());
    return response;
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "FFPD_OFFLINE_STATUS_REQUEST") return;
  event.waitUntil((async () => {
    const ready = !!(await (await caches.open(CACHE)).match(READY));
    event.source?.postMessage({ type: "FFPD_OFFLINE_STATUS", status: ready ? "ready" : "unavailable" });
  })());
});

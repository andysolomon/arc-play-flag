/* Offline shell for the sideline: cache the pages and their static assets. No dependencies. */
const VERSION = "ffpd-v2";
const SHELL = ["/", "/playbooks"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const isStatic = (url) =>
  url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/_next/image") || url.pathname.startsWith("/icons/");

/** Which cached shell answers a navigation: the playbooks page for /playbooks, the designer otherwise. */
const shellFor = (url) => (url.pathname.startsWith("/playbooks") ? "/playbooks" : "/");

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    // network first, fall back to the cached shell
    const shell = shellFor(url);
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === shell) caches.open(VERSION).then((c) => c.put(shell, res.clone()));
          return res;
        })
        .catch(() => caches.match(shell).then((hit) => hit || caches.match("/"))),
    );
    return;
  }
  if (isStatic(url)) {
    // cache first, refresh in the background
    event.respondWith(
      caches.match(req).then((hit) => {
        const refresh = fetch(req).then((res) => { if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; });
        return hit || refresh;
      }),
    );
  }
});

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RELEASE } from "@/lib/diagnostics";
import { pill } from "./ui";

export type OfflineState = "ready" | "unavailable" | "updating";

const COPY: Record<OfflineState, { label: string; title: string }> = {
  ready: { label: "Offline ready", title: "The designer, playbooks, and complete demo tour are available offline." },
  unavailable: { label: "Offline unavailable", title: "Reconnect while this page is open to prepare offline access." },
  updating: { label: "Offline updating…", title: "Offline pages and demo media are being verified." },
};

/** An open tab re-checks /sw.js this often, on top of every navigation and every return to the tab. */
const CHECK_EVERY_MS = 60 * 60 * 1000;
/** If the new worker never takes over after "Update now", a plain reload still fetches the newest build. */
const APPLY_TIMEOUT_MS = 8000;

/** A worker of another release, installed and waiting for this page to let it take over. */
interface Offer {
  worker: ServiceWorker;
  release: string;
}

type WorkerMessage =
  | { type: "FFPD_OFFLINE_STATUS"; status: "ready" | "unavailable" }
  | { type: "FFPD_RELEASE"; release: string };

const isWorkerMessage = (value: unknown): value is WorkerMessage => {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  if (value.type === "FFPD_OFFLINE_STATUS") return "status" in value && (value.status === "ready" || value.status === "unavailable");
  if (value.type === "FFPD_RELEASE") return "release" in value && typeof value.release === "string";
  return false;
};

/**
 * Registers the offline worker and shows two things about it: the small pill that says
 * whether this device can open the app offline, and, when a deploy has happened since
 * this page loaded, a card offering to reload onto it.
 *
 * Every build ships a byte-different /sw.js (see scripts/stamp-sw.ts). The browser
 * installs the new one in the background and it waits; the page asks the waiting worker
 * which release it is. A page already running that release lets it take over quietly.
 * An older page shows "Update ready": "Update now" tells the worker to take over, and
 * every tab on the old release reloads when it does. Plays live in localStorage, so a
 * reload never touches them.
 */
export function OfflineStatus() {
  const [state, setState] = useState<OfflineState>("updating");
  const [offer, setOffer] = useState<Offer | null>(null);
  const [dismissed, setDismissed] = useState<ServiceWorker | null>(null);
  const [applying, setApplying] = useState(false);
  // the offer as the worker listeners see it, since they outlive any render
  const offered = useRef<Offer | null>(null);
  const update = useCallback((next: Offer | null) => {
    offered.current = next;
    setOffer(next);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      const timer = window.setTimeout(() => { setState("unavailable"); }, 0);
      return () => { window.clearTimeout(timer); };
    }

    const container = navigator.serviceWorker;
    let live = true;
    let registration: ServiceWorkerRegistration | null = null;
    let responseTimer = 0;
    // the worker whose FFPD_RELEASE reply is next: replies do not say who sent them
    let asked: ServiceWorker | null = null;
    const watched = new WeakSet<ServiceWorker>();

    const ask = (worker: ServiceWorker | null) => {
      if (!worker) { if (live) setState("unavailable"); return; }
      window.clearTimeout(responseTimer);
      worker.postMessage({ type: "FFPD_OFFLINE_STATUS_REQUEST" });
      responseTimer = window.setTimeout(() => { if (live) setState("unavailable"); }, 1500);
    };
    const askRelease = (worker: ServiceWorker) => {
      asked = worker;
      worker.postMessage({ type: "FFPD_RELEASE_REQUEST" });
    };
    const message = (event: MessageEvent<unknown>) => {
      if (!live || !isWorkerMessage(event.data)) return;
      if (event.data.type === "FFPD_OFFLINE_STATUS") {
        window.clearTimeout(responseTimer);
        setState(event.data.status);
        return;
      }
      const worker = asked;
      asked = null;
      if (!worker || worker.state !== "installed") return;
      // the same code this page is running: take over now, nothing to reload for
      if (event.data.release === RELEASE) worker.postMessage({ type: "FFPD_SKIP_WAITING" });
      else update({ worker, release: event.data.release });
    };
    const controllerChange = () => {
      // a page that was offered another release is now behind the worker that serves it
      if (offered.current && offered.current.release !== RELEASE) { window.location.reload(); return; }
      ask(container.controller ?? registration?.active ?? null);
    };
    const watchInstall = () => {
      const worker = registration?.installing;
      if (!worker || watched.has(worker)) return;
      watched.add(worker);
      // with a controller this is a background update; without one, the first install
      const isUpdate = container.controller !== null;
      if (!isUpdate) setState("updating");
      worker.addEventListener("statechange", () => {
        if (!live) return;
        if (worker.state === "installed" && isUpdate) askRelease(worker);
        if (worker.state === "activated" && !isUpdate) ask(worker);
        if (worker.state === "redundant") {
          if (offered.current?.worker === worker) update(null);
          if (!isUpdate) ask(registration?.active ?? null);
        }
      });
    };
    const check = () => { registration?.update().catch(() => undefined); };
    const onVisible = () => { if (document.visibilityState === "visible") check(); };

    container.addEventListener("message", message);
    container.addEventListener("controllerchange", controllerChange);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", check);
    const interval = window.setInterval(check, CHECK_EVERY_MS);

    container.register("/sw.js").then((next) => {
      if (!live) return;
      registration = next;
      next.addEventListener("updatefound", watchInstall);
      if (next.installing) watchInstall();
      if (container.controller || !next.installing) ask(container.controller ?? next.active);
      // a release that finished installing before this page opened, still waiting
      if (container.controller && next.waiting) askRelease(next.waiting);
    }).catch(() => { if (live) setState("unavailable"); });

    return () => {
      live = false;
      window.clearTimeout(responseTimer);
      window.clearInterval(interval);
      registration?.removeEventListener("updatefound", watchInstall);
      container.removeEventListener("message", message);
      container.removeEventListener("controllerchange", controllerChange);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", check);
    };
  }, [update]);

  const apply = useCallback(() => {
    if (!offer || applying) return;
    setApplying(true);
    offer.worker.postMessage({ type: "FFPD_SKIP_WAITING" });
    window.setTimeout(() => { window.location.reload(); }, APPLY_TIMEOUT_MS);
  }, [applying, offer]);

  if (offer && offer.worker !== dismissed) {
    return (
      <section
        aria-label="Update ready"
        aria-live="polite"
        data-update-state={applying ? "applying" : "ready"}
        className="fixed bottom-2 left-2 right-2 z-[16] flex max-w-[520px] flex-wrap items-center justify-center gap-2 rounded-tile border-2 border-ink bg-cream px-2.5 py-2 shadow-toast sm:right-auto"
      >
        <p className="m-0 min-w-[140px] flex-1 text-small leading-body">
          {applying ? "Updating…" : "Update ready · your plays stay on this device"}
        </p>
        <button
          type="button"
          onClick={apply}
          disabled={applying}
          title="Reloads the app on the new version"
          className={`${pill} min-h-10 px-3 py-1 text-small`}
        >
          Update now
        </button>
        <button
          type="button"
          onClick={() => { setDismissed(offer.worker); }}
          disabled={applying}
          aria-label="Not now"
          title="Not now"
          className={`${pill} min-h-10 min-w-10 px-2 py-1 text-base`}
        >
          ×
        </button>
      </section>
    );
  }

  const copy = COPY[state];
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      data-offline-state={state}
      title={copy.title}
      className="fixed bottom-2 left-2 z-[15] rounded-pill border border-ink bg-cream px-2 py-1 text-caption leading-none text-ink shadow-toast"
    >
      <span aria-hidden className={state === "ready" ? "text-defense" : state === "updating" ? "text-yellow" : "text-offense"}>●</span>{" "}
      <span>{copy.label}</span>
    </div>
  );
}

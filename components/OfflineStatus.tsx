"use client";

import { useEffect, useState } from "react";

export type OfflineState = "ready" | "unavailable" | "updating";

const COPY: Record<OfflineState, { label: string; title: string }> = {
  ready: { label: "Offline ready", title: "The designer, playbooks, and complete demo tour are available offline." },
  unavailable: { label: "Offline unavailable", title: "Reconnect while this page is open to prepare offline access." },
  updating: { label: "Offline updating…", title: "Offline pages and demo media are being verified." },
};

const isStatusMessage = (value: unknown): value is { type: "FFPD_OFFLINE_STATUS"; status: "ready" | "unavailable" } =>
  typeof value === "object" && value !== null && "type" in value && value.type === "FFPD_OFFLINE_STATUS" &&
  "status" in value && (value.status === "ready" || value.status === "unavailable");

export function OfflineStatus() {
  const [state, setState] = useState<OfflineState>("updating");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      const timer = window.setTimeout(() => { setState("unavailable"); }, 0);
      return () => { window.clearTimeout(timer); };
    }

    let live = true;
    let registration: ServiceWorkerRegistration | null = null;
    let responseTimer = 0;
    const ask = (worker: ServiceWorker | null) => {
      if (!worker) { if (live) setState("unavailable"); return; }
      window.clearTimeout(responseTimer);
      worker.postMessage({ type: "FFPD_OFFLINE_STATUS_REQUEST" });
      responseTimer = window.setTimeout(() => { if (live) setState("unavailable"); }, 1500);
    };
    const message = (event: MessageEvent<unknown>) => {
      if (live && isStatusMessage(event.data)) {
        window.clearTimeout(responseTimer);
        setState(event.data.status);
      }
    };
    const controllerChange = () => { ask(navigator.serviceWorker.controller ?? registration?.active ?? null); };
    const watchInstall = () => {
      const worker = registration?.installing;
      if (!worker) return;
      setState("updating");
      worker.addEventListener("statechange", () => {
        if (!live) return;
        if (worker.state === "activated") ask(worker);
        if (worker.state === "redundant") ask(registration?.active ?? null);
      });
    };

    navigator.serviceWorker.addEventListener("message", message);
    navigator.serviceWorker.addEventListener("controllerchange", controllerChange);
    navigator.serviceWorker.register("/sw.js").then((next) => {
      if (!live) return;
      registration = next;
      next.addEventListener("updatefound", watchInstall);
      if (next.installing || next.waiting) {
        setState("updating");
        watchInstall();
      } else {
        ask(navigator.serviceWorker.controller ?? next.active);
      }
    }).catch(() => { if (live) setState("unavailable"); });

    return () => {
      live = false;
      window.clearTimeout(responseTimer);
      registration?.removeEventListener("updatefound", watchInstall);
      navigator.serviceWorker.removeEventListener("message", message);
      navigator.serviceWorker.removeEventListener("controllerchange", controllerChange);
    };
  }, []);

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

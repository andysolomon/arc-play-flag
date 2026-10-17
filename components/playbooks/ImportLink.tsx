"use client";

import { useId, useState } from "react";
import { SharedBook } from "./SharedBook";
import { tokenFromUrl } from "@/lib/sharing/links";
import { input, pill } from "../ui";

/**
 * A share link from another coach, pasted rather than opened. Signed-in coaches move work between
 * their own teams with "Send to another team…", so this sits folded at the foot of the page.
 */
export function ImportLink() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const id = useId();
  return <>
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-small text-ink-muted marker:content-none [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block transition-transform duration-[120ms] group-open:rotate-90 motion-reduce:transition-none">›</span>
        Have a share link from another coach?
      </summary>
      <form className="flex flex-wrap items-center gap-2 pt-1" onSubmit={event => {
        event.preventDefault();
        const token = tokenFromUrl(url.trim(), window.location.origin);
        if (!token) { setError("Paste an Arc Play Flag /s/ share link. A local ?book= link cannot transfer a book."); return; }
        setToken(token);
      }}>
        <label htmlFor={id} className="sr-only">Share link</label>
        <input id={id} type="url" placeholder="Paste a share link" value={url} onChange={e => { setUrl(e.target.value); setError(""); }} className={`${input} min-w-0 flex-1`} required />
        <button type="submit" className={`${pill} min-h-11 px-3`}>Preview link</button>
        {error && <p role="alert" className="w-full">{error}</p>}
      </form>
    </details>
    {token && <SharedBook key={token} token={token} onClose={() => { setToken(null); }} />}
  </>;
}

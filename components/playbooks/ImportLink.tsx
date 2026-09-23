"use client";

import { useId, useState } from "react";
import { SharedBook } from "./SharedBook";
import { tokenFromUrl } from "@/lib/sharing/links";
import { input, pill } from "../ui";

export function ImportLink() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const id = useId();
  return <><form className="flex flex-wrap items-center gap-2" onSubmit={event => {
    event.preventDefault();
    const token = tokenFromUrl(url.trim(), window.location.origin);
    if (!token) { setError("Paste an Arc Play Flag /s/ share link. A local ?book= link cannot transfer a book."); return; }
    setToken(token);
  }}>
    <label htmlFor={id} className="w-full text-caption text-ink-muted">Have a share link? Paste it here.</label>
    <input id={id} type="url" placeholder="Paste a share link" value={url} onChange={e => { setUrl(e.target.value); setError(""); }} className={`${input} min-w-0 flex-1`} required />
    <button type="submit" className={`${pill} min-h-11 px-3`}>Preview link</button>
    {error && <p role="alert" className="w-full">{error}</p>}
  </form>{token && <SharedBook key={token} token={token} onClose={() => { setToken(null); }} />}</>;
}

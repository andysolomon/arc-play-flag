"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { tokenFromUrl } from "@/lib/sharing/links";
import { input, pill } from "../ui";

export function ImportLink() {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  return <form className="flex flex-wrap items-center gap-2" onSubmit={event => {
    event.preventDefault();
    const token = tokenFromUrl(url.trim(), window.location.origin);
    if (!token) { setError("Paste an Arc Play Flag /s/ share link. A local ?book= link cannot transfer a book."); return; }
    router.push(`/s/${token}`);
  }}>
    <input type="url" aria-label="Playbook share URL" placeholder="Paste a playbook share link" value={url} onChange={e => { setUrl(e.target.value); setError(""); }} className={`${input} min-w-0 flex-1`} required />
    <button type="submit" className={`${pill} min-h-11 px-3`}>Preview link</button>
    {error && <p role="alert" className="w-full">{error}</p>}
  </form>;
}

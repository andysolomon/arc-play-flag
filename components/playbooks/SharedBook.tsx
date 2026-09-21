"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readTransfer, type TransferRead } from "@/lib/export/transfer";
import { ImportPreview } from "./ImportPreview";
import { pill } from "../ui";

export function SharedBook({ token }: { token: string }) {
  const [read, setRead] = useState<Extract<TransferRead, { ok: true }> | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/shares/${token}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const text = await response.text();
      if (!response.ok) {
        const result = JSON.parse(text) as { error?: string };
        throw new Error(result.error ?? "This shared playbook is unavailable.");
      }
      const parsed = readTransfer(text);
      if (!parsed.ok || parsed.file.kind !== "ffpd.playbook") throw new Error("This shared playbook is not readable.");
      if (!controller.signal.aborted) setRead(parsed);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof TypeError ? "This playbook is unavailable offline. Reconnect and retry." : reason instanceof Error ? reason.message : "This playbook is unavailable.");
    });
    return () => { controller.abort(); };
  }, [token, attempt]);
  return <main className="mx-auto flex h-full w-full max-w-[920px] flex-col gap-4 overflow-y-auto p-4">
    <Link href="/playbooks" className="underline">‹ My playbooks</Link>
    <h1 className="text-title">Shared playbook</h1>
    <p>This is a snapshot. Import it to keep an editable copy on this device.</p>
    {error ? <div role="alert"><p>{error}</p><button type="button" className={`${pill} min-h-11 px-3`} onClick={() => { setError(""); setAttempt(a => a + 1); }}>Retry</button></div>
      : read ? <ImportPreview file={read.file} skipped={read.skipped} normalized={read.normalized} onImported={id => { router.push(id ? `/playbooks?book=${id}` : "/playbooks"); }} />
      : <p role="status">Loading playbook…</p>}
  </main>;
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readTransfer, type TransferRead } from "@/lib/export/transfer";
import { ImportPreview } from "./ImportPreview";
import { PreviewModal } from "./PreviewModal";
import { pill } from "../ui";

export function SharedBook({ token, onClose }: { token: string; onClose?: () => void }) {
  const [read, setRead] = useState<Extract<TransferRead, { ok: true }> | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/shares/${token}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const text = await response.text();
      if (!response.ok) {
        const result = JSON.parse(text) as { error?: string };
        throw new Error(result.error ?? "This shared snapshot is unavailable.");
      }
      const parsed = readTransfer(text);
      if (!parsed.ok) throw new Error("This shared snapshot is not readable.");
      if (!controller.signal.aborted) setRead(parsed);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof TypeError ? "This snapshot is unavailable offline. Reconnect and retry." : reason instanceof Error ? reason.message : "This snapshot is unavailable.");
    });
    return () => { controller.abort(); };
  }, [token, attempt]);
  const close = () => { setOpen(false); onClose?.(); };
  const content = error ? <div role="alert"><p>{error}</p><button type="button" className={`${pill} min-h-11 px-3`} onClick={() => { setError(""); setAttempt(a => a + 1); }}>Retry</button></div>
    : read ? <ImportPreview visual file={read.file} skipped={read.skipped} normalized={read.normalized} onCancel={close} onImported={id => { close(); router.push(id ? `/playbooks?book=${id}` : "/playbooks"); }} />
    : <p role="status">Loading shared snapshot…</p>;
  const modal = open && <PreviewModal title="Shared snapshot preview" onClose={close}>{content}</PreviewModal>;
  if (onClose) return modal;
  return <main className="mx-auto flex h-full w-full max-w-[920px] flex-col gap-4 overflow-y-auto p-4">
    <Link href="/playbooks" className="underline">‹ My playbooks</Link>
    <h1 className="text-title">Shared snapshot</h1>
    <p>Preview the plays and notes before importing an editable copy to this device.</p>
    <button type="button" className={`${pill} min-h-11 self-start px-3`} onClick={() => { setOpen(true); }}>Preview shared snapshot</button>
    {modal}
  </main>;
}

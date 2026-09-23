"use client";

import { useEffect, useState } from "react";
import { pill } from "../ui";

interface Props {
  label: string;
  /** what the button says once armed, e.g. "Delete? It's in 2 playbooks" */
  confirm: string;
  onConfirm: () => void;
  className?: string;
  /** replaces the default pill look, e.g. for a row inside a menu */
  base?: string;
}

/** A destructive action that asks by changing its own label: tap once to arm, again within 3 s to do it. */
export function TwoStep({ label, confirm, onConfirm, className = "", base = `${pill} px-3 py-1 text-small` }: Props) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => { setArmed(false); }, 3000);
    return () => { window.clearTimeout(t); };
  }, [armed]);
  return (
    <button
      type="button"
      data-active={armed}
      aria-live="polite"
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      className={`${base} data-[active=true]:bg-rose-soft ${className}`}
    >
      {armed ? confirm : label}
    </button>
  );
}

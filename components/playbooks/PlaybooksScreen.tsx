"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { Vis } from "@/lib/play/types";
import { Hint } from "../Hint";
import { pillSm } from "../ui";
import { BookEditor } from "./BookEditor";
import { Home } from "./Home";

export type Say = (text: string, ms?: number) => void;

const noSubscribe = (): (() => void) => () => undefined;

/** The playbook screens: the list (and team, file, gallery) or one book when ?book=<id> is set. */
export function PlaybooksScreen() {
  const bookId = useSearchParams().get("book");
  // the page is prerendered without a query string, so which screen shows is decided after mount
  const mounted = useSyncExternalStore(noSubscribe, () => true, () => false);
  // which team the thumbnails draw; shared by both screens so it survives opening a book
  const [show, setShow] = useState<Vis>("both");
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef(0);
  const say = useCallback<Say>((text, ms = 1800) => {
    setToast(text);
    window.clearTimeout(timer.current);
    if (ms > 0) timer.current = window.setTimeout(() => { setToast(null); }, ms);
  }, []);

  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5">
        <Link href="/" className={`${pillSm} inline-block !text-ink no-underline`}>‹ Designer</Link>
        <Image src="/icons/playbook.png" alt="" width={26} height={26} sizes="26px" className="block flex-none" priority />
        <h1 className="min-w-0 truncate text-header font-normal">Playbooks</h1>
        <span className="whitespace-nowrap text-caption text-ink-muted max-[479px]:hidden">5v5 flag</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[920px] flex-col gap-3 px-3 py-4">
          {mounted && (bookId ? <BookEditor id={bookId} say={say} show={show} onShow={setShow} /> : <Home say={say} show={show} onShow={setShow} />)}
        </div>
      </div>
      <Hint text={toast} />
    </div>
  );
}

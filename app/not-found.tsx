import type { Metadata } from "next";
import Link from "next/link";
import { card, eyebrow, pillSm } from "@/components/ui";

export const metadata: Metadata = { title: "Not found · Flag Football Play Designer" };

/** Unknown addresses, and share links that don't decode into a play. */
export default function NotFound() {
  return (
    <main className="flex h-full flex-col items-center justify-center overflow-y-auto bg-paper p-4">
      <div className={`${card} flex w-full max-w-[420px] flex-col gap-3 leading-body`}>
        <span className={eyebrow}>NOT FOUND</span>
        <h1 className="m-0 text-header font-normal">That page isn&apos;t here.</h1>
        <p className="m-0 text-base">
          If this was a share link, it was probably cut short when it was copied: a share link carries the whole play, so it&apos;s long. Ask for it again, or draw the play yourself.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className={`${pillSm} inline-block !text-ink no-underline`}>Open the designer ›</Link>
          <Link href="/playbooks" className={`${pillSm} inline-block !text-ink no-underline`}>Playbooks</Link>
        </div>
      </div>
    </main>
  );
}

import Image from "next/image";
import Link from "next/link";
import { DemoClip } from "./DemoClip";
import { DEMOS } from "./demos";
import { pillSm } from "../ui";

export function DemoScreen() {
  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5">
        <Link href="/" className={`${pillSm} inline-block !text-ink no-underline`}>‹ Designer</Link>
        <Image src="/icons/demo.png" alt="" width={26} height={26} sizes="26px" className="block flex-none" priority />
        <h1 className="min-w-0 truncate text-header font-normal">Demo</h1>
        <span className="whitespace-nowrap text-caption text-ink-muted max-[479px]:hidden">Complete tour</span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-4 px-3 py-4 sm:px-5 sm:py-6">
          <section className="grid gap-3 rounded-tile border-2 border-ink bg-yellow p-4 shadow-tile sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <span className="text-eyebrow tracking-eyebrow">START HERE</span>
              <h2 className="mt-1 text-[28px] leading-tight">Learn the whole play designer in five short clips.</h2>
              <p className="mb-0 mt-2 max-w-[680px] text-base leading-body text-ink-2">
                The tour follows the same path as a real practice: draw the offense, run it, add the defense, save it, then put it in a playbook.
              </p>
            </div>
            <span className="w-fit rounded-pill border-2 border-ink bg-cream px-3 py-1 text-base">Under a minute</span>
          </section>
          <div className="grid gap-4 md:grid-cols-2">
            {DEMOS.map((demo, index) => <DemoClip key={demo.slug} demo={demo} index={index} />)}
          </div>
          <section className="flex flex-wrap items-center gap-2 rounded-note border-2 border-dashed border-ink bg-cream p-3 text-base leading-body">
            <span>Ready to draw your own?</span>
            <Link href="/" className={`${pillSm} !text-ink no-underline`}>Open the designer ›</Link>
          </section>
        </div>
      </main>
    </div>
  );
}

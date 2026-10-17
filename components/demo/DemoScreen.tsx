import Link from "next/link";
import { DemoClip } from "./DemoClip";
import { DEMOS, HERO, TOUR_SECONDS } from "./demos";
import { pillSm } from "../ui";
import { Sticker } from "../Sticker";

export function DemoScreen() {
  const rest = DEMOS.filter((demo) => demo.slug !== HERO.slug);
  return (
    <div className="app-root flex h-full flex-col overflow-hidden">
      <header className="flex flex-none items-center gap-[10px] border-b-2 border-ink bg-cream px-3 py-1.5">
        <Link href="/" className={`${pillSm} inline-flex items-center !text-ink no-underline`}>‹ Designer</Link>
        <Sticker icon="demo" size={26} className="flex-none" priority />
        <h1 className="min-w-0 truncate text-header font-normal">Demo</h1>
        <span className="whitespace-nowrap text-caption text-ink-muted max-[479px]:hidden">Complete tour</span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4 px-3 py-4 sm:px-5 sm:py-6">
          <section className="grid gap-3 rounded-tile border-2 border-ink bg-yellow on-yellow p-4 shadow-tile sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <span className="text-eyebrow tracking-eyebrow">START HERE</span>
              <h2 className="mt-1 text-[28px] leading-tight">Learn the whole play designer in {DEMOS.length} short clips.</h2>
              <p className="mb-0 mt-2 max-w-[680px] text-base leading-body text-ink-2">
                The tour follows a coach&apos;s week: draw a play and watch it run, put your players on it, set your league&apos;s rules,
                install the run game and the defense, build the book and call it from the sideline, print the wristbands, send it to
                your staff, score, then the trick plays. Every clip is the app on a phone, with what it says written under it.
              </p>
            </div>
            <span className="w-fit rounded-pill border-2 border-ink bg-cream px-3 py-1 text-base">Under {Math.ceil(TOUR_SECONDS / 30) * 30} seconds</span>
          </section>
          <DemoClip demo={HERO} index={0} hero />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rest.map((demo, index) => <DemoClip key={demo.slug} demo={demo} index={index + 1} />)}
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

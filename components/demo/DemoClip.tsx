"use client";

import { useRef, useState } from "react";
import type { DemoChapter } from "./demos";

export function DemoClip({ demo, index }: { demo: DemoChapter; index: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  // read from the clip itself, so a pause from elsewhere (another chapter starting) shows here too
  const sync = () => {
    const video = videoRef.current;
    setPlaying(!!video && !video.paused && !video.ended);
  };
  const onPlay = () => {
    for (const video of document.querySelectorAll<HTMLVideoElement>("video[data-demo]")) {
      if (video !== videoRef.current) video.pause();
    }
    sync();
  };
  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) video.play().catch(sync);
    else video.pause();
  };

  return (
    <article className="overflow-hidden rounded-tile border-2 border-ink bg-white shadow-tile [content-visibility:auto] [contain-intrinsic-size:480px]">
      <div className="relative border-b-2 border-ink bg-ink">
        {/* No browser controls: iOS draws skip, scrub and AirPlay buttons over the clip, and Android
            Chrome a cast button unless remote playback is off. A tap anywhere on it plays or pauses. */}
        <video
          ref={videoRef}
          data-demo
          muted
          playsInline
          disableRemotePlayback
          preload="none"
          poster={`/demos/${demo.slug}.webp`}
          aria-label={`${demo.title} demonstration`}
          onPlay={onPlay}
          onPause={sync}
          onEnded={sync}
          className="aspect-video h-auto w-full bg-paper object-cover"
        >
          <source src={`/demos/${demo.slug}.webm`} type="video/webm" />
          <source src={`/demos/${demo.slug}.mp4`} type="video/mp4" />
          Your browser cannot play this demonstration.
        </video>
        <button
          type="button"
          onClick={toggle}
          aria-label={`${playing ? "Pause" : "Play"} ${demo.title}`}
          className="pressable absolute inset-0 flex cursor-pointer items-center justify-center focus-visible:outline-offset-[-5px]"
        >
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink bg-yellow on-yellow shadow-tile transition-[opacity,visibility] duration-150 motion-reduce:transition-none ${playing ? "invisible opacity-0" : ""}`}
            aria-hidden
          >
            <svg viewBox="0 0 24 24" width="24" height="24" className="ml-1">
              <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <span className="pointer-events-none absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-yellow on-yellow text-base" aria-hidden>
          {index + 1}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-title leading-tight">{demo.title}</h2>
          <span className="ml-auto whitespace-nowrap text-caption text-ink-muted">{demo.time}</span>
        </div>
        <p className="m-0 text-base leading-body text-ink-2">{demo.summary}</p>
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Features covered">
          {demo.covers.map((feature) => (
            <li key={feature} className="rounded-pill border border-ink bg-yellow-soft px-2 py-0.5 text-caption leading-tight">{feature}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

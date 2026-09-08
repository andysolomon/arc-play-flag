"use client";

import { useRef } from "react";
import type { DemoChapter } from "./demos";

export function DemoClip({ demo, index }: { demo: DemoChapter; index: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onPlay = () => {
    for (const video of document.querySelectorAll<HTMLVideoElement>("video[data-demo]")) {
      if (video !== videoRef.current) video.pause();
    }
  };

  return (
    <article className="overflow-hidden rounded-tile border-2 border-ink bg-white shadow-tile [content-visibility:auto] [contain-intrinsic-size:480px]">
      <div className="relative border-b-2 border-ink bg-ink">
        <video
          ref={videoRef}
          data-demo
          controls
          muted
          playsInline
          preload="none"
          poster={`/demos/${demo.slug}.webp`}
          aria-label={`${demo.title} demonstration`}
          onPlay={onPlay}
          className="aspect-video h-auto w-full bg-paper object-cover"
        >
          <source src={`/demos/${demo.slug}.webm`} type="video/webm" />
          <source src={`/demos/${demo.slug}.mp4`} type="video/mp4" />
          Your browser cannot play this demonstration.
        </video>
        <span className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-yellow text-base" aria-hidden>
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

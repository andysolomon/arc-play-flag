"use client";

import { useRef } from "react";
import { DEMO_VIDEO, type DemoChapter } from "./demos";

/**
 * One chapter: a phone-shaped clip (4:5, the app's own phone layout under its caption band),
 * then its card. The video never crops: the frame is the one the recorder made. The captions
 * the clip shows are listed under it, so a silent video has a text alternative a reader can
 * follow, and the number sits in the title row, never over the picture.
 */
export function DemoClip({ demo, index, hero = false }: { demo: DemoChapter; index: number; hero?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onPlay = () => {
    for (const video of document.querySelectorAll<HTMLVideoElement>("video[data-demo]")) {
      if (video !== videoRef.current) video.pause();
    }
  };

  return (
    <article
      className={`overflow-hidden rounded-tile border-2 border-ink bg-white shadow-tile [content-visibility:auto] [contain-intrinsic-size:auto_640px] ${hero ? "sm:grid sm:grid-cols-[minmax(0,360px)_1fr]" : ""}`}
    >
      <div className={`border-ink bg-ink ${hero ? "border-b-2 sm:border-b-0 sm:border-r-2" : "border-b-2"}`}>
        <video
          ref={videoRef}
          data-demo
          controls
          muted
          playsInline
          preload="none"
          width={DEMO_VIDEO.width}
          height={DEMO_VIDEO.height}
          poster={`/demos/${demo.slug}.webp`}
          aria-label={`${demo.title} demonstration`}
          onPlay={onPlay}
          className="mx-auto block aspect-[4/5] h-auto w-full max-w-[360px] bg-ink object-contain sm:max-w-none"
        >
          <source src={`/demos/${demo.slug}.webm`} type="video/webm" />
          <source src={`/demos/${demo.slug}.mp4`} type="video/mp4" />
          Your browser cannot play this demonstration.
        </video>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline gap-2">
          <span className="flex h-7 w-7 flex-none items-center justify-center self-center rounded-full border-2 border-ink bg-yellow on-yellow text-small" aria-hidden>
            {index + 1}
          </span>
          <h2 className="min-w-0 text-title leading-tight">{demo.title}</h2>
          <span className="ml-auto whitespace-nowrap text-caption text-ink-muted">{demo.time}</span>
        </div>
        <p className="m-0 text-base leading-body text-ink-2">{demo.summary}</p>
        <ol className="m-0 flex list-none flex-col gap-0.5 p-0 text-caption leading-tight text-ink-muted" aria-label="What the clip says">
          {demo.captions.map((caption, step) => (
            <li key={caption} className="flex gap-1.5">
              <span className="w-4 flex-none text-right" aria-hidden>{step + 1}.</span>
              <span>{caption}</span>
            </li>
          ))}
        </ol>
        <ul className="m-0 flex list-none flex-wrap gap-1 p-0" aria-label="Features covered">
          {demo.covers.map((feature) => (
            <li key={feature} className="rounded-pill border border-ink bg-yellow-soft px-2 py-0.5 text-caption leading-tight">{feature}</li>
          ))}
        </ul>
      </div>
    </article>
  );
}

"use client";

import { useRef, useState } from "react";
import { DEMO_VIDEO, type DemoChapter } from "./demos";

/**
 * One chapter: a phone-shaped clip (4:5, the app's own phone layout under its caption band),
 * then its card. The video never crops: the frame is the one the recorder made. The captions
 * the clip shows are listed under it, so a silent video has a text alternative a reader can
 * follow. The chapter number sits over a stopped clip and fades off a playing one.
 */
export function DemoClip({ demo, index, hero = false }: { demo: DemoChapter; index: number; hero?: boolean }) {
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
  // the sign and the chapter number fade off a playing clip, so nothing is drawn over it
  const overClip = `transition-[opacity,visibility,scale] duration-150 motion-reduce:transition-none ${playing ? "invisible opacity-0" : ""}`;
  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) video.play().catch(sync);
    else video.pause();
  };

  return (
    <article
      className={`overflow-hidden rounded-tile border-2 border-ink bg-white shadow-tile [content-visibility:auto] [contain-intrinsic-size:auto_640px] ${hero ? "sm:grid sm:grid-cols-[minmax(0,360px)_1fr]" : ""}`}
    >
      <div className={`relative border-ink bg-ink ${hero ? "border-b-2 sm:border-b-0 sm:border-r-2" : "border-b-2"}`}>
        {/* No browser controls: iOS draws skip, scrub and AirPlay buttons over the clip, and Android
            Chrome a cast button unless remote playback is off. A tap anywhere on it plays or pauses.
            The press feedback is on the sign: shrinking the control itself would let a click at the
            clip's edge slip off it. */}
        <video
          ref={videoRef}
          data-demo
          muted
          playsInline
          disableRemotePlayback
          preload="none"
          width={DEMO_VIDEO.width}
          height={DEMO_VIDEO.height}
          poster={`/demos/${demo.slug}.webp`}
          aria-label={`${demo.title} demonstration`}
          onPlay={onPlay}
          onPause={sync}
          onEnded={sync}
          className="mx-auto block aspect-[4/5] h-auto w-full max-w-[360px] bg-ink object-contain sm:max-w-none"
        >
          <source src={`/demos/${demo.slug}.webm`} type="video/webm" />
          <source src={`/demos/${demo.slug}.mp4`} type="video/mp4" />
          Your browser cannot play this demonstration.
        </video>
        <button
          type="button"
          onClick={toggle}
          aria-label={`${playing ? "Pause" : "Play"} ${demo.title}`}
          className="group absolute inset-0 flex cursor-pointer touch-manipulation select-none items-center justify-center focus-visible:outline-offset-[-5px]"
        >
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-full border-2 border-ink bg-yellow on-yellow shadow-tile group-active:opacity-80 motion-safe:group-active:scale-[0.97] ${overClip}`}
            aria-hidden
          >
            <svg viewBox="0 0 24 24" width="24" height="24" className="ml-1">
              <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <span className={`pointer-events-none absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-yellow on-yellow text-base ${overClip}`} aria-hidden>
          {index + 1}
        </span>
      </div>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-baseline gap-2">
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

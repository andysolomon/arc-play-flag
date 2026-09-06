"use client";

import { memo } from "react";

interface ButtonProps {
  playing: boolean;
  onClick: () => void;
}

/** Round yellow ▶ in the corner of the field: run the play, or ■ to stop it early. */
function PlayButtonImpl({ playing, onClick }: ButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={playing ? "Stop (Esc)" : "Run the play"}
      aria-label={playing ? "Stop the play" : "Run the play"}
      aria-pressed={playing}
      data-active={playing}
      className={
        "absolute bottom-3 right-3 flex h-12 w-12 cursor-pointer items-center justify-center rounded-full " +
        "border-2 border-ink bg-yellow text-[22px] leading-none text-ink shadow-tile transition-transform duration-[120ms] " +
        "hover:-translate-y-0.5 data-[active=true]:bg-white print:hidden motion-reduce:transition-none"
      }
    >
      {playing ? (
        <span aria-hidden="true" className="block h-4 w-4 rounded-[3px] bg-ink" />
      ) : (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" className="ml-0.5 block">
          <path d="M4 2.5 L17.5 10 L4 17.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}

export const PlayButton = memo(PlayButtonImpl);

interface BallProps {
  x: number;
  y: number;
  /** 0 on the ground, 1 at the top of the throw: the ball grows as it comes towards you */
  lift: number;
}

/** The football sticker rides with whoever has it, and grows as a throw comes up towards you. */
function FootballImpl({ x, y, lift }: BallProps) {
  const k = 1 + lift * 0.6;
  return (
    <image
      href="/icons/football.png"
      x={-16} y={-16} width={32} height={32}
      transform={`translate(${x.toFixed(1)},${(y - lift * 16).toFixed(1)}) scale(${k.toFixed(2)})`}
      className="pointer-events-none"
      data-export="skip"
    />
  );
}

export const Football = memo(FootballImpl);

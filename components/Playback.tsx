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

/** A little hand-drawn football that rides with whoever has it. */
function FootballImpl({ x, y, lift }: BallProps) {
  const k = 1 + lift * 0.55;
  return (
    <g transform={`translate(${x.toFixed(1)},${(y - lift * 14).toFixed(1)}) scale(${k.toFixed(2)}) rotate(-30)`} className="pointer-events-none" data-export="skip">
      <ellipse rx={11} ry={7} fill="#a15d2c" stroke="#1b1a17" strokeWidth={2} />
      <line x1={-4} y1={0} x2={4} y2={0} stroke="#fffdf6" strokeWidth={1.6} strokeLinecap="round" />
      <line x1={-2} y1={-2} x2={-2} y2={2} stroke="#fffdf6" strokeWidth={1.4} strokeLinecap="round" />
      <line x1={2} y1={-2} x2={2} y2={2} stroke="#fffdf6" strokeWidth={1.4} strokeLinecap="round" />
    </g>
  );
}

export const Football = memo(FootballImpl);

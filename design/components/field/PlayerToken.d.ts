import * as React from 'react';
/** @startingPoint section="Field" subtitle="Red/blue player circles with selection ring" viewport="700x160" */
export interface PlayerTokenProps extends React.HTMLAttributes<HTMLSpanElement> {
  team?: 'offense' | 'defense';
  /** Up to 3 uppercase letters (QB, X, Y, Z, C). Defenders are usually blank. */
  label?: string;
  /** Diameter in px; 46 matches the field at 1:1. */
  size?: number;
  /** Pulsing yellow ring. */
  selected?: boolean;
  /** Dashed yellow ring while choosing a man-coverage target. */
  target?: boolean;
}
export function PlayerToken(props: PlayerTokenProps): JSX.Element;

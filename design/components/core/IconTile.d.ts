import * as React from 'react';
/** @startingPoint section="Controls" subtitle="Icon + label tile, 3-up grid, yellow when active" viewport="700x190" */
export interface IconTileProps {
  /** Path to one of the assets/icons/*.png sticker icons. */
  icon: string;
  label: string;
  /** Yellow fill; used for the selected route and the current Show filter. */
  active?: boolean;
  onClick?: () => void;
  title?: string;
  style?: React.CSSProperties;
}
export function IconTile(props: IconTileProps): JSX.Element;
export interface TileGridProps { columns?: number; children?: React.ReactNode; style?: React.CSSProperties; }
export function TileGrid(props: TileGridProps): JSX.Element;

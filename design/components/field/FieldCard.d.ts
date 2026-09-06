import * as React from 'react';
export interface FieldCardProps {
  width?: string | number;
  /** CSS aspect-ratio; the app derives it from the deepest player. */
  aspect?: string;
  showYardLines?: boolean;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function FieldCard(props: FieldCardProps): JSX.Element;

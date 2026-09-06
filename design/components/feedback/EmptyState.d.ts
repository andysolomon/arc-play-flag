import * as React from 'react';
export interface EmptyStateProps {
  /** Sticker icon path; the football by default. */
  icon?: string;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export function EmptyState(props: EmptyStateProps): JSX.Element;

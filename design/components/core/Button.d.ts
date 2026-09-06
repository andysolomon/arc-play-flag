import * as React from 'react';
/** @startingPoint section="Controls" subtitle="Pill button in default, active, dark and disabled states" viewport="700x120" */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual treatment. 'active' is the yellow selected state, 'dark' the single ink CTA per panel. */
  variant?: 'default' | 'active' | 'dark';
  /** 'sm' is used for secondary options under a title (e.g. Mirror route). */
  size?: 'md' | 'sm';
  disabled?: boolean;
  children?: React.ReactNode;
}
export function Button(props: ButtonProps): JSX.Element;

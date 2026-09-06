import * as React from 'react';
export interface ToastProps { children?: React.ReactNode; style?: React.CSSProperties; }
/** Floating ink pill over the field ("Cover who? Tap a red player."). */
export function Toast(props: ToastProps): JSX.Element;
export interface NoteProps { children?: React.ReactNode; style?: React.CSSProperties; }
/** Yellow sticky-note hint inside a panel. */
export function Note(props: NoteProps): JSX.Element;

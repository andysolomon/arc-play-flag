import React from 'react';

/** Uppercase eyebrow that heads each sidebar group (PLAY, FIELD, SHOW, ROUTES). */
export function SectionLabel({ children, style }) {
  return <span style={{ fontFamily: 'var(--font-hand)', fontSize: 'var(--text-eyebrow)', letterSpacing: 'var(--tracking-eyebrow)', color: 'var(--text-muted)', textTransform: 'uppercase', ...style }}>{children}</span>;
}

/** Faint 2px rule between sidebar groups. */
export function Divider({ style }) {
  return <span style={{ display: 'block', height: 2, background: 'var(--divider)', margin: 'var(--space-1) 0', ...style }} />;
}

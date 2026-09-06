import React from 'react';

/** Ink pill that floats over the field with a one-line instruction. */
export function Toast({ children, style }) {
  return (
    <div style={{
      display: 'inline-block', background: 'var(--ink)', color: 'var(--text-on-dark)', padding: '6px 16px',
      borderRadius: 'var(--radius-pill)', fontFamily: 'var(--font-hand)', fontSize: 'var(--text-base)',
      whiteSpace: 'nowrap', boxShadow: 'var(--shadow-toast)', ...style
    }}>{children}</div>
  );
}

/** Yellow sticky note used for in-panel hints. */
export function Note({ children, style }) {
  return (
    <span style={{
      display: 'block', fontFamily: 'var(--font-hand)', fontSize: 'var(--text-base)', background: 'var(--yellow)',
      border: 'var(--border)', borderRadius: 'var(--radius-note)', padding: '6px 10px', lineHeight: 1.3, color: 'var(--ink)', ...style
    }}>{children}</span>
  );
}

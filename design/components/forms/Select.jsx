import React from 'react';

/** Pill native select. */
export function Select({ style, children, ...rest }) {
  return (
    <select
      style={{
        fontFamily: 'var(--font-hand)', fontSize: 'var(--text-base)', padding: '6px 12px', width: '100%',
        border: 'var(--border)', borderRadius: 'var(--radius-pill)', background: 'var(--surface-control)',
        color: 'var(--text-body)', cursor: 'pointer', boxSizing: 'border-box', ...style
      }}
      {...rest}
    >{children}</select>
  );
}

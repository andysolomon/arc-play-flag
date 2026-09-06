import React from 'react';

/** Pill text field. */
export function TextInput({ compact = false, style, ...rest }) {
  return (
    <input
      style={{
        fontFamily: 'var(--font-hand)', fontSize: compact ? 'var(--text-small)' : 'var(--text-input)',
        padding: compact ? '4px 8px' : 'var(--control-pad)', border: 'var(--border)', borderRadius: 'var(--radius-pill)',
        background: 'var(--surface-control)', color: 'var(--text-body)', outline: 'none', width: '100%',
        textAlign: compact ? 'center' : 'left', boxSizing: 'border-box', ...style
      }}
      {...rest}
    />
  );
}

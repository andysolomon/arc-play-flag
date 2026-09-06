import React from 'react';

/** Pill button. variant: 'default' | 'active' | 'dark'. size: 'md' | 'sm'. */
export function Button({ variant = 'default', size = 'md', disabled = false, style, children, ...rest }) {
  const [hover, setHover] = React.useState(false);
  const bg = disabled ? 'var(--surface-disabled)'
    : variant === 'dark' ? (hover ? 'var(--ink-2)' : 'var(--ink)')
    : variant === 'active' ? 'var(--surface-active)'
    : hover ? 'var(--surface-hover)' : 'var(--surface-control)';
  const color = disabled ? 'var(--text-disabled)' : variant === 'dark' ? 'var(--text-on-dark)' : 'var(--text-body)';
  return (
    <button
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: 'var(--font-hand)', fontSize: size === 'sm' ? 'var(--text-small)' : 'var(--text-base)',
        padding: size === 'sm' ? 'var(--control-pad-compact)' : 'var(--control-pad)',
        border: 'var(--border)', borderRadius: 'var(--radius-pill)', background: bg, color,
        cursor: disabled ? 'default' : 'pointer', whiteSpace: 'nowrap', lineHeight: 1.25, ...style
      }}
      {...rest}
    >{children}</button>
  );
}

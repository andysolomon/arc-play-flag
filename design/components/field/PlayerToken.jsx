import React from 'react';

/** Player marker: red offense / blue defense circle with an optional 1–3 letter tag. */
export function PlayerToken({ team = 'offense', label = '', size = 46, selected = false, target = false, style, ...rest }) {
  const ring = selected ? 'var(--yellow)' : target ? 'var(--yellow)' : 'transparent';
  return (
    <span style={{ position: 'relative', display: 'inline-flex', width: size, height: size, ...style }} {...rest}>
      <span style={{
        position: 'absolute', inset: -6, borderRadius: '50%', border: `5px ${target && !selected ? 'dashed' : 'solid'} ${ring}`,
        animation: selected ? 'ffpd-pulse 1.25s ease-in-out infinite' : 'none'
      }} />
      <span style={{
        width: size, height: size, borderRadius: '50%', background: team === 'offense' ? 'var(--offense)' : 'var(--defense)',
        border: 'var(--border-w-token) solid var(--ink)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-hand)', fontSize: label.length > 2 ? size * 0.33 : size * 0.39, color: 'var(--ink)', boxSizing: 'border-box'
      }}>{label}</span>
      <style>{'@keyframes ffpd-pulse{0%,100%{opacity:.9;transform:scale(1)}50%{opacity:.3;transform:scale(1.16)}}'}</style>
    </span>
  );
}

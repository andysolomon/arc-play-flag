import React from 'react';

/** Dashed card with the football and a two-line nudge; shown when nothing is selected. */
export function EmptyState({ icon, children, style }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '18px 10px',
      border: '2px dashed var(--ink)', borderRadius: 'var(--radius-tile)', opacity: 0.75, fontFamily: 'var(--font-hand)', ...style
    }}>
      {icon && <img src={icon} alt="" style={{ width: 56, height: 56, display: 'block' }} />}
      <span style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)', lineHeight: 'var(--leading-body)', textAlign: 'center' }}>{children}</span>
    </div>
  );
}

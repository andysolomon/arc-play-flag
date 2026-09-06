import React from 'react';

/** The turf card: green surface, 3px ink border, 7px radius, hard 7px shadow. Children are positioned absolutely by the caller. */
export function FieldCard({ width = '100%', aspect = '30 / 24', showYardLines = true, children, style }) {
  const lines = [0.14, 0.34, 0.54, 0.74];
  return (
    <div style={{
      position: 'relative', width, aspectRatio: aspect, background: 'var(--turf)', border: 'var(--border-w-field) solid var(--ink)',
      borderRadius: 'var(--radius-field)', boxShadow: 'var(--shadow-field)', overflow: 'hidden', fontFamily: 'var(--font-hand)', ...style
    }}>
      {showYardLines && lines.map((t, i) => (
        <div key={i} style={{ position: 'absolute', left: 0, right: 0, top: `${t * 100}%`, height: i === 3 ? 4 : 2, background: 'var(--ink)', opacity: i === 3 ? 1 : 0.22 }} />
      ))}
      {showYardLines && <span style={{ position: 'absolute', left: 12, top: 'calc(74% - 22px)', fontSize: 17, color: 'var(--ink)', opacity: 0.5 }}>LOS</span>}
      {children}
    </div>
  );
}

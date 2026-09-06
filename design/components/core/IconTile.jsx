import React from 'react';

/** Square-ish icon + label tile, laid out 3-up in a grid. */
export function IconTile({ icon, label, active = false, onClick, title, style }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      onClick={onClick} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: 'var(--space-1)',
        padding: 'var(--tile-pad)', border: 'var(--border)', borderRadius: 'var(--radius-tile)',
        background: active ? 'var(--surface-active)' : 'var(--surface-control)', cursor: 'pointer',
        boxShadow: 'var(--shadow-tile)', fontFamily: 'var(--font-hand)', color: 'var(--text-body)',
        transform: hover ? 'var(--lift-hover)' : 'none', transition: 'transform 120ms ease', ...style
      }}
    >
      <img src={icon} alt="" style={{ width: 'var(--tile-icon)', height: 'var(--tile-icon)', display: 'block' }} />
      <span style={{ fontSize: 'var(--text-caption)', lineHeight: 'var(--leading-tight)', textAlign: 'center' }}>{label}</span>
    </button>
  );
}

/** 3-column grid that IconTiles live in. */
export function TileGrid({ columns = 3, children, style }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 'var(--tile-gap)', ...style }}>
      {children}
    </div>
  );
}

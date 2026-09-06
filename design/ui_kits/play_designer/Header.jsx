function Header({ NS, leftOpen, rightOpen, onLeft, onRight, name }) {
  const { Button } = NS;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'var(--header-pad)', background: 'var(--cream)', borderBottom: 'var(--border)' }}>
      <Button size="sm" variant={leftOpen ? 'active' : 'default'} onClick={onLeft}>{leftOpen ? '‹' : '›'} Play</Button>
      <img src="../../assets/icons/football.png" alt="" style={{ width: 26, height: 26 }} />
      <span style={{ fontSize: 'var(--text-header)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
      <span style={{ fontSize: 14, color: 'var(--ink-muted)', whiteSpace: 'nowrap' }}>5v5 flag</span>
      <span style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <Button disabled>↶ Undo</Button>
        <Button disabled>Redo ↷</Button>
      </div>
      <Button size="sm" variant={rightOpen ? 'active' : 'default'} onClick={onRight}>Routes {rightOpen ? '›' : '‹'}</Button>
    </div>
  );
}
window.PDHeader = Header;

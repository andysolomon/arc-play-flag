const OFF_ROUTES = [['go','Go'],['out','Out'],['in','In'],['slant','Slant'],['corner','Corner'],['post','Post'],['curl','Curl'],['flat','Flat'],['cross','Cross'],['wheel','Wheel'],['block','Block'],['handoff','Handoff'],['customOff','Custom'],['deselectOff','Done']];
const DEF_ROUTES = [['man','Man'],['zoneDeep','Zone deep'],['zoneFlat','Zone flat'],['curlFlat','Curl-flat'],['midRead','Mid-read'],['blitz','Blitz'],['spy','Spy'],['customDef','Custom'],['deselectDef','Done']];

function RoutesSidebar({ NS, open, sel, route, setRoute, onDone, primary, setPrimary }) {
  const { IconTile, TileGrid, SectionLabel, TextInput, EmptyState, Button, PlayerToken } = NS;
  const I = (n) => '../../assets/icons/' + n + '.png';
  const list = sel ? (sel.team === 'offense' ? OFF_ROUTES : DEF_ROUTES) : [];
  return (
    <div style={{ flex: '0 0 auto', width: open ? 266 : 0, overflow: 'hidden', background: 'var(--cream)', borderLeft: open ? 'var(--border)' : 'none', transition: 'width 180ms ease' }}>
      <div style={{ width: 264, height: '100%', overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
        <SectionLabel>Routes</SectionLabel>
        {!sel && <EmptyState icon={I('football')}>Tap a player to give them a route.<br />Drag to move them.</EmptyState>}
        {sel && <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PlayerToken team={sel.team} label={sel.label} size={34} />
            <span style={{ flex: 1, fontSize: 18, lineHeight: 1.1 }}>{sel.team === 'offense' ? 'Pick a route' : 'Pick a coverage'}</span>
            <TextInput compact maxLength={3} defaultValue={sel.label} placeholder="Tag" style={{ width: 58 }} />
          </div>
          <TileGrid>
            {list.map(([k, label]) => <IconTile key={k} icon={I(k)} label={label} active={route === k}
              onClick={() => k.startsWith('deselect') ? onDone() : setRoute(route === k ? null : k)} />)}
          </TileGrid>
          {sel.team === 'offense' && route && <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" style={{ background: primary ? 'var(--rose-soft)' : undefined }} onClick={() => setPrimary(!primary)}>{primary ? '★ Primary read' : '☆ Mark primary'}</Button>
            <Button size="sm">⇄ Mirror route</Button>
          </div>}
        </>}
      </div>
    </div>
  );
}
window.PDRoutesSidebar = RoutesSidebar;

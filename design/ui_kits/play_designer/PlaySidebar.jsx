function PlaySidebar({ NS, open, vis, setVis, name, setName }) {
  const { IconTile, TileGrid, SectionLabel, Divider, TextInput, Select } = NS;
  const I = (n) => '../../assets/icons/' + n + '.png';
  return (
    <div style={{ flex: '0 0 auto', width: open ? 266 : 0, overflow: 'hidden', background: 'var(--cream)', borderRight: open ? 'var(--border)' : 'none', transition: 'width 180ms ease' }}>
      <div style={{ width: 264, height: '100%', overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box' }}>
        <SectionLabel>Play</SectionLabel>
        <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Play name" />
        <TileGrid>
          <IconTile icon={I('save')} label="Save" />
          <IconTile icon={I('duplicate')} label="Duplicate" />
          <IconTile icon={I('export')} label="Export" />
        </TileGrid>
        <Select defaultValue=""><option value="">Open a saved play…</option><option>Trips right</option><option>Mesh</option></Select>
        <Divider />
        <SectionLabel>Field</SectionLabel>
        <TileGrid>
          <IconTile icon={I('flip')} label="Flip play" />
          <IconTile icon={I('clear')} label="Clear routes" />
          <IconTile icon={I('reset')} label="Reset spots" />
        </TileGrid>
        <Divider />
        <SectionLabel>Show</SectionLabel>
        <TileGrid>
          <IconTile icon={I('football')} label="Both" active={vis === 'both'} onClick={() => setVis('both')} />
          <IconTile icon={I('offOnly')} label="Offense" active={vis === 'offense'} onClick={() => setVis('offense')} />
          <IconTile icon={I('defOnly')} label="Defense" active={vis === 'defense'} onClick={() => setVis('defense')} />
        </TileGrid>
        <span style={{ fontSize: 14, color: 'var(--ink-muted)', lineHeight: 1.3 }}>Clear and reset only touch the team you're showing.</span>
      </div>
    </div>
  );
}
window.PDPlaySidebar = PlaySidebar;

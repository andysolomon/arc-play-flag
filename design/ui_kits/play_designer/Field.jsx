// default 5v5 formation from the app, in yards (x 0–30, y: negative = defense side)
const PLAYERS = [
  { id: 'o1', team: 'offense', label: 'C', x: 15, y: 1 }, { id: 'o2', team: 'offense', label: 'QB', x: 15, y: 5 },
  { id: 'o3', team: 'offense', label: 'X', x: 3, y: 1 }, { id: 'o4', team: 'offense', label: 'Y', x: 27, y: 1 },
  { id: 'o5', team: 'offense', label: 'Z', x: 19, y: 5 },
  { id: 'd1', team: 'defense', label: '', x: 3, y: -5 }, { id: 'd2', team: 'defense', label: '', x: 11, y: -4 },
  { id: 'd3', team: 'defense', label: '', x: 18, y: -4 }, { id: 'd4', team: 'defense', label: '', x: 27, y: -5 },
  { id: 'd5', team: 'defense', label: '', x: 15, y: -11 }
];
const TOP = -17, DEPTH = 25; // yards shown above the LOS → total 24 yards tall

function Field({ NS, vis, selId, onSelect }) {
  const { FieldCard, PlayerToken } = NS;
  const shown = PLAYERS.filter(p => vis === 'both' || p.team === vis);
  return (
    <div onClick={() => onSelect(null)} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 9 }}>
      <FieldCard width="min(100%, 720px)" aspect={'30 / ' + DEPTH} showYardLines={false}>
        {[-15, -10, -5, 0, 5].map(y => <div key={y} style={{ position: 'absolute', left: 0, right: 0, top: ((y - TOP) / DEPTH * 100) + '%', height: y === 0 ? 4 : 2, background: 'var(--ink)', opacity: y === 0 ? 1 : 0.22 }} />)}
        {[-15, -10, -5, 0].map(y => <span key={y} style={{ position: 'absolute', left: 12, top: 'calc(' + ((y - TOP) / DEPTH * 100) + '% - 22px)', fontSize: 17, color: 'var(--ink)', opacity: 0.5 }}>{y === 0 ? 'LOS' : -y}</span>)}
        {shown.map(p => <PlayerToken key={p.id} team={p.team} label={p.label} size={46} selected={p.id === selId}
          onClick={e => { e.stopPropagation(); onSelect(p.id); }}
          style={{ position: 'absolute', left: (p.x / 30 * 100) + '%', top: ((p.y - TOP) / DEPTH * 100) + '%', transform: 'translate(-50%,-50%)', cursor: 'grab' }} />)}
      </FieldCard>
    </div>
  );
}
window.PDField = Field;
window.PD_PLAYERS = PLAYERS;

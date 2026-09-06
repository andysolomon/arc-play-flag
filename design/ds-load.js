// Resolves the component namespace: the compiled _ds_bundle.js when present, otherwise the raw .jsx sources transpiled in-page.
window.dsLoad = async function (base) {
  const find = () => { for (const k of Object.keys(window)) { try { const v = window[k]; if (v && typeof v === 'object' && v.IconTile && v.Button && v.PlayerToken) return v; } catch (e) {} } return null; };
  let NS = find();
  if (NS) return NS;
  await new Promise(res => { const s = document.createElement('script'); s.src = base + '_ds_bundle.js'; s.onload = res; s.onerror = res; document.head.appendChild(s); });
  NS = find();
  if (NS) return NS;
  NS = {};
  const files = ['components/core/Button.jsx', 'components/core/IconTile.jsx', 'components/core/SectionLabel.jsx',
    'components/forms/TextInput.jsx', 'components/forms/Select.jsx', 'components/feedback/Toast.jsx',
    'components/feedback/EmptyState.jsx', 'components/field/PlayerToken.jsx', 'components/field/FieldCard.jsx'];
  for (const f of files) {
    const src = await (await fetch(base + f)).text();
    const names = [...src.matchAll(/export function (\w+)/g)].map(m => m[1]);
    const code = src.replace(/^import .*$/mg, '').replace(/export function/g, 'function') + '\n;({' + names.join(',') + '})';
    Object.assign(NS, (0, eval)(Babel.transform(code, { presets: [['react', { runtime: 'classic' }]] }).code));
  }
  return NS;
};

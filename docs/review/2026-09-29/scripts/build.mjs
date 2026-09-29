import { launch, D, BASE, SP } from './lib.mjs';
import { TEAM, OFFENSE_A, OFFENSE_B, DEFENSE_A, DEFENSE_B } from './plays.mjs';
import { writeFileSync } from 'node:fs';
const { ctx, page, log } = await launch({ profile: 'coach' });
const d = new D(page);
const issues = [];
await d.goto();
await page.getByRole('button', { name: 'Dismiss getting started' }).click().catch(() => {});
await d.tools();
await page.getByRole('textbox', { name: 'Team name' }).fill(TEAM.name);
await page.getByRole('textbox', { name: 'Team name' }).press('Tab');

async function makePlay(spec, side) {
  const team = side === 'Offense' ? 'Offense' : 'Defense';
  await d.newPlay(side);
  await d.setName(spec.name);
  if (spec.los) { await d.tools(); await page.getByLabel('Line of scrimmage').selectOption({ label: spec.los }); await page.waitForTimeout(300); }
  for (const [who, x, y] of spec.moves) await d.drag(who, team, x, y);
  for (const [who, r, opt = {}] of spec.routes) {
    await d.select(who, team); await d.pick(r);
    if (opt.mirror) { await d.palette(); await page.locator('#route-sidebar').getByRole('button', { name: '⇄ Mirror route' }).click(); }
    if (opt.primary) { await d.palette(); await page.locator('#route-sidebar').getByRole('button', { name: /Mark primary/ }).click(); }
  }
  for (const [who, target] of spec.man ?? []) {
    await d.select(who, team); await d.pick('Man');
    await page.waitForTimeout(200);
    await d.field.getByRole('button', { name: `Offense ${target}, man coverage target` }).click();
    await page.waitForTimeout(200);
  }
  if (spec.custom) {
    const [who, pts, opt = {}] = spec.custom;
    await d.select(who, team); await d.pick('Custom');
    for (let i = 0; i < pts.length - 1; i++) await d.tapField(...pts[i]);
    await d.dblField(...pts[pts.length - 1]);
    await page.waitForTimeout(250);
    if (opt.primary) { await d.select(who, team); await page.locator('#route-sidebar').getByRole('button', { name: /Mark primary/ }).click(); }
  }
  await d.notes(spec.notes);
  await d.save();
  const toast = (await d.toast.allTextContents()).join('|');
  await d.closeSidebars();
  await page.waitForTimeout(200);
  const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await d.shot(`play-${side.toLowerCase()}-${slug}`);
  // verify what was stored against the spec
  const stored = Object.values(await d.storedPlays()).find(p => p.name === spec.name);
  if (!stored) { issues.push(`${spec.name}: not stored (toast: ${toast})`); return; }
  const lab = (id) => { const p = stored.players.find(q => q.label === id || q.id === id); return p; };
  for (const [who, r, opt = {}] of spec.routes) {
    const p = lab(who); const want = r.toLowerCase().replace(/[^a-z]/g, '');
    const got = (p?.route?.type ?? 'none').toLowerCase();
    if (!got.startsWith(want.slice(0, 4)) && !(want === 'zonedeep' && got === 'zonedeep')) issues.push(`${spec.name}: ${who} wanted ${r} got ${got}`);
    if (opt.primary && !p?.route?.primary) issues.push(`${spec.name}: ${who} primary not stored`);
  }
  for (const [who, target] of spec.man ?? []) {
    const p = lab(who); const t = stored.players.find(q => q.label === target && q.team === 'offense');
    if (p?.route?.type !== 'man' || p.route.target !== t?.id) issues.push(`${spec.name}: ${who} man on ${target} not stored (${JSON.stringify(p?.route)})`);
  }
  if (spec.custom) { const p = lab(spec.custom[0]); if (p?.route?.type !== 'custom') issues.push(`${spec.name}: custom route on ${spec.custom[0]} not stored (${JSON.stringify(p?.route)})`); else console.log(spec.name, 'custom pts', JSON.stringify(p.route.pts)); }
  for (const [who, x, y] of spec.moves) { const p = lab(who); if (Math.abs(p.x - x) > 0.6 || Math.abs(p.y - y) > 0.6) issues.push(`${spec.name}: ${who} dragged to ${x},${y} but stored ${p.x},${p.y}`); }
  if (stored.notes !== spec.notes) issues.push(`${spec.name}: notes mismatch`);
  console.log('OK', side, spec.name, 'toast=', toast, 'los=', stored.los ?? '(default)');
}
for (const s of [...OFFENSE_A, ...OFFENSE_B]) { try { await makePlay(s, 'Offense'); } catch (e) { issues.push(`${s.name}: THREW ${e.message.split('\n')[0]}`); await d.shot(`err-${s.name.replace(/\W+/g, '-')}`); } }
for (const s of [...DEFENSE_A, ...DEFENSE_B]) { try { await makePlay(s, 'Defense'); } catch (e) { issues.push(`${s.name}: THREW ${e.message.split('\n')[0]}`); await d.shot(`err-${s.name.replace(/\W+/g, '-')}`); } }
const all = await d.storedPlays();
writeFileSync(`${SP}/stored-plays.json`, JSON.stringify(all, null, 1));
console.log('STORED', Object.values(all).length, Object.values(all).map(p => `${p.side}:${p.name}`).join(', '));
console.log('ISSUES', JSON.stringify(issues, null, 1));
console.log('LOG', log.filter(l => !l.includes('preloaded')));
await ctx.close();

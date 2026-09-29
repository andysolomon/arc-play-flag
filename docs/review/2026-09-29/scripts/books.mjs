import { launch, D, BASE, SP } from './lib.mjs';
import { BOOKS } from './plays.mjs';
const { ctx, page, log } = await launch({ profile: 'coach' });
const d = new D(page);
// fix Mesh: un-mirror X's cross (my input error)
const plays = await (async () => { await d.goto(); return d.storedPlays(); })();
const mesh = Object.entries(plays).find(([, p]) => p.name === 'Mesh')[0];
await d.goto(`?open=${mesh}`);
await d.select('X'); await page.locator('#route-sidebar').getByRole('button', { name: '⇄ Mirror route' }).click();
await d.save(); await d.closeSidebars(); await d.shot('play-offense-mesh-fixed');
const x = Object.values(await d.storedPlays()).find(p => p.name === 'Mesh').players.find(p => p.label === 'X').route;
console.log('Mesh X route now', JSON.stringify(x));

await page.goto(`${BASE}/playbooks`); await page.waitForTimeout(600);
await d.shot('20-playbooks-all-plays');
for (const b of BOOKS) {
  await page.getByRole('button', { name: '+ New playbook' }).click();
  await page.waitForURL(/book=/);
  const name = page.getByRole('textbox', { name: 'Playbook name' });
  await name.fill(b.name);
  await page.getByRole('button', { name: '+ Add plays' }).click();
  const picker = page.getByRole('dialog', { name: new RegExp('Add plays to') });
  await picker.waitFor();
  if (b === BOOKS[0]) await d.shot('21-add-plays-dialog');
  for (const p of b.plays) await picker.getByTitle(`Add ${p}`, { exact: true }).click();
  console.log(b.name, '->', await picker.getByText(/plays? in this playbook/).textContent());
  await picker.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(300);
  const items = await page.getByRole('list').getByRole('listitem').allTextContents();
  console.log('  items:', items.map(t => t.slice(0, 40)).join(' | '));
  await d.shot(`22-book-${b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, { fullPage: true });
  await page.getByRole('link', { name: '‹ All playbooks' }).click();
  await page.waitForTimeout(400);
}
await d.shot('23-playbooks-home', { fullPage: true });
const books = await page.evaluate(() => JSON.parse(localStorage.getItem('ffpd.playbooks.v1') ?? localStorage.getItem('ffpd.playbooks.v2') ?? '{}'));
console.log('BOOK KEYS', await page.evaluate(() => Object.keys(localStorage)));
console.log(JSON.stringify(Object.values(books).map(b => [b.name, b.plays.length])));
console.log('LOG', log.filter(l => !l.includes('preloaded')));
await ctx.close();

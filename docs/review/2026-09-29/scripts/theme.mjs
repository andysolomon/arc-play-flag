import { launch, D, BASE, SP } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const { ctx, page, log } = await launch({ profile: 'coach' });
const d = new D(page);
const out = {};
const plays = async () => d.storedPlays();
await d.goto();
const trips = Object.entries(await plays()).find(([, p]) => p.name === 'Trips Right Flood')[0];
await d.goto(`?open=${trips}`);
async function theme(name) {
  await d.tools();
  const fold = page.locator('#play-sidebar').getByRole('button', { name: /^Theme\b/i });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  const r = page.locator('#play-sidebar').getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name, exact: true });
  out[`${name}-enabled`] = await r.isEnabled();
  if (await r.isEnabled()) { await r.click(); await page.waitForTimeout(1500); }
}
await d.tools();
const fold = page.locator('#play-sidebar').getByRole('button', { name: /^Theme\b/i });
await fold.click(); await page.waitForTimeout(400);
await page.locator('#play-sidebar').screenshot({ path: `${SP}/shots/60-theme-picker.png` });
out.themeRadios = await page.locator('#play-sidebar').getByRole('radiogroup', { name: 'Theme' }).getByRole('radio').evaluateAll(rs => rs.map(r => `${r.getAttribute('aria-label') ?? r.closest('label')?.innerText.trim()}${r.disabled ? ' (locked)' : ''}`));
await theme('Dark');
await d.shot('61-dark-designer-tools');
await d.closeSidebars(); await d.shot('62-dark-designer');
await page.goto(`${BASE}/playbooks`); await page.waitForTimeout(800); await d.shot('63-dark-playbooks');
const books = await page.evaluate(() => JSON.parse(localStorage.getItem('ffpd.playbooks.v1')));
await page.goto(`${BASE}/playbooks?book=${Object.keys(books)[0]}`); await page.waitForTimeout(800); await d.shot('64-dark-book');
// print emulation stays ink on paper?
await page.emulateMedia({ media: 'print' }); await page.waitForTimeout(300); await d.shot('65-dark-book-print'); await page.emulateMedia({ media: 'screen' });
await d.goto(`?open=${trips}`);
await theme('Tokyo Night'); await d.closeSidebars(); await d.shot('66-theme-tokyo-night');
await theme('Rosé Pine'); await d.closeSidebars(); await d.shot('67-theme-rose-pine');
await theme('Light'); await d.closeSidebars(); await d.shot('68-light-designer');
out.storedTheme = await page.evaluate(() => localStorage.getItem('ffpd.theme.v1'));
// per-play snapshot share link from the designer
await d.tools();
await page.getByRole('button', { name: 'Copy share link' }).click();
await page.waitForTimeout(400);
await d.shot('69-share-snapshot-dialog');
out.shareDialog = await page.getByRole('dialog').innerText().catch(() => null);
await page.getByRole('button', { name: 'Copy snapshot link' }).click();
await page.waitForTimeout(300);
out.snapshotLink = await page.evaluate(() => navigator.clipboard.readText());
out.toast = await d.toast.allTextContents();
const p2 = await ctx.newPage(); await p2.goto(out.snapshotLink); await p2.waitForTimeout(1200);
await p2.screenshot({ path: `${SP}/shots/70-snapshot-page.png` }); out.snapshotTitle = await p2.title(); await p2.close();
writeFileSync(`${SP}/theme.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log('LOG', log.filter(l => !l.includes('preloaded')));
await ctx.close();

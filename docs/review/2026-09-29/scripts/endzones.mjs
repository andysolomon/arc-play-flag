import { launch, D, BASE, SP } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const { ctx, page, log } = await launch({ profile: 'coach' });
const d = new D(page);
const res = [];
await d.goto();
// team colour: Hawks green
await d.tools();
 console.log('team', await page.evaluate(() => localStorage.getItem('ffpd.team.v1')));
await page.waitForTimeout(300);
// a scoring play: ball on their 10, X runs a go into the end zone
const td = Object.entries(await d.storedPlays()).find(([, p]) => p.name === 'TD Test - X Fade')[0];
await d.goto(`?open=${td}`);
const picker = () => page.locator('#play-sidebar').getByRole('radiogroup', { name: 'End zone' });
async function openPicker() {
  await d.tools();
  const fold = page.locator('#play-sidebar').getByRole('button', { name: /^End zone\b/i });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await picker().waitFor();
  await page.waitForTimeout(400);
}
await openPicker();
await page.locator('#play-sidebar').getByRole('radiogroup', { name: 'End zone' }).screenshot({ path: `${SP}/shots/50b-endzone-picker-resume.png` });
const hintStart = await page.locator('#play-sidebar').getByText(/of 8 open|All 8 open/).textContent();
res.push({ hintStart });
const order = ['Great Wave', '8-Bit', 'Event Horizon'];
for (const name of order) {
  await openPicker();
  const radio = picker().getByRole('radio', { name, exact: true });
  const enabled = await radio.isEnabled();
  if (!enabled) { res.push({ name, error: 'locked when its turn came' }); continue; }
  for (let i = 0; i < 4 && !(await radio.isChecked()); i++) { await radio.scrollIntoViewIfNeeded(); await radio.click(); await page.waitForTimeout(800); }
  // the "Switching to…" interstitial comes and goes
  await page.waitForTimeout(1500);
  await d.closeSidebars();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  await d.shot(`51-endzone-${slug}-rest`);
  await page.getByRole('button', { name: 'Run the play' }).click();
  const party = page.locator('[data-celebration]');
  let scored = false;
  try { await party.waitFor({ timeout: 12000 }); scored = true; } catch {}
  if (!scored) { res.push({ name, scored: false }); await page.waitForTimeout(4000); continue; }
  await page.waitForTimeout(900);
  await d.shot(`52-endzone-${slug}-touchdown`);
  const r = {
    name, scored,
    celebration: await party.getAttribute('data-celebration'),
    motion: await party.getAttribute('data-motion'),
    banner: await party.locator('[data-touchdown]').innerText().catch(() => null),
    unlocked: await party.locator('[data-unlocked]').innerText().catch(() => null),
    announced: await page.locator("[aria-live='polite']", { hasText: 'Touchdown!' }).allTextContents(),
    touchdowns: await page.evaluate(() => localStorage.getItem('ffpd.touchdowns.v1')),
  };
  res.push(r); console.log(JSON.stringify(r));
  await party.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);
}
await openPicker();
await page.locator('#play-sidebar').getByRole('radiogroup', { name: 'End zone' }).screenshot({ path: `${SP}/shots/53-endzone-picker-all-open.png` });
res.push({ hintEnd: await page.locator('#play-sidebar').getByText(/of 8 open|All 8 open/).textContent() });
writeFileSync(`${SP}/endzones-part2.json`, JSON.stringify(res, null, 1));
console.log(JSON.stringify(res.filter(r => !r.celebration), null, 1));
console.log('LOG', log.filter(l => !l.includes('preloaded')));
await ctx.close();

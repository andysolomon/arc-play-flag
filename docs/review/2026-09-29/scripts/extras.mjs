import { launch, D, BASE, SP } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const out = {};
// B. How deep downfield can a coach see/draw, per screen?
for (const [name, vp, extra] of [['laptop-1280x720', { width: 1280, height: 720 }, {}], ['laptop-1440x900', { width: 1440, height: 900 }, {}], ['desktop-1920x1080', { width: 1920, height: 1080 }, {}], ['ipad-810x1080', { width: 810, height: 1080 }, { isMobile: true, hasTouch: true }], ['iphone-390x844', { width: 390, height: 844 }, { isMobile: true, hasTouch: true }]]) {
  const { ctx, page } = await launch({ profile: `depth-${name}`, viewport: vp, extra });
  const d = new D(page); await d.goto();
  const vb = await d.field.getAttribute('viewBox');
  const vh = Number(vb.split(' ')[3]);
  out[`depth-${name}`] = { viewBox: vb, yardsDownfield: +(vh / 22 - 8).toFixed(1), totalYards: vh / 22 };
  await ctx.close();
}
const { ctx, page, log } = await launch({ profile: 'coach' });
const d = new D(page);
await d.goto();
// C. a run from inside the no-run zone (ball on their 5)
await d.newPlay('Offense'); await d.setName('No-run zone check');
await page.getByLabel('Line of scrimmage').selectOption({ label: 'From the 5' });
out.losCaption = await page.locator('#play-sidebar').getByText(/Saved with this play\./).textContent();
await d.select('Z'); 
out.runsOfferedInNoRunZone = await page.locator('#route-sidebar').getByRole('group', { name: 'Runs' }).getByRole('button').allTextContents();
await d.pick('Stretch');
out.stretchStored = (await d.draft())?.players?.find(p => p.id === 'o5')?.route ?? (await page.evaluate(() => Object.keys(localStorage)));
out.toastAfterRun = await d.toast.allTextContents();
await d.closeSidebars(); await d.shot('80-run-in-no-run-zone');
// D. rusher closer than 7 yards
await d.newPlay('Defense'); await d.setName('Rush rule check');
await d.drag('d3', 'Defense', 18, -2);
const before = await d.player('d3', 'Defense').getAttribute('transform');
await d.select('d3', 'Defense'); await d.pick('Blitz');
await page.waitForTimeout(400);
out.blitz = { before, after: await d.player('d3', 'Defense').getAttribute('transform') };
await d.closeSidebars(); await d.shot('81-blitz-rule');
// offense dragged past the line / off the field
await d.newPlay('Offense');
await d.drag('X', 'Offense', 3, -6);
await d.drag('Y', 'Offense', 31, 1);
out.clamp = { X: await d.player('X').getAttribute('transform'), Y: await d.player('Y').getAttribute('transform') };
// L. a 60-char name + emoji, max notes
await d.setName('Trips Right Bunch Flood Wheel Sluggo Double Move Special 🦅🏈');
out.nameStored = await page.getByRole('textbox', { name: 'Play name' }).inputValue();
await d.closeSidebars(); await d.shot('82-long-name');
// Unsaved work survives a reload?
await d.select('Z'); await d.pick('Post');
await page.reload(); await d.field.waitFor(); await page.waitForTimeout(600);
out.afterReload = { heading: await page.getByRole('heading', { level: 1 }).textContent(), zRoute: (await d.draft())?.players?.find(p => p.id === 'o5')?.route ?? null };
await d.shot('83-after-reload-unsaved');
// Undo shortcut
await page.keyboard.press('Control+z'); await page.waitForTimeout(200);
out.afterCtrlZ = (await d.draft())?.players?.find(p => p.id === 'o5')?.route ?? null;
// F. delete the duplicate TD play from All plays
await page.goto(`${BASE}/playbooks`); await page.waitForTimeout(800);
const cards = page.getByRole('link', { name: 'Open TD Test - X Fade in the designer' });
out.tdCardsBefore = await cards.count();
const card = page.locator('li, article, div').filter({ has: cards.first() }).last();
await d.shot('84-all-plays', { fullPage: false });
writeFileSync(`${SP}/extras.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
console.log('LOG', log.filter(l => !l.includes('preloaded')));
await ctx.close();

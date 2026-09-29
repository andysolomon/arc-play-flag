import { launch, D, BASE, SP } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const out = {};
// ---- Demo tour (desktop)
{
  const { ctx, page, log } = await launch({ profile: 'demo' });
  await page.goto(`${BASE}/demo`); await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SP}/shots/90-demo-page.png` });
  out.demoHeadings = await page.getByRole('heading', { level: 2 }).allTextContents();
  const vids = page.locator('video[data-demo]');
  out.demoCount = await vids.count();
  out.demoFrames = [];
  for (let i = 0; i < out.demoCount; i++) {
    const v = vids.nth(i);
    await v.scrollIntoViewIfNeeded();
    const info = await v.evaluate(async (el) => {
      el.preload = 'auto'; el.load();
      await new Promise((res, rej) => { el.addEventListener('loadeddata', res, { once: true }); el.addEventListener('error', () => rej(new Error('video error ' + (el.error?.code))), { once: true }); setTimeout(() => rej(new Error('timeout')), 15000); });
      const dur = el.duration; el.currentTime = dur * 0.6;
      await new Promise(r => el.addEventListener('seeked', r, { once: true }));
      return { src: el.currentSrc.split('/').pop(), dur: +dur.toFixed(1), w: el.videoWidth, h: el.videoHeight };
    }).catch(e => ({ error: e.message }));
    out.demoFrames.push(info);
    await v.screenshot({ path: `${SP}/shots/91-demo-${String(i + 1).padStart(2, '0')}.png` }).catch(() => {});
  }
  out.demoLog = log.filter(l => !l.includes('preloaded'));
  await ctx.close();
}
// ---- Phone: iPhone-sized, build a play from scratch with touch
{
  const { ctx, page, log } = await launch({ profile: 'phone-coach', viewport: { width: 390, height: 844 }, extra: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
  const d = new D(page);
  await d.goto();
  await page.getByRole('button', { name: 'Dismiss getting started' }).click().catch(() => {});
  await d.tools(); await d.shot('92-phone-play-tools');
  out.phoneToolsOverlay = await page.locator('#play-sidebar').evaluate(el => getComputedStyle(el).position);
  await d.setName('Phone Slant');
  await d.closeSidebars();
  await d.select('X'); await d.shot('93-phone-palette');
  await d.pick('Slant');
  await d.palette(); await page.locator('#route-sidebar').getByRole('button', { name: /Mark primary/ }).click();
  await d.closeSidebars();
  await d.select('Y'); await d.pick('Out');
  await d.closeSidebars();
  await d.save(); await d.closeSidebars(); await d.shot('94-phone-play-saved');
  out.phoneSaved = Object.values(await d.storedPlays()).map(p => p.name);
  // header buttons accessible names + sizes
  out.phoneHeader = await page.locator('header button, header a, [role=banner] button').evaluateAll(bs => bs.map(b => ({ name: b.getAttribute('aria-label') || b.innerText.trim(), text: b.innerText.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })));
  // playbooks on the phone
  await page.goto(`${BASE}/playbooks`); await page.waitForTimeout(800); await d.shot('95-phone-playbooks');
  // a second coach imports a shared link by pasting it
  const link = JSON.parse(await (await import('node:fs/promises')).readFile(`${SP}/exports/report.json`, 'utf8')).find(r => r.share)?.share;
  out.importLink = link;
  await page.getByRole('textbox', { name: /Have a share link/ }).fill(link);
  await page.getByRole('button', { name: 'Preview link' }).click();
  await page.waitForTimeout(1500); await d.shot('96-phone-import-preview');
  const imp = page.getByRole('button', { name: /^Import/ }).first();
  out.importButtons = await page.getByRole('button', { name: /Import/ }).allTextContents();
  if (await imp.count()) { await imp.click(); await page.waitForTimeout(1000); }
  out.importToast = await d.toast.allTextContents();
  out.afterImportPlays = Object.values(await d.storedPlays()).length;
  await d.shot('97-phone-after-import');
  // offline: cut the network and reload the designer and a book
  await page.waitForTimeout(2500);
  await ctx.setOffline(true);
  await page.goto(`${BASE}/`).catch(e => out.offlineErr = e.message);
  await page.waitForTimeout(1500);
  out.offlineDesigner = await page.locator("[aria-label='Play diagram']").isVisible().catch(() => false);
  await d.shot('98-phone-offline');
  await ctx.setOffline(false);
  out.phoneLog = log.filter(l => !l.includes('preloaded'));
  await ctx.close();
}
// ---- delete the duplicate TD play (desktop coach)
{
  const { ctx, page, log } = await launch({ profile: 'coach' });
  const d = new D(page);
  await page.goto(`${BASE}/playbooks`); await page.waitForTimeout(800);
  const more = page.getByRole('button', { name: 'More actions for TD Test - X Fade' });
  out.tdBefore = await more.count();
  await more.last().scrollIntoViewIfNeeded(); await more.last().click();
  const del = page.getByRole('button', { name: /Delete play|Tap again to delete/ });
  await del.first().click(); await page.waitForTimeout(200);
  await d.shot('99-delete-confirm');
  await page.getByRole('button', { name: /Tap again to delete|Delete\?/ }).first().click();
  await page.waitForTimeout(500);
  out.deleteToast = await d.toast.allTextContents();
  out.tdAfter = await page.getByRole('button', { name: 'More actions for TD Test - X Fade' }).count();
  await ctx.close();
}
writeFileSync(`${SP}/phone.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));

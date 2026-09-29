import { launch, BASE, SP } from './lib.mjs';
const { ctx, page } = await launch({ profile: 'demo' });
await page.goto(`${BASE}/demo`); await page.waitForTimeout(800);
const vids = page.locator('video[data-demo]');
const n = await vids.count();
for (let i = 0; i < n; i++) {
  const v = vids.nth(i);
  await v.scrollIntoViewIfNeeded();
  await v.evaluate(async (el) => { el.removeAttribute('controls'); el.preload = 'auto'; el.load(); await new Promise(r => el.addEventListener('canplaythrough', r, { once: true })); });
  for (const f of [0.15, 0.5, 0.9]) {
    await v.evaluate(async (el, f) => { el.currentTime = el.duration * f; await new Promise(r => el.addEventListener('seeked', r, { once: true })); }, f);
    await page.waitForTimeout(350);
    await v.screenshot({ path: `${SP}/shots/102-demo-${i + 1}-${Math.round(f * 100)}.png` });
  }
}
await ctx.close();

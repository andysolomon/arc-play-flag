import { launch, D, BASE, SP } from './lib.mjs';
// same Four Verts play on a 1920x1080 monitor and on a phone
const { ctx, page } = await launch({ profile: 'coach', viewport: { width: 1920, height: 1080 } });
const d = new D(page);
await d.goto();
const fv = Object.entries(await d.storedPlays()).find(([, p]) => p.name === 'Four Verts')[0];
await d.goto(`?open=${fv}`); await d.closeSidebars(); await page.waitForTimeout(400);
await d.shot('110-depth-1920-four-verts');
// try to tap a custom waypoint 20 yards deep on the desktop: where does it land?
await d.select('C'); await d.pick('Custom');
const top = await d.yardPoint(15, -16);
await d.closeSidebars();
await page.mouse.click(top.x, top.y + 2);
await page.mouse.dblclick(top.x, top.y + 2);
await page.waitForTimeout(300);
const c = (await d.draft())?.players?.find(p => p.id === 'o1')?.route;
console.log('deepest custom waypoint reachable on 1920x1080:', JSON.stringify(c));
await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z');
// playbooks page scroll check on desktop
await page.goto(`${BASE}/playbooks`); await page.waitForTimeout(700);
await page.mouse.wheel(0, 3000); await page.waitForTimeout(500);
await d.shot('111-playbooks-scrolled');
console.log('all plays visible after scroll:', await page.getByText('ALL PLAYS', { exact: false }).first().isVisible());
await ctx.close();
const m = await launch({ profile: 'coach', viewport: { width: 390, height: 844 }, extra: { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } });
const dm = new D(m.page); await dm.goto(`?open=${fv}`); await dm.closeSidebars(); await m.page.waitForTimeout(400);
await dm.shot('112-depth-phone-four-verts');
await m.ctx.close();

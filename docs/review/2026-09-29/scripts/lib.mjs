import { chromium } from 'playwright';
export const BASE = 'http://localhost:3123';
export const SP = '/tmp/claude-0/-home-user-arc-play-flag/996a583c-4d9d-5a48-9fe5-d2c42ad4671b/scratchpad';
export const S = 22, VW = 660;
export async function launch({ profile = 'coach', viewport = { width: 1440, height: 900 }, colorScheme = 'light', extra = {} } = {}) {
  const ctx = await chromium.launchPersistentContext(`${SP}/profiles/${profile}`, {
    executablePath: '/opt/pw-browsers/chromium', viewport, colorScheme, acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'], ...extra,
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const log = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => log.push('pageerror: ' + e.message));
  return { ctx, page, log };
}
export class D {
  constructor(page) { this.page = page; }
  get field() { return this.page.locator("[aria-label='Play diagram']"); }
  get toast() { return this.page.locator("div[role='status']"); }
  async goto(q = '') { await this.page.goto(`${BASE}/${q}`); await this.field.waitFor(); await this.page.waitForTimeout(400); }
  async open(name, id) {
    const t = this.page.getByRole('button', { name });
    for (let i = 0; i < 10; i++) {
      if ((await t.getAttribute('aria-expanded')) === 'true') break;
      await t.click(); await this.page.waitForTimeout(250);
    }
    await this.settle();
  }
  async settle() { let a = null; for (let i = 0; i < 20; i++) { const b = await this.field.boundingBox(); if (a && JSON.stringify(a) === JSON.stringify(b)) return; a = b; await this.page.waitForTimeout(80); } }
  async tools() { await this.open('Play tools', 'play-sidebar'); }
  async palette() { await this.open('Route palette', 'route-sidebar'); }
  async closeSidebars() {
    for (const name of ['Play tools', 'Route palette']) { const t = this.page.getByRole('button', { name }); if ((await t.getAttribute('aria-expanded')) === 'true') await t.click(); }
    await this.settle();
  }
  async foldOverlays() {
    const floating = await this.page.locator("aside[aria-hidden='false']").evaluateAll(as => as.some(el => getComputedStyle(el).position === 'absolute'));
    if (floating) await this.closeSidebars();
  }
  async tool(label) { await this.tools(); return this.page.locator('#play-sidebar').getByRole('button', { name: label, exact: true }); }
  async clickTool(label) { await (await this.tool(label)).click(); }
  async newPlay(side = 'Offense') { await this.clickTool('New play'); await this.page.locator('#play-sidebar').getByRole('group', { name: 'New play' }).getByRole('button', { name: side, exact: true }).click(); await this.page.waitForTimeout(200); }
  async setName(n) { await this.tools(); await this.page.getByRole('textbox', { name: 'Play name' }).fill(n); }
  async notes(text) {
    await this.tools();
    const ta = this.page.getByRole('textbox', { name: 'Coaching points' });
    if (!(await ta.isVisible().catch(() => false))) await this.clickTool('Notes');
    await ta.fill(text);
  }
  async save() { await this.clickTool('Save'); await this.page.waitForTimeout(300); }
  player(label, team = 'Offense') { return this.field.getByRole('button', { name: `${team} ${label}`, exact: true }); }
  async select(label, team = 'Offense') {
    await this.foldOverlays();
    for (let i = 0; i < 5; i++) {
      await this.player(label, team).click();
      await this.page.waitForTimeout(150);
      if ((await this.player(label, team).getAttribute('aria-pressed')) === 'true') break;
    }
    await this.palette();
  }
  async pick(label) { await this.palette(); await this.page.locator('#route-sidebar').getByRole('group').getByRole('button', { name: label, exact: true }).click(); await this.page.waitForTimeout(150); }
  async route(label, team, routeName, { primary = false } = {}) {
    await this.select(label, team); await this.pick(routeName);
    if (primary) { await this.palette(); await this.page.locator('#route-sidebar').getByRole('button', { name: /Mark primary/ }).click(); }
  }
  async yardPoint(x, y) {
    const box = await this.field.boundingBox(); const vb = await this.field.getAttribute('viewBox');
    const vh = Number(vb.split(' ')[3]); const top = 8 - vh / S;
    return { x: box.x + ((x * S) / VW) * box.width, y: box.y + (((y - top) * S) / vh) * box.height };
  }
  async tapField(x, y) { await this.closeSidebars(); const p = await this.yardPoint(x, y); await this.page.mouse.click(p.x, p.y); }
  async dblField(x, y) { await this.closeSidebars(); const p = await this.yardPoint(x, y); await this.page.mouse.dblclick(p.x, p.y); }
  /** drag a player to yard (x,y) */
  async drag(label, team, x, y) {
    await this.closeSidebars();
    const b = await this.player(label, team).boundingBox();
    const to = await this.yardPoint(x, y);
    await this.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await this.page.mouse.down();
    await this.page.mouse.move((b.x + b.width / 2 + to.x) / 2, (b.y + b.height / 2 + to.y) / 2, { steps: 5 });
    await this.page.mouse.move(to.x, to.y, { steps: 8 });
    await this.page.mouse.up();
    await this.page.waitForTimeout(150);
  }
  async storedPlays() { return this.page.evaluate(() => JSON.parse(localStorage.getItem('ffpd.plays.v2') ?? '{}')); }
  async draft() { return this.page.evaluate(() => JSON.parse(localStorage.getItem('ffpd.draft.v2') ?? localStorage.getItem('ffpd.draft.v1') ?? 'null')); }
  async shot(name, opts = {}) { await this.page.screenshot({ path: `${SP}/shots/${name}.png`, ...opts }); return `${SP}/shots/${name}.png`; }
}

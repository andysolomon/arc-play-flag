import { launch, D, BASE, SP } from './lib.mjs';
import { BOOKS } from './plays.mjs';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
const { ctx, page, log } = await launch({ profile: 'coach' });
const d = new D(page);
const report = [];
await page.goto(`${BASE}/playbooks`); await page.waitForTimeout(600);
const books = await page.evaluate(() => JSON.parse(localStorage.getItem('ffpd.playbooks.v1')));
const posts = [];
page.on('request', r => { if (r.url().endsWith('/api/shares') && r.method() === 'POST') posts.push(r.postData()); });
async function dl(label, dir, timeout = 60000, rename = null) {
  const t0 = Date.now();
  try {
    const [f] = await Promise.all([page.waitForEvent('download', { timeout }), page.getByRole('button', { name: label }).click()]);
    const path = `${dir}/${rename ?? f.suggestedFilename()}`; await f.saveAs(path);
    await page.waitForTimeout(300);
    const toast = (await d.toast.allTextContents()).join('|');
    report.push({ label, file: f.suggestedFilename(), bytes: statSync(path).size, ms: Date.now() - t0, toast });
  } catch (e) { report.push({ label, error: e.message.split('\n')[0], toast: (await d.toast.allTextContents()).join('|') }); }
}
for (const [id, b] of Object.entries(books)) {
  const slug = b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dir = `${SP}/exports/${slug}`; mkdirSync(dir, { recursive: true });
  await page.goto(`${BASE}/playbooks?book=${id}`); await page.waitForTimeout(800);
  report.push({ book: b.name });
  await page.getByRole('img', { name: 'Playbook PDF preview' }).scrollIntoViewIfNeeded();
  await d.shot(`30-export-panel-${slug}`);
  await dl('Download wristbands PDF', dir);
  await dl('Download binder PDF', dir);
  await page.getByRole('combobox', { name: 'Binder layout' }).selectOption('four');
  await dl('Download binder PDF', dir, 60000, `${slug}-binder-four-up.pdf`);
  await page.getByRole('combobox', { name: 'Binder layout' }).selectOption('one');
  await dl('Download postcards PDF', dir);
  await dl('Download flyer PDF', dir);
  await dl('Download slides', dir, 90000);
  await dl('Download playbook file', dir);
  // share this playbook
  await page.getByRole('button', { name: 'Share playbook…' }).click();
  await page.getByRole('checkbox', { name: /Include team name and colour/ }).check();
  await d.shot(`31-share-preview-${slug}`);
  const n = posts.length;
  await page.getByRole('button', { name: 'Create link' }).click();
  const url = page.getByRole('textbox', { name: 'Share URL' }).first();
  await url.waitFor({ timeout: 15000 });
  const localUrl = await url.inputValue();
  await d.shot(`32-share-created-${slug}`);
  writeFileSync(`${SP}/shares/${slug}.json`, posts[n] ?? '');
  report.push({ share: localUrl, body: `${slug}.json`, bodyBytes: (posts[n] ?? '').length });
  // open the local share page as a recipient would
  const r = await ctx.newPage();
  await r.goto(localUrl); await r.waitForTimeout(1200);
  await r.screenshot({ path: `${SP}/shots/33-share-page-${slug}.png`, fullPage: false });
  report.push({ sharePageTitle: await r.title(), h1: await r.locator('h1').allTextContents() });
  await r.close();
}
writeFileSync(`${SP}/exports/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
console.log('LOG', log.filter(l => !l.includes('preloaded')));
await ctx.close();

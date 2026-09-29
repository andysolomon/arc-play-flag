import { launch, D, SP } from './lib.mjs';
import { statSync } from 'node:fs';
const { ctx, page, log } = await launch({ profile: 'coach' });
const d = new D(page);
// 1) back up everything on the 127.0.0.1 origin
await page.goto('http://127.0.0.1:3123/playbooks'); await page.waitForTimeout(600);
await page.getByRole('button', { name: /team, theme & backup settings/ }).click();
await page.waitForTimeout(400);
await d.shot('24-settings-dialog', { fullPage: false });
const [f] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
const path = `${SP}/exports/${f.suggestedFilename()}`; await f.saveAs(path);
console.log('backup', f.suggestedFilename(), statSync(path).size, 'bytes; toast:', await d.toast.allTextContents());
const before = await page.evaluate(() => ({ plays: Object.keys(JSON.parse(localStorage.getItem('ffpd.plays.v2'))).length, books: Object.keys(JSON.parse(localStorage.getItem('ffpd.playbooks.v1'))).length, team: localStorage.getItem('ffpd.team.v1') }));
// 2) restore on the localhost origin (an empty "device")
await page.goto('http://localhost:3123/playbooks'); await page.waitForTimeout(800);
await page.getByRole('button', { name: /team, theme & backup settings/ }).click();
await page.getByLabel('Restore a device backup').setInputFiles(path);
await page.waitForTimeout(500);
await d.shot('25-restore-preview');
console.log(await page.getByRole('region', { name: 'Restore preview' }).innerText());
await page.getByRole('button', { name: 'Replace device data' }).click();
await page.waitForTimeout(800);
console.log('toast:', await d.toast.allTextContents());
const after = await page.evaluate(() => ({ plays: Object.keys(JSON.parse(localStorage.getItem('ffpd.plays.v2') ?? '{}')).length, books: Object.keys(JSON.parse(localStorage.getItem('ffpd.playbooks.v1') ?? '{}')).length, team: localStorage.getItem('ffpd.team.v1') }));
console.log('before', before, 'after', after);
console.log('LOG', log.filter(l => !l.includes('preloaded')));
await ctx.close();

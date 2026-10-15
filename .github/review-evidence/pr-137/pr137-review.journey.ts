import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { Designer } from '../support/designer';
import { seed, SLANT_LEFT, WHEEL_RIGHT, OTTERS, playbook, playbookFile, jsonUpload, storedPlaybooks } from '../support/fixtures';

test('review: importing a changed primary must preserve that choice', async ({page}, info) => {
  const book = playbook('review-book', 'Review Game Plan', [SLANT_LEFT, WHEEL_RIGHT], SLANT_LEFT);
  await seed(page, {plays: [SLANT_LEFT, WHEEL_RIGHT], playbooks: [book], team: OTTERS});
  await page.goto('/playbooks?book=review-book');
  await expect(page.getByRole('list').getByRole('listitem').nth(0).getByText('Primary', {exact:true})).toBeVisible();
  const incoming = {...book, primary: WHEEL_RIGHT.id};
  await page.goto('/playbooks');
  await page.getByLabel('Import a playbook file').setInputFiles(jsonUpload('changed-primary.playbook.json', playbookFile(incoming,[SLANT_LEFT,WHEEL_RIGHT],OTTERS)));
  await expect(page.getByRole('button',{name:'Import playbook',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Import playbook',exact:true}).click();
  await expect(page.getByRole('list').getByRole('listitem')).toHaveCount(2);
  const stored = await storedPlaybooks(page);
  await page.getByRole('list').getByRole('listitem').nth(0).getByText('Primary',{exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:`test-results/review-import-primary-${info.project.name}.png`,fullPage:true});
  writeFileSync(`test-results/review-import-primary-${info.project.name}.json`,JSON.stringify({incoming,stored},null,2));
  // Record observed behavior without treating the reproduction as a product pass.
  expect(stored[book.id]?.primary).toBe(SLANT_LEFT.id);
});

test('review: Escape does not dismiss a play menu for an empty book', async ({page}, info) => {
  await seed(page,{plays:[SLANT_LEFT],playbooks:[playbook('empty-review','Review Empty Book',[])],team:OTTERS});
  const d=new Designer(page); await d.goto(); await d.tools();
  await page.getByRole('button',{name:'Plays in this playbook',exact:true}).click();
  const menu=page.getByRole('menu',{name:'Plays in this playbook'});
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // A reproduction: expected dismissal does not happen.
  await expect(menu).toBeVisible();
  await page.screenshot({path:`test-results/review-empty-escape-${info.project.name}.png`});
  writeFileSync(`test-results/review-empty-escape-${info.project.name}.json`,JSON.stringify({key:'Escape',stillExpanded:await page.getByRole('button',{name:'Plays in this playbook',exact:true}).getAttribute('aria-expanded'),focused:await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'))},null,2));
});

test('review: long menus remain scrollable and keyboard reachable in dark mode', async ({page},info) => {
  await page.emulateMedia({colorScheme:'dark'});
  const many=Array.from({length:40},(_,i)=>({...SLANT_LEFT,id:`long-${i}`,name:`Review Play ${i+1}: Long name for the two minute game plan`}));
  await seed(page,{plays:many,playbooks:[playbook('long-book','Review Long Game Plan',many,many[35])],team:OTTERS});
  const d=new Designer(page);await d.goto();await d.tools();
  await page.getByRole('button',{name:'Plays in this playbook',exact:true}).click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(40);
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitemradio').last()).toBeFocused();
  await page.screenshot({path:`test-results/review-dark-long-menu-${info.project.name}.png`});
  await page.keyboard.press('Enter');
  await expect(d.nameInput).toHaveValue(many[39].name);
});

test('review: a failed current-book write loses the in-memory choice after a book edit', async ({page}, info) => {
  const game=playbook('review-game','Review Game Plan',[SLANT_LEFT],SLANT_LEFT);
  const road=playbook('review-road','Review Road Book',[WHEEL_RIGHT],WHEEL_RIGHT);
  await seed(page,{plays:[SLANT_LEFT,WHEEL_RIGHT],playbooks:[game,road],team:OTTERS});
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value) {
      if(key==='ffpd.current-book.v1') throw new DOMException('Quota exceeded','QuotaExceededError');
      return original.call(this,key,value);
    };
  });
  const d=new Designer(page); await d.goto(); await d.tools();
  await page.getByRole('button',{name:'Playbooks',exact:true}).click();
  await page.getByRole('menuitemradio',{name:road.name,exact:true}).click();
  await expect(d.nameInput).toHaveValue(WHEEL_RIGHT.name);
  await page.getByRole('button',{name:'Plays in this playbook',exact:true}).click();
  await expect(page.getByRole('menu',{name:'Plays in this playbook'})).toContainText(road.name);
  await page.screenshot({path:`test-results/review-current-before-${info.project.name}.png`});
  await page.keyboard.press('Escape');
  await d.newPlay(); await d.setName('Review New Play'); await d.save();
  await page.getByRole('button',{name:'Plays in this playbook',exact:true}).click();
  await page.getByRole('menuitem',{name:'+ Add “Review New Play” to this playbook',exact:true}).click();
  await page.getByRole('button',{name:'Plays in this playbook',exact:true}).click();
  await expect(page.getByRole('menu',{name:'Plays in this playbook'})).toContainText(game.name);
  await page.screenshot({path:`test-results/review-current-after-${info.project.name}.png`});
  writeFileSync(`test-results/review-current-${info.project.name}.json`,JSON.stringify({stored:await storedPlaybooks(page),menu:await page.getByRole('menu',{name:'Plays in this playbook'}).innerText()},null,2));
});

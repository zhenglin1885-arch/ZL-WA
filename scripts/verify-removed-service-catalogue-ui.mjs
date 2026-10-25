/* eslint-disable no-await-in-loop -- Legacy routes are verified sequentially. */
/* eslint-disable no-console -- Standalone UI regression output. */
import assert from 'node:assert/strict';
import { evaluate, wait, click, socket } from './account-tools-cdp.mjs';

try {
  await wait(
    '!!window.ferdium?.stores?.services?.allServicesRequest.wasExecuted',
    'installed accounts loaded',
  );
  const originalRoute = await evaluate(
    'window.ferdium.stores.router.location.pathname',
  );
  const accounts = () =>
    evaluate(
      'window.ferdium.stores.services.all.map(s=>({id:s.id,name:s.name,recipeId:s.recipe.id}))',
    );
  const before = await accounts();
  const workspaces = () =>
    evaluate(
      `require('./features/workspaces/api').workspaceApi.getUserWorkspaces()`,
    );
  const workspacesBefore = await workspaces();
  try {
    const previews = await evaluate('window.ferdium.api.recipePreviews.all()');
    assert.equal(previews.length, 16);
    assert(previews.some(recipe => recipe.id === 'discord'));
    assert(previews.some(recipe => recipe.id === 'whatsapp'));
    await evaluate(
      `window.ferdium.stores.router.push('/settings/recipes');true`,
    );
    await wait(
      `document.querySelectorAll('.zl-picks__item').length===16`,
      'ZL Picks original recommendations',
    );
    assert.equal(
      await evaluate(
        `document.querySelector('.zl-picks__navigation').innerText`,
      ),
      'ZL Picks',
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.settings-navigation a[href*="workspaces"]').length`,
      ),
      0,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('.settings-navigation').innerText.includes('您的工作组')`,
      ),
      false,
    );
    assert(
      await evaluate(
        `![...document.querySelectorAll('.zl-picks img')].some(img=>!img.complete || img.naturalWidth===0)`,
      ),
      'local recommendation icons loaded',
    );
    assert(
      !/Custom Services|Custom 3rd Party|Ferdium Picks|服务丢失|Missing a service|所有服务/.test(
        await evaluate("document.querySelector('.zl-picks').innerText"),
      ),
    );
    await evaluate(
      `(()=>{const input=document.querySelector('.zl-picks input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'gmail');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    );
    await wait(
      `document.querySelectorAll('.zl-picks__item').length===1 && !!document.querySelector('[data-recipe-id="gmail"]')`,
      'recommendation search',
    );
    await evaluate(
      `(()=>{const input=document.querySelector('.zl-picks input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'');input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`,
    );
    await wait(
      `document.querySelectorAll('.recipe-teaser').length===16`,
      'all original service buttons restored after search',
    );
    const cards = await evaluate(
      `(()=>{const cards=[...document.querySelectorAll('.recipe-teaser')];const calendar=cards.find(n=>n.dataset.recipeId==='google-calendar');return {ids:cards.map(n=>n.dataset.recipeId),buttons:cards.every(n=>n.tagName==='BUTTON'),aliases:calendar.querySelector('.recipe-teaser__alias_label')?.textContent,rows:cards.map(n=>Math.round(n.getBoundingClientRect().top))}})()`,
    );
    assert.deepEqual(cards.ids, [
      'discord',
      'meta-business-suite',
      'gitter',
      'gmail',
      'google-calendar',
      'hangouts',
      'mattermost',
      'messenger',
      'proton-mail',
      'skype',
      'slack',
      'telegram',
      'trello',
      'tweetdeck',
      'wechat',
      'whatsapp',
    ]);
    assert(cards.buttons);
    assert(cards.aliases.includes('gCalendar'));
    assert.equal(
      new Set(cards.rows).size,
      4,
      'original four-column card layout',
    );
    await click('[data-recipe-id="gmail"]');
    await wait(
      `window.ferdium.stores.router.location.pathname==='/settings/services/add/gmail' && !!document.querySelector('form')`,
      'recommended service installs and opens add form',
    );
    for (const route of ['/settings/recipes/all', '/settings/recipes/dev']) {
      await evaluate(
        `window.ferdium.stores.router.push(${JSON.stringify(route)});true`,
      );
      await wait(
        `window.ferdium.stores.router.location.pathname==='/settings/services' && !!document.querySelector('.settings-navigation')`,
        'removed catalogue/custom routes redirect safely',
      );
    }
    await evaluate(
      `window.ferdium.stores.router.push('/settings/services/add/whatsapp');true`,
    );
    await wait(
      `!!document.querySelector('form') && document.body.innerText.includes('WhatsApp')`,
      'add WhatsApp form',
    );
    assert.deepEqual(await accounts(), before);
    assert.deepEqual(await workspaces(), workspacesBefore);
    console.log(
      'PASS ZL Picks displays/searches original recommendations and opens add form; workspaces navigation hidden; accounts/workspaces data preserved; deleted features stay hidden',
    );
  } finally {
    await evaluate(
      `window.ferdium.stores.router.push(${JSON.stringify(originalRoute)});true`,
    );
  }
} finally {
  socket.close();
}

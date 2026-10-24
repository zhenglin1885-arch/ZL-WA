/* eslint-disable no-await-in-loop -- Sequential deletion and wake assertions depend on prior UI actions. */
/* eslint-disable no-console -- GUI regression status. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluate,
  wait,
  click,
  clickText,
  socket,
} from './account-tools-cdp.mjs';

const service = id =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const ids = [];
const fixture = readFileSync(
  new URL('fixtures/whatsapp-tools.html', import.meta.url),
  'utf8',
);
await wait(
  'window.ferdium?.stores?.services?.allServicesRequest.wasExecuted',
  'account list ready',
);
const originalIds = await evaluate(
  'window.ferdium.stores.services.all.map(s=>s.id)',
);
assert.equal(
  await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
  false,
  'Use only the isolated GUI profile with disabled original accounts',
);
const sidebar = await evaluate(
  'JSON.stringify(window.ferdium.stores.settings.app.accountSidebar)',
);
const active = await evaluate(
  'window.ferdium.stores.settings.all.service.activeService',
);
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
const snapshot = id =>
  evaluate(
    `(()=>{const s=${service(id)};return {sleep:s.isHibernating,manual:s.isManuallyHibernating,webview:Boolean(s.webview)}})()`,
  );
const openDelete = async id => {
  await click(`[data-service-id="${id}"] .account-card__more`);
  await clickText('删除会话');
  await wait(
    `!!document.querySelector('[role="dialog"]')`,
    'delete confirmation',
  );
};
const remove = async id => {
  await openDelete(id);
  await clickText('删除');
  await wait(
    `!${service(id)} && !document.querySelector('[role="dialog"]')`,
    'delete completed and confirmation closed',
  );
};
try {
  await evaluate(
    `(()=>{require('@electron/remote').getCurrentWindow().webContents.closeDevTools();location.hash='/';return true})()`,
  );
  for (const name of [
    'Sleeping',
    'Current',
    'Awake',
    'Inactive',
    'Never opened',
  ]) {
    await evaluate(
      `window.ferdium.stores.services._createService({recipeId:'whatsapp',serviceData:{name:${JSON.stringify(`Deletion QA ${name}`)},isEnabled:false,isHibernationEnabled:false},redirect:false,skipCleanup:true})`,
    );
    const created = await evaluate(
      `window.ferdium.stores.services.all.filter(s=>!${JSON.stringify([...originalIds, ...ids])}.includes(s.id)).map(s=>s.id)`,
    );
    assert.equal(created.length, 1);
    const id = created[0];
    ids.push(id);
    await vm(
      `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',()=>new Response(${JSON.stringify(fixture)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));true`,
    );
  }
  const [sleeping, current, awake, inactive] = ids;
  for (const id of [sleeping, current, awake])
    await evaluate(
      `window.ferdium.stores.services._updateService({serviceId:${JSON.stringify(id)},serviceData:{isEnabled:true},redirect:false})`,
    );
  // Match AccountSidebar.addSession: finish saving the newly created cards
  // before asserting that their startup queue has mounted the guest pages.
  await evaluate(
    `(()=>{const previous=JSON.parse(JSON.stringify(window.ferdium.stores.settings.app.accountSidebar));return window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:{...previous,accounts:{...previous?.accounts,...Object.fromEntries(${JSON.stringify(ids)}.map(id=>[id,{groupId:'default'}]))}}}})})()`,
  );
  await wait(
    `${service(sleeping)}.webview && ${service(current)}.webview && ${service(awake)}.webview`,
    'all fixture accounts opened before sleeping',
  );
  await click(`[data-service-id="${sleeping}"] .account-card__sleep`);
  await wait(
    `${service(sleeping)}.isHibernating && !${service(sleeping)}.webview`,
    'sleeping guest closed',
  );
  await click(`[data-service-id="${current}"] .account-card__select`);
  await wait(
    `${service(current)}.webview && ${service(awake)}.webview`,
    'awake views mounted',
  );
  const awakeView = await evaluate(
    `${service(awake)}.webview.getWebContentsId()`,
  );
  assert.deepEqual(await snapshot(sleeping), {
    sleep: true,
    manual: true,
    webview: false,
  });
  await remove(inactive);
  assert.equal(
    await evaluate('window.ferdium.stores.services.active?.id'),
    current,
  );
  assert.deepEqual(await snapshot(sleeping), {
    sleep: true,
    manual: true,
    webview: false,
  });
  await openDelete(current);
  await clickText('取消');
  assert.equal(await evaluate(`Boolean(${service(current)})`), true);
  assert.deepEqual(await snapshot(sleeping), {
    sleep: true,
    manual: true,
    webview: false,
  });
  await remove(current);
  await wait(
    `window.ferdium.stores.services.active?.id===${JSON.stringify(awake)}`,
    'fallback chooses an already awake account',
  );
  assert.deepEqual(await snapshot(sleeping), {
    sleep: true,
    manual: true,
    webview: false,
  });
  assert.equal(
    await evaluate(`${service(awake)}.webview.getWebContentsId()`),
    awakeView,
    'fallback never reloads the existing awake guest',
  );
  await remove(awake);
  assert.equal(
    await evaluate('Boolean(window.ferdium.stores.services.active)'),
    false,
  );
  assert.deepEqual(await snapshot(sleeping), {
    sleep: true,
    manual: true,
    webview: false,
  });
  await evaluate(
    `window.ferdium.actions.settings.update({type:'app',data:{accountSidebar:JSON.parse(JSON.stringify(window.ferdium.stores.settings.app.accountSidebar))}})`,
  );
  assert.deepEqual(await snapshot(sleeping), {
    sleep: true,
    manual: true,
    webview: false,
  });
  await click(`[data-service-id="${sleeping}"] .account-card__select`);
  await wait(
    `window.ferdium.stores.services.active?.id===${JSON.stringify(sleeping)}`,
    'sleeping window selected',
  );
  assert.deepEqual(await snapshot(sleeping), {
    sleep: true,
    manual: true,
    webview: false,
  });
  await click(`[data-service-id="${sleeping}"] .account-card__sleep`);
  await wait(
    `!${service(sleeping)}.isHibernating && Boolean(${service(sleeping)}.webview)`,
    'restore button wakes the account',
  );
  const fresh = ids[4];
  await evaluate(
    `window.ferdium.stores.services._hibernate({serviceId:${JSON.stringify(fresh)},manual:true})`,
  );
  await evaluate(
    `window.ferdium.stores.services._updateService({serviceId:${JSON.stringify(fresh)},serviceData:{isEnabled:true},redirect:false})`,
  );
  await click(`[data-service-id="${fresh}"] .account-card__select`);
  await wait(
    `window.ferdium.stores.services.active?.id===${JSON.stringify(fresh)}`,
    'never-opened sleeper selected',
  );
  assert.deepEqual(await snapshot(fresh), {
    sleep: true,
    manual: true,
    webview: false,
  });
  await click(`[data-service-id="${fresh}"] .account-card__sleep`);
  await wait(
    `!${service(fresh)}.isHibernating && Boolean(${service(fresh)}.webview)`,
    'restore admits a previously sleeping account to startup queue',
  );
  console.log(
    'PASS delete inactive, cancel deletion, choose an awake fallback, preserve all sleeping accounts after deleting the final awake account, select without waking and explicit restore',
  );
} finally {
  for (const id of ids)
    if (await evaluate(`Boolean(${service(id)})`))
      await evaluate(
        `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
      );
  await evaluate(
    `(()=>{window.ferdium.actions.settings.update({type:'app',data:{accountSidebar:${sidebar || 'undefined'}}});window.ferdium.actions.settings.update({type:'service',data:{activeService:${JSON.stringify(active || '')}}});return true})()`,
  );
  const remainingIds = await evaluate(
    'window.ferdium.stores.services.all.map(s=>s.id)',
  );
  assert.deepEqual(remainingIds.sort(), originalIds.sort());
  socket.close();
}

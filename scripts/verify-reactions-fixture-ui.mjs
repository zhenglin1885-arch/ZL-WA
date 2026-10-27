/* eslint-disable no-await-in-loop -- Isolated native desktop fixture setup, verification and cleanup. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  evaluate,
  wait,
  click,
  clickText,
  call,
  socket,
} from './account-tools-cdp.mjs';
import { verifyReactions } from './verify-reactions-ui.mjs';

const fixture = readFileSync(
  new URL('fixtures/whatsapp-tools.html', import.meta.url),
  'utf8',
);
const ids = [];
const service = id =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const guest = (id, code) =>
  evaluate(`${service(id)}.webview.executeJavaScript(${JSON.stringify(code)})`);
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
let sidebar;
try {
  await wait(
    `!!window.ferdium?.stores?.settings.loaded && !!document.querySelector('.account-tools')`,
    'app ready',
  );
  assert.equal(
    await evaluate(`window.ferdium.stores.services.all.some(s=>s.isEnabled)`),
    false,
    'Only use an isolated QA profile without enabled real accounts',
  );
  sidebar = await evaluate(
    'JSON.parse(JSON.stringify(window.ferdium.stores.settings.app.accountSidebar || {}))',
  );
  await evaluate(
    `require('@electron/remote').getCurrentWindow().setSize(1280,800);window.ferdium.stores.router.push('/')`,
  );
  for (let i = 0; i < 2; i += 1) {
    const before = await evaluate(
      'window.ferdium.stores.services.all.map(s=>s.id)',
    );
    await click('[data-group-id="default"] .account-group__add');
    await wait(
      `window.ferdium.stores.services.createServiceRequest.wasExecuted && !window.ferdium.stores.services.createServiceRequest.isWaitingForResponse && !!window.ferdium.stores.services.createServiceRequest.result?.data?.id && !${JSON.stringify(before)}.includes(window.ferdium.stores.services.createServiceRequest.result.data.id)`,
      'fixture created',
    );
    const id = await evaluate(
      'window.ferdium.stores.services.createServiceRequest.result.data.id',
    );
    assert(!before.includes(id));
    ids.push(id);
    await wait(
      `window.ferdium.stores.services.all.some(s=>s.id===${JSON.stringify(id)})`,
      'fixture model ready',
    );
    await evaluate(`${service(id)}.isHibernationEnabled=false`);
    await vm(
      `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',()=>new Response(${JSON.stringify(fixture)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));true`,
    );
    await wait(`!!${service(id)}.webview`, 'fixture mounted');
    await evaluate(`${service(id)}.webview.reload()`);
    await wait(
      `!${service(id)}.isLoading && ${service(id)}.accountSnapshot.status==='online'`,
      'fixture online',
    );
  }
  await verifyReactions({
    first: ids[0],
    second: ids[1],
    guest,
    evaluate,
    wait,
    click,
    clickText,
    call,
    shot: async path => {
      const result = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(path, Buffer.from(result.data, 'base64'));
    },
  });
} finally {
  if (await evaluate(`!!document.querySelector('[aria-label="关闭批量点赞"]')`))
    await click('[aria-label="关闭批量点赞"]');
  for (const id of ids)
    await evaluate(
      `(async()=>{if(window.ferdium.stores.services.all.some(s=>s.id===${JSON.stringify(id)}))await window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})})()`,
    );
  if (sidebar)
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:${JSON.stringify(sidebar)}}})`,
    );
  socket.close();
}

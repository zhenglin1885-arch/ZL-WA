/* eslint-disable no-await-in-loop -- Sequential account lifecycle assertions. */
/* eslint-disable no-console -- GUI regression status. */
import assert from 'node:assert/strict';
import { evaluate, wait, click, socket } from './account-tools-cdp.mjs';

const service = id =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
const ids = [];
let wrapped = false;
await wait(
  'window.ferdium?.stores?.services?.allServicesRequest.wasExecuted',
  'account list ready',
);
const original = await evaluate(
  'window.ferdium.stores.services.all.map(s=>s.id)',
);
assert.equal(
  await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
  false,
  'Use isolated GUI profile',
);
const sidebar = await evaluate(
  'JSON.stringify(window.ferdium.stores.settings.app.accountSidebar)',
);
const active = await evaluate(
  'window.ferdium.stores.settings.all.service.activeService',
);
// No WhatsApp traffic: all fixture partitions serve a loading page locally.
const intercept = id =>
  vm(
    `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',()=>new Response('<html><body>Starting fixture account...</body></html>',{headers:{'Content-Type':'text/html'}}));true`,
  );
try {
  await evaluate("window.ferdium.stores.router.push('/');true");
  for (const name of ['First', 'Second', 'Waiting']) {
    await evaluate(
      `window.ferdium.stores.services._createService({recipeId:'whatsapp',serviceData:{name:${JSON.stringify(`Startup QA ${name}`)},isEnabled:false,isHibernationEnabled:false},redirect:false,skipCleanup:true})`,
    );
    const id = await evaluate(
      'window.ferdium.stores.services.createServiceRequest.result.data.id',
    );
    ids.push(id);
    await intercept(id);
  }
  await evaluate(
    'window.ferdium.stores.services.immediateStartupIds.clear();true',
  );
  for (const id of ids)
    await evaluate(
      `window.ferdium.stores.services._updateService({serviceId:${JSON.stringify(id)},serviceData:{isEnabled:true},redirect:false})`,
    );
  await wait(
    `${service(ids[0])}.webview && ${service(ids[1])}.webview`,
    'two boot slots occupied',
  );
  assert.equal(
    await evaluate(`Boolean(${service(ids[2])}.webview)`),
    false,
    'third existing account waits',
  );
  // Only the fixture wrapper delays enabling until its local protocol is ready.
  // The actual sidebar create/group/select path and startup admission run normally.
  await evaluate(
    `(()=>{const store=window.ferdium.stores.services;window.__zlCreateStartup=store._createService;store._createService=async function(options){await window.__zlCreateStartup.call(this,{...options,serviceData:{...options.serviceData,isEnabled:false}});const id=this.createServiceRequest.result.data.id;await require('@electron/remote').require('node:vm').runInThisContext("process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-"+id+"').protocol.handle('https',()=>new Response('<html><body>New fixture account</body></html>',{headers:{'Content-Type':'text/html'}}));true");await this._updateService({serviceId:id,serviceData:{isEnabled:true},redirect:false})}})()`,
  );
  wrapped = true;
  await click('.account-group__add');
  await wait(
    `window.ferdium.stores.services.all.length===${original.length + 4}`,
    'new session created',
  );
  const id = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result.data.id',
  );
  ids.push(id);
  await wait(
    `${service(id)}?.webview && ${service(id)}.isActive`,
    'new session immediately mounted and selected',
  );
  assert.equal(
    await evaluate(`Boolean(${service(ids[2])}.webview)`),
    false,
    'new session did not release a boot slot',
  );
  assert.equal(
    await evaluate('window.ferdium.stores.services.immediateStartupIds.size'),
    1,
    'creation hint is only in current store memory',
  );
  console.log(
    'PASS two existing accounts loading, third waits, sidebar new session opens immediately and becomes active without releasing a boot slot',
  );
} finally {
  if (wrapped)
    await evaluate(
      'window.ferdium.stores.services._createService=window.__zlCreateStartup;delete window.__zlCreateStartup;true',
    );
  const fixtures = await evaluate(
    `window.ferdium.stores.services.all.filter(s=>!${JSON.stringify(original)}.includes(s.id)).map(s=>s.id)`,
  );
  for (const id of fixtures)
    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
    );
  await evaluate(
    `window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:${sidebar || 'undefined'}}})`,
  );
  await evaluate(
    `window.ferdium.stores.settings._update({type:'service',data:{activeService:${JSON.stringify(active || '')}}})`,
  );
  const remaining = await evaluate(
    'window.ferdium.stores.services.all.map(s=>s.id)',
  );
  assert.deepEqual(remaining.sort(), original.sort());
  socket.close();
}

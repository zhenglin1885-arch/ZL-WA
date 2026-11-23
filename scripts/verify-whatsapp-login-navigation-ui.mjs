/* Actual Electron guest/preload regression with an isolated synthetic login page; no phone pairing is attempted. */
import assert from 'node:assert/strict';
import { evaluate, wait, click, socket } from './account-tools-cdp.mjs';
let id;
const service = () =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
try {
  const existing = await evaluate(
    'window.ferdium.stores.services.all.map(s=>s.id)',
  );
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
    'Only use an isolated profile',
  );
  await click('[data-group-id="default"] .account-group__add');
  await wait(
    `!window.ferdium.stores.services.createServiceRequest.isWaitingForResponse && !!window.ferdium.stores.services.createServiceRequest.result?.data?.id && window.ferdium.stores.services.all.some(s=>s.id===window.ferdium.stores.services.createServiceRequest.result.data.id) && !${JSON.stringify(existing)}.includes(window.ferdium.stores.services.createServiceRequest.result.data.id)`,
    'new account created',
  );
  id = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result.data.id',
  );
  await evaluate(`${service()}.isHibernationEnabled=false`);
  const html =
    '<!doctype html><meta charset="utf-8"><title>Offline login navigation check</title><script>window.nativePushState=history.pushState</script><div data-testid="qrcode"><canvas></canvas></div><p>Controlled login fixture; not a real QR code</p>';
  await vm(
    `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',request=>new Response(${JSON.stringify(html)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));true`,
  );
  await wait(`!!${service()}.webview`, 'guest mounted');
  await evaluate(`${service()}.webview.reload()`);
  await wait(
    `${service()}.webview.executeJavaScript('document.title===${JSON.stringify('Offline login navigation check')}').then(Boolean)`,
    'controlled login loaded',
  );
  await evaluate(
    `${service()}.webview.executeJavaScript('new Promise(r=>setTimeout(()=>r(true),8000))')`,
  );
  const result = await evaluate(
    `${service()}.webview.executeJavaScript(${JSON.stringify(`(()=>{const before=performance.timeOrigin;const original=history.pushState===window.nativePushState;const legacy=typeof window.pushStateBehavior!=='undefined';const routes=[];for(let i=1;i<=3;i++){history.pushState({},'', '?login-navigation-qa='+i);routes.push(location.search)}return {original,legacy,routes,navigationUnchanged:performance.timeOrigin===before,loginPresent:!!document.querySelector('[data-testid="qrcode"]')}})()`)})`,
  );
  assert.equal(result.original, true);
  assert.equal(result.legacy, false);
  assert.deepEqual(
    result.routes,
    [1, 2, 3].map(i => '?login-navigation-qa=' + i),
  );
  assert(result.navigationUnchanged && result.loginPresent);
  console.log(
    'PASS real WhatsApp guest preload leaves native pushState intact; three consecutive login navigation transitions retained, with no login page reload',
  );
  console.log(JSON.stringify(result));
} finally {
  if (id)
    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
    ).catch(() => {});
  socket.close();
}

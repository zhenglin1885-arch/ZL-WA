/* eslint-disable no-console -- Command-line GUI regression evidence. */
/* Verify explicit opt-in DIRECT routing through the real account UI and Electron Session. */
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

let id;
const service = () =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
const routes = () =>
  vm(
    `(async()=>{const s=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session;const own=s.fromPartition('persist:service-${id}');const other=s.fromPartition('qa-direct-other');const kind=s=>s.split(';').map(p=>{const t=p.trim().split(' ')[0];return ['DIRECT','PROXY','HTTPS','SOCKS','SOCKS5'].includes(t)?t:'unknown'});return {https:kind(await own.resolveProxy('https://web.whatsapp.com/')),wss:kind(await own.resolveProxy('wss://web.whatsapp.com/ws/chat')),other:kind(await other.resolveProxy('https://web.whatsapp.com/'))}})()`,
  );
try {
  await wait('window.ferdium?.stores?.user.localSessionReady', 'app ready');
  assert.equal(
    await evaluate("require('@electron/remote').app.getPath('userData')"),
    '/tmp/zl-direct-qa',
  );
  const before = await evaluate(
    'window.ferdium.stores.services.all.map(s=>s.id)',
  );
  await click('[data-group-id="default"] .account-group__add');
  await wait(
    `!window.ferdium.stores.services.createServiceRequest.isWaitingForResponse && !!window.ferdium.stores.services.createServiceRequest.result?.data?.id && window.ferdium.stores.services.all.some(s=>s.id===window.ferdium.stores.services.createServiceRequest.result.data.id) && !${JSON.stringify(before)}.includes(window.ferdium.stores.services.createServiceRequest.result.data.id)`,
    'new account',
  );
  id = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result.data.id',
  );
  await evaluate(`${service()}.isHibernationEnabled=false`);
  const fixture = readFileSync(
    new URL('fixtures/whatsapp-tools.html', import.meta.url),
    'utf8',
  );
  await vm(
    `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',()=>new Response(${JSON.stringify(fixture)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));true`,
  );
  await wait(`!!${service()}.webview`, 'account mounted');
  await evaluate(`${service()}.webview.reload()`);
  await wait(
    `${service()}.accountSnapshot.status==='online'`,
    'local fixture ready',
  );
  const original = await routes();
  if (
    !(await evaluate("Boolean(document.querySelector('.account-tools-panel'))"))
  )
    await clickText('代理');
  await wait(
    "!!document.getElementById('zl-AccountTools-3')",
    'proxy controls',
  );
  await evaluate(
    "(()=>{const s=document.getElementById('zl-AccountTools-3');s.value='direct-only';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()",
  );
  await wait(
    "document.querySelector('.account-tools-panel').textContent.includes('当前选择直连')",
    'explicit direct selected',
  );
  await clickText('应用');
  await wait(
    `require('electron').ipcRenderer.invoke('account-tools-get',${JSON.stringify(id)}).then(c=>c.proxy.mode==='direct-only')`,
    'direct preference saved',
  );
  const direct = await routes();
  assert.deepEqual(direct.https, ['DIRECT']);
  assert.deepEqual(direct.wss, ['DIRECT']);
  assert.deepEqual(direct.other, original.other);
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1250,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await evaluate(
    'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
  );
  const shot = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    '/workspace/ZL-WA-explicit-direct.png',
    Buffer.from(shot.data, 'base64'),
  );
  await evaluate(
    "(()=>{const s=document.getElementById('zl-AccountTools-3');s.value='manual';s.dispatchEvent(new Event('change',{bubbles:true}));return true})()",
  );
  await clickText('应用');
  await wait(
    `require('electron').ipcRenderer.invoke('account-tools-get',${JSON.stringify(id)}).then(c=>c.proxy.mode==='manual'&&!c.proxy.enabled)`,
    'original disabled/system preference restored',
  );
  const restored = await routes();
  assert.deepEqual(restored, original);
  console.log(
    'PASS explicit direct selection resolves HTTPS and WSS to DIRECT only for the selected account; disabled/manual retains original system routing and other Sessions remain unchanged',
  );
  console.log(
    JSON.stringify({
      original,
      direct,
      restored,
      realPhonePairingVerified: false,
    }),
  );
} finally {
  if (id)
    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
    ).catch(() => {});
  socket.close();
}

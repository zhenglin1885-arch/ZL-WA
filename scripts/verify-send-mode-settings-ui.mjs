/* Full settings -> active account integration with a disposable service fixture. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluate, wait, click, call, socket } from './account-tools-cdp.mjs';
let id;
const service = () =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const guest = code =>
  evaluate(`${service()}.webview.executeJavaScript(${JSON.stringify(code)})`);
let originalTheme;
try {
  await wait(
    'window.ferdium?.stores?.user.localSessionReady',
    'isolated app ready',
  );
  const profile = await evaluate(
    "require('@electron/remote').app.getPath('userData')",
  );
  assert.equal(profile, '/tmp/zl-send-mode-qa');
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
  );
  originalTheme = await evaluate(
    '(()=>{const a=window.ferdium.stores.settings.app;return {darkMode:a.darkMode,adaptableDarkMode:a.adaptableDarkMode,universalDarkMode:a.universalDarkMode}})()',
  );
  await evaluate("location.hash='/';true");
  const existing = await evaluate(
    'window.ferdium.stores.services.all.map(s=>s.id)',
  );
  await click('[data-group-id="default"] .account-group__add');
  await wait(
    `!window.ferdium.stores.services.createServiceRequest.isWaitingForResponse && !!window.ferdium.stores.services.createServiceRequest.result?.data?.id && window.ferdium.stores.services.all.some(s=>s.id===window.ferdium.stores.services.createServiceRequest.result.data.id) && !${JSON.stringify(existing)}.includes(window.ferdium.stores.services.createServiceRequest.result.data.id)`,
    'new fixture inserted',
  );
  id = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result.data.id',
  );
  await evaluate(`${service()}.isHibernationEnabled=false`);
  const fixture = readFileSync(
    new URL('fixtures/whatsapp-tools.html', import.meta.url),
    'utf8',
  );
  const code = `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',()=>new Response(${JSON.stringify(fixture)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));true`;
  await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
  await wait(`!!${service()}.webview`, 'account mounted');
  await evaluate(`${service()}.webview.reload()`);
  await wait(
    `${service()}.accountSnapshot.status==='online'`,
    'fixture logged in',
  );
  await guest(
    "document.querySelector('footer [contenteditable]').textContent='Unsaved draft 保留草稿';true",
  );
  const before = await guest(
    '({start:performance.timeOrigin,draft:document.querySelector("footer [contenteditable]").textContent})',
  );
  await evaluate("location.hash='/settings/app';true");
  await wait(
    "!!document.querySelector('.settings-send-mode')",
    'settings form open',
  );
  await click('.settings-send-mode input[value="shift-enter"]');
  await wait(
    `${service()}.webview.executeJavaScript("window.__zlSendMode?.mode==='shift-enter'")`,
    'saved setting applied to existing account',
  );
  assert.deepEqual(
    await guest(
      '({start:performance.timeOrigin,draft:document.querySelector("footer [contenteditable]").textContent})',
    ),
    before,
  );
  await call('Emulation.setDeviceMetricsOverride', {
    width: 1250,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const dark of [false, true]) {
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:{darkMode:${dark},adaptableDarkMode:false,universalDarkMode:${dark}}});true`,
    );
    await wait(
      `window.ferdium.stores.ui.isDarkThemeActive===${dark}`,
      'theme applied',
    );
    await evaluate(
      "document.querySelector('.settings-send-mode').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      `/workspace/ZL-WA-send-mode-${dark ? 'dark' : 'light'}.png`,
      Buffer.from(shot.data, 'base64'),
    );
  }
  await click('.settings-send-mode input[value="enter"]');
  await wait(
    `${service()}.webview.executeJavaScript("window.__zlSendMode?.mode==='enter'")`,
    'original mode restored',
  );
  assert.deepEqual(
    await guest(
      '({start:performance.timeOrigin,draft:document.querySelector("footer [contenteditable]").textContent})',
    ),
    before,
  );
  console.log(
    'PASS actual settings radio persists and updates an already open WhatsApp account without reload, draft loss or account changes; light/dark settings rendered and original Enter restored',
  );
} finally {
  if (id)
    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
    ).catch(() => {});
  if (originalTheme)
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(originalTheme)}});true`,
    ).catch(() => {});
  await evaluate("location.hash='/';true").catch(() => {});
  socket.close();
}

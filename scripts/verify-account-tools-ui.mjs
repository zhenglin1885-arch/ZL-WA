/* eslint-disable no-await-in-loop -- Sequential UI actions and assertions depend on each other. */
/* eslint-disable no-console -- Command-line GUI regression output. */
// Linux cloud GUI integration test. Use a local profile without enabled real accounts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { verifyWhatsAppLayout } from './verify-whatsapp-layout-ui.mjs';
import { verifyTranslationRedraft } from './verify-translation-redraft-ui.mjs';
import { verifyTranslationContexts } from './verify-translation-contexts-ui.mjs';
import { verifyGroups } from './verify-groups-ui.mjs';
import { verifyCustomerCompatibility } from './verify-customer-compatibility-ui.mjs';
import { verifyBulkMultitask } from './verify-bulk-multitask-ui.mjs';
import {
  evaluate,
  wait,
  click,
  clickText,
  call,
  socket,
} from './account-tools-cdp.mjs';

const fixture = readFileSync(
  new URL('fixtures/whatsapp-tools.html', import.meta.url),
  'utf8',
);
const tlsDirectory = mkdtempSync('/tmp/zl-tools-tls-');
execFileSync(
  'openssl',
  [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    `${tlsDirectory}/key.pem`,
    '-out',
    `${tlsDirectory}/cert.pem`,
    '-days',
    '1',
    '-subj',
    '/CN=web.whatsapp.com',
  ],
  { stdio: 'ignore' },
);
const ids = [];
let mainPatched = false;
let sidebarBefore;
let translationColorBefore;
let themeBefore;
let historyBefore;
let historyBackupPath;
let groupStateBefore;
let bulkPreferencesBefore;
let customersBefore;
const vm = async code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
const queueExpression = `require('./features/accountTools/bulkRuntime').getBulkQueue(window.ferdium.stores)`;
const service = id =>
  `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
const guest = (id, code) =>
  evaluate(`${service(id)}.webview.executeJavaScript(${JSON.stringify(code)})`);
const shot = async path => {
  await new Promise(r => {
    setTimeout(r, 350);
  });
  const r = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
};
try {
  await wait(
    `!!window.ferdium?.stores?.services && !!document.querySelector('.account-tools')`,
    'app ready',
  );
  await evaluate(
    `require('@electron/remote').getCurrentWindow().webContents.closeDevTools();require('@electron/remote').getCurrentWindow().setSize(1280,800);window.ferdium.stores.router.push('/')`,
  );
  await wait(
    `window.ferdium.stores.services.allServicesRequest.wasExecuted && !window.ferdium.stores.services.allServicesRequest.isWaitingForResponse && window.ferdium.stores.settings.loaded`,
    'initial service list fully loaded',
  );
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
    'Use an isolated test profile with no enabled real accounts',
  );
  if (!process.argv.includes('--customers-only')) {
    historyBefore = await evaluate(
      `require('electron').ipcRenderer.invoke('account-tools-history')`,
    );
    historyBackupPath = `/tmp/zl-wa-history-backup-${Date.now()}.json`;
    writeFileSync(historyBackupPath, JSON.stringify(historyBefore));
    await evaluate(
      `(async()=>{const queue=${queueExpression};await queue.load();if(queue.activeId||queue.records.some(r=>r.status==='待发送'))throw Error('Use a test profile without active or scheduled jobs');await queue.remove(queue.records.map(r=>r.id));return true})()`,
    );
  }
  groupStateBefore = await evaluate(
    `require('electron').ipcRenderer.invoke('group-tools-load')`,
  );
  await evaluate(
    `require('electron').ipcRenderer.invoke('group-tools-save',{batches:[],intervals:{speech:3,join:5,leave:5}})`,
  );
  themeBefore = await evaluate(
    `(()=>{const {darkMode,adaptableDarkMode,universalDarkMode}=window.ferdium.stores.settings.app;return {darkMode,adaptableDarkMode,universalDarkMode}})()`,
  );
  translationColorBefore = await evaluate(
    'window.ferdium.stores.settings.app.translationTextColor',
  );
  sidebarBefore = await evaluate(
    'JSON.parse(JSON.stringify(window.ferdium.stores.settings.app.accountSidebar || {}))',
  );
  if (await evaluate('!!document.querySelector(".account-dialog")'))
    await clickText('取消');
  bulkPreferencesBefore = await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-bulk-preferences')`,
  );
  await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-bulk-preferences',{})`,
  );
  customersBefore = await vm(
    `(()=>{const fs=process.getBuiltinModule('fs');const p=process.getBuiltinModule('path').join(process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.getPath('userData'),'customers.json');return fs.existsSync(p)?fs.readFileSync(p,'base64'):null})()`,
  );
  const before = await evaluate(
    'window.ferdium.stores.services.all.map(s=>s.id)',
  );
  await vm(
    `globalThis.__zlSessionPrototype = Object.getPrototypeOf(process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.defaultSession);globalThis.__zlToolsFetch=globalThis.__zlSessionPrototype.fetch;globalThis.__zlSessionPrototype.fetch=async function(url,options){if(String(url).startsWith('https://translate.googleapis.com/')){globalThis.__zlTranslationCalls=(globalThis.__zlTranslationCalls||0)+1;globalThis.__zlLastTranslationInput=new URLSearchParams(options.body).get('q');if(globalThis.__zlTranslateFail)return new Response('{}',{status:400});await new Promise(r=>setTimeout(r,350));return new Response(JSON.stringify([[[new URLSearchParams(options.body).get('tl')==='zh-CN'?'你好，这是本地测试消息。':new URLSearchParams(options.body).get('q')==='你好🐭'?'Hello 🐭':'Hello translated']]]),{status:200,headers:{'Content-Type':'application/json'}})}return globalThis.__zlToolsFetch.call(this,url,options)};true`,
  );
  mainPatched = true;
  for (let i = 0; i < 2; i += 1) {
    const old = [...before, ...ids];
    await click('[data-group-id="default"] .account-group__add');
    await wait(
      `window.ferdium.stores.services.createServiceRequest.wasExecuted && !window.ferdium.stores.services.createServiceRequest.isWaitingForResponse && !!window.ferdium.stores.services.createServiceRequest.result?.data?.id && !${JSON.stringify(old)}.includes(window.ferdium.stores.services.createServiceRequest.result.data.id)`,
      'new service creation request completed',
    );
    const id = await evaluate(
      'window.ferdium.stores.services.createServiceRequest.result.data.id',
    );
    assert(
      !old.includes(id),
      'Cleanup may only target the service ID returned by this creation request',
    );
    ids.push(id);
    await wait(
      `window.ferdium.stores.services.all.some(s=>s.id===${JSON.stringify(id)})`,
      'new service model inserted',
    );
    // Fixture counters must survive this long regression run. Automatic
    // hibernation is tested separately; disable it only on these new fixtures.
    await evaluate(`${service(id)}.isHibernationEnabled=false`);
    await vm(
      `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('persist:service-${id}').protocol.handle('https',request=>new Response(${JSON.stringify(fixture)},{headers:{'Content-Type':'text/html; charset=utf-8'}}));true`,
    );
    await wait(`!!${service(id)}.webview`, 'test account mounted');
    await evaluate(`${service(id)}.webview.reload()`);
    await wait(
      `!${service(id)}.isLoading && ${service(id)}.accountSnapshot.status==='online'`,
      'fixture online',
    );
  }
  const [first, second] = ids;
  // Card dragging updates only local presentation order, never the account's
  // identity or active guest. Start with trusted mouse input so a button inside
  // the draggable card cannot silently prevent an actual Chromium drag.
  let dragData;
  const intercepted = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Input.dragIntercepted')
      dragData = message.params.data;
  };
  socket.addEventListener('message', intercepted);
  await call('Input.setInterceptDrags', { enabled: true });
  const dragPoints = await evaluate(`(() => {
    const source=document.querySelector('[data-service-id="${second}"] .account-card__select').getBoundingClientRect();
    const target=document.querySelector('[data-service-id="${first}"]').getBoundingClientRect();
    return {source:{x:source.x+source.width/2,y:source.y+source.height/2},target:{x:target.x+target.width/2,y:target.y+2}};
  })()`);
  try {
    await call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...dragPoints.source,
    });
    await call('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...dragPoints.source,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await call('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: dragPoints.source.x + 20,
      y: dragPoints.source.y - 20,
      button: 'left',
      buttons: 1,
    });
    for (let i = 0; i < 30; i += 1) {
      if (dragData) break;
      await new Promise(resolve => {
        setTimeout(resolve, 100);
      });
    }
    assert(dragData, 'native mouse starts a draggable account card');
    await wait(
      `document.querySelector('[data-service-id="${second}"]').classList.contains('is-dragging')`,
      'card drag starts',
    );
    await call('Input.dispatchDragEvent', {
      type: 'dragEnter',
      ...dragPoints.target,
      data: dragData,
    });
    await call('Input.dispatchDragEvent', {
      type: 'dragOver',
      ...dragPoints.target,
      data: dragData,
    });
    await wait(
      `document.querySelector('[data-service-id="${first}"]').classList.contains('drop-before')`,
      'card insertion marker',
    );
    await call('Input.dispatchDragEvent', {
      type: 'drop',
      ...dragPoints.target,
      data: dragData,
    });
  } finally {
    await call('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...dragPoints.target,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await call('Input.setInterceptDrags', { enabled: false });
    socket.removeEventListener('message', intercepted);
  }
  await wait(
    `(() => {const ids=[...document.querySelectorAll('.account-card')].map(n=>n.dataset.serviceId);return ids.indexOf('${second}')<ids.indexOf('${first}') && window.ferdium.stores.settings.app.accountSidebar.accounts['${second}'].order < window.ferdium.stores.settings.app.accountSidebar.accounts['${first}'].order})()`,
    'account card order saved',
  );
  console.log(
    'PASS account card drag reorders and persists local preferences without replacing accounts',
  );
  await click(`[data-service-id="${first}"] .account-card__select`);
  const viewsBeforeFold = await evaluate(
    `[${ids.map(id => `${service(id)}.webview?.getWebContentsId()`).join(',')}]`,
  );
  await click('[aria-label="折叠账户栏"]');
  await wait(
    `document.querySelector('.account-sidebar')?.classList.contains('is-collapsed')`,
    'sidebar collapsed',
  );
  const compact = await evaluate(
    `(()=>{const side=document.querySelector('.account-sidebar');const card=side.querySelector('[data-service-id="${first}"]');const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;return {width:side.getBoundingClientRect().width,portrait:visible(card.querySelector('.account-card__portrait')),remark:visible(card.querySelector('.account-card__remark')),identity:visible(card.querySelector('.account-card__identity')),saved:window.ferdium.stores.settings.app.accountSidebar.collapsed}})()`,
  );
  assert.equal(compact.width, 84);
  assert(
    compact.portrait && compact.remark && !compact.identity && compact.saved,
  );
  assert.deepEqual(
    await evaluate(
      `[${ids.map(id => `${service(id)}.webview?.getWebContentsId()`).join(',')}]`,
    ),
    viewsBeforeFold,
    'folding must preserve webviews',
  );
  // Respect the existing 250 ms post-drag click suppression.
  await new Promise(resolve => {
    setTimeout(resolve, 300);
  });
  await click(`[data-service-id="${second}"] .account-card__remark`);
  await wait(
    `document.querySelector('[data-service-id="${second}"]').classList.contains('is-active')`,
    'compact remark selects account',
  );
  assert.equal(
    await evaluate(`!!document.querySelector('.account-dialog')`),
    false,
  );
  await shot('/workspace/ZL-WA-sidebar-compact.png');
  await click('[aria-label="展开账户栏"]');
  await wait(
    `!document.querySelector('.account-sidebar')?.classList.contains('is-collapsed')`,
    'sidebar expanded',
  );
  assert.equal(
    await evaluate(
      `document.querySelector('.account-sidebar__footer').textContent.includes('下载')`,
    ),
    false,
  );
  await click(`[data-service-id="${first}"] .account-card__select`);
  console.log(
    'PASS compact sidebar persists, shows avatar/remark, switches accounts and preserves webview instances',
  );
  // Use the actual nativeTheme in a light desktop, not just a dark CSS fixture.
  await evaluate(
    `window.ferdium.stores.settings._update({type:'app',data:{darkMode:false,adaptableDarkMode:true,universalDarkMode:false}})`,
  );
  await wait(
    `!window.ferdium.stores.ui.isDarkThemeActive`,
    'light system theme baseline',
  );
  await guest(
    first,
    `(()=>{const style=document.createElement('style');style.id='fixture-theme-rules';style.textContent='html.dark #fixture-theme-probe{background:rgb(17,27,33);color:rgb(233,237,239)}html.light #fixture-theme-probe{background:rgb(255,255,255);color:rgb(17,17,17)}';document.head.append(style);const node=document.createElement('div');node.id='fixture-theme-probe';node.style.position='absolute';node.style.left='-9999px';document.body.append(node);return true})()`,
  );
  await click('.account-sidebar__footer button');
  await wait(`!!document.querySelector('#appearance')`, 'theme appearance tab');
  await click('#appearance');
  await wait(
    `!!document.querySelector('input[name="darkMode"]')`,
    'manual dark toggle visible while following system',
  );
  const draftBeforeThemeTest = await guest(
    first,
    `(()=>{const input=document.querySelector('#main footer [contenteditable]');const old=input.textContent;input.textContent='unsent theme draft';return old})()`,
  );
  await click('input[name="darkMode"]');
  await wait(
    `window.ferdium.stores.settings.app.darkMode && !window.ferdium.stores.settings.app.adaptableDarkMode && document.body.classList.contains('theme__dark') && window.ferdium.stores.ui.muiTheme.palette.mode==='dark'`,
    'manual dark switches app and MUI without OS dark',
  );
  await wait(
    `matchMedia('(prefers-color-scheme: dark)').matches`,
    'Chromium theme signal dark',
  );
  assert.equal(
    await vm(
      `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').nativeTheme.themeSource`,
    ),
    'dark',
  );
  await wait(
    `${service(first)}.webview.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches && document.documentElement.classList.contains('dark') && document.body.classList.contains('dark') && getComputedStyle(document.querySelector('#fixture-theme-probe')).backgroundColor==='rgb(17, 27, 33)'")`,
    'native WhatsApp theme classes dark',
  );
  const draftsBeforeTheme = await guest(
    first,
    `document.querySelector('#main footer [contenteditable]').textContent`,
  );
  await guest(
    first,
    `document.documentElement.classList.replace('dark','light');document.body.classList.replace('dark','light');document.documentElement.dataset.theme='light';document.body.dataset.appTheme='light';true`,
  );
  await wait(
    `${service(first)}.webview.executeJavaScript("document.documentElement.classList.contains('dark') && !document.body.classList.contains('light') && document.documentElement.dataset.theme==='dark' && document.body.dataset.appTheme==='dark'")`,
    'late native light-theme reset repaired without refresh',
  );
  assert.equal(
    await guest(
      first,
      `document.querySelector('#main footer [contenteditable]').textContent`,
    ),
    draftsBeforeTheme,
  );
  assert.equal(draftsBeforeTheme, 'unsent theme draft');
  await guest(
    first,
    `document.querySelector('#main footer [contenteditable]').textContent=${JSON.stringify(draftBeforeThemeTest)};true`,
  );
  await click('input[name="adaptableDarkMode"]');
  await wait(
    `!window.ferdium.stores.settings.app.darkMode && window.ferdium.stores.settings.app.adaptableDarkMode && !document.body.classList.contains('theme__dark') && !matchMedia('(prefers-color-scheme: dark)').matches && window.ferdium.stores.ui.muiTheme.palette.mode==='light'`,
    'following a light system restores app and MUI light',
  );
  await click('input[name="universalDarkMode"]');
  await wait(
    `window.ferdium.stores.settings.app.darkMode && !window.ferdium.stores.settings.app.adaptableDarkMode && document.body.classList.contains('theme__dark')`,
    'enabling compatibility dark also enables manual dark',
  );
  await click('.settings__close');
  await evaluate(
    `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(themeBefore)}})`,
  );
  await guest(
    first,
    `document.querySelector('#fixture-theme-probe').remove();document.querySelector('#fixture-theme-rules').remove();true`,
  );
  console.log(
    'PASS light desktop: manual dark updates app, MUI, Chromium and native WhatsApp classes; delayed light reset repaired; system-follow and compatibility switches work without reload or draft loss',
  );
  await verifyWhatsAppLayout(first);
  if (!process.argv.includes('--customers-only')) {
    // Use native mouse/keyboard input and screen coordinates: DOM-only clicks
    // cannot catch a focus sentinel pushing the whole dialog off-screen.
    const typeInVisibleDialog = async text => {
      await wait(
        '!!document.querySelector(".account-dialog input")',
        'dialog input',
      );
      await wait(
        `getComputedStyle(document.querySelector('.account-dialog .MuiDialog-container, .account-dialog .MuiPopover-paper')).opacity === '1'`,
        'dialog opening transition completed',
      );
      const rect = await evaluate(
        `(()=>{const n=document.querySelector('.account-dialog input');const r=n.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight||r.width<50||r.height<15)throw Error('Dialog input is offscreen');const at=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);if(at!==n)throw Error('Dialog input is covered');return r.toJSON()})()`,
      );
      await call('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        button: 'left',
        clickCount: 1,
      });
      await call('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        button: 'left',
        clickCount: 1,
      });
      await wait(
        `document.activeElement === document.querySelector('.account-dialog input')`,
        'native click focused dialog input',
      );
      await call('Input.insertText', { text });
      assert.equal(await evaluate('document.activeElement.value'), text);
    };
    await click('.account-sidebar__new-group');
    await typeInVisibleDialog('GUI测试分组');
    await clickText('保存');
    await wait(
      '!document.querySelector(".account-dialog") && [...document.querySelectorAll(".account-group")].some(n=>n.textContent.includes("GUI测试分组"))',
      'new group saved',
    );
    await click(`[data-service-id="${first}"] .account-card__remark`);
    await wait(
      `!!document.querySelector('.account-remark-dialog [role="dialog"]')`,
      'compact card remark popup',
    );
    const remarkBounds = await evaluate(
      `(()=>{const c=document.querySelector('[data-service-id="${first}"]').getBoundingClientRect();const p=document.querySelector('.account-remark-dialog [role="dialog"]').getBoundingClientRect();return{cardBottom:c.bottom,cardLeft:c.left,top:p.top,left:p.left,width:p.width,height:p.height}})()`,
    );
    assert(Math.abs(remarkBounds.left - remarkBounds.cardLeft) < 2);
    assert(
      remarkBounds.top >= remarkBounds.cardBottom &&
        remarkBounds.top - remarkBounds.cardBottom < 12,
    );
    assert(remarkBounds.width <= 302 && remarkBounds.height < 180);
    await typeInVisibleDialog('GUI测试备注');
    await clickText('保存');
    await wait(
      `!document.querySelector('.account-dialog') && document.querySelector('[data-service-id="${first}"] .account-card__remark').textContent.includes('GUI测试备注')`,
      'remark saved',
    );
    await shot('/workspace/ZL-WA-dialog-regression.png');
    console.log(
      'PASS visible group/remark dialogs accept native mouse and text input and persist changes',
    );
    await clickText('译翻译');
    await wait(
      `!!document.querySelector('.account-tools-panel fieldset')`,
      'translation panel',
    );
    assert.equal(
      await evaluate(
        `(()=>{const t=document.querySelector('.account-tools-panel').textContent;return ['开启接收翻译后，','Google 免 Key 通道为非官方接口','翻译开关立即生效。','手动点击或开启翻译预览后，'].some(s=>t.includes(s))})()`,
      ),
      false,
      'the four marked translation help paragraphs are removed',
    );
    for (const engine of ['OpenAI', 'Gemini']) {
      await evaluate(
        `(()=>{const select=document.querySelector('#zl-AccountTools-10');select.value=${JSON.stringify(engine)};select.dispatchEvent(new Event('change',{bubbles:true}))})()`,
      );
      await wait(
        `document.querySelector('#provider-key-${engine}')?.closest('details')?.open`,
        'provider configuration expands when selected',
      );
      assert.equal(
        await evaluate(
          `document.querySelector('#provider-key-${engine}').type`,
        ),
        'password',
      );
      assert(
        await evaluate(`!!document.querySelector('#provider-model-${engine}')`),
        'provider model is configurable',
      );
      await clickText('应用并测试发送翻译');
      await wait(
        `document.querySelector('.tools-notice')?.textContent.includes(${JSON.stringify(`${engine} 需要填写 API Key`)})`,
        'provider requires user key',
      );
    }
    await evaluate(
      `(()=>{const select=document.querySelector('#zl-AccountTools-10');select.value='Google';select.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    );
    await clickText('应用');
    await wait(
      `document.querySelector('.tools-notice')?.textContent.includes('已应用')`,
      'restore Google mock',
    );
    console.log(
      'PASS OpenAI/Gemini expose password and model fields and require the user API Key',
    );
    const switchTranslation = async label => {
      await evaluate(
        `(()=>{const label=[...document.querySelectorAll('.account-tools-panel label')].find(n=>n.textContent.includes(${JSON.stringify(label)}));label.querySelector('input[role="switch"]').click()})()`,
      );
      await wait(
        `!document.querySelector('.account-tools-panel fieldset').disabled && document.querySelector('.tools-notice')?.textContent.includes('已应用')`,
        'translation switch applied',
      );
    };
    await switchTranslation('接收翻译（收发消息）');
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelectorAll("[data-zl-translate]").length').then(n=>n===2)`,
      'manual buttons on incoming and sent bubbles',
    );
    assert.equal(
      await vm('globalThis.__zlTranslationCalls || 0'),
      0,
      'manual mode must not translate automatically',
    );
    for (const bubble of ['.message-in', '.message-out']) {
      await guest(
        first,
        `document.querySelector('${bubble} [data-zl-translate]').click();true`,
      );
      await wait(
        `${service(first)}.webview.executeJavaScript('document.querySelector("${bubble} [data-zl-translation-text]").textContent').then(t=>t.includes('你好'))`,
        'manual bubble translation',
      );
    }
    assert.equal(
      await guest(first, 'fixture.sent.length'),
      0,
      'translating sent bubbles never resends them',
    );
    // Simulate an interrupted refresh restored from cache, then use real mouse input.
    await guest(
      first,
      `(()=>{const state=window.__zlTranslation;const nested=document.createElement('span');nested.innerHTML='Original<div data-zl-translation>Decoration</div>';if(state.readText(nested)!=='Original')throw Error('Translation decoration changed source text');const node=document.querySelector('.message-in .selectable-text');const record=state.controls.get(document.querySelector('.message-in [data-zl-translation]'));if(!record)throw Error('Missing translation');record.request(true,true);state.cancelPending();state.restore(record,'你好');if(record.refresh.disabled)throw Error('Cancelled refresh remained disabled');return true})()`,
    );
    const beforeRetranslate = await vm('globalThis.__zlTranslationCalls');
    const refreshPoint = await guest(
      first,
      `(()=>{const button=document.querySelector('.message-in [data-zl-retranslate]');button.scrollIntoView({block:'center'});const r=button.getBoundingClientRect();if(!button.textContent.includes('文'))throw Error('Missing 文 icon');if(button.previousElementSibling.tagName!=='SPAN')throw Error('Translation is not inline');return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    const refreshContents = await evaluate(
      `${service(first)}.webview.getWebContentsId()`,
    );
    for (const type of ['mouseDown', 'mouseUp']) {
      await vm(
        `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').webContents.fromId(${refreshContents}).sendInputEvent(${JSON.stringify({ type, ...refreshPoint, button: 'left', clickCount: 1 })});true`,
      );
    }
    await wait(
      `(${service(first)}.webview.executeJavaScript('!document.querySelector(".message-in [data-zl-retranslate]").disabled')).then(Boolean)`,
      'retranslation completed',
    );
    assert.equal(
      await vm('globalThis.__zlTranslationCalls'),
      beforeRetranslate + 1,
      'refresh bypasses existing translation cache',
    );
    assert.equal(
      await guest(first, 'fixture.sent.length'),
      0,
      'refresh never resends a message',
    );
    console.log(
      'PASS translation refresh requests a new result and never resends the message',
    );

    // Media captions are split across formatted spans; React consumes clicks at
    // the bubble root, and may rebuild the inner caption while a request runs.
    await guest(
      first,
      `(()=>{
      const bubble=document.createElement('div');bubble.className='message-in';bubble.id='formatted-caption';
      bubble.innerHTML='<div class="copyable-text" data-pre-plain-text="caption"><img alt="photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><div><b class="selectable-text">Lucas Henrique Varella</b><br><span class="selectable-text">CEO | Oravion Capital</span></div><p class="selectable-text">Com mais de 27 anos de experiência em tecnologia financeira e gestão corporativa.</p><p><span class="selectable-text">Áreas de Especialização</span><br><span class="selectable-text">Mercados globais de ações</span><br><span class="selectable-text">Gestão de riscos de portfólios de investimentos.</span></p><span data-testid="msg-meta">21:14</span></div>';
      bubble.addEventListener('click',event=>event.stopImmediatePropagation(),true);
      document.querySelector('#messages').append(bubble);bubble.scrollIntoView({block:'center'});return true;
    })()`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('!!document.querySelector("#formatted-caption [data-zl-translate]")')`,
      'formatted caption ready',
    );
    const caption = await guest(
      first,
      `(()=>{const root=document.querySelector('#formatted-caption .copyable-text');const text=window.__zlTranslation.readText(root);if(!text.includes('Lucas Henrique')||!text.includes('Gestão de riscos')||text.includes('21:14')||text.includes('photo'))throw Error('Incomplete caption extraction');return text})()`,
    );
    await guest(
      first,
      `document.querySelector('#formatted-caption [data-zl-translate]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#formatted-caption [data-zl-translation-text]").textContent.includes("你好")')`,
      'whole caption translated',
    );
    assert.equal(
      await vm('globalThis.__zlLastTranslationInput'),
      caption,
      'provider receives every caption paragraph, without timestamp or image alt',
    );
    assert.equal(
      await guest(
        first,
        'document.querySelectorAll("#formatted-caption [data-zl-translation]").length',
      ),
      1,
      'one translation for the whole formatted caption',
    );
    await guest(
      first,
      `(()=>{const root=document.querySelector('#formatted-caption .copyable-text');root.querySelector('b').innerHTML='<span class="selectable-text">Lucas Henrique Varella</span>';return true})()`,
    );
    const captionPoint = await guest(
      first,
      `(()=>{const b=document.querySelector('#formatted-caption [data-zl-retranslate]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    const captionCalls = await vm('globalThis.__zlTranslationCalls');
    for (const type of ['mouseDown', 'mouseUp'])
      await vm(
        `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').webContents.fromId(${refreshContents}).sendInputEvent(${JSON.stringify({ type, ...captionPoint, button: 'left', clickCount: 1 })});true`,
      );
    assert.equal(
      await guest(
        first,
        'document.querySelector("#formatted-caption [data-zl-translate]").textContent',
      ),
      '重新翻译中…',
      'native click immediately shows progress before provider responds',
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#formatted-caption [data-zl-translate]").hidden && !document.querySelector("#formatted-caption [data-zl-retranslate]").disabled')`,
      'caption refresh completes despite ancestor event capture',
    );
    assert.equal(
      await vm('globalThis.__zlTranslationCalls'),
      captionCalls + 1,
      'caption refresh bypasses both caches',
    );
    assert.equal(
      await vm('globalThis.__zlLastTranslationInput'),
      caption,
      'refresh includes the complete caption after inner DOM rebuild',
    );
    await vm('globalThis.__zlTranslateFail=true;true');
    await guest(
      first,
      `document.querySelector('#formatted-caption [data-zl-retranslate]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#formatted-caption [data-zl-translation-text]").textContent.includes("重试") && !document.querySelector("#formatted-caption [data-zl-retranslate]").disabled')`,
      'refresh failure is visible and retry stays enabled',
    );
    await vm('globalThis.__zlTranslateFail=false;true');
    await guest(
      first,
      `document.querySelector('#formatted-caption [data-zl-retranslate]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#formatted-caption [data-zl-translate]").hidden')`,
      'failed refresh can retry',
    );
    await guest(
      first,
      `document.querySelector('#formatted-caption').remove();document.querySelector('.message-in').scrollIntoView({block:'center'});true`,
    );
    console.log(
      'PASS complete formatted media caption, native refresh across React capture, immediate progress, visible failure and retry',
    );

    await vm('globalThis.__zlTranslateFail=true;true');
    await guest(
      first,
      `document.querySelector('#messages').insertAdjacentHTML('beforeend','<div class="message-in" id="manual-retry"><div class="copyable-text"><span class="selectable-text">A unique retry test ${Date.now()}.</span></div></div>');true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('!!document.querySelector("#manual-retry [data-zl-translate]")')`,
      'retry bubble button',
    );
    await guest(
      first,
      `document.querySelector('#manual-retry [data-zl-translate]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#manual-retry [data-zl-translation-text]").textContent').then(t=>t.includes('重试'))`,
      'manual failure',
    );
    await vm('globalThis.__zlTranslateFail=false;true');
    await guest(
      first,
      `document.querySelector('#manual-retry [data-zl-translate]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#manual-retry [data-zl-translation-text]").textContent').then(t=>t.includes('你好'))`,
      'manual retry succeeds',
    );
    console.log(
      'PASS receive toggle adds manual translate to incoming and sent messages, no automatic requests, retry works without resending',
    );
    await vm('globalThis.__zlTranslateFail=true;true');
    await guest(
      first,
      `document.querySelector('#messages').insertAdjacentHTML('beforeend','<div class="message-in" id="preview-fresh"><div class="copyable-text"><span class="selectable-text">Deferred preview ${Date.now()}.</span></div></div>');true`,
    );
    const beforePreview = await vm('globalThis.__zlTranslationCalls');
    await switchTranslation('翻译预览');
    await new Promise(resolve => {
      setTimeout(resolve, 1000);
    });
    assert.equal(
      await vm('globalThis.__zlTranslationCalls'),
      beforePreview,
      'enabling preview does not bulk translate the current chat',
    );
    await guest(
      first,
      `document.querySelector('header span').dataset.id='preview-next-chat';true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#preview-fresh [data-zl-translation-text]")?.textContent.includes("重试")')`,
      'newly opened chat preview failure',
    );
    const failedCalls = await vm('globalThis.__zlTranslationCalls');
    await new Promise(resolve => {
      setTimeout(resolve, 900);
    });
    assert.equal(
      await vm('globalThis.__zlTranslationCalls'),
      failedCalls,
      'failed preview must not hammer provider',
    );
    await vm('globalThis.__zlTranslateFail=false;true');
    await guest(
      first,
      `document.querySelector('#preview-fresh [data-zl-translate]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#preview-fresh [data-zl-translation-text]").textContent.includes("你好")')`,
      'preview fallback manual retry',
    );
    await guest(
      first,
      `document.querySelector('#preview-fresh').remove();true`,
    );
    await switchTranslation('翻译预览');
    await switchTranslation('翻译预览');
    await guest(
      first,
      `document.querySelector('header span').dataset.id='preview-next-again';true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('[...document.querySelectorAll("[data-zl-translation-text]")].every(n=>n.textContent.includes("你好"))')`,
      'cached previews restore both directions',
    );
    await click('.account-sidebar__footer button');
    await wait(`!!document.querySelector('.settings__close')`, 'settings open');
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.settings-navigation a[href*="releasenotes"],.settings-navigation a[href*="support"]').length`,
      ),
      0,
    );
    await click('#appearance');
    await wait(
      `!!document.querySelector('input[name="translationTextColor"]')`,
      'translation color picker',
    );
    const editColor = async value => {
      await wait(
        `document.querySelector('.settings').getAnimations({subtree:true}).every(animation=>animation.playState==='finished'||animation.effect?.getTiming().iterations===Infinity)`,
        'settings transition completed before native color click',
      );
      const point = await evaluate(
        `(()=>{const input=document.querySelector('input[name="translationTextColor"]');input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();const point={x:r.x+r.width/2,y:r.y+r.height/2};if(document.elementFromPoint(point.x,point.y)!==input)throw Error('Translation color input is covered: '+JSON.stringify({rect:r.toJSON(),hit:document.elementFromPoint(point.x,point.y)?.outerHTML.slice(0,300)}));return point})()`,
      );
      await call('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...point,
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      await call('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...point,
        button: 'left',
        buttons: 0,
        clickCount: 1,
      });
      await wait(
        `document.activeElement?.name==='translationTextColor'`,
        'color input focused',
      );
      await call('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers: 2,
      });
      await call('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: 'a',
        code: 'KeyA',
        windowsVirtualKeyCode: 65,
        modifiers: 2,
      });
      if (value) await call('Input.insertText', { text: value });
      else {
        await call('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
        await call('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: 'Backspace',
          code: 'Backspace',
          windowsVirtualKeyCode: 8,
        });
      }
      await click('.settings__settings-group__apply-color__button');
    };
    const translationCallsBeforeColor = await vm(
      'globalThis.__zlTranslationCalls',
    );
    await editColor('#1685c7');
    await wait(
      `window.ferdium.stores.settings.app.translationTextColor==='#1685c7'`,
      'translation color saved',
    );
    await wait(
      `${service(first)}.webview.executeJavaScript("[...document.querySelectorAll('[data-zl-translation-text]')].some(e=>e.textContent)&&[...document.querySelectorAll('[data-zl-translation-text]')].every(e=>getComputedStyle(e).color==='rgb(22, 133, 199)')")`,
      'existing translations recolored',
    );
    assert.equal(
      await vm('globalThis.__zlTranslationCalls'),
      translationCallsBeforeColor,
      'color change must not request translations again',
    );
    await shot('/workspace/ZL-WA-translation-color.png');
    await click('.settings__close');
    await click('.account-sidebar__footer button');
    await click('#appearance');
    await wait(
      `document.querySelector('input[name="translationTextColor"]')?.value==='#1685c7'`,
      'color restored after reopening settings',
    );
    await editColor('');
    await wait(
      `window.ferdium.stores.settings.app.translationTextColor==='#ffe45c'`,
      'empty color restores default',
    );
    await click('.settings__close');
    console.log(
      'PASS appearance color saves/reopens, updates existing translations without provider calls, empty value restores default; release/about/download links hidden',
    );
    await shot('/workspace/ZL-WA-message-preview.png');
    await switchTranslation('接收翻译（收发消息）');
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelectorAll("[data-zl-translation]").length').then(n=>n===0)`,
      'disable removes message controls',
    );
    console.log(
      'PASS preview auto translates incoming/sent messages, errors retain manual controls, disabled feature removes all controls',
    );
    for (const label of ['发送自动翻译', '接收翻译（收发消息）', '翻译预览']) {
      const checked = await evaluate(
        `(()=>{const n=[...document.querySelectorAll('.account-tools-panel label')].find(n=>n.textContent.includes(${JSON.stringify(label)}));return n.querySelector('input[role="switch"]').checked})()`,
      );
      if (!checked) await switchTranslation(label);
    }
    await clickText('应用');
    await wait(
      `document.querySelector('.tools-notice')?.textContent.includes('已应用')`,
      'translation saved',
    );
    await wait(`!!${service(first)}.webview`, 'webview after save');
    await wait(`!${service(first)}.isLoading`, 'loaded');
    await new Promise(r => {
      setTimeout(r, 900);
    });
    assert(
      await guest(first, `!!document.querySelector('[data-zl-translation]')`),
      'incoming translation appears below bubble',
    );
    assert.equal(
      await guest(second, `!!document.querySelector('[data-zl-translation]')`),
      false,
      'other account incoming translation is off',
    );
    await guest(
      first,
      `(()=>{const state=window.__zlTranslation;const text=document.querySelector('.selectable-text');const record=state.controls.get(document.querySelector('[data-zl-translation]'));record.status='pending';record.button.disabled=true;state.pending.set(999999,{direction:'incoming',record});window.__zlPendingRecord=record;return true})()`,
    );
    await switchTranslation('发送自动翻译');
    await wait(
      `${service(first)}.webview.executeJavaScript('!window.__zlPendingRecord.button.disabled && window.__zlTranslation.pending.size===0')`,
      'configuration changes release canceled preview buttons',
    );
    await switchTranslation('发送自动翻译');
    // Large history: only the viewport is decorated/translated, and plugin reflow
    // preserves WhatsApp's bottom or the user's history anchor.
    const originalMessages = await guest(
      first,
      `(()=>{const c=document.querySelector('#messages').cloneNode(true);c.querySelectorAll('[data-zl-translation]').forEach(n=>n.remove());return c.innerHTML})()`,
    );
    const originalMessagesStyle = await guest(
      first,
      `document.querySelector('#messages').style.cssText`,
    );
    const previewCallsBefore = await vm('globalThis.__zlTranslationCalls');
    await guest(
      first,
      `(()=>{const list=document.querySelector('#messages');list.style.cssText='height:260px;flex:none;overflow-y:auto';list.innerHTML=Array.from({length:90},(_,i)=>'<div class="message-in" data-id="perf-'+i+'" style="min-height:32px"><div class="copyable-text"><span class="selectable-text">Viewport preview ${Date.now()} '+i+'</span></div></div>').join('');list.scrollTop=list.scrollHeight;document.querySelector('header span').dataset.id='performance-chat';return true})()`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelectorAll("#messages [data-zl-translation-text]").length>=2')`,
      'visible history preview',
    );
    await new Promise(resolve => {
      setTimeout(resolve, 1800);
    });
    assert(
      (await vm('globalThis.__zlTranslationCalls')) - previewCallsBefore < 20,
      '90 loaded history messages must not cause 90 translations',
    );
    assert(
      await guest(
        first,
        `(()=>{const list=document.querySelector('#messages');return list.scrollHeight-list.clientHeight-list.scrollTop<3})()`,
      ),
      'translation insertion keeps an already pinned chat at its native bottom',
    );
    const anchor = await guest(
      first,
      `(()=>{const list=document.querySelector('#messages');list.scrollTop=300;const top=list.getBoundingClientRect().top;const row=[...list.children].find(n=>n.getBoundingClientRect().bottom>top+1);return {id:row.dataset.id,top:row.getBoundingClientRect().top}})()`,
    );
    await new Promise(resolve => {
      setTimeout(resolve, 1800);
    });
    const anchorAfter = await guest(
      first,
      `document.querySelector('[data-id="${anchor.id}"]').getBoundingClientRect().top`,
    );
    assert(
      Math.abs(anchorAfter - anchor.top) < 3,
      'translating history never jumps the user to the bottom',
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('window.__zlTranslation.pending.size===0')`,
      'visible preview queue drained',
    );
    const cachedCalls = await vm('globalThis.__zlTranslationCalls');
    await guest(
      first,
      `(()=>{const list=document.querySelector('#messages');list.innerHTML='<div class="message-in"><div class="copyable-text"><span class="selectable-text">Hello, this is a local test message.</span></div></div>';document.querySelector('header span').dataset.id='cached-return-chat';return true})()`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#messages [data-zl-translation-text]")?.textContent.includes("你好")')`,
      'cached translation restores after DOM remount',
    );
    assert.equal(
      await vm('globalThis.__zlTranslationCalls'),
      cachedCalls,
      'returning to translated text must not invoke the provider again',
    );
    await guest(
      first,
      `document.querySelector('#messages').innerHTML=${JSON.stringify(originalMessages)};document.querySelector('#messages').style.cssText=${JSON.stringify(originalMessagesStyle)};document.querySelector('header span').dataset.id='test-chat';true`,
    );
    console.log(
      'PASS deferred preview, visible-only work, cached DOM remount, pinned-bottom reflow and history-anchor preservation',
    );
    await guest(
      first,
      `(()=>{let i=0;for(const row of document.querySelector('#messages').children){const original=row.querySelector('.selectable-text')?.textContent;if(!original)continue;row.className='';row.dataset.id='opaque-message-'+(++i);row.replaceChildren();const body=document.createElement('div');body.dataset.prePlainText='synthetic';const text=document.createElement('span');text.dir='auto';text.textContent=original;body.append(text);row.append(body)}return true})()`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelectorAll("[data-zl-translate]").length').then(n=>n===3)`,
      'semantic message markers without old classes',
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('[...document.querySelectorAll("[data-zl-translation-text]")].every(n=>n.textContent.includes("你好"))')`,
      'semantic preview text',
    );
    assert.equal(
      await guest(
        first,
        'document.querySelectorAll("#messages .message-in, #messages .message-out, #messages .selectable-text, #messages .copyable-text").length',
      ),
      0,
    );
    console.log(
      'PASS message recognition works without message-in/out, copyable/selectable classes or true_/false_ IDs',
    );
    await clickText('检查页面识别');
    await wait(
      `document.querySelector('.tools-notice')?.textContent.includes('检测到 3 条')`,
      'visible page recognition status',
    );
    await clickText('复制页面诊断');
    const report = await evaluate(`require('electron').clipboard.readText()`);
    assert.equal(JSON.parse(report).version, 8);
    assert.equal(JSON.parse(report).counts['[data-zl-translate]'], 3);
    assert(
      !report.includes('8613800000001') &&
        !report.includes('你好') &&
        !report.includes('test-chat'),
      'diagnostics must omit content and attribute values',
    );
    // Edit-message dialogs use a separate editor and a checkmark, never the chat's send button.
    const sentBeforeEdit = await guest(first, 'fixture.sent.length');
    await guest(
      first,
      `document.querySelector('#main footer [contenteditable]').textContent='保留后台草稿';fixture.openEdit('修改后的消息');document.querySelector('#fixture-edit [data-icon="checkmark"]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#fixture-edit [contenteditable]")?.textContent').then(t=>t==='Hello translated')`,
      'edited message translation preview',
    );
    assert.equal(
      await guest(first, 'fixture.edited.length'),
      0,
      'first save only previews the edited translation',
    );
    assert.equal(
      await guest(
        first,
        `document.querySelector('#main footer [contenteditable]').textContent`,
      ),
      '保留后台草稿',
    );
    await guest(
      first,
      `document.querySelector('#fixture-edit [contenteditable]').textContent='Corrected edited message';document.querySelector('#fixture-edit [data-icon="checkmark"]').click();true`,
    );
    assert.deepEqual(await guest(first, 'fixture.edited'), [
      'Corrected edited message',
    ]);
    await guest(
      first,
      `fixture.openEdit('键盘修改消息',false,'编辑消息');document.querySelector('#fixture-edit [contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#fixture-edit [contenteditable]")?.textContent').then(t=>t==='Hello translated')`,
      'edited message Enter preview without dialog role',
    );
    assert.equal(await guest(first, 'fixture.edited.length'), 1);
    await guest(
      first,
      `document.querySelector('#fixture-edit [contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`,
    );
    assert.equal(await guest(first, 'fixture.edited.length'), 2);
    await vm('globalThis.__zlTranslateFail=true;true');
    await guest(
      first,
      `fixture.openEdit('编辑翻译失败 ${Date.now()}');document.querySelector('#fixture-edit [data-icon="checkmark"]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('document.querySelector("#zl-translation-status")?.textContent.includes("消息尚未发送")')`,
      'edit translation failure stays unsaved',
    );
    assert.equal(await guest(first, 'fixture.edited.length'), 2);
    await guest(
      first,
      `document.querySelector('[data-testid="fixture-edit-cancel"]').click();true`,
    );
    await vm('globalThis.__zlTranslateFail=false;true');
    await guest(
      first,
      `fixture.openEdit('等待翻译的编辑 ${Date.now()}');document.querySelector('#fixture-edit [data-icon="checkmark"]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('[...window.__zlTranslation.pending.values()].some(j=>j.direction==="outgoing")')`,
      'edit translation pending',
    );
    await guest(
      first,
      `document.querySelector('[data-testid="fixture-edit-cancel"]').click();fixture.openEdit('另一条消息的编辑');true`,
    );
    await new Promise(resolve => {
      setTimeout(resolve, 900);
    });
    assert.equal(
      await guest(
        first,
        `document.querySelector('#fixture-edit [contenteditable]').textContent`,
      ),
      '另一条消息的编辑',
      'a cancelled edit cannot overwrite another message',
    );
    assert.equal(await guest(first, 'fixture.edited.length'), 2);
    await guest(
      first,
      `document.querySelector('[data-testid="fixture-edit-cancel"]').click();fixture.openEdit('正常备注',true,'Edit profile');document.querySelector('#fixture-edit [data-icon="checkmark"]').click();true`,
    );
    assert.equal(
      await guest(first, 'fixture.edited.at(-1)'),
      '正常备注',
      'unrelated forms keep their native confirmation',
    );
    assert.equal(
      await guest(first, 'fixture.sent.length'),
      sentBeforeEdit,
      'editing never sends a new message',
    );
    console.log(
      'PASS edit-message click/Enter translation previews, corrected saves, failed translation protection, cancellation isolation and unrelated dialogs',
    );
    // Media preview caption is outside #main/footer and uses a role=button send control.
    await guest(
      first,
      `document.querySelector('#main footer [contenteditable]').textContent='不要修改的聊天草稿';fixture.openMedia('你好');document.querySelector('#fixture-media [role=button]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript("document.querySelector('#fixture-media [contenteditable]')?.textContent").then(t=>t==='Hello translated')`,
      'media caption native replacement',
    );
    assert.equal(
      await guest(first, 'fixture.mediaSent.length'),
      0,
      'first click must not send original media caption',
    );
    assert.equal(
      await guest(
        first,
        `document.querySelector('#main footer [contenteditable]').textContent`,
      ),
      '不要修改的聊天草稿',
    );
    await guest(
      first,
      `document.querySelector('#fixture-media [contenteditable]').textContent='Hello corrected caption';document.querySelector('#fixture-media [role=button]').click();true`,
    );
    assert.equal(
      await guest(first, 'fixture.mediaSent.at(-1).caption'),
      'Hello corrected caption',
    );
    await guest(
      first,
      `fixture.openMedia('你好',false);document.querySelector('#fixture-media [role=button]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript("document.querySelector('#fixture-media [contenteditable]')?.textContent").then(t=>t==='Hello translated')`,
      'caption preview without dialog role',
    );
    await guest(
      first,
      `document.querySelector('#fixture-media [contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`,
    );
    assert.equal(
      await guest(first, 'fixture.mediaSent.at(-1).caption'),
      'Hello translated',
    );
    const beforeCaptionFailure = await guest(first, 'fixture.mediaSent.length');
    await vm('globalThis.__zlTranslateFail=true;true');
    await guest(
      first,
      `fixture.openMedia('翻译失败的图片说明');document.querySelector('#fixture-media [role=button]').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript("!window.__zlTranslation.busy && !window.__zlTranslation.approved && document.querySelector('#zl-translation-status')?.textContent.includes('消息尚未发送')")`,
      'caption provider failure',
    );
    assert.equal(
      await guest(first, 'fixture.mediaSent.length'),
      beforeCaptionFailure,
    );
    assert.equal(
      await guest(
        first,
        `document.querySelector('#fixture-media [contenteditable]').textContent`,
      ),
      '翻译失败的图片说明',
    );
    await vm('globalThis.__zlTranslateFail=false;true');
    await guest(
      first,
      `document.querySelector('#fixture-media').remove();fixture.openMedia('等待翻译的图文');document.querySelector('#fixture-media img').src='https://web.whatsapp.com/preview-A.png';document.querySelector('#fixture-media [role=button]').click();true`,
    );
    await wait(
      `(async()=>await ${service(first)}.webview.executeJavaScript("[...window.__zlTranslation.pending.values()].some(j=>j.direction==='outgoing')"))()`,
      'caption request pending',
    );
    await guest(
      first,
      `document.querySelector('#fixture-media img').src='https://web.whatsapp.com/preview-B.png';true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript("document.querySelector('#zl-translation-status')?.textContent").then(t=>t?.includes('已变化'))`,
      'changing media discards pending caption',
    );
    assert.equal(
      await guest(
        first,
        `document.querySelector('#fixture-media [contenteditable]').textContent`,
      ),
      '等待翻译的图文',
    );
    await guest(
      first,
      `document.querySelector('#fixture-media').remove();fixture.openMedia('🐭');document.querySelector('#fixture-media [role=button]').click();true`,
    );
    assert.equal(await guest(first, 'fixture.mediaSent.at(-1).caption'), '🐭');
    await guest(
      first,
      `fixture.openMedia('');document.querySelector('#fixture-media [role=button]').click();document.querySelector('#main footer [contenteditable]').textContent='';true`,
    );
    assert.equal(await guest(first, 'fixture.mediaSent.at(-1).caption'), '');
    console.log(
      'PASS media captions translate before send, preserve background drafts, allow corrections and Enter, reject provider failures/media switches, and bypass emoji/empty captions',
    );
    for (const kind of ['video', 'file']) {
      const attachmentSendCount = await guest(
        first,
        'fixture.mediaSent.length',
      );
      await guest(
        first,
        `fixture.openMedia('你好',false,${JSON.stringify(kind)});document.querySelector('#fixture-media [role=button]').click();true`,
      );
      await wait(
        `${service(first)}.webview.executeJavaScript("document.querySelector('#fixture-media [contenteditable]')?.textContent").then(t=>t==='Hello translated')`,
        `${kind} caption translated`,
      );
      assert.equal(
        await guest(first, 'fixture.mediaSent.length'),
        attachmentSendCount,
      );
      await guest(
        first,
        `document.querySelector('#fixture-media [contenteditable]').textContent='Hello corrected ${kind}';document.querySelector('#fixture-media [role=button]').click();true`,
      );
      assert.equal(
        await guest(first, 'fixture.mediaSent.at(-1).caption'),
        `Hello corrected ${kind}`,
      );
      assert.equal(await guest(first, 'fixture.mediaSent.at(-1).kind'), kind);
      await vm('globalThis.__zlTranslateFail=true;true');
      await guest(
        first,
        `fixture.openMedia('发送失败保护说明'+${JSON.stringify(kind)},false,${JSON.stringify(kind)});document.querySelector('#fixture-media [role=button]').click();true`,
      );
      await wait(
        `${service(first)}.webview.executeJavaScript("!window.__zlTranslation.busy && !window.__zlTranslation.approved && document.querySelector('#zl-translation-status')?.textContent.includes('消息尚未发送')")`,
        `${kind} failure keeps attachment unsent`,
      );
      assert.equal(
        await guest(first, 'fixture.mediaSent.length'),
        attachmentSendCount + 1,
      );
      await vm('globalThis.__zlTranslateFail=false;true');
      await guest(
        first,
        `document.querySelector('#fixture-media').remove();fixture.openMedia('更换附件等待翻译'+${JSON.stringify(kind)},false,${JSON.stringify(kind)});document.querySelector('#fixture-media [role=button]').click();true`,
      );
      await wait(
        `(async()=>await ${service(first)}.webview.executeJavaScript("[...window.__zlTranslation.pending.values()].some(j=>j.direction==='outgoing')"))()`,
        `${kind} pending before changing attachment`,
      );
      await guest(
        first,
        kind === 'file'
          ? `const title=document.querySelector('#fixture-media [title]');title.title='sample-B.pdf';title.textContent='sample-B.pdf';true`
          : `document.querySelector('#fixture-media video').src='blob:https://web.whatsapp.com/synthetic-video-B';true`,
      );
      await wait(
        `${service(first)}.webview.executeJavaScript("!window.__zlTranslation.busy && document.querySelector('#zl-translation-status')?.textContent.includes('已变化')")`,
        `${kind} change discards old result`,
      );
      assert.equal(
        await guest(
          first,
          `document.querySelector('#fixture-media [contenteditable]').textContent`,
        ),
        `更换附件等待翻译${kind}`,
      );
      await guest(
        first,
        `document.querySelector('#fixture-media').remove();fixture.openMedia('',false,${JSON.stringify(kind)});document.querySelector('#fixture-media [role=button]').click();true`,
      );
      assert.equal(await guest(first, 'fixture.mediaSent.at(-1).caption'), '');
      await guest(
        first,
        `fixture.openMedia('🐭',false,${JSON.stringify(kind)});document.querySelector('#fixture-media [role=button]').click();true`,
      );
      assert.equal(
        await guest(first, 'fixture.mediaSent.at(-1).caption'),
        '🐭',
      );
      await guest(
        first,
        `fixture.openMedia('你好',true,${JSON.stringify(kind)});document.querySelector('#fixture-media [contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`,
      );
      await wait(
        `${service(first)}.webview.executeJavaScript("document.querySelector('#fixture-media [contenteditable]')?.textContent").then(t=>t==='Hello translated')`,
        `${kind} Enter previews translation`,
      );
      await guest(
        first,
        `document.querySelector('#fixture-media [contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));true`,
      );
      assert.equal(
        await guest(first, 'fixture.mediaSent.at(-1).caption'),
        'Hello translated',
      );
    }
    console.log(
      'PASS video and document captions support two-step click/Enter sends, corrections, failure protection, attachment changes, empty captions and emoji',
    );
    const callsBeforeEmoji = await vm('globalThis.__zlTranslationCalls');
    for (const value of [
      '🐭',
      '👩🏽‍💻',
      '🇨🇳',
      '1️⃣',
      '123',
      '?!',
      'https://example.test/path',
    ]) {
      await guest(
        first,
        `document.querySelector('[contenteditable]').textContent=${JSON.stringify(value)};document.querySelector('footer button').click();true`,
      );
      assert.equal(
        await guest(first, 'fixture.sent.at(-1)'),
        value,
        'non-translatable content sends on first click unchanged',
      );
    }
    await guest(
      first,
      `document.querySelector('[contenteditable]').innerHTML='<p><span contenteditable="false"><img alt="🐭"></span></p>';document.querySelector('footer button').click();true`,
    );
    assert.equal(
      await guest(first, 'fixture.sent.at(-1)'),
      '🐭',
      'decorator image emoji sends once without duplication',
    );
    await new Promise(resolve => {
      setTimeout(resolve, 600);
    });
    assert.equal(
      await vm('globalThis.__zlTranslationCalls'),
      callsBeforeEmoji,
      'emoji/numeric/link sends never call translation',
    );
    await guest(first, 'fixture.sent=[];true');
    console.log(
      'PASS Unicode emoji, ZWJ/flags/keycaps, decorator IMG emoji, numbers and URLs bypass translation unchanged',
    );
    await guest(
      first,
      `document.querySelector('[contenteditable]').innerHTML='<p>你好<span contenteditable="false"><img alt="🐭"></span></p>';document.querySelector('footer button').click();true`,
    );
    await wait(
      `${service(first)}.webview.executeJavaScript('fixture.editorText()').then(t=>t==='Hello 🐭')`,
      'mixed emoji native replacement',
    );
    assert.equal(await guest(first, 'fixture.sent.length'), 0);
    await guest(first, `document.querySelector('footer button').click();true`);
    assert.deepEqual(await guest(first, 'fixture.sent'), ['Hello 🐭']);
    await guest(first, 'fixture.sent=[];true');
    console.log(
      'PASS native select-all replaces text plus noneditable emoji decorator exactly once before confirmed send',
    );
    await guest(
      first,
      `document.querySelector('[contenteditable]').innerText='你好';document.querySelector('footer button').click();true`,
    );
    assert.equal(
      await guest(first, 'fixture.sent.length'),
      0,
      'first click must never send original',
    );
    await new Promise(r => {
      setTimeout(r, 1000);
    });
    assert.equal(
      await guest(
        first,
        `document.querySelector('[contenteditable]').innerText`,
      ),
      'Hello translated',
    );
    assert.equal(
      await guest(first, 'fixture.sent.length'),
      0,
      'translated preview must remain unsent',
    );
    assert(
      (await guest(first, 'fixture.nativeInputs')) > 0,
      'replacement must use trusted native editor input when execCommand fails',
    );
    await shot('/workspace/ZL-WA-translation.png');
    await guest(
      first,
      `document.querySelector('[contenteditable]').innerText='Hello corrected';document.querySelector('footer button').click();true`,
    );
    assert.deepEqual(await guest(first, 'fixture.sent'), ['Hello corrected']);
    console.log(
      'PASS received translation, per-account isolation, first-click preview and second-click corrected send',
    );
    await verifyTranslationRedraft({ first, guest, evaluate, wait, service });
    await verifyTranslationContexts({ first, guest, evaluate, wait, service });
    await vm(`globalThis.__zlTranslateFail=true;true`);
    await guest(
      first,
      `document.querySelector('[contenteditable]').innerText='失败测试';document.querySelector('footer button').click();true`,
    );
    await new Promise(r => {
      setTimeout(r, 1000);
    });
    assert.equal(
      await guest(
        first,
        `document.querySelector('[contenteditable]').innerText`,
      ),
      '失败测试',
    );
    assert.equal(await guest(first, 'fixture.sent.length'), 1);
    assert.match(
      await guest(
        first,
        `document.querySelector('#zl-translation-status').textContent`,
      ),
      /消息尚未发送/,
    );
    await vm(`globalThis.__zlTranslateFail=false;true`);
    // Edit while translation is pending: stale result must never replace it.
    await guest(
      first,
      `document.querySelector('[contenteditable]').innerText='等待翻译';document.querySelector('footer button').click();document.querySelector('[contenteditable]').innerText='已修改内容';true`,
    );
    await new Promise(r => {
      setTimeout(r, 1000);
    });
    assert.equal(
      await guest(
        first,
        `document.querySelector('[contenteditable]').innerText`,
      ),
      '已修改内容',
    );
    assert.equal(await guest(first, 'fixture.sent.length'), 1);
    console.log(
      'PASS translation failure and stale-draft protection leave the original unsent',
    );
    // Test Enter, including repeat protection, through a real contenteditable event.
    await guest(
      first,
      `(()=>{const i=document.querySelector('[contenteditable]');i.innerText='键盘测试';i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return true})()`,
    );
    await new Promise(r => {
      setTimeout(r, 1000);
    });
    assert.equal(
      await guest(
        first,
        `document.querySelector('[contenteditable]').innerText`,
      ),
      'Hello translated',
    );
    await guest(
      first,
      `document.querySelector('[contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true}));true`,
    );
    assert.equal(await guest(first, 'fixture.sent.length'), 1);
    await guest(
      first,
      `document.querySelector('[contenteditable]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));true`,
    );
    assert.equal(await guest(first, 'fixture.sent.length'), 2);
    console.log('PASS Enter first/second send and held-key protection');
    await guest(
      first,
      `document.querySelector('[contenteditable]').innerText='切换聊天测试';document.querySelector('footer button').click();document.querySelector('header span').dataset.id='other-chat';true`,
    );
    await new Promise(r => {
      setTimeout(r, 1000);
    });
    assert.equal(
      await guest(
        first,
        `document.querySelector('[contenteditable]').innerText`,
      ),
      '切换聊天测试',
    );
    assert.equal(await guest(first, 'fixture.sent.length'), 2);
    console.log(
      'PASS switching chats invalidates pending outgoing translation',
    );

    await clickText('▤代理');
    await wait(
      `!!document.querySelector('.account-tools-panel fieldset')`,
      'proxy panel',
    );
    await shot('/workspace/ZL-WA-proxy.png');
    // Confirm underlying Electron Session proxy routing, without sending traffic to a real proxy.
    await evaluate(
      `(async()=>{const e=require('electron').ipcRenderer;const c=await e.invoke('account-tools-get',${JSON.stringify(first)});c.proxy={...c.proxy,enabled:true,host:'127.0.0.1',port:'47891'};await e.invoke('account-tools-save',${JSON.stringify(first)},c)})()`,
    );
    assert.match(
      await evaluate(
        `require('@electron/remote').session.fromPartition('persist:service-${first}').resolveProxy('https://web.whatsapp.com')`,
      ),
      /PROXY 127\.0\.0\.1:47891/,
    );
    await vm(
      `(async()=>{const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const fs=req('node:fs');globalThis.__zlProxyConnects=0;globalThis.__zlProxyTLS=req('node:https').createServer({key:fs.readFileSync('${tlsDirectory}/key.pem'),cert:fs.readFileSync('${tlsDirectory}/cert.pem')},(_r,s)=>{s.writeHead(200);s.end()});globalThis.__zlProxyServer=req('node:http').createServer();globalThis.__zlProxyServer.on('connect',(_r,c,h)=>{globalThis.__zlProxyConnects++;const u=req('node:net').connect(47892,'127.0.0.1',()=>{c.write('HTTP/1.1 200 Connection Established\\r\\n\\r\\n');if(h.length)u.write(h);c.pipe(u);u.pipe(c)});u.on('error',()=>c.destroy());c.on('error',()=>u.destroy())});await new Promise(r=>globalThis.__zlProxyTLS.listen(47892,'127.0.0.1',r));await new Promise(r=>globalThis.__zlProxyServer.listen(47891,'127.0.0.1',r));req('electron').session.fromPartition('persist:service-${first}').setCertificateVerifyProc((_r,cb)=>cb(0));return true})()`,
    );
    const connection = await evaluate(
      `require('electron').ipcRenderer.invoke('account-tools-test-proxy',${JSON.stringify(first)})`,
    );
    assert.match(connection.route, /PROXY/);
    assert(
      (await vm(`globalThis.__zlProxyConnects`)) > 0,
      'native proxy test must really establish an HTTP CONNECT tunnel',
    );
    await vm(
      `globalThis.__zlProxyTLS.closeAllConnections();globalThis.__zlProxyTLS.close();globalThis.__zlProxyServer.closeAllConnections();globalThis.__zlProxyServer.close();true`,
    );
    console.log(
      'PASS native connection-test IPC traverses a local HTTP CONNECT proxy and TLS destination',
    );

    const systemRoute = await vm(
      `(async()=>{const s=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition('zl-qa-system-${first}');await s.setProxy({mode:'system'});return s.resolveProxy('https://web.whatsapp.com')})()`,
    );
    assert.equal(
      await evaluate(
        `require('@electron/remote').session.fromPartition('persist:service-${second}').resolveProxy('https://web.whatsapp.com')`,
      ),
      systemRoute,
    );
    await evaluate(
      `(async()=>{const e=require('electron').ipcRenderer;const c=await e.invoke('account-tools-get',${JSON.stringify(first)});c.proxy.enabled=false;await e.invoke('account-tools-save',${JSON.stringify(first)},c)})()`,
    );
    assert.equal(
      await evaluate(
        `require('@electron/remote').session.fromPartition('persist:service-${first}').resolveProxy('https://web.whatsapp.com')`,
      ),
      systemRoute,
    );
    console.log(
      'PASS actual Electron account Session proxy routing and disable-to-system-network isolation',
    );
    // The system-route assertions above intentionally honor the cloud host's
    // ambient proxy. The remaining guest pages are local fixtures: isolate
    // their transport from that external proxy to avoid native reloads while
    // exercising message counters. Only this run's two test Sessions change.
    await vm(
      `(async()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');for(const id of ${JSON.stringify(ids)}){const s=e.session.fromPartition('persist:service-'+id);await s.setProxy({mode:'direct'});await s.closeAllConnections()}return true})()`,
    );
    await wait(
      `!${service(first)}.isLoading && ${service(first)}.accountSnapshot.status==='online' && !${service(second)}.isLoading && ${service(second)}.accountSnapshot.status==='online'`,
      'local fixture Sessions remain online',
    );
    await clickText('☷群发');
    const checkBulkLayout = async () => {
      for (const [width, height] of [
        [1920, 1080],
        [1366, 768],
        [900, 650],
        [640, 480],
      ]) {
        await evaluate(
          `require('@electron/remote').getCurrentWindow().setSize(${width},${height})`,
        );
        await new Promise(resolve => {
          setTimeout(resolve, 150);
        });
        const layout = await evaluate(`(()=>{
        const paper=document.querySelector('.bulk-dialog > .MuiDialog-container > .MuiPaper-root');
        const content=paper.querySelector(':scope > .MuiDialogContent-root');
        const actions=paper.querySelector(':scope > .MuiDialogActions-root');
        const r=paper.getBoundingClientRect();const footer=actions.getBoundingClientRect();
        const fixture=document.createElement('div');fixture.style.height='2000px';content.append(fixture);content.scrollTop=content.scrollHeight;
        const button=actions.querySelector('button');const b=button.getBoundingClientRect();
        const hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
        const result={width:innerWidth,height:innerHeight,paper:r.toJSON(),footer:footer.toJSON(),scrolls:content.scrollHeight>content.clientHeight,footerClickable:button.contains(hit),noHorizontalOverflow:content.scrollWidth<=content.clientWidth+1};
        fixture.remove();content.scrollTop=0;return result;
      })()`);
        assert(
          layout.paper.top >= 0 && layout.paper.bottom <= layout.height,
          'forwarding dialog fits vertically',
        );
        assert(
          layout.paper.left >= 0 && layout.paper.right <= layout.width,
          'forwarding dialog fits horizontally',
        );
        assert(
          layout.paper.height >= layout.height - 40,
          'forwarding dialog uses the WhatsApp page height',
        );
        assert(
          layout.paper.width >= layout.width - 40,
          'forwarding dialog covers the WhatsApp page width',
        );
        assert(
          layout.footer.bottom <= layout.height && layout.footerClickable,
          'footer stays visible and clickable above the guest',
        );
        assert(
          layout.scrolls && layout.noHorizontalOverflow,
          'body scrolls without hiding footer or overflowing horizontally',
        );
      }
      await evaluate(
        `require('@electron/remote').getCurrentWindow().setSize(1280,800)`,
      );
      await new Promise(resolve => {
        setTimeout(resolve, 150);
      });
    };
    await checkBulkLayout();
    await clickText('新建转发');
    await wait(
      `!!document.querySelector('.bulk-columns')`,
      'centered bulk form',
    );
    await evaluate(
      `document.querySelector('.bulk-columns fieldset input[type="checkbox"]').click()`,
    );
    await clickText('读取聊天对象');
    await wait(
      `document.querySelectorAll('.bulk-recipient-list input').length===2`,
      'real adapter fixture recipients',
    );
    await evaluate(
      `document.querySelector('.bulk-columns fieldset:nth-child(2) > label input').click();const t=document.querySelector('[aria-label="发送内容"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'这是批量发送本地测试');t.dispatchEvent(new Event('input',{bubbles:true}));`,
    );
    await checkBulkLayout();
    console.log(
      'PASS forwarding history and creation overlay the guest at four window sizes, with scrolling body and clickable fixed footer',
    );
    await shot('/workspace/ZL-WA-bulk-send.png');
    assert.equal(
      await guest(first, 'fixture.bulk.length'),
      0,
      'selecting recipients must not send',
    );
    await clickText('检查并发送');
    assert.equal(
      await guest(first, 'fixture.bulk.length'),
      0,
      'preview confirmation must not send',
    );
    assert(
      await evaluate(
        `(()=>{const buttons=[...document.querySelectorAll('[role="dialog"] button')];const button=buttons.find(b=>b.textContent.trim()==='确认发送');const r=button.getBoundingClientRect();return r.top>=0 && r.bottom<=innerHeight && button.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
      ),
      'confirmation stays above the forwarding overlay',
    );
    await clickText('确认发送');
    await wait(
      `document.querySelector('.bulk-history tbody tr:first-child')?.textContent.includes('已完成') && ${service(first)}.webview.executeJavaScript('fixture.bulk.length').then(n=>n===2)`,
      'bulk complete',
    );
    assert.deepEqual(await guest(first, 'fixture.bulk'), [
      { id: '10001@g.us', text: '这是批量发送本地测试' },
      { id: '10002@c.us', text: '这是批量发送本地测试' },
    ]);
    assert.equal(await guest(second, 'fixture.bulk.length'), 0);
    await shot('/workspace/ZL-WA-bulk-history.png');
    console.log(
      'PASS centered bulk dialog, real recipient adapter, explicit confirmation, two synthetic sends, progress and history',
    );
    await clickText('新建转发');
    await evaluate(
      `document.querySelectorAll('.bulk-columns fieldset:first-child input[type="checkbox"]')[1].click()`,
    );
    await clickText('读取聊天对象');
    await wait(
      `document.querySelectorAll('.bulk-recipient-list input').length===4`,
      'multi-account recipients',
    );
    await evaluate(
      `document.querySelector('.bulk-columns fieldset:nth-child(2) > label input').click()`,
    );
    await guest(second, `fixture.fail=true;true`);
    await clickText('检查并发送');
    await clickText('确认发送');
    await wait(
      `!!document.querySelector('.bulk-history') && /^(已停止|待确认)$/.test(document.querySelector('.bulk-history tbody tr .bulk-status')?.textContent || '')`,
      'bulk stops on failure',
    );
    assert.equal(await guest(first, 'fixture.bulk.length'), 4);
    assert.equal(
      await guest(second, 'fixture.bulk.length'),
      1,
      'failure must stop before next target, with no retry',
    );
    console.log(
      'PASS multi-account targets remain distinct and an uncertain/failed send stops the queue without retry',
    );
    await guest(second, `fixture.fail=false;true`);
    await clickText('新建转发');
    await clickText('检查并发送');
    await clickText('确认发送');
    await wait(
      `${service(first)}.webview.executeJavaScript('fixture.bulk.length').then(n=>n===5)`,
      'first cancellation send',
    );
    await clickText('停止发送');
    await wait(
      `!!document.querySelector('.bulk-history') && /^(已停止|待确认)$/.test(document.querySelector('.bulk-history tbody tr .bulk-status')?.textContent || '')`,
      'queue cancelled',
    );
    assert.equal(await guest(first, 'fixture.bulk.length'), 5);
    assert.equal(await guest(second, 'fixture.bulk.length'), 1);
    console.log(
      'PASS stop button prevents subsequent recipients after the current send',
    );

    // Media + revoke exercise the privileged file picker, isolated guest adapter and live history UI.
    await guest(
      first,
      `fixture.advanced=[];fixture.revoked=[];window.WPP={isReady:true,chat:{get:()=>({}),sendFileMessage:async(id,data,options)=>{const messageId='fixture-media-'+crypto.randomUUID();fixture.advanced.push({id,dataPrefix:data.slice(0,30),options,messageId});return {id:messageId,ack:1}},getMessageById:async()=>({id:{fromMe:true,remote:{_serialized:'10001@g.us'}}}),deleteMessage:async(chat,id,local,revoke)=>{fixture.revoked.push({chat,id,local,revoke});return {isRevoked:true,sendMsgResult:'OK'}}}};true`,
    );
    const mediaPath = `${tlsDirectory}/fixture.png`;
    writeFileSync(
      mediaPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
        'base64',
      ),
    );
    await vm(
      `globalThis.__zlOriginalFilePicker=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog.showOpenDialog;process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[${JSON.stringify(mediaPath)}]});true`,
    );
    await clickText('新建转发');
    await evaluate(
      `document.querySelectorAll('.bulk-columns fieldset:first-child input[type="checkbox"]')[1].click()`,
    );
    await clickText('读取聊天对象');
    await wait(
      `document.querySelectorAll('.bulk-recipient-list input').length===2`,
      'media target list',
    );
    await evaluate(
      `document.querySelector('.bulk-recipient-list input').click()`,
    );
    await clickText('图片');
    await clickText('选择图片附件');
    await wait(
      `document.querySelector('.bulk-media')?.textContent.includes('fixture.png')`,
      'native picked and copied image',
    );
    await wait(
      `document.querySelector('.bulk-media-preview img')?.naturalWidth>0`,
      'selected bulk image shows a preview',
    );
    await clickText('检查并发送');
    await clickText('确认发送');
    await wait(
      `${service(first)}.webview.executeJavaScript('fixture.advanced.length').then(n=>n===1)`,
      'one media send',
    );
    await wait(
      `document.querySelector('.bulk-history tbody tr:first-child')?.textContent.includes('已完成')`,
      'media accepted',
    );
    await evaluate(
      `document.querySelector('.bulk-history tbody tr:first-child summary').click()`,
    );
    await clickText('撤回已发消息');
    await clickText('确认撤回消息');
    await wait(
      `document.querySelectorAll('[role="dialog"]')[1]?.textContent.includes('已撤回')`,
      'revoke detail result',
    );
    assert.deepEqual(
      await guest(
        first,
        'fixture.revoked.map(r=>({chat:r.chat,local:r.local,revoke:r.revoke}))',
      ),
      [{ chat: '10001@g.us', local: false, revoke: true }],
    );
    await clickText('关闭详情');
    await clickText('撤回记录');
    await wait(
      `document.querySelector('.bulk-history tbody tr:first-child')?.textContent.includes('已撤回')`,
      'revoke history table',
    );
    await shot('/workspace/ZL-WA-bulk-revoke.png');
    await clickText('发送记录');
    assert.equal(
      await guest(first, 'fixture.advanced.length'),
      1,
      'revoke and record navigation never resend media',
    );
    await vm(
      `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog.showOpenDialog=globalThis.__zlOriginalFilePicker;delete globalThis.__zlOriginalFilePicker;true`,
    );
    console.log(
      'PASS native attachment picker copies media, media adapter records its message ID, revoke requests delete-for-everyone and updates revoke history',
    );

    await clickText('新建转发');
    await evaluate(
      `(()=>{const n=document.querySelector('#bulk-failure');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(n,'continue');n.dispatchEvent(new Event('change',{bubbles:true}));const t=document.querySelector('#bulk-min');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(t,'4.5');t.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await clickText('关闭');
    await clickText('☷群发');
    await clickText('新建转发');
    await wait(
      `document.querySelector('#bulk-failure')?.value==='continue' && document.querySelector('#bulk-min')?.value==='4.5'`,
      'bulk preferences survive closing and reopening',
    );
    assert.equal(
      await evaluate(
        `document.querySelectorAll('.bulk-recipient-list input:checked').length`,
      ),
      0,
      'remember settings without silently restoring recipients',
    );
    console.log(
      'PASS bulk settings persist on immediate close/reopen without carrying over recipient selection',
    );
    await clickText('关闭');
    await verifyBulkMultitask({
      first,
      service,
      guest,
      evaluate,
      wait,
      clickText,
      shot,
      queueExpression,
    });
  }
  // Customer integration uses local identities and never sends a WhatsApp message.
  await click(`[data-service-id="${first}"] .account-card__select`);
  await guest(
    first,
    `fixture.openChat('10002@c.us');fixture.chats[0].unreadCount=4;fixture.chats[1].unreadCount=3;true`,
  );
  await guest(
    first,
    `(()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=2;canvas.getContext('2d').fillRect(0,0,2,2);fixture.ownAvatar=canvas.toDataURL();return true})()`,
  );
  await wait(
    `document.querySelector('[data-service-id="${first}"] .account-card__portrait img')?.src.startsWith('data:image/')`,
    'own account avatar loaded from native thumbnail',
  );
  const ownAvatar = await evaluate(
    `document.querySelector('[data-service-id="${first}"] .account-card__portrait img').src`,
  );
  await guest(first, `fixture.ownAvatar='';true`);
  await new Promise(resolve => {
    setTimeout(resolve, 3300);
  });
  assert.equal(
    await evaluate(
      `document.querySelector('[data-service-id="${first}"] .account-card__portrait img')?.src`,
    ),
    ownAvatar,
    'temporary missing thumbnail must not clear an own-account avatar',
  );
  const historyProfile = await evaluate(
    `JSON.parse(JSON.stringify(${service(first)}.accountSnapshot))`,
  );
  const pollIdentity = async () =>
    evaluate(
      `${service(first)}.webview.dispatchEvent(new Event('did-stop-loading'))`,
    );
  for (const [socketState, status] of [
    ['UNPAIRED', 'logged-out'],
    ['TIMEOUT', 'error'],
  ]) {
    await guest(
      first,
      `window.require('WAWebSocketModel').Socket.state=${JSON.stringify(socketState)};true`,
    );
    await pollIdentity();
    await wait(
      `${service(first)}.accountSnapshot.status===${JSON.stringify(status)}`,
      'actual logout/error status',
    );
    assert.equal(
      await evaluate(`${service(first)}.accountSnapshot.phone`),
      historyProfile.phone,
    );
    assert.equal(
      await evaluate(`${service(first)}.accountSnapshot.nickname`),
      historyProfile.nickname,
    );
    assert.equal(
      await evaluate(
        `document.querySelector('[data-service-id="${first}"] .account-card__portrait img')?.src`,
      ),
      ownAvatar,
    );
    assert(
      !(await evaluate(
        `document.querySelector('[data-service-id="${first}"]').textContent.includes('待同步')`,
      )),
    );
  }
  await guest(
    first,
    `window.require('WAWebSocketModel').Socket.state='CONNECTED';fixture.ownPhone='8613800000003';window.require('WAWebConnModel').Conn.pushname='新登录测试账号';true`,
  );
  await pollIdentity();
  await wait(
    `${service(first)}.accountSnapshot.phone==='8613800000003' && ${service(first)}.accountSnapshot.nickname==='新登录测试账号'`,
    'new owner replaces historical phone and nickname',
  );
  assert.equal(
    await evaluate(`${service(first)}.accountSnapshot.avatar`),
    undefined,
    'new owner cannot inherit old owner avatar',
  );
  const storedIdentity = await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-profile','${first}')`,
  );
  assert.equal(storedIdentity.ownerId, '8613800000003@c.us');
  assert.equal(storedIdentity.avatar, undefined);
  const restoredCard = await evaluate(`(async () => {
    const current=${service(first)};
    const restored=new current.constructor({id:current.id,name:'Restored offline card',isEnabled:false},current.recipe);
    for(let i=0;i<40 && !restored.accountSnapshot.ownerId;i+=1) await new Promise(resolve=>setTimeout(resolve,50));
    return JSON.parse(JSON.stringify(restored.accountSnapshot));
  })()`);
  assert.equal(
    restoredCard.phone,
    '8613800000003',
    'a recreated offline card loads its saved identity',
  );
  assert.equal(restoredCard.nickname, '新登录测试账号');
  assert.equal(
    restoredCard.status,
    'loading',
    'history restoration never claims the account is online',
  );
  await guest(
    first,
    `fixture.ownPhone=${JSON.stringify(historyProfile.phone)};fixture.ownAvatar=${JSON.stringify(ownAvatar)};window.require('WAWebConnModel').Conn.pushname=${JSON.stringify(historyProfile.nickname)};true`,
  );
  await pollIdentity();
  await wait(
    `${service(first)}.accountSnapshot.phone===${JSON.stringify(historyProfile.phone)} && !!${service(first)}.accountSnapshot.avatar`,
    'original account can log back into the same card',
  );
  console.log(
    'PASS logout and errors keep historical card identity; new login replaces it without mixing the old avatar',
  );
  await clickText('客户');
  await wait(
    `!!document.querySelector('#customer-remark-name')`,
    'customer panel loaded',
  );
  const fillCustomer = async (selector, value) =>
    evaluate(
      `(()=>{const n=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(n.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
  await fillCustomer('#customer-remark-name', '红色客户备注');
  await fillCustomer('#customer-notes', '仅客户面板显示的长备注');
  await fillCustomer('#customer-email', 'fixture@example.invalid');
  await click('.customer-flag--priority');
  await click('.customer-flag--follow');
  await click('.customer-flag--signup');
  await click('.customer-flag--deposit');
  await wait(
    `document.querySelector('.customer-panel [role=status]')?.textContent.includes('已保存')`,
    'customer autosaved',
  );
  await wait(
    `${service(first)}.unreadDirectMessageCount===7 && ${service(first)}.unreadIndirectMessageCount===0`,
    'actual unread message counts',
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('[data-service-id="${first}"] .account-card__unread')).color`,
    ),
    'rgb(229, 57, 53)',
    'account unread digits are red',
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('[data-service-id="${first}"] .account-card__unread')).backgroundColor`,
    ),
    'rgba(0, 0, 0, 0)',
    'account unread count has no background',
  );
  const unreadStarted = Date.now();
  await guest(first, `fixture.chats[1].set({unreadCount:9});true`);
  await wait(
    `${service(first)}.unreadDirectMessageCount===13`,
    'native unread change immediately reaches the card',
  );
  assert(
    Date.now() - unreadStarted < 800,
    'unread update must bypass the six-second profile poll',
  );
  await guest(first, `fixture.chats[1].set({unreadCount:3});true`);
  await wait(
    `${service(first)}.unreadDirectMessageCount===7`,
    'reading clears live unread totals',
  );
  const backgroundTotal = await evaluate(
    `${service(second)}.unreadDirectMessageCount`,
  );
  const backgroundUnread = await guest(
    second,
    'fixture.chats[1].unreadCount || 0',
  );
  const backgroundStarted = Date.now();
  await guest(second, `fixture.chats[1].set({unreadCount:6});true`);
  await wait(
    `${service(second)}.unreadDirectMessageCount===6`,
    'background account unread updates immediately',
  );
  assert(
    Date.now() - backgroundStarted < 800,
    'background unread bypasses the profile poll',
  );
  await guest(
    second,
    `fixture.chats[1].set({unreadCount:${backgroundUnread}});true`,
  );
  await wait(
    `${service(second)}.unreadDirectMessageCount===${backgroundTotal}`,
    'background read state restored',
  );
  const groupId = await evaluate(
    `document.querySelector('[data-service-id="${first}"]').closest('.account-group').dataset.groupId`,
  );
  const groupSelector = `.account-group[data-group-id="${groupId}"]`;
  const groupTotal = await evaluate(
    `Number(document.querySelector(${JSON.stringify(groupSelector)}+' .account-group__unread').textContent)`,
  );
  const groupBase = groupTotal - 7;
  const firstViewId = await evaluate(
    `${service(first)}.webview.getWebContentsId()`,
  );
  await click(`${groupSelector} .account-group__toggle`);
  await wait(
    `!document.querySelector(${JSON.stringify(groupSelector)}+' .account-group__cards')`,
    'account group collapsed',
  );
  await guest(first, `fixture.chats[1].set({unreadCount:0});true`);
  await wait(
    `document.querySelector(${JSON.stringify(groupSelector)}+' .account-group__unread')?.textContent==='${groupBase + 4}'`,
    'collapsed group total clears read messages',
  );
  await guest(first, `fixture.chats[1].set({unreadCount:-1});true`);
  await wait(
    `${service(first)}.unreadDirectMessageCount===5 && document.querySelector(${JSON.stringify(groupSelector)}+' .account-group__unread')?.textContent==='${groupBase + 5}'`,
    'manual unread adds one to both the account and folded group',
  );
  assert.equal(
    await evaluate(`${service(first)}.webview.getWebContentsId()`),
    firstViewId,
  );
  await guest(first, `fixture.chats[1].set({unreadCount:0});true`);
  await wait(
    `${service(first)}.unreadDirectMessageCount===4`,
    'reading manual unread clears its reminder',
  );
  await guest(first, `fixture.chats[1].set({unreadCount:3});true`);
  await click(`${groupSelector} .account-group__toggle`);
  await wait(
    `!!document.querySelector('[data-service-id="${first}"]') && ${service(first)}.unreadDirectMessageCount===7`,
    'group expanded without resetting live counts',
  );
  await guest(first, `fixture.chats[0].muteExpiration=-1;true`);
  await wait(
    `${service(first)}.unreadDirectMessageCount===3`,
    'muted messages excluded',
  );
  await wait(
    `(async()=>{const v=await ${service(first)}.webview.executeJavaScript(${JSON.stringify(`document.querySelector('[data-id="10002@c.us"][role=row] .zl-chat-note')?.value`)});return v==='红色客户备注'})()`,
    'red remark injected into native row',
  );
  assert.equal(
    await guest(
      first,
      `document.querySelector('#main header').textContent.includes('红色客户备注')`,
    ),
    false,
    'customer remark stays out of the native conversation header',
  );

  assert.equal(
    await guest(
      first,
      `document.body.textContent.includes('仅客户面板显示的长备注')`,
    ),
    false,
  );
  const layout = await guest(
    first,
    `(()=>{const r=document.querySelector('[data-id="10002@c.us"][role=row]');const name=r.querySelector('[title]').getBoundingClientRect();const input=r.querySelector('.zl-chat-note');const note=input.getBoundingClientRect();const preview=r.querySelector('.fixture-preview').getBoundingClientRect();const style=getComputedStyle(input);return [r.getBoundingClientRect().height,name.bottom,note.top,note.bottom,preview.top,name.left,note.left,style.textIndent,style.fontSize,preview.bottom,r.getBoundingClientRect().bottom]})()`,
  );
  assert.equal(layout[0], 72);
  assert(
    layout[1] <= layout[2] && layout[3] <= layout[4],
    JSON.stringify(layout),
  );
  assert(
    layout[2] - layout[1] <= 2 && layout[4] - layout[3] <= 2,
    'name, remark and preview have compact gaps',
  );
  assert(
    Math.abs(layout[5] - layout[6]) < 1,
    'remark aligns with the name despite native row borders',
  );
  assert.equal(layout[7], '0px', 'native input text indentation is reset');
  assert.equal(layout[8], '11px', 'remark stays smaller than the native title');
  assert(
    layout[9] <= layout[10],
    'preview stays inside the original virtual row',
  );
  const compactCheck = `(() => {
    const row=document.querySelector('[data-id="10002@c.us"][role=row]');
    const input=row?.querySelector('.zl-chat-note');
    if(!input)return false;
    const name=row.querySelector('[title]').getBoundingClientRect();
    const note=input.getBoundingClientRect();
    const preview=row.querySelector('.fixture-preview').getBoundingClientRect();
    return note.width>20 && Math.abs(note.left-name.left)<1 &&
      note.top>=name.bottom && note.top-name.bottom<=2 &&
      preview.top>=note.bottom && preview.top-note.bottom<=2;
  })()`;
  const beforeReflow = await guest(first, `window.__zlCustomers.data.revision`);
  await guest(
    first,
    `(() => {
    const style=document.createElement('style');style.id='fixture-delayed-login-layout';
    style.textContent='#side{width:240px}.fixture-chat{border-left-width:13px}.fixture-title{height:26px;font-size:18px}.fixture-preview{margin-top:20px}';
    document.head.append(style);return true;
  })()`,
  );
  await wait(
    `(async()=>await ${service(first)}.webview.executeJavaScript(${JSON.stringify(compactCheck)}))()`,
    'late login styles and sidebar resize automatically recalculate compact remarks',
  );
  assert.equal(
    await guest(first, `window.__zlCustomers.data.revision`),
    beforeReflow,
    'layout reflow does not require a profile edit or page refresh',
  );
  await guest(
    first,
    `document.querySelector('#fixture-delayed-login-layout').remove();true`,
  );
  await wait(
    `(async()=>await ${service(first)}.webview.executeJavaScript(${JSON.stringify(compactCheck)}))()`,
    'restoring native dimensions recalculates layout again',
  );
  console.log(
    'PASS compact alignment survives delayed login styles and sidebar resize without editing data or refreshing',
  );
  assert.equal(
    await guest(
      first,
      `document.querySelectorAll('#main header .zl-customer-flag').length`,
    ),
    4,
  );
  await guest(first, `fixture.openChat('10001@g.us');true`);
  await wait(
    `document.querySelector('.customer-panel')?.textContent.includes('群聊不显示客户资料') && !document.querySelector('#customer-remark-name')`,
    'groups have no customer form',
  );
  await guest(
    first,
    `(()=>{const input=document.querySelector('[data-id="10001@g.us"][role=row] .zl-chat-note');if(input.placeholder!=='添加备注')throw Error('Missing empty inline placeholder');input.focus();input.value='群聊快速备注';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return true})()`,
  );
  await wait(
    `(async()=>{const r=await ${service(first)}.webview.executeJavaScript(${JSON.stringify(`document.querySelector('[data-id="10001@g.us"][role=row] .zl-chat-note')?.dataset.saveState`)});return r==='saved'})()`,
    'group inline note saved without a popup',
  );
  assert.equal(
    await evaluate(`document.querySelectorAll('[role=dialog]').length`),
    0,
  );
  await guest(
    first,
    `fixture.openChat('10002@c.us');fixture.missingChatGetter=true;true`,
  );
  await wait(
    `document.querySelector('#customer-notes')?.value==='仅客户面板显示的长备注'`,
    'private context works with missing native getter',
  );
  const inlinePoint = await evaluate(`(async () => {
    const view=${service(first)}.webview;
    const host=view.getBoundingClientRect();
    const input=await view.executeJavaScript(${JSON.stringify(`(() => {const r=document.querySelector('[data-id="10002@c.us"][role=row] .zl-chat-note').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`)});
    return {x:host.x+input.x,y:host.y+input.y};
  })()`);
  await call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    ...inlinePoint,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  await call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    ...inlinePoint,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  assert(
    await guest(
      first,
      `document.activeElement?.classList.contains('zl-chat-note')`,
    ),
    'real mouse click focuses inline note before native row capture',
  );
  assert.equal(await guest(first, `fixture.nativeNoteInterceptions || 0`), 0);
  await guest(first, `document.activeElement.select();true`);
  await call('Input.insertText', { text: '行内直接修改' });
  await wait(
    `document.querySelector('#customer-remark-name')?.value==='行内直接修改'`,
    'inline autosave synchronizes private customer form',
  );
  assert.equal(
    await guest(
      first,
      `document.activeElement?.classList.contains('zl-chat-note')`,
    ),
    true,
    'autosave does not remove a focused editor',
  );
  await guest(
    first,
    `(()=>{const input=document.querySelector('[data-id="10002@c.us"][role=row] .zl-chat-note');input.value='取消这次修改';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));return true})()`,
  );
  await wait(
    `(async()=>await ${service(first)}.webview.executeJavaScript(${JSON.stringify(`document.querySelector('[data-id="10002@c.us"][role=row] .zl-chat-note')?.value==='行内直接修改'`)}))()`,
    'Escape cancels only the unsaved inline draft',
  );
  await fillCustomer('#customer-remark-name', '红色客户备注');
  await guest(first, `fixture.openChat('10001@g.us');true`);
  await wait(
    `!document.querySelector('#customer-remark-name')`,
    'group customer form stays hidden',
  );
  await click('[aria-label="关闭客户资料"]');
  await guest(
    first,
    `for(let i=3;i<=7;i++)fixture.chats.push({id:{_serialized:(10000+i)+'@c.us',server:'c.us'},name:'置顶客户'+i});fixture.renderChats();true`,
  );
  await guest(
    first,
    `fixture.chats.find(c=>c.id._serialized==='10007@c.us').set({pin:12345});true`,
  );
  await new Promise(resolve => {
    setTimeout(resolve, 1300);
  });
  assert(
    await guest(
      first,
      `!!document.querySelector('[role=row][data-id="10007@c.us"] [data-icon=pinned]')`,
    ),
    'official pin absent from an old local list must not be erased',
  );
  await guest(
    first,
    `fixture.chats.find(c=>c.id._serialized==='10007@c.us').set({pin:0});true`,
  );
  for (const id of [
    '10001@g.us',
    '10002@c.us',
    '10003@c.us',
    '10004@c.us',
    '10005@c.us',
  ]) {
    await wait(
      `(async()=>!!(await ${service(first)}.webview.executeJavaScript(${JSON.stringify(`document.querySelector('[role=row][data-id="${id}"] [data-testid=native-chat-menu]') !== null`)})))()`,
      'native chat menu ready',
    );
    await guest(
      first,
      `(()=>{fixture.barePinItem=${id === '10003@c.us'};fixture.menuRole='${id === '10004@c.us' ? 'button' : 'menuitem'}';fixture.chineseMenu=${id === '10004@c.us'};const menu=document.querySelector('[role=row][data-id="${id}"] [data-testid=native-chat-menu]');if('${id}'==='10004@c.us'){const row=menu.closest('[role=row]');delete row.dataset.id;row.querySelector('[title]').title='not a unique chat title';}menu.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));menu.click();const item=document.querySelector('[data-testid=native-pin-item]');item.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true}));if(item.isConnected)item.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}));if(item.isConnected)item.click();return true})()`,
    );
    await wait(
      `(async()=>{return await ${service(first)}.webview.executeJavaScript("document.querySelector('#pane-side [role=row]')?.dataset.id === '${id}'")})()`,
      'newest pin first',
    );
  }
  // Bypass all DOM event interception, as keyboard/native command actions do.
  // Lazily loaded exports must be hooked before a fourth+ native guard runs.
  await guest(
    first,
    `fixture.barePinItem=false;fixture.loadPinCommands();true`,
  );
  await new Promise(resolve => {
    setTimeout(resolve, 1400);
  });
  for (const id of ['10006@c.us', '10007@c.us']) {
    await guest(first, `fixture.nativePinCommand('${id}').then(()=>true)`);
    await wait(
      `(async()=>await ${service(first)}.webview.executeJavaScript("document.querySelector('#pane-side [role=row]')?.dataset.id === '${id}'"))()`,
      'command pin beyond native limit renders in original list',
    );
  }
  assert.equal(await guest(first, `fixture.nativePinServerCalls || 0`), 0);
  assert.equal(await guest(first, `fixture.nativePinLimitDialogs || 0`), 0);
  assert.equal(
    await guest(first, `require('WAWebFixtureMsgPinAction').getPinLimit()`),
    3,
  );
  assert.equal(
    await guest(
      first,
      `require('WAWebFixtureFrozenChatPinAction').getPinLimit()`,
    ),
    3,
  );
  for (const id of ['10007@c.us', '10006@c.us']) {
    await guest(first, `fixture.nativePinCommand('${id}').then(()=>true)`);
    await wait(
      `(async()=>await ${service(first)}.webview.executeJavaScript(${JSON.stringify(`!document.querySelector('[role=row][data-id="${id}"] [data-icon=pinned]')`)}))()`,
      'native command unpin removes original glyph',
    );
  }
  assert.equal(await guest(first, `fixture.nativePinServerCalls || 0`), 0);
  console.log(
    'PASS native command guard beyond three pins, local unpin, no server pin calls, immutable and message modules preserved',
  );
  const order = await guest(
    first,
    `[...document.querySelectorAll('#pane-side [role=row]')].filter(n=>n.querySelector('[data-icon=pinned]')).map(n=>n.dataset.id)`,
  );
  assert.equal(order.length, 5);
  await guest(first, `fixture.chats.reverse();fixture.renderChats();true`);
  await new Promise(r => {
    setTimeout(r, 1300);
  });
  assert.deepEqual(
    await guest(
      first,
      `[...document.querySelectorAll('#pane-side [role=row]')].filter(n=>n.querySelector('[data-icon=pinned]')).map(n=>n.dataset.id)`,
    ),
    order,
  );
  await shot('/workspace/ZL-WA-customers-pins.png');
  await clickText('客户');
  await guest(first, `fixture.openChat('10002@c.us');true`);
  await wait(
    `document.querySelector('#customer-remark-name')?.value==='红色客户备注'`,
    'contact profile restored',
  );
  assert.equal(
    await guest(
      first,
      `document.querySelectorAll('.zl-local-pins,.zl-chat-actions,.zl-chat-action').length`,
    ),
    0,
  );
  await fillCustomer('#customer-remark-name', '客户面板编辑的备注');
  await wait(
    `document.querySelector('.customer-panel [role=status]')?.textContent.includes('已保存')`,
    'customer remark saved from panel',
  );
  assert.equal(
    await evaluate(`document.querySelector('#customer-notes').value`),
    '仅客户面板显示的长备注',
  );
  await clickText('一键复制');
  const copiedCustomer = await evaluate(
    `require('electron').clipboard.readText()`,
  );
  assert(copiedCustomer.includes('仅客户面板显示的长备注'));
  await guest(
    first,
    `(()=>{const menu=document.querySelector('[role=row][data-id="10005@c.us"] [data-testid=native-chat-menu]');menu.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));menu.click();if(document.querySelector('[role=menuitem]').textContent!=='Unpin chat')throw Error('native menu did not show unpin');document.querySelector('[role=menuitem]').click();return true})()`,
  );
  await wait(
    `(async()=>await ${service(first)}.webview.executeJavaScript("document.querySelectorAll('#pane-side [data-icon=pinned]').length === 4"))()`,
    'native unpin updates original list',
  );
  assert.equal(
    await guest(first, `fixture.nativePinActions || 0`),
    0,
    'server pin actions never invoked',
  );
  // Remount all native rows, like virtual scrolling, without duplicating pins.
  await guest(first, `fixture.renderChats();true`);
  await wait(
    `(async()=>await ${service(first)}.webview.executeJavaScript("document.querySelector('#pane-side [role=row]')?.dataset.id === '10004@c.us'"))()`,
    'native pinned order survives virtual row remount',
  );
  await wait(
    `(async()=>await ${service(first)}.webview.executeJavaScript("[...document.querySelectorAll('#pane-side [role=row]')].every(row=>!!row.querySelector('.zl-chat-note'))"))()`,
    'remarks hydrated after native row remount',
  );
  await shot('/workspace/ZL-WA-customers.png');
  await verifyCustomerCompatibility({ first, service, guest, wait });
  await click(`[data-service-id="${second}"] .account-card__select`);
  await guest(
    second,
    `fixture.ownPhone='8613800000002';fixture.openChat('10002@c.us');true`,
  );
  await wait(
    `document.querySelector('#customer-remark-name')?.value===''`,
    'different WhatsApp account keeps separate profile',
  );
  await click('[aria-label="关闭客户资料"]');
  console.log(
    'PASS own-avatar cache, private context fallback, group form exclusion, inline note Enter/autosave/Escape, multi-labels, layout, profile isolation, pins and unread counts',
  );
  await wait(
    `${service(second)}.accountSnapshot.phone==='8613800000002'`,
    'second account identity ready for group tools',
  );
  await verifyGroups({
    first,
    second,
    guest,
    evaluate,
    wait,
    click,
    clickText,
    call,
    shot,
  });
  // Delete only fixtures created by this run, using the existing real delete action.
  for (const id of ids) {
    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
    );
  }
  assert.deepEqual(
    await evaluate('window.ferdium.stores.services.all.map(s=>s.id)'),
    before,
  );
  console.log(
    'PASS original accounts preserved; all created account fixtures removed',
  );
} catch (error) {
  console.error(error);
  for (const id of ids) {
    console.error(
      'Fixture composer diagnostic',
      await guest(
        id,
        `({status:document.querySelector('#zl-translation-status')?.textContent,editor:document.querySelector('#fixture-media [contenteditable],#fixture-edit [contenteditable]')?.textContent,busy:window.__zlTranslation?.busy,pending:window.__zlTranslation?.pending?.size,approved:!!window.__zlTranslation?.approved})`,
      ).catch(() => ({ unavailable: true })),
    );
  }
  console.error(
    'Dialog diagnostic',
    await evaluate(
      `({notice:document.querySelector('.tools-notice')?.textContent,latest:document.querySelector('.bulk-history tbody tr:first-child')?.textContent,groups:document.querySelector('.group-tools-results')?.textContent})`,
    ),
  );
  for (const id of ids) {
    try {
      console.error(
        'Fixture account diagnostic',
        await evaluate(
          `(()=>{const s=${service(id)};return {id:s.id,enabled:s.isEnabled,loading:s.isLoading,sleep:s.isHibernating,snapshot:{status:s.accountSnapshot.status,unread:s.accountSnapshot.unreadMessages}}})()`,
        ),
      );
      console.error(
        'Fixture page diagnostic',
        await guest(
          id,
          `(()=>{try{return {url:location.href,online:navigator.onLine,socket:window.require?.('WAWebSocketModel')?.Socket?.state,count:fixture.bulk.length}}catch(e){return {error:String(e)}}})()`,
        ),
      );
    } catch {
      /* A disposed fixture cannot be inspected. */
    }
  }
  process.exitCode = 1;
} finally {
  if (groupStateBefore) {
    try {
      await evaluate(
        `(async()=>{const queue=require('./features/groups/runtime').getGroupRuntime(window.ferdium.stores).queue;if(queue.active)throw Error('Group test queue is still active');queue.state=${JSON.stringify(groupStateBefore)};await require('electron').ipcRenderer.invoke('group-tools-save',queue.state);queue.notify();return true})()`,
      );
    } catch (error) {
      console.error('Unable to restore group test state', error);
      process.exitCode = 1;
    }
  }
  if (historyBefore) {
    try {
      await evaluate(
        `(async()=>{const queue=${queueExpression};if(queue.activeId)throw Error('Test queue is still active');const ipc=require('electron').ipcRenderer;await queue.remove(queue.records.map(r=>r.id));for(const record of ${JSON.stringify([...historyBefore].reverse())})await ipc.invoke('account-tools-history',record);queue.records=await ipc.invoke('account-tools-history');queue.notify();return true})()`,
      );
      console.log(
        'PASS original forwarding history restored after isolated GUI tests',
      );
      rmSync(historyBackupPath, { force: true });
    } catch (error) {
      console.error(
        `Unable to restore GUI test history; backup: ${historyBackupPath}`,
        error,
      );
      process.exitCode = 1;
    }
  }
  if (themeBefore) {
    try {
      await evaluate(
        `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(themeBefore)}})`,
      );
    } catch {
      /* Preserve original failure. */
    }
  }
  if (translationColorBefore !== undefined) {
    try {
      await evaluate(
        `window.ferdium.stores.settings._update({type:'app',data:{translationTextColor:${JSON.stringify(translationColorBefore)}}})`,
      );
    } catch {
      /* Preserve original failure. */
    }
  }
  if (sidebarBefore) {
    try {
      await evaluate(
        `window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:${JSON.stringify(sidebarBefore)}}})`,
      );
    } catch {
      /* Keep diagnostic failure visible. */
    }
  }
  try {
    await vm(
      `if(globalThis.__zlOriginalFilePicker){process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').dialog.showOpenDialog=globalThis.__zlOriginalFilePicker;delete globalThis.__zlOriginalFilePicker;}true`,
    );
  } catch {
    /* App may have closed. */
  }
  if (bulkPreferencesBefore)
    try {
      await evaluate(
        `require('electron').ipcRenderer.invoke('account-tools-bulk-preferences',${JSON.stringify(bulkPreferencesBefore)})`,
      );
    } catch {
      /* App may have closed. */
    }
  if (mainPatched)
    try {
      await vm(
        `globalThis.__zlSessionPrototype.fetch=globalThis.__zlToolsFetch;delete globalThis.__zlSessionPrototype;delete globalThis.__zlToolsFetch;delete globalThis.__zlTranslateFail;delete globalThis.__zlTranslationCalls;delete globalThis.__zlLastTranslationInput;globalThis.__zlProxyTLS?.closeAllConnections();globalThis.__zlProxyTLS?.close();globalThis.__zlProxyServer?.closeAllConnections();globalThis.__zlProxyServer?.close();true`,
      );
    } catch {
      /* A failed app connection may already have closed; fixtures remain isolated. */
    }
  for (const id of ids)
    try {
      await evaluate(
        `(async()=>{if(window.ferdium.stores.services.all.some(s=>s.id===${JSON.stringify(id)}))await window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})})()`,
      );
    } catch {
      /* A failed app connection may already have closed; fixtures remain isolated. */
    }
  if (customersBefore !== undefined) {
    try {
      await vm(
        `(()=>{const fs=process.getBuiltinModule('fs');const p=process.getBuiltinModule('path').join(process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').app.getPath('userData'),'customers.json');const saved=${JSON.stringify(customersBefore)};if(saved===null)fs.rmSync(p,{force:true});else fs.writeFileSync(p,Buffer.from(saved,'base64'));return true})()`,
      );
    } catch {
      /* App may have closed. */
    }
  }
  rmSync(tlsDirectory, { recursive: true, force: true });
  socket.close();
}

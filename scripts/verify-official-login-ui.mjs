/* Controlled real-window handoff and sandboxed-frame diagnostics. No phone login is simulated. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, wait, click, socket } from './account-tools-cdp.mjs';
const normalFixture = readFileSync(
  new URL('fixtures/whatsapp-tools.html', import.meta.url),
  'utf8',
);
const loginFixture = `<!doctype html><html><body><div data-testid="qrcode"><canvas width="200" height="200"></canvas></div><button id="qa-complete">Complete controlled fixture</button><script>document.querySelector('#qa-complete').onclick=()=>{window.qaCompletion=(async()=>{localStorage.setItem('qa-official-local','fixture-local');document.cookie='qa-official-auth=fixture-auth;path=/;SameSite=Lax';const db=await new Promise(resolve=>{const r=indexedDB.open('qa-official-db',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);});await new Promise(resolve=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put('fixture-record','auth');tx.oncomplete=resolve;});db.close();document.body.innerHTML='<div id="pane-side">Controlled chat</div><div id="main"><header>Controlled chat</header></div>';return true;})();};</script></body></html>`;
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
let id;
let before;
let report = { realPhonePairingVerified: false };
const svc = () => `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
try {
  await wait(
    'window.ferdium.stores.settings.loaded && window.ferdium.stores.services.allServicesRequest.wasExecuted',
    'app ready',
  );
  before = await evaluate('window.ferdium.stores.services.all.map(s=>s.id)');
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
    'Use isolated QA profile',
  );
  const previousCreated = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result?.data?.id',
  );
  await click('[data-group-id="default"] .account-group__add');
  await wait(
    `!window.ferdium.stores.services.createServiceRequest.isWaitingForResponse&&!!window.ferdium.stores.services.createServiceRequest.result?.data?.id&&window.ferdium.stores.services.createServiceRequest.result.data.id!==${JSON.stringify(previousCreated)}&&!${JSON.stringify(before)}.includes(window.ferdium.stores.services.createServiceRequest.result.data.id)`,
    'new QA service',
  );
  id = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result.data.id',
  );
  await wait(`${svc()} && !!${svc()}.webview`, 'QA webview');
  await evaluate(`${svc()}.isHibernationEnabled=false`);
  await evaluate(`${svc()}.webview.stop()`);
  await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-prepare',${JSON.stringify(id)})`,
  );
  await vm(
    `(async()=>{const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const s=req('electron').session.fromPartition(${JSON.stringify('persist:service-')}+${JSON.stringify(id)});globalThis.__qaOfficialProtocolSession=s;globalThis.__qaOfficialProtocolHits=0;await s.protocol.handle('https',async request=>{globalThis.__qaOfficialProtocolHits++;const u=new URL(request.url);if(u.pathname==='/qa-child')return new Response('<!doctype html><body>正在加载你的对话 PRIVATE_CHAT_SENTINEL</body>',{headers:{'Content-Type':'text/html; charset=utf-8'}});const auth=await s.cookies.get({url:'https://web.whatsapp.com/',name:'qa-official-auth'});return new Response(auth.length?${JSON.stringify(normalFixture)}:${JSON.stringify(loginFixture)},{headers:{'Content-Type':'text/html; charset=utf-8'}});});return true;})()`,
  );
  const fixtureContentsId = await evaluate(
    `${svc()}.webview.getWebContentsId()`,
  );
  const fixtureSession = await vm(
    `(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');const g=e.webContents.fromId(${fixtureContentsId});return {sameSession:g.session===globalThis.__qaOfficialProtocolSession,type:g.getType()};})()`,
  );
  assert(
    fixtureSession.sameSession,
    'Fixture interceptor must target the actual account Session',
  );
  // New service startup may still be finishing its first remote request. Reload
  // after installing the fixture, then verify the actual document, not an old
  // same-URL navigation promise's failure notification.
  await evaluate(`${svc()}.webview.reload()`);
  await wait(
    `${svc()}.webview.executeJavaScript('!!document.querySelector("#qa-complete")')`,
    'controlled login document loaded',
  );
  await wait(
    `${svc()}.accountSnapshot.status==='logged-out'&&!${svc()}.isLoading`,
    'normal UI detects login',
  );
  const contentsId = await evaluate(`${svc()}.webview.getWebContentsId()`);
  const configBefore = await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-get',${JSON.stringify(id)})`,
  );
  const transport = await vm(
    `(async()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');const g=e.webContents.fromId(${contentsId});globalThis.__qaOfficialGuest=g;globalThis.__qaOfficialUA=g.getUserAgent();return {route:await g.session.resolveProxy('https://web.whatsapp.com/'),policy:g.getWebRTCIPHandlingPolicy()};})()`,
  );
  await evaluate(
    `(()=>{const b=document.querySelector('.account-tools button:nth-child(2)');if(b.getAttribute('aria-pressed')!=='true')b.click();})()`,
  );
  await wait(
    "[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='打开官方登录窗口')",
    'visible official-login entry',
  );
  await evaluate(
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='打开官方登录窗口').click()`,
  );
  await wait(
    "document.querySelector('.tools-notice')?.textContent.includes('已打开官方登录窗口')",
    'handoff IPC accepted',
  );
  await wait(
    `window.ferdium.stores.services.one(${JSON.stringify(id)}).webview.getURL()==='about:blank'`,
    'original login paused',
  );
  await vm(
    `(()=>{const e=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');const child=e.BrowserWindow.getAllWindows().find(w=>w.getTitle()==='WhatsApp 官方登录');if(!child)throw Error('Missing login window');globalThis.__qaOfficialWindow=child;return true;})()`,
  );
  const isolated = await vm(
    `(async()=>{const w=globalThis.__qaOfficialWindow;for(let i=0;i<50;i++){if(w.webContents.getURL().startsWith('https://web.whatsapp.com')&&!w.webContents.isLoadingMainFrame())break;await new Promise(r=>setTimeout(r,50));}const p=w.webContents.getLastWebPreferences();const g=globalThis.__qaOfficialGuest;return {sameSession:w.webContents.session===g.session,sameUA:w.webContents.getUserAgent()===globalThis.__qaOfficialUA,policy:w.webContents.getWebRTCIPHandlingPolicy(),preload:!!p.preload,nodeIntegration:p.nodeIntegration,sandbox:p.sandbox,clean:await w.webContents.executeJavaScript('({noAppBridge:typeof window.ferdium==="undefined",noSDK:typeof window.WPP==="undefined",noNode:typeof process==="undefined",noAdapters:!window.__zlTranslation&&!window.__zlCustomerAdapter&&!window.__zlWaUnread})')};})()`,
  );
  assert(
    isolated.sameSession &&
      isolated.sameUA &&
      isolated.sandbox &&
      !isolated.nodeIntegration &&
      !isolated.preload,
  );
  assert.equal(isolated.policy, transport.policy);
  assert(Object.values(isolated.clean).every(Boolean));
  await vm(
    `globalThis.__qaOfficialWindow.webContents.executeJavaScript("document.querySelector('#qa-complete').click();window.qaCompletion")`,
  );
  await vm('globalThis.__qaOfficialWindow.close();true');
  await wait(
    `${svc()}.webview.getURL().startsWith('https://web.whatsapp.com')&&${svc()}.accountSnapshot.status==='online'`,
    'normal features resume from the shared session',
  );
  const retained = await evaluate(
    `${svc()}.webview.executeJavaScript("(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('qa-official-db',1);r.onsuccess=()=>resolve(r.result);});const value=await new Promise(resolve=>{const r=db.transaction('data').objectStore('data').get('auth');r.onsuccess=()=>resolve(r.result);});db.close();return {record:value,local:localStorage.getItem('qa-official-local'),cookie:document.cookie.includes('qa-official-auth=fixture-auth')};})()")`,
  );
  assert.deepEqual(retained, {
    record: 'fixture-record',
    local: 'fixture-local',
    cookie: true,
  });
  assert.deepEqual(
    await evaluate(
      `require('electron').ipcRenderer.invoke('account-tools-get',${JSON.stringify(id)})`,
    ),
    configBefore,
  );
  assert.equal(
    await vm(
      "globalThis.__qaOfficialGuest.session.resolveProxy('https://web.whatsapp.com/')",
    ),
    transport.route,
  );
  const adapters = await evaluate(
    `${svc()}.webview.executeJavaScript('({translation:!!window.__zlTranslation,unread:!!window.__zlWaUnread,customer:!!window.__zlCustomerAdapter})')`,
  );
  assert(adapters.translation && adapters.unread);
  report = {
    ...report,
    sameSession: true,
    sameUA: true,
    sameTransport: true,
    noPreloadOrSDK: true,
    noNodeInLoginWindow: true,
    cookieLocalStorageAndDatabaseRetained: true,
    normalFeaturesRestored: true,
  };
  const frameHtml =
    '<iframe sandbox="allow-scripts" src="https://web.whatsapp.com/qa-child?PRIVATE_TOKEN" style="position:fixed;inset:0;width:100vw;height:100vh;border:0"></iframe>';
  const createFrame =
    'document.body.innerHTML=' + JSON.stringify(frameHtml) + ';true';
  await evaluate(
    `${svc()}.webview.executeJavaScript(${JSON.stringify(createFrame)})`,
  );
  await new Promise(r => setTimeout(r, 350));
  const frames = await evaluate(
    `require('electron').ipcRenderer.invoke('account-tools-proxy-diagnostics',${JSON.stringify(id)},${contentsId})`,
  );
  const child = frames.frameInspection.original.find(
    f => !f.main && f.origin === 'whatsapp-web',
  );
  assert(
    child && child.opaque && child.state?.loadingChats,
    JSON.stringify(frames.frameInspection),
  );
  assert.equal(child.state.storageError, 'SecurityError');
  assert(!/PRIVATE_TOKEN|PRIVATE_CHAT_SENTINEL/.test(JSON.stringify(frames)));
  await assert.rejects(
    () =>
      evaluate(
        `require('electron').ipcRenderer.invoke('account-tools-official-login',${JSON.stringify(id)},${contentsId})`,
      ),
    /仅在二维码/,
  );
  report.sandboxedLoadingFrameRecognized = true;
  report.opaqueStorageRestrictionReported = true;
  report.loadingPageNeverInterrupted = true;
  report.privateFrameContentExcluded = true;
  console.log(
    'PASS real UI official-login handoff: same account Session, proxy, UA and WebRTC policy; no preload/SDK/Node; shared cookie/IDB/localStorage; normal adapters restored; stuck opaque child-frame diagnosed without native module calls or private content',
  );
  console.log(JSON.stringify(report));
} finally {
  if (id) {
    try {
      await vm(
        'globalThis.__qaOfficialWindow&&!globalThis.__qaOfficialWindow.isDestroyed()&&globalThis.__qaOfficialWindow.destroy();true',
      );
    } catch {}
    try {
      await evaluate(
        `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
      );
    } catch {}
    try {
      await vm(
        `process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron').session.fromPartition(${JSON.stringify('persist:service-')}+${JSON.stringify(id)}).protocol.unhandle('https');true`,
      );
    } catch {}
  }
  socket.close();
}

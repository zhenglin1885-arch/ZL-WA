/* eslint-disable no-console, unicorn/consistent-function-scoping -- Offline Chromium surface regression. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const proof = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const root = `${process.cwd()}/build/features/accounts`;
        for (const file of ['sendDiagnostics', 'collectSendDiagnostics'])
          delete req.cache[req.resolve(`${root}/${file}.js`)];
        const { readWhatsAppPageHealth } = req(`${root}/sendDiagnostics.js`);
        const { collectSendDiagnostics } = req(
          `${root}/collectSendDiagnostics.js`,
        );
        const isolated = session.fromPartition(`zl-error-page-${Date.now()}`);
        let html = '';
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(html, { headers: { 'Content-Type': 'text/html' } }),
        );
        const win = new BrowserWindow({
          show: false,
          width: 900,
          height: 700,
          webPreferences: { session: isolated, backgroundThrottling: false },
        });
        const view = {
          executeJavaScript: source =>
            win.webContents.executeJavaScript(source),
          getURL: () => win.webContents.getURL(),
        };
        const service = { isError: false, errorMessage: '', webview: view };
        const health = () =>
          view.executeJavaScript(`(${readWhatsAppPageHealth.toString()})()`);
        const load = async body => {
          html = `<!doctype html><meta charset="utf-8">${body}`;
          await win.loadURL('https://web.whatsapp.com/');
          await view.executeJavaScript(
            `window.WPP={isReady:true,version:'4.7.1',conn:{isAuthenticated:()=>true,isRegistered:()=>true,isMainReady:()=>true,getStreamData:()=>({mode:'MAIN',info:'NORMAL'})},whatsapp:{MsgStore:{models:[]}}};window.require=()=>({Socket:{state:'CONNECTED'}});true`,
          );
        };
        const check = (ok, label) => {
          if (!ok) throw new Error(label);
        };
        try {
          await load('<h1>Sorry, something went wrong.</h1><a>Go Back</a>');
          const error = await collectSendDiagnostics(service, async () => ({
            route: 'PROXY',
          }));
          check(
            error.page.contentFailed &&
              !error.page.loadFailed &&
              error.page.recoveryRecommended,
            'HTTP-loaded error document not detected',
          );
          check(
            error.connection.reason === 'error-document' &&
              !error.connection.sdkReady,
            'stale SDK reported healthy',
          );
          await load(
            '<div id="side">Chats</div><div id="main"><div class="message-in" data-id="false_private"><h1>Sorry, something went wrong.</h1></div><footer><div contenteditable>private draft</div></footer></div>',
          );
          const healthy = await collectSendDiagnostics(
            service,
            async () => ({}),
          );
          check(
            healthy.page.surface.state === 'chat' &&
              healthy.connection.socket === 'CONNECTED' &&
              !healthy.page.recoveryRecommended,
            'message text misidentified as error',
          );
          check(
            !JSON.stringify(healthy).includes('private'),
            'diagnostic leaked draft or identity',
          );
          await view.executeJavaScript(
            `document.body.insertAdjacentHTML('beforeend','<h1>Sorry, something went wrong.</h1>')`,
          );
          const overlay = await health();
          check(
            overlay.state === 'error-overlay' && !overlay.recoveryRecommended,
            'overlay could reload a draft',
          );
          await load(
            '<iframe style="position:fixed;inset:0;width:100vw;height:100vh" srcdoc="<h1>Sorry, something went wrong.</h1>"></iframe>',
          );
          await view.executeJavaScript(
            `new Promise(r=>{const f=document.querySelector('iframe');if(f.contentDocument?.readyState==='complete')r();else f.onload=r})`,
          );
          const framed = await health();
          check(
            framed.state === 'error-frame' && !framed.recoveryRecommended,
            'frame error not detected safely',
          );
          await load(
            '<div id="side">Chats</div><iframe sandbox style="position:fixed;inset:0;width:100vw;height:100vh" srcdoc="<h1>Covered</h1>"></iframe>',
          );
          await view.executeJavaScript(`new Promise(r=>setTimeout(r,50))`);
          const covered = await collectSendDiagnostics(
            service,
            async () => ({}),
          );
          check(
            covered.page.surface.state === 'covered-frame' &&
              covered.connection.reason === 'covered-frame' &&
              !covered.page.recoveryRecommended,
            'unreadable covering frame reported healthy',
          );
          await load('<div id="side">Chats</div>');
          let navigated = false;
          const original = view.executeJavaScript;
          view.executeJavaScript = async source => {
            const result = await original(source);
            if (!navigated) {
              navigated = true;
              await win.loadURL('https://web.whatsapp.com/');
            }
            return result;
          };
          const changed = await collectSendDiagnostics(
            service,
            async () => ({}),
          );
          check(
            changed.page.changedDuringRead &&
              changed.connection.reason === 'page-changed',
            'same-URL navigation retained stale success',
          );
          return {
            errorDocument: true,
            staleSdkMasked: true,
            chatTextExcluded: true,
            draftsProtected: true,
            frameError: true,
            unreadableFrame: true,
            sameUrlNavigation: true,
            privateDataExcluded: true,
          };
        } finally {
          win.destroy();
          isolated.protocol.unhandle('https');
        }
      }})().catch(error => ({error:String(error),stack:error.stack}))`,
    )})`,
  );
  if (proof.error) throw new Error(JSON.stringify(proof));
  for (const value of Object.values(proof)) assert.equal(value, true);
  console.log('PASS offline Chromium WhatsApp error-page diagnostics');
  console.log(JSON.stringify(proof));
} finally {
  socket.close();
}

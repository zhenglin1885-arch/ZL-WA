/* eslint-disable no-console -- Sequential native checks against code extracted from the released executable. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const report = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const oldGuest = req(
          '/tmp/zl-test5-inspect/app.asar/features/accountTools/guest.js',
        );
        const oldLayout = req(
          '/tmp/zl-test5-inspect/app.asar/features/accounts/layout.js',
        );
        for (const name of ['guest', '../accounts/layout']) {
          const path = `${process.cwd()}/build/features/accountTools/${name}.js`;
          delete req.cache[req.resolve(path)];
        }
        const guest = req(
          `${process.cwd()}/build/features/accountTools/guest.js`,
        );
        const layout = req(
          `${process.cwd()}/build/features/accounts/layout.js`,
        );
        const isolated = session.fromPartition(
          `zl-live-adapter-upgrade-${Date.now()}`,
        );
        const html = `<!doctype html><style>*{box-sizing:border-box}body{margin:0}#app{height:100vh;display:flex}#side{width:320px;flex:0 0 320px}#pane-side{height:100%}#main{flex:1;min-width:0}#editor{border:1px solid gray;padding:10px}button{padding:15px}.message-in{height:70px}</style><div id="app"><div id="side"><header><button aria-label="New chat">+</button></header><div id="pane-side"></div></div><div id="main" role="dialog"><h2>Edit message</h2><div class="message-in" data-id="true_PRIVATE_CONTACT"><span class="selectable-text">PRIVATE_MESSAGE_BODY</span></div><div contenteditable="true" id="editor">你好吗</div><button id="save"><span data-icon="checkmark">✓</span></button></div></div><script>window.saved=[];document.querySelector('#save').onclick=()=>saved.push(document.querySelector('#editor').textContent)</script>`;
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(html, {
              headers: { 'Content-Type': 'text/html;charset=utf-8' },
            }),
        );
        const win = new BrowserWindow({
          show: true,
          width: 1000,
          height: 750,
          webPreferences: { session: isolated },
        });
        const execute = code => win.webContents.executeJavaScript(code);
        try {
          await win.loadURL('https://web.whatsapp.com/');
          const config = {
            outgoing: true,
            incoming: true,
            preview: false,
            engine: 'Google',
            receiveEngine: 'Google',
            source: 'auto',
            sendTarget: 'en',
            receiveSource: 'auto',
            receiveTarget: 'zh-CN',
          };
          await execute(
            `window.config=${JSON.stringify(config)};window.oldTick=${oldGuest.translationTick.toString()};window.oldResult=${oldGuest.translationResult.toString()};oldTick(config);document.querySelector('[data-zl-translate]').click();window.incoming=oldTick(config)[0];oldResult(incoming.id,incoming.token,{text:'保留已有译文',error:false});window.oldState=window.__zlTranslation;window.oldToken=oldState.token;window.oldMap=oldState.memo;(${oldLayout.configureWhatsAppLayout.toString()})();window.oldLayoutState=window.__zlChatListLayout;oldLayoutState.apply(300,true);true`,
          );
          await execute(
            `window.tick=${guest.translationTick.toString()};window.deliver=${guest.translationResult.toString()};window.layout=${layout.configureWhatsAppLayout.toString()};tick(config);tick(config);layout();layout();true`,
          );
          const snapshot = await execute(
            `({translationRevision:window.__zlTranslation.revision,retired:oldState.config.outgoing===false,cacheRetained:oldMap===window.__zlTranslation.memo,oldLabelRestored:document.querySelector('[data-zl-translation-text]')?.textContent,layoutReused:oldLayoutState===window.__zlChatListLayout,width:document.querySelector('#side').getBoundingClientRect().width,styles:document.querySelectorAll('#zl-whatsapp-layout-style').length,listeners:window.__zlTranslation.listeners.length})`,
          );
          const diagnostic = await execute(
            `(${guest.translationSurfaceDiagnostics.toString()})()`,
          );
          const safe = JSON.stringify(diagnostic);
          if (
            safe.includes('PRIVATE_MESSAGE_BODY') ||
            safe.includes('PRIVATE_CONTACT') ||
            safe.includes('你好吗')
          )
            throw new Error('Diagnostic leaked user content');
          await execute(`document.querySelector('#save').click();true`);
          const jobs = await execute('tick(config)');
          if (
            jobs.length !== 1 ||
            jobs[0].text !== '你好吗' ||
            (await execute('saved.length'))
          )
            throw new Error('Upgrade duplicated handlers or sent source');
          const [job] = jobs;
          if (
            await execute(
              `deliver(${job.id},oldToken,{text:'WRONG OLD RESULT',error:false})`,
            )
          )
            throw new Error('Retired token accepted');
          if (
            await execute(
              `document.querySelector('#editor').textContent!=='你好吗'`,
            )
          )
            throw new Error('Late old result overwrote draft');
          const args = `${job.id},${JSON.stringify(job.token)},{text:'How are you?',error:false}`;
          if (!(await execute(`deliver(${args},'prepare')`)))
            throw new Error('Upgraded editor cannot select text');
          await win.webContents.insertText('How are you?');
          await execute(
            `deliver(${args},'complete');document.querySelector('#save').click();true`,
          );
          const saved = await execute('saved');
          if (saved.length !== 1 || saved[0] !== 'How are you?')
            throw new Error('Upgraded edit did not save translated text');
          await execute(
            `document.querySelector('#zl-whatsapp-layout-style').remove();layout();true`,
          );
          snapshot.styleRepaired = await execute(
            `document.querySelectorAll('#zl-whatsapp-layout-style').length===1`,
          );
          snapshot.diagnosticPrivate = true;
          const [translated] = saved;
          snapshot.saved = translated;
          return snapshot;
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )} )`,
  );
  assert.equal(report.translationRevision, 8);
  assert(
    report.retired &&
      report.cacheRetained &&
      report.layoutReused &&
      report.styleRepaired &&
      report.diagnosticPrivate,
  );
  assert.equal(report.oldLabelRestored, '保留已有译文');
  assert.equal(report.width, 300);
  assert.equal(report.styles, 1);
  assert.equal(report.saved, 'How are you?');
  console.log(
    'PASS live upgrade from released test-5 code preserves cached translations/draft/width, replaces obsolete hooks once, repairs styles, and excludes private content from diagnostics',
    report,
  );
} finally {
  socket.close();
}

/* eslint-disable no-console, no-await-in-loop -- Sequential native resize and seam checks. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const results = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const path = `${process.cwd()}/build/features/accounts/layout.js`;
        delete req.cache[req.resolve(path)];
        const layout = req(path).configureWhatsAppLayout;
        const isolated = session.fromPartition(`zl-nested-seams-${Date.now()}`);
        let html = '';
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(html, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }),
        );
        const win = new BrowserWindow({
          show: true,
          width: 1000,
          height: 750,
          webPreferences: { session: isolated },
        });
        const execute = code => win.webContents.executeJavaScript(code);
        const reports = [];
        try {
          for (const mode of ['light', 'dark']) {
            html = `<!doctype html><style>*{box-sizing:border-box}body{margin:0}#app{display:flex;width:100vw;height:100vh;background:${mode === 'light' ? '#f8f6f3' : '#1c2021'}}#side{width:400px;flex:0 0 400px;background:${mode === 'light' ? 'white' : '#151515'}}header{height:65px}#pane{position:relative;flex:1;min-width:0}#shell{height:100%;border-inline-start:1px solid #ddd!important}#shell::after{content:'';position:absolute;top:0;bottom:0;left:120px;width:1px;background:#aaa}#old-line{position:absolute;top:0;bottom:0;left:80px;width:1px;background:#ccc!important}#other-panel{position:absolute;left:350px;top:0;height:100%;width:200px;border-left:1px solid purple}#message{position:absolute;top:250px;left:200px;width:180px;height:80px;border:1px solid green}button{padding:16px}</style><div id="app"><div id="side"><header><button aria-label="New chat">+</button></header><div id="pane-side"></div></div><div id="pane"><div id="shell"><div id="old-line"></div><div id="other-panel"></div><div id="message">Preserve this border</div></div></div></div>`;
            await win.loadURL('https://web.whatsapp.com/');
            const before = await execute(
              `({color:getComputedStyle(document.querySelector('#shell')).borderLeftColor,line:getComputedStyle(document.querySelector('#old-line')).backgroundColor})`,
            );
            if (
              before.color === 'rgba(0, 0, 0, 0)' ||
              before.line === 'rgba(0, 0, 0, 0)'
            )
              throw new Error('Fixture lacks original visible seams');
            await execute(
              `localStorage.removeItem('zl-chat-list-width');(${layout.toString()})();true`,
            );
            const point = await execute(
              `(()=>{const r=document.querySelector('[data-zl-chat-divider]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+180}})()`,
            );
            for (const event of [
              { type: 'mouseDown', ...point, button: 'left', clickCount: 1 },
              {
                type: 'mouseMove',
                x: point.x - 100,
                y: point.y,
                button: 'left',
                modifiers: ['leftButtonDown'],
              },
              {
                type: 'mouseUp',
                x: point.x - 100,
                y: point.y,
                button: 'left',
                clickCount: 1,
              },
            ])
              win.webContents.sendInputEvent(event);
            await execute(
              'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
            );
            const after = await execute(
              `(()=>{const shell=document.querySelector('#shell');const line=document.querySelector('#old-line');const message=document.querySelector('#message');return{list:document.querySelector('#side').getBoundingClientRect().width,border:getComputedStyle(shell).borderLeftColor,pseudo:getComputedStyle(shell,'::after').backgroundColor,line:getComputedStyle(line).backgroundColor,message:getComputedStyle(message).borderLeftColor,otherPanel:getComputedStyle(document.querySelector('#other-panel')).borderLeftColor,outer:document.querySelector('#app').getBoundingClientRect().width}})()`,
            );
            reports.push({ mode, ...after });
          }
          return reports;
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )} )`,
  );
  for (const r of results) {
    assert.equal(r.list, 300);
    for (const key of ['border', 'pseudo', 'line'])
      assert.equal(
        r[key],
        'rgba(0, 0, 0, 0)',
        `${r.mode} ${key} must be invisible after dragging`,
      );
    assert.equal(r.message, 'rgb(0, 128, 0)');
    assert.equal(r.otherPanel, 'rgb(128, 0, 128)');
    assert.equal(r.outer, 1000);
  }
  console.log(
    'PASS native light/dark drag removes nested logical borders, old-position separators and pseudo lines while preserving message borders and app bounds',
    results,
  );
} finally {
  socket.close();
}

/* eslint-disable no-console, no-await-in-loop -- Trusted sequential drag checks against captured WhatsApp drawer geometry. */
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
        const current = req(path).configureWhatsAppLayout;
        const released = req(
          '/tmp/zl-test5-inspect/app.asar/features/accounts/layout.js',
        ).configureWhatsAppLayout;
        const isolated = session.fromPartition(`zl-drawer-seam-${Date.now()}`);
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
          width: 1134,
          height: 1115,
          webPreferences: { session: isolated },
        });
        const execute = code => win.webContents.executeJavaScript(code);
        const frame = () => execute('new Promise(r=>requestAnimationFrame(r))');
        const reports = [];
        try {
          for (const mode of ['light', 'dark']) {
            for (const screen of ['welcome', 'chat']) {
              for (const version of ['released', 'current']) {
                const background = mode === 'light' ? '#f7f5f3' : '#1c2021';
                // The independent drawer layer precedes the real panes. Its
                // native width does not follow the resized list, just as in
                // the supplied full-page diagnostic. It cannot be hit-tested.
                html = `<!doctype html><style>*{box-sizing:border-box}body{margin:0}#app{position:relative;display:flex;width:100vw;height:100vh;background:${background}}nav{width:64px;flex:0 0 64px}#overlay{position:absolute;left:64px;right:0;top:0;bottom:0;display:flex;pointer-events:none;z-index:2}#drawer-left{flex:0 0 40vw;border-left:.8px solid rgba(0,0,0,.1)}#drawer{flex:1;border-inline-start:.8px solid rgba(0,0,0,.1)!important;overflow:hidden;position:relative;background:transparent;transform:matrix(1,0,0,1,0,0)}#drawer>span{position:absolute;inset:0}#list{display:flex;flex-direction:column;width:40vw;flex:0 0 40vw}#side{height:100%;width:100%}header{height:64px}#pane{flex:1;min-width:0;position:relative}#message{position:absolute;top:250px;left:180px;width:180px;height:80px;border:1px solid green}#other{position:absolute;right:0;top:0;height:100%;width:120px;border-left:1px solid purple}button{padding:15px}</style><div id="app"><nav></nav><div id="overlay"><div id="drawer-left" data-testid="drawer-left"><span></span></div><div id="drawer" data-testid="drawer-middle"><span></span></div></div><div id="list"><div id="side"><header><button aria-label="New chat">+</button></header><div id="pane-side"></div></div></div><div id="pane">${screen === 'chat' ? '<main id="main" data-testid="conversation-panel-wrapper"><div id="message">Preserve this border</div></main>' : '<div id="welcome">Voice and video calling is now available</div>'}<div id="other"></div></div></div>`;
                await win.loadURL('https://web.whatsapp.com/');
                const snapshot = `(()=>{const d=document.querySelector('#drawer'),p=document.querySelector('#pane'),c=document.querySelector('#list');return{list:c.getBoundingClientRect().width,boundary:p.getBoundingClientRect().left,drawerX:d.getBoundingClientRect().left,drawerWidth:d.getBoundingClientRect().width,drawerBorder:getComputedStyle(d).borderLeftColor,drawerBorderWidth:getComputedStyle(d).borderLeftWidth,drawerBackground:getComputedStyle(d).backgroundColor,drawerContent:d.innerHTML,navBorder:getComputedStyle(document.querySelector('#drawer-left')).borderLeftColor,outer:document.querySelector('#app').getBoundingClientRect().width,other:getComputedStyle(document.querySelector('#other')).borderLeftColor,message:document.querySelector('#message')?getComputedStyle(document.querySelector('#message')).borderLeftColor:null}})()`;
                const before = await execute(snapshot);
                await execute(
                  `localStorage.removeItem('zl-chat-list-width');window.layout=${(version === 'released' ? released : current).toString()};layout();true`,
                );
                for (const target of [342, 580]) {
                  const start = await execute(
                    `(()=>{const r=document.querySelector('[data-zl-chat-divider]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:180,width:document.querySelector('#list').getBoundingClientRect().width}})()`,
                  );
                  const endX = Math.round(start.x + target - start.width);
                  const events = [
                    { type: 'mouseMove', x: start.x, y: start.y },
                    {
                      type: 'mouseDown',
                      x: start.x,
                      y: start.y,
                      button: 'left',
                      clickCount: 1,
                    },
                    {
                      type: 'mouseMove',
                      x: endX,
                      y: start.y,
                      button: 'left',
                      modifiers: ['leftButtonDown'],
                    },
                    {
                      type: 'mouseUp',
                      x: endX,
                      y: start.y,
                      button: 'left',
                      clickCount: 1,
                    },
                  ];
                  win.webContents.focus();
                  for (const event of events) {
                    win.webContents.sendInputEvent(event);
                    await frame();
                  }
                  const after = await execute(snapshot);
                  // Check rendered pixels too: transparent computed styles
                  // alone do not prove that the visible line disappeared.
                  const image = await win.webContents.capturePage();
                  const { width } = image.getSize();
                  const pixels = image.toBitmap();
                  const scale = width / (await execute('innerWidth'));
                  const y = Math.round(150 * scale);
                  const x = Math.floor(before.drawerX * scale);
                  const reference = (y * width + x + 6) * 4;
                  let lineVisible = false;
                  for (let offset = -1; offset <= 2; offset += 1) {
                    const candidate = (y * width + x + offset) * 4;
                    for (let channel = 0; channel < 3; channel += 1)
                      if (
                        pixels[candidate + channel] !==
                        pixels[reference + channel]
                      )
                        lineVisible = true;
                  }
                  after.lineVisible = lineVisible;
                  reports.push({
                    mode,
                    screen,
                    version,
                    target,
                    before,
                    after,
                  });
                }
                if (version === 'current') {
                  // Opening a drawer must preserve its content, geometry,
                  // background and controls while the separator stays hidden.
                  const active = await execute(
                    `(()=>{const d=document.querySelector('#drawer');d.style.backgroundColor='white';d.innerHTML='<button id="drawer-close">Close</button><div contenteditable="true">Preserve caption</div>';layout();const result={border:getComputedStyle(d).borderLeftColor,text:d.textContent,background:getComputedStyle(d).backgroundColor,x:d.getBoundingClientRect().left};document.body.append(d);layout();result.restored=getComputedStyle(d).borderLeftColor;return result})()`,
                  );
                  if (
                    active.border !== 'rgba(0, 0, 0, 0)' ||
                    active.text !== 'ClosePreserve caption' ||
                    active.background !== 'rgb(255, 255, 255)' ||
                    active.restored !== before.drawerBorder
                  )
                    throw new Error(
                      `Drawer content or reversible styling failed: ${JSON.stringify(active)}`,
                    );
                }
              }
            }
          }
          return reports;
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )} )`,
  );
  for (const { mode, screen, version, target, before, after } of results) {
    assert.equal(after.list, target, `${mode}/${screen}/${version} drag`);
    assert.equal(after.boundary, 64 + target);
    assert.equal(
      after.drawerX,
      version === 'released' ? before.drawerX : after.boundary,
      'drawer follows the resized pane boundary',
    );
    assert.equal(
      after.drawerWidth,
      version === 'released'
        ? before.drawerWidth
        : after.outer - after.boundary,
    );
    assert.equal(after.drawerBorderWidth, before.drawerBorderWidth);
    assert.equal(after.drawerBackground, before.drawerBackground);
    assert.equal(after.drawerContent, before.drawerContent);
    assert.equal(
      after.navBorder,
      before.navBorder,
      'navigation border preserved',
    );
    assert.equal(after.outer, before.outer, 'app bounds preserved');
    assert.equal(after.other, 'rgb(128, 0, 128)');
    if (screen === 'chat') assert.equal(after.message, 'rgb(0, 128, 0)');
    assert.equal(
      after.lineVisible,
      version === 'released',
      'rendered old-position line',
    );
    assert.equal(
      after.drawerBorder,
      version === 'released' ? before.drawerBorder : 'rgba(0, 0, 0, 0)',
      `${mode}/${screen}: published code reproduces the stale border; fixed code hides it`,
    );
  }
  console.log(
    'PASS captured external drawer seam: published failure versus fixed code, light/dark, welcome/chat, narrow/wide drags, drawer content and reversible styling',
  );
  console.log(
    JSON.stringify(
      results.map(({ mode, screen, version, target, after }) => ({
        mode,
        screen,
        version,
        target,
        boundary: after.boundary,
        oldLine: after.drawerX,
        color: after.drawerBorder,
      })),
    ),
  );
} finally {
  socket.close();
}

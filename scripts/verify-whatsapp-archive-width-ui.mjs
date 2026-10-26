/* eslint-disable no-console, no-await-in-loop -- Native archive navigation and resizing in disposable Chromium sessions. */
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
        const fixed = req(path).configureWhatsAppLayout;
        const released = req(
          '/tmp/zl-test6-inspect/app.asar/features/accounts/layout.js',
        ).configureWhatsAppLayout;
        const isolated = session.fromPartition(
          `zl-archive-width-${Date.now()}`,
        );
        let html = '';
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(html, {
              headers: { 'Content-Type': 'text/html;charset=utf-8' },
            }),
        );
        const win = new BrowserWindow({
          show: true,
          width: 1280,
          height: 900,
          webPreferences: { session: isolated },
        });
        const execute = code => win.webContents.executeJavaScript(code);
        const frame = () =>
          execute(
            'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
          );
        const click = async selector => {
          const point = await execute(
            `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
          );
          win.webContents.focus();
          await frame();
          win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
          await frame();
          for (const type of ['mouseDown', 'mouseUp']) {
            win.webContents.sendInputEvent({
              type,
              ...point,
              button: 'left',
              clickCount: 1,
            });
            await frame();
          }
        };
        const snapshot = `(()=>{const box=s=>document.querySelector(s).getBoundingClientRect().toJSON();return{list:box('#list'),pane:box('#pane'),archive:box('[data-testid="drawer-left"]'),drawerPane:box('[data-testid="drawer-middle"]'),row:box('[data-chat="archived-A"]'),body:box('#app'),selected:window.selected,stored:localStorage.getItem('zl-chat-list-width'),draft:document.querySelector('#draft').textContent,cache:localStorage.getItem('qa-cache'),seam:getComputedStyle(document.querySelector('[data-testid="drawer-middle"]')).borderLeftColor}})()`;
        const reports = [];
        try {
          for (const mode of ['light', 'dark']) {
            for (const version of ['released', 'fixed', 'upgraded']) {
              await win.setSize(1280, 900);
              const background = mode === 'light' ? '#fff' : '#151515';
              html = `<!doctype html><style>*{box-sizing:border-box}body{margin:0}#app{position:relative;display:flex;height:100vh;width:100vw}nav{flex:0 0 64px}#list{flex:0 0 40vw;width:40vw}#side{height:100%}header{height:64px}#pane{flex:1;min-width:0;background:${background}}#overlay{position:absolute;left:64px;right:0;top:0;bottom:0;display:flex;pointer-events:none;z-index:2}#overlay.open>[data-testid="drawer-left"]{pointer-events:auto;background:${background}}[data-testid="drawer-left"]{flex:0 0 40vw;width:40vw;overflow:hidden}[data-testid="drawer-middle"]{flex:1;min-width:0;border-left:1px solid gray}#archive-content{visibility:hidden}#overlay.open #archive-content{visibility:visible}#archive-scroll{height:calc(100vh - 64px);overflow:auto}.row{display:block;width:100%;height:80px;white-space:nowrap;overflow:hidden}button{padding:15px}#archive-tail{height:1400px}</style><div id="app"><nav></nav><div id="overlay"><div data-testid="drawer-left"><div id="archive-content"><header><button id="back">Back</button>Archived</header><div id="archive-scroll"><button class="row" data-chat="archived-A">Archived conversation A — preserve preview and unread count 2</button><button class="row" data-chat="archived-B">Archived conversation B</button><div id="archive-tail"></div></div></div></div><div data-testid="drawer-middle"></div></div><div id="list"><div id="side"><header><button aria-label="New chat">+</button></header><button id="open-archive" data-testid="chatlist-panel-archived-button">Archived</button><div id="pane-side"></div></div></div><div id="pane"><div id="main">Chat content remains visible</div><div id="draft" contenteditable="true">Preserve draft</div></div></div><script>window.selected='';document.querySelector('#open-archive').onclick=()=>document.querySelector('#overlay').classList.add('open');document.querySelector('#overlay').onclick=e=>{if(e.target.closest('#back'))document.querySelector('#overlay').classList.remove('open');const row=e.target.closest('[data-chat]');if(row)window.selected=row.dataset.chat}</script>`;
              await win.loadURL('https://web.whatsapp.com/');
              await execute(
                `localStorage.setItem('zl-chat-list-width','342');localStorage.setItem('qa-cache','Keep cached translation');window.layout=${(version === 'fixed' ? fixed : released).toString()};layout();true`,
              );
              if (version === 'upgraded') {
                // Upgrade an already rendered old page, matching a running
                // account rather than racing its first layout frame.
                await frame();
                await execute(
                  `window.layout=${fixed.toString()};layout();true`,
                );
              }
              if (version !== 'released') {
                const before = await execute(snapshot);
                await click('[data-zl-chat-resize]');
                await click('[data-zl-chat-resize]');
                for (const keyCode of [
                  'Enter',
                  'Space',
                  'ArrowLeft',
                  'ArrowRight',
                ]) {
                  await execute(
                    'document.querySelector("[data-zl-chat-resize]").focus();true',
                  );
                  for (const type of ['keyDown', 'keyUp']) {
                    win.webContents.sendInputEvent({ type, keyCode });
                    await frame();
                  }
                }
                const after = await execute(snapshot);
                if (
                  after.list.width !== before.list.width ||
                  after.stored !== before.stored
                )
                  throw new Error(
                    `${mode}/${version}: non-drag input changed width or preference ${JSON.stringify({ before: before.list.width, after: after.list.width, storedBefore: before.stored, storedAfter: after.stored, revision: await execute('window.__zlChatListLayout.revision') })}`,
                  );
                reports.push({
                  mode,
                  version,
                  action: 'click-and-keys-do-not-resize',
                  result: after,
                });
              }
              await click('#open-archive');
              reports.push({
                mode,
                version,
                action: 'open-after-cached-width',
                result: await execute(snapshot),
              });
              await click('[data-chat="archived-A"]');
              reports.push({
                mode,
                version,
                action: 'select-archived-chat',
                result: await execute(snapshot),
              });
              await click('#back');
              await execute('window.__zlChatListLayout.apply(580);true');
              await click('#open-archive');
              reports.push({
                mode,
                version,
                action: 'reopen-after-width-change',
                result: await execute(snapshot),
              });
              if (version !== 'released') {
                // Resize while the archive drawer is open using trusted events.
                const start = await execute(
                  `(()=>{const r=document.querySelector('[data-zl-chat-divider]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:200}})()`,
                );
                for (const event of [
                  {
                    type: 'mouseDown',
                    ...start,
                    button: 'left',
                    clickCount: 1,
                  },
                  {
                    type: 'mouseMove',
                    x: start.x - 130,
                    y: start.y,
                    button: 'left',
                    modifiers: ['leftButtonDown'],
                  },
                  {
                    type: 'mouseUp',
                    x: start.x - 130,
                    y: start.y,
                    button: 'left',
                    clickCount: 1,
                  },
                ]) {
                  win.webContents.sendInputEvent(event);
                  await frame();
                }
                reports.push({
                  mode,
                  version,
                  action: 'drag-while-archived',
                  result: await execute(snapshot),
                });
                await click('[data-chat="archived-B"]');
                reports.push({
                  mode,
                  version,
                  action: 'switch-archived-chat',
                  result: await execute(snapshot),
                });
                await win.setSize(900, 760);
                await frame();
                reports.push({
                  mode,
                  version,
                  action: 'window-resize',
                  result: await execute(snapshot),
                });
                await execute(
                  `(()=>{const d=document.querySelector('[data-testid="drawer-left"]');d.replaceWith(d.cloneNode(true));document.querySelector('#archive-scroll').scrollTop=300})()`,
                );
                await frame();
                reports.push({
                  mode,
                  version,
                  action: 'archive-remount',
                  result: await execute(snapshot),
                });
                if (
                  (await execute(
                    'document.querySelector("#archive-scroll").scrollTop',
                  )) !== 300
                )
                  throw new Error('Archive synchronization reset scrolling');
                const restored = await execute(
                  `(()=>{const left=document.querySelector('[data-testid="drawer-left"]');document.body.append(left);layout();return{marked:left.hasAttribute('data-zl-chat-drawer-column'),width:left.style.getPropertyValue('--zl-chat-drawer-width')}})()`,
                );
                if (restored.marked || restored.width)
                  throw new Error('Detached drawer keeps sizing overrides');
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
  console.log(
    JSON.stringify(
      results.map(({ mode, version, action, result }) => ({
        mode,
        version,
        action,
        selected: result.selected,
        list: result.list.width,
        archive: result.archive.width,
        chatStart: result.pane.left,
        archiveEnd: result.archive.right,
      })),
    ),
  );
  for (const { mode, version, action, result: r } of results) {
    assert.equal(r.draft, 'Preserve draft');
    assert.equal(r.cache, 'Keep cached translation');
    assert.equal(r.seam, 'rgba(0, 0, 0, 0)', 'seam remains hidden');
    if (action === 'select-archived-chat')
      assert.equal(r.selected, 'archived-A', `${mode}/${version}/${action}`);
    if (action === 'switch-archived-chat')
      assert.equal(r.selected, 'archived-B');
    if (version === 'released') {
      assert.notEqual(
        r.archive.width,
        r.list.width,
        'test-6 reproduces archive width mismatch',
      );
    } else {
      assert.equal(
        r.archive.width,
        r.list.width,
        `${mode}/${action} archive width`,
      );
      assert.equal(
        r.archive.right,
        r.pane.left,
        `${mode}/${action} no chat overlap`,
      );
      assert.equal(r.drawerPane.left, r.pane.left);
      assert.equal(r.drawerPane.right, r.pane.right);
      assert(r.row.right <= r.pane.left, 'archived rows fit the current list');
      if (action === 'drag-while-archived') assert.equal(r.list.width, 450);
      if (action === 'drag-while-archived') assert.equal(r.stored, '450');
    }
  }
  console.log(
    'PASS archive width sync: published test-6 mismatch reproduced; fixed cached width, open/back/reopen, trusted drag, chat selection, window resize, remount, scrolling, reversible styling and cache/draft preservation',
  );
} finally {
  socket.close();
}

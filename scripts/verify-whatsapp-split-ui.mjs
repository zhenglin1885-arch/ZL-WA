/* eslint-disable no-console, no-await-in-loop -- Sequential real Chromium drag regression. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const reports = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const path = `${process.cwd()}/build/features/accounts/layout.js`;
        delete req.cache[req.resolve(path)];
        const { configureWhatsAppLayout } = req(path);
        const partition = `zl-whatsapp-split-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        const observations = [];
        let html = '';
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(html, { headers: { 'Content-Type': 'text/html' } }),
        );
        const win = new BrowserWindow({
          show: true,
          width: 1100,
          height: 750,
          webPreferences: { partition },
        });
        const exec = async code => {
          const reply = await win.webContents.executeJavaScript(
            `(async()=>{try{return {ok:true,value:await eval(${JSON.stringify(code)})}}catch(error){return {ok:false,error:String(error.stack||error)}}})()`,
          );
          if (!reply.ok) throw new Error(reply.error);
          return reply.value;
        };
        const drag = async (delta, fromDivider = false) => {
          const p = await exec(
            `(()=>{const r=document.querySelector(${JSON.stringify(fromDivider ? '[data-zl-chat-divider]' : '[data-zl-chat-resize]')}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
          );
          win.webContents.sendInputEvent({
            type: 'mouseDown',
            ...p,
            button: 'left',
            clickCount: 1,
          });
          await exec('true');
          win.webContents.sendInputEvent({
            type: 'mouseMove',
            x: p.x + delta,
            y: p.y,
            button: 'left',
            modifiers: ['leftButtonDown'],
          });
          await exec(
            `(()=>{const line=getComputedStyle(document.querySelector('[data-zl-chat-divider]'));if(line.backgroundColor!=='rgba(0, 0, 0, 0)'||line.boxShadow!=='none'||parseFloat(line.borderLeftWidth)!==0)throw Error('Divider must stay invisible while dragging');return true})()`,
          );
          win.webContents.sendInputEvent({
            type: 'mouseUp',
            x: p.x + delta,
            y: p.y,
            button: 'left',
            clickCount: 1,
          });
          await exec(
            '(async()=>{for(let i=0;i<30&&window.__zlChatListLayout.drag;i++)await new Promise(r=>setTimeout(r,10));return true})()',
          );
        };
        try {
          for (const variant of [
            'padded-flex-welcome',
            'grid-welcome',
            'flex-chat',
            'headerless',
            'no-side-id',
          ]) {
            win.setContentSize(1100, 750);
            const grid = variant === 'grid-welcome';
            const nativeHeader =
              variant === 'headerless' || variant === 'no-side-id'
                ? 'div class="wa-head"'
                : 'header';
            const closeHeader = nativeHeader.startsWith('div')
              ? 'div'
              : 'header';
            html = `<!doctype html><style>
          *{box-sizing:border-box}body{margin:0;display:flex;height:100vh}
          #software-accounts{width:140px;flex:none}#software-tools{width:60px;flex:none}
          #guest{flex:1;min-width:0}#app{height:100%;width:100%;display:${grid ? 'grid' : 'flex'};${grid ? 'grid-template-columns:48px 280px minmax(0,1fr)' : ''}}
          #wa-nav{width:48px;flex:0 0 48px}#list-col{overflow:hidden;width:280px;flex:0 0 280px;padding:8px;border:3px solid gray;min-width:280px}
          #side,.qa-side{width:280px;height:100%;display:flex;flex-direction:column}header,.wa-head{height:72px;flex:none;display:flex;align-items:center;justify-content:space-between;background:#202c33;color:white}
          #chat-pane,#welcome-pane{height:100%;min-width:400px;width:calc(100% - 328px);flex:0 0 calc(100% - 328px);background:#eee;border-left:1px solid #555;box-shadow:inset 1px 0 #555;position:relative}#chat-pane::before,#welcome-pane::before{content:"";position:absolute;left:0;top:0;height:100%;border-left:1px solid #555}
          </style><div id="software-accounts">Software accounts</div><div id="guest"><div id="app"><div id="wa-nav">WA nav</div><div id="list-col" data-testid="chat-list-pane"><div id="${variant === 'no-side-id' ? 'new-side' : 'side'}" class="qa-side"><${nativeHeader}><span>WhatsApp</span><button id="new-chat" aria-label="New chat">+</button></${closeHeader}><div id="pane-side" style="flex:1">Chat list</div></div></div><div id="${variant === 'flex-chat' ? 'chat-pane' : 'welcome-pane'}">Conversation or welcome</div></div></div><div id="software-tools">Software tools</div>`;
            await win.loadURL('https://web.whatsapp.com/');
            await exec(
              `window.__qaConfigure=${configureWhatsAppLayout.toString()};window.__qaConfigure();document.querySelector('header,.wa-head').addEventListener('pointerdown',e=>e.stopImmediatePropagation(),true);true`,
            );
            const geometry = () =>
              exec(
                `(()=>{const box=id=>{const r=(id==='side'?document.querySelector('#side,.qa-side'):document.getElementById(id)).getBoundingClientRect();return {x:r.x,right:r.right,width:r.width}};const state=window.__zlChatListLayout;return {column:box('list-col'),side:box('side'),pane:box('${variant === 'flex-chat' ? 'chat-pane' : 'welcome-pane'}'),app:box('app'),guest:box('guest'),accounts:box('software-accounts'),tools:box('software-tools'),stored:localStorage.getItem('zl-chat-list-width'),selected:state.column.id,grid:state.split?.dataset.zlChatGrid}})()`,
              );
            win.webContents.sendInputEvent({
              type: 'mouseMove',
              x: 30,
              y: 100,
            });
            await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
            await exec(
              `(()=>{const b=document.querySelector('[data-zl-chat-resize]');if(getComputedStyle(b).opacity!=='0')throw Error('Handle must hide away from divider');return true})()`,
            );
            const edge = await exec(
              `(()=>{const r=document.querySelector('#list-col').getBoundingClientRect();return {x:Math.round(r.right),y:Math.round(r.top+200)}})()`,
            );
            win.webContents.sendInputEvent({ type: 'mouseMove', ...edge });
            await exec('new Promise(resolve=>requestAnimationFrame(resolve))');
            await exec(
              `(()=>{const b=document.querySelector('[data-zl-chat-resize]');if(getComputedStyle(b).opacity!=='1')throw Error('Hovering divider must show top handle');return true})()`,
            );
            await exec(
              `(()=>{const b=document.querySelector('[data-zl-chat-resize]');if(!b||b.parentElement!==document.body)throw Error('Handle must be mounted outside native header');const r=b.getBoundingClientRect();const plus=document.querySelector('#new-chat').getBoundingClientRect();if(!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-zl-chat-resize]'))throw Error('Handle is clipped or not hittable '+JSON.stringify({rect:r.toJSON(),near:window.__zlChatListLayout.nearBoundary,opacity:getComputedStyle(b).opacity,pointer:getComputedStyle(b).pointerEvents,visible:b.dataset.zlVisible,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML}));if(Math.abs(r.y+r.height/2-plus.y-plus.height/2)>1)throw Error('Handle must align with green plus');b.remove();return true})()`,
            );
            await exec(
              'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
            );
            const before = await geometry();
            await drag(70);
            const after = await geometry();
            await exec(
              `(()=>{const old=document.querySelector('#welcome-pane,#chat-pane');const next=old.cloneNode(false);delete next.dataset.zlChatPane;old.replaceWith(next);window.__qaConfigure();return true})()`,
            );
            const swapped = await geometry();
            await exec(
              `document.querySelector('header,.wa-head').replaceChildren();window.__qaConfigure();true`,
            );
            await drag(-35, true);
            const rerendered = await geometry();
            win.setContentSize(850, 750);
            await exec(
              'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
            );
            await exec('window.__qaConfigure();true');
            const resized = await geometry();
            await exec(
              `(()=>{const state=window.__zlChatListLayout;const pane=getComputedStyle(state.pane);const pseudo=getComputedStyle(state.pane,'::before');const column=getComputedStyle(state.column);if(column.borderRightColor!=='rgba(0, 0, 0, 0)'||pane.borderLeftColor!=='rgba(0, 0, 0, 0)'||pseudo.borderLeftColor!=='rgba(0, 0, 0, 0)'||pane.boxShadow!=='none')throw Error('Native seam must be invisible after resizing');const line=getComputedStyle(state.divider);if(line.backgroundColor!=='rgba(0, 0, 0, 0)'||line.boxShadow!=='none')throw Error('Hover strip must stay transparent');return true})()`,
            );

            observations.push({
              variant,
              before,
              after,
              swapped,
              rerendered,
              resized,
            });
          }
          return observations;
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )})`,
  );
  for (const {
    variant,
    before,
    after,
    swapped,
    rerendered,
    resized,
  } of reports) {
    assert.equal(
      before.selected,
      'list-col',
      `${variant}: select actual internal column`,
    );
    assert(
      Math.abs(after.column.width - before.column.width - 70) < 1,
      `${variant}: native drag must widen list`,
    );
    assert(
      Math.abs(after.side.width - before.side.width - 70) < 1,
      `${variant}: inner native list must widen too`,
    );
    assert(
      Math.abs(after.pane.width - before.pane.width + 70) < 1,
      `${variant}: right pane must shrink by same amount`,
    );
    assert(
      Math.abs(rerendered.column.width - after.column.width + 35) < 1,
      `${variant}: replacement header still drags`,
    );
    assert.deepEqual(
      swapped.pane,
      after.pane,
      `${variant}: replacement right pane must retain width`,
    );
    for (const phase of [after, swapped, rerendered]) {
      for (const id of ['app', 'guest', 'accounts', 'tools'])
        assert.deepEqual(
          phase[id],
          before[id],
          `${variant}: ${id} must remain unchanged`,
        );
      assert(
        phase.side.right <= phase.column.right + 1,
        `${variant}: inner list must fit padded wrapper`,
      );
      assert(
        Math.abs(phase.pane.right - phase.app.right) < 1,
        `${variant}: no outer overflow or gap`,
      );
      assert.equal(Number(phase.stored), Math.round(phase.column.width));
    }
    assert(
      Math.abs(resized.pane.right - resized.app.right) < 1,
      `${variant}: window resize must retain split`,
    );
    assert(
      resized.pane.width >= 299,
      `${variant}: retain usable conversation width`,
    );
    if (variant === 'grid-welcome') assert.equal(after.grid, 'true');
  }
  console.log(
    'PASS native internal-only WhatsApp split drag: padded/fixed flex columns, grid welcome screen, chat pane, missing header tag, alternate list root, clipped containers, hover reveal at top of divider, hidden away from divider, invisible seam and hover strip during/after full-divider drag, automatic remount, replacement header, persisted width and responsive clamp; software sidebars and guest bounds unchanged',
  );
  console.log(
    JSON.stringify(
      reports.map(r => ({
        variant: r.variant,
        list: [
          r.before.column.width,
          r.after.column.width,
          r.rerendered.column.width,
        ],
        chat: [
          r.before.pane.width,
          r.after.pane.width,
          r.rerendered.pane.width,
        ],
        narrowChat: r.resized.pane.width,
      })),
    ),
  );
} finally {
  socket.close();
}

/* eslint-disable no-console, no-await-in-loop -- Sequential native input regression. */
import assert from 'node:assert/strict';
import { evaluate, wait } from './account-tools-cdp.mjs';

export async function verifyWhatsAppLayout(id) {
  const service = `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
  const guest = code =>
    evaluate(`${service}.webview.executeJavaScript(${JSON.stringify(code)})`);
  await evaluate(
    `window.ferdium.stores.services._setActive({serviceId:${JSON.stringify(id)}});true`,
  );
  await wait(
    `${service}.webview.executeJavaScript('!!document.querySelector("[data-zl-chat-resize]")')`,
    'list sizing button',
  );
  const before = await guest(
    `({width:document.querySelector('#side').getBoundingClientRect().width,stored:localStorage.getItem('zl-chat-list-width')})`,
  );
  const theme = await evaluate(
    `({darkMode:window.ferdium.stores.settings.app.darkMode,adaptableDarkMode:window.ferdium.stores.settings.app.adaptableDarkMode})`,
  );
  const send = async event => {
    const contents = await evaluate(`${service}.webview.getWebContentsId()`);
    await evaluate(
      `require('@electron/remote').webContents.fromId(${contents}).sendInputEvent(${JSON.stringify(event)});true`,
    );
  };
  const point = () =>
    guest(
      `(()=>{const r=document.querySelector('[data-zl-chat-resize]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
  try {
    let p = await point();
    for (const type of ['mouseDown', 'mouseUp'])
      await send({ type, ...p, button: 'left', clickCount: 1 });
    const wide = await guest(
      `document.querySelector('#side').getBoundingClientRect().width`,
    );
    assert(wide > before.width + 50, 'native click expands list');
    p = await point();
    await send({ type: 'mouseDown', ...p, button: 'left', clickCount: 1 });
    await send({
      type: 'mouseMove',
      modifiers: ['leftButtonDown'],
      x: p.x - 70,
      y: p.y,
      button: 'left',
    });
    await send({
      type: 'mouseUp',
      x: p.x - 70,
      y: p.y,
      button: 'left',
      clickCount: 1,
    });
    const narrow = await guest(
      `document.querySelector('#side').getBoundingClientRect().width`,
    );
    assert(
      narrow < wide - 40,
      `native drag resizes list: ${wide} -> ${narrow}`,
    );
    assert.equal(
      Number(await guest(`localStorage.getItem('zl-chat-list-width')`)),
      Math.round(narrow),
    );
    assert.equal(
      await guest(`document.querySelectorAll('[data-zl-chat-resize]').length`),
      1,
    );
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:{darkMode:false,adaptableDarkMode:false}});true`,
    );
    await wait(
      `getComputedStyle(document.querySelector('.account-sidebar')).backgroundColor==='rgb(115, 103, 240)'`,
      'light purple sidebar',
    );
    assert.equal(
      await evaluate(
        `getComputedStyle(document.querySelector('.account-tools')).backgroundColor`,
      ),
      'rgb(115, 103, 240)',
    );
    const statuses = await evaluate(
      `(()=>{const status=require('./features/accounts/whatsapp').accountStatus;const s={isEnabled:true,isLoading:false,isError:false,hasCrashed:false,isHibernating:false,accountSnapshot:{status:'online'}};return [status(s),status({...s,accountSnapshot:{status:'logged-out'}}),status({...s,isError:true}),status({...s,isHibernating:true,isError:true})].map(value=>{const dot=document.createElement('i');dot.className='account-status account-status--'+value;document.body.append(dot);const color=getComputedStyle(dot).backgroundColor;dot.remove();return color})})()`,
    );
    assert.deepEqual(statuses, [
      'rgb(24, 197, 104)',
      'rgb(240, 82, 89)',
      'rgb(237, 177, 54)',
      'rgb(146, 153, 163)',
    ]);
    console.log(
      'PASS native WhatsApp list click/drag/persistence, light purple sidebars and four distinct account status colors',
    );
  } finally {
    await guest(
      `(()=>{const state=window.__zlChatListLayout;state.width=0;state.column.removeAttribute('data-zl-chat-column');state.column.style.removeProperty('--zl-chat-list-width');${before.stored === null ? "localStorage.removeItem('zl-chat-list-width')" : `localStorage.setItem('zl-chat-list-width',${JSON.stringify(before.stored)})`};return true})()`,
    );
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(theme)}});true`,
    );
  }
}

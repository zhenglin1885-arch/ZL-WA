/* eslint-disable no-console, no-await-in-loop -- Sequential native UI verification and screenshots. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { evaluate, click, wait, call } from './account-tools-cdp.mjs';

const pause = async () =>
  new Promise(resolve => {
    setTimeout(resolve, 220);
  });
const settings = value =>
  `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(value)}})`;
const service = id =>
  `window.ferdium.stores.services.all.find(s=>s.id===${JSON.stringify(id)})`;
async function shot(path) {
  await pause();
  const result = await call('Page.captureScreenshot', { format: 'png' });
  writeFileSync(path, Buffer.from(result.data, 'base64'));
}
export async function verifyRoundedUI(first) {
  const output =
    process.env.ZL_ROUNDED_SCREENSHOTS || '/tmp/zl-rounded-preview';
  mkdirSync(output, { recursive: true });
  const before = await evaluate(
    `(()=>{const app=window.ferdium.stores.settings.app;return {darkMode:app.darkMode,adaptableDarkMode:app.adaptableDarkMode,lightThemeColor:app.lightThemeColor}})()`,
  );
  const unread = await evaluate(
    `${service(first)}.webview.executeJavaScript('fixture.chats.map(c=>c.unreadCount||0)')`,
  );
  const guestBefore = await evaluate(
    `${service(first)}.webview.executeJavaScript('({origin:performance.timeOrigin,draft:document.querySelector("#main footer [contenteditable]")?.textContent})')`,
  );
  try {
    await evaluate(
      `for(const button of [...document.querySelectorAll('.account-tools-rail button')].slice(0,3))if(button.getAttribute('aria-pressed')==='true')button.click()`,
    );
    await click(`[data-service-id="${first}"] .account-card__select`);
    await evaluate(`require('@electron/remote').getCurrentWindow().focus()`);
    await evaluate(
      `${service(first)}.webview.executeJavaScript('fixture.chats[0].unreadCount=108;true')`,
    );
    await wait(
      `document.querySelector('[data-service-id="${first}"] .account-card__unread')?.textContent==='99+'`,
      'rounded unread badge',
    );
    for (const dark of [true, false]) {
      await evaluate(
        settings({
          darkMode: dark,
          adaptableDarkMode: false,
          lightThemeColor: '#7367f0',
        }),
      );
      await wait(
        `document.body.classList.contains('theme__dark')===${dark}`,
        'UI theme switch',
      );
      await pause();
      const card = await evaluate(
        `(()=>{const node=document.querySelector('[data-service-id="${first}"]');const badge=node.querySelector('.account-card__unread');const style=getComputedStyle(node);const b=getComputedStyle(badge);const r=badge.getBoundingClientRect();const c=node.getBoundingClientRect();return {radius:style.borderRadius,border:style.borderWidth,background:style.backgroundColor,badge:{font:b.fontSize,whiteSpace:b.whiteSpace,height:r.height,background:b.backgroundColor,fits:badge.scrollWidth<=badge.clientWidth+1&&r.left>=c.left&&r.right<=c.right},icons:[...document.querySelectorAll('.account-tools-rail>button')].map(button=>{const svg=button.querySelector('svg');return svg&&svg.getAttribute('width')==='20'&&svg.getAttribute('height')==='20'&&svg.getAttribute('stroke-width')==='1.8'&&svg.getAttribute('fill')==='none'})}})()`,
      );
      assert.equal(card.radius, '16px');
      assert.equal(card.border, '0px');
      assert.equal(card.badge.font, '12px');
      assert.equal(card.badge.whiteSpace, 'nowrap');
      assert.equal(card.badge.height, 22);
      assert.equal(card.badge.background, 'rgb(217, 58, 66)');
      assert(card.badge.fits);
      assert.equal(card.icons.length, 9);
      assert(card.icons.every(Boolean));
      if (!dark) assert(card.background.includes('255, 255, 255'));
      await shot(`${output}/${dark ? 'dark' : 'light'}-main.png`);
      await click('.account-tools-rail button:nth-child(2)');
      await wait(
        `!!document.querySelector('.account-tools-panel input:not([type=checkbox])')`,
        'rounded proxy fields',
      );
      const fields = await evaluate(
        `(()=>{const inputs=[...document.querySelectorAll('.account-tools-panel input:not([type=checkbox]),.account-tools-panel select')].filter(n=>n.getBoundingClientRect().height>0);inputs[0].focus();return inputs.map(n=>({height:n.getBoundingClientRect().height,radius:getComputedStyle(n).borderRadius}))})()`,
      );
      assert(fields.length > 0);
      assert(
        fields.every(field => field.height === 38 && field.radius === '12px'),
      );
      await wait(
        `[...document.querySelectorAll('.account-tools-panel input:not([type=checkbox])')].some(n=>!n.matches(':disabled')&&n.getBoundingClientRect().height>0)`,
        'proxy input enabled after settings load',
      );
      await call('Page.bringToFront');
      await evaluate(
        `require('@electron/remote').getCurrentWindow().webContents.focus()`,
      );
      const point = await evaluate(
        `(()=>{const input=[...document.querySelectorAll('.account-tools-panel input:not([type=checkbox])')].find(n=>!n.matches(':disabled'));input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
      );
      await call('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...point,
        button: 'left',
        clickCount: 1,
      });
      await call('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...point,
        button: 'left',
        clickCount: 1,
      });
      await pause();
      await evaluate(
        `(()=>{const input=[...document.querySelectorAll('.account-tools-panel input:not([type=checkbox])')].find(n=>!n.matches(':disabled'));input.focus()})()`,
      );
      await pause();
      const focus = await evaluate(
        `getComputedStyle(document.querySelector('.account-tools-panel input:focus')||document.activeElement).boxShadow`,
      );
      assert(focus.includes('3px'), `Native input focus halo: ${focus}`);
      await shot(`${output}/${dark ? 'dark' : 'light'}-panel.png`);
      await click('.account-tools-rail button:nth-child(2)');
      await click('.account-tools-rail button:nth-child(4)');
      await wait(
        `!!document.querySelector('.bulk-dialog .MuiDialogTitle-root')`,
        'bulk theme preview',
      );
      await pause();
      const bulkChrome = await evaluate(
        `(()=>{const dialog=document.querySelector('.bulk-dialog');return [...dialog.querySelectorAll('.MuiDialogTitle-root,.MuiDialogActions-root')].map(n=>({background:getComputedStyle(n).backgroundColor,color:getComputedStyle(n).color,radius:getComputedStyle(n.closest('.MuiPaper-root')).borderRadius}))})()`,
      );
      assert.equal(bulkChrome.length, 2);
      assert(bulkChrome.every(n => n.radius === '20px'));
      if (!dark)
        assert(
          bulkChrome.every(
            n =>
              n.background === 'rgb(246, 248, 252)' &&
              n.color === 'rgb(38, 50, 71)',
          ),
        );
      await shot(`${output}/${dark ? 'dark' : 'light'}-bulk.png`);
      await click('.bulk-dialog__close-icon');
      await wait(
        `!document.querySelector('.bulk-dialog')`,
        'close bulk preview without sending',
      );
      await evaluate(
        `(()=>{const card=document.querySelector('[data-service-id="${first}"]');const header=document.querySelector('.account-group__header');card.classList.add('drop-before');header.classList.add('drop-after');})()`,
      );
      const markers = await evaluate(
        `(()=>{const nodes=[[document.querySelector('[data-service-id="${first}"]'),'::before'],[document.querySelector('.account-group__header'),'::after']];return nodes.map(([n,pseudo])=>{const s=getComputedStyle(n,pseudo);return {height:s.height,radius:s.borderRadius,events:s.pointerEvents}})})()`,
      );
      assert(
        markers.every(
          marker =>
            marker.height === '3px' &&
            marker.radius === '999px' &&
            marker.events === 'none',
        ),
      );
      await evaluate(
        `document.querySelector('[data-service-id="${first}"]').classList.remove('drop-before');document.querySelector('.account-group__header').classList.remove('drop-after')`,
      );
      await click('.account-sidebar__collapse');
      await pause();
      assert.equal(
        await evaluate(
          `document.querySelector('.account-sidebar').getBoundingClientRect().width`,
        ),
        84,
      );
      await shot(`${output}/${dark ? 'dark' : 'light'}-collapsed.png`);
      await click('.account-sidebar__collapse');
      const guestAfter = await evaluate(
        `${service(first)}.webview.executeJavaScript('({origin:performance.timeOrigin,draft:document.querySelector("#main footer [contenteditable]")?.textContent})')`,
      );
      assert.deepEqual(
        guestAfter,
        guestBefore,
        'theme and chrome styling must not reload the guest or alter drafts',
      );
    }
    console.log(
      'PASS rounded light/dark UI: borderless cards, 99+ badges, nine stroke icons, consistent focused fields, rounded drag markers and compact sidebar',
    );
    console.log(
      'PASS rounded styling preserves native guest navigation and unsent drafts',
    );
    writeFileSync(
      `${output}/rounded-ui-verification.json`,
      `${JSON.stringify(
        {
          lightAndDarkVerified: true,
          unreadBadge99PlusVerified: true,
          consistentInputsAndFocusVerified: true,
          nativeGuestAndDraftUnchanged: true,
          roundedDragMarkersVerified: true,
          compactSidebarVerified: true,
          bulkDialogThemeContrastVerified: true,
          realPhoneLoginVerified: false,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await evaluate(
      `for(const button of [...document.querySelectorAll('.account-tools-rail button')].slice(0,3))if(button.getAttribute('aria-pressed')==='true')button.click()`,
    );
    await evaluate(
      `${service(first)}.webview.executeJavaScript(${JSON.stringify(`fixture.chats.forEach((c,i)=>c.unreadCount=${JSON.stringify(unread)}[i]);true`)})`,
    );
    await evaluate(settings(before));
  }
}

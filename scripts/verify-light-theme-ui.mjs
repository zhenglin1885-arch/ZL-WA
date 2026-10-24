/* eslint-disable no-console, no-await-in-loop -- Native input and theme transitions are sequential. */
import assert from 'node:assert/strict';
import { evaluate, wait, click, call, socket } from './account-tools-cdp.mjs';

const update = data =>
  evaluate(
    `window.ferdium.stores.settings._update({type:'app',data:${JSON.stringify(data)}});true`,
  );
const open = async () => {
  await click('.account-sidebar__footer button');
  await wait(`!!document.querySelector('#appearance')`, 'settings');
  await click('#appearance');
  await wait(
    `!!document.querySelector('input[name="lightThemeColor"]')`,
    'independent light color control',
  );
};
const edit = async color => {
  const point = await evaluate(
    `(()=>{const input=document.querySelector('input[name="lightThemeColor"]');input.scrollIntoView({block:'center'});const r=input.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  for (const type of ['mousePressed', 'mouseReleased'])
    await call('Input.dispatchMouseEvent', {
      type,
      ...point,
      button: 'left',
      clickCount: 1,
    });
  for (const type of ['keyDown', 'keyUp'])
    await call('Input.dispatchKeyEvent', {
      type,
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
  if (color) await call('Input.insertText', { text: color });
  else
    for (const type of ['keyDown', 'keyUp'])
      await call('Input.dispatchKeyEvent', {
        type,
        key: 'Backspace',
        code: 'Backspace',
        windowsVirtualKeyCode: 8,
      });
  await click('.settings__settings-group__apply-color__button');
};
const darkSnapshot = () =>
  evaluate(
    `({primary:window.ferdium.stores.ui.muiTheme.palette.primary.main,colors:['.account-sidebar','.account-tools','.app-titlebar','.settings__header','.settings-navigation__link.is-active'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return {background:s.backgroundColor,color:s.color}})})`,
  );
let original;
try {
  await wait(`!!window.ferdium?.stores?.settings.loaded`, 'app ready');
  await evaluate(
    `(()=>{if(!document.querySelector('.app-titlebar')){const probe=document.createElement('div');probe.id='qa-light-titlebar';probe.className='app-titlebar';probe.style.cssText='position:fixed;left:-10000px;width:200px;height:28px';probe.innerHTML='<span class="app-titlebar__brand">QA</span>';document.body.append(probe)}return true})()`,
  );
  original = await evaluate(
    `(()=>{const s=window.ferdium.stores.settings.app;return {darkMode:s.darkMode,adaptableDarkMode:s.adaptableDarkMode,universalDarkMode:s.universalDarkMode,accentColor:s.accentColor,lightThemeColor:s.lightThemeColor}})()`,
  );
  await update({ darkMode: true, adaptableDarkMode: false });
  await open();
  await wait(`document.body.classList.contains('theme__dark')`, 'dark theme');
  const before = await darkSnapshot();
  await edit('#f4df82');
  await wait(
    `window.ferdium.stores.settings.app.lightThemeColor==='#f4df82'`,
    'light preference saved while in dark mode',
  );
  assert.deepEqual(
    await darkSnapshot(),
    before,
    'light preference leaves all dark surfaces and primary color unchanged',
  );
  assert.equal(
    await evaluate(`window.ferdium.stores.settings.app.accentColor`),
    original.accentColor,
  );
  await update({
    darkMode: false,
    adaptableDarkMode: false,
    universalDarkMode: false,
  });
  await wait(
    `getComputedStyle(document.querySelector('.account-sidebar')).backgroundColor==='rgb(244, 223, 130)'`,
    'light color applied',
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.account-tools')).backgroundColor`,
    ),
    'rgb(244, 223, 130)',
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.app-titlebar')).backgroundColor`,
    ),
    'rgb(244, 223, 130)',
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.account-sidebar')).color`,
    ),
    'rgb(23, 33, 43)',
  );
  assert.equal(
    await evaluate(
      `getComputedStyle(document.querySelector('.settings__header')).backgroundColor`,
    ),
    'rgb(244, 223, 130)',
  );
  assert.equal(
    await evaluate(`window.ferdium.stores.ui.muiTheme.palette.primary.main`),
    '#f4df82',
  );
  await edit('#1484a0');
  await wait(
    `getComputedStyle(document.querySelector('.account-sidebar')).backgroundColor==='rgb(20, 132, 160)'`,
    'second light color',
  );
  await wait(
    `JSON.parse(require('node:fs').readFileSync(require('node:path').join(require('@electron/remote').app.getPath('userData'),'config','settings.json'),'utf8')).lightThemeColor==='#1484a0'`,
    'light preference persisted on disk',
  );
  await click('.settings__close');
  await open();
  assert.equal(
    await evaluate(
      `document.querySelector('input[name="lightThemeColor"]').value`,
    ),
    '#1484a0',
  );
  await update({ darkMode: true, adaptableDarkMode: false });
  await wait(
    `document.body.classList.contains('theme__dark')`,
    'dark theme restored',
  );
  await wait(
    `getComputedStyle(document.querySelector('.settings-navigation__link.is-active')).backgroundColor===${JSON.stringify(before.colors[4].background)}`,
    'dark navigation transition completed',
  );
  assert.deepEqual(
    await darkSnapshot(),
    before,
    'dark palette preserved after changing light colors and reopening settings',
  );
  await update({ darkMode: false, adaptableDarkMode: false });
  await wait(`!document.body.classList.contains('theme__dark')`, 'light again');
  await edit('');
  await wait(
    `window.ferdium.stores.settings.app.lightThemeColor.toLowerCase()==='#7367f0'`,
    'clearing restores default',
  );
  console.log(
    'PASS native light color editing, all light surfaces and MUI update, readable contrast, saved preference, empty reset and unchanged dark palette',
  );
} finally {
  if (original) await update(original);
  await evaluate(`window.ferdium.stores.router.push('/');true`);
  await evaluate(`document.querySelector('#qa-light-titlebar')?.remove();true`);
  socket.close();
}

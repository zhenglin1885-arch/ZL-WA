/* Verify the menu against the real Electron sidebar and across a full process restart.
 * Use only a disposable profile; the synthetic account stays disabled throughout. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  evaluate,
  wait,
  click,
  clickText,
  call,
  socket,
} from './account-tools-cdp.mjs';
const manifest = '/tmp/zl-native-name-persistence.json';
try {
  await wait(
    'window.ferdium?.stores?.user.localSessionReady && window.ferdium.stores.services.allServicesRequest.wasExecuted',
    'local startup ready',
  );
  const profile = await evaluate(
    "require('@electron/remote').app.getPath('userData')",
  );
  assert(
    profile.startsWith('/tmp/zl-account-remark-'),
    'Use a disposable remark QA profile',
  );
  if (process.argv.includes('--restart')) {
    const saved = JSON.parse(readFileSync(manifest, 'utf8'));
    assert.equal(profile, saved.profile);
    const card = `[data-service-id="${saved.id}"]`;
    await wait(
      `document.querySelector(${JSON.stringify(card + ' .account-card__name')})?.textContent===${JSON.stringify(saved.nativeName)}`,
      'saved account card restored',
    );
    const current = await evaluate(
      `(()=>{const c=document.querySelector(${JSON.stringify(card)});const s=window.ferdium.stores;return {name:c.querySelector('.account-card__name').textContent,remark:c.querySelector('.account-card__remark').textContent.trim(),prefs:{nickname:s.settings.app.accountSidebar.accounts[${JSON.stringify(saved.id)}].nickname,remark:s.settings.app.accountSidebar.accounts[${JSON.stringify(saved.id)}].remark},enabled:s.services.one(${JSON.stringify(saved.id)}).isEnabled}})()`,
    );
    assert.equal(current.name, saved.nativeName);
    assert.equal(current.remark, saved.remark);
    assert.equal(current.prefs.nickname, saved.nickname);
    assert.equal(current.prefs.remark, saved.remark);
    assert.equal(current.enabled, false);
    console.log(
      'PASS account remark survives a complete application restart; native WhatsApp nickname displayed despite legacy alias; remark and disabled state preserved',
    );
    await click(card + ' .account-card__more');
    await wait(
      "getComputedStyle(document.querySelector('[role=menu]').closest('.MuiPaper-root')).opacity==='1'",
      'remark menu paint finished',
    );
    const painted = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      '/workspace/ZL-WA-remark-menu.png',
      Buffer.from(painted.data, 'base64'),
    );
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await wait(
      "!document.querySelector('[role=menu]')",
      'menu closed after visual capture',
    );

    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(saved.id)},redirect:false})`,
    );
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:${JSON.stringify(saved.before)}}})`,
    );
  } else {
    assert.equal(
      await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
      false,
    );
    const before = await evaluate(
      'JSON.parse(JSON.stringify(window.ferdium.stores.settings.app.accountSidebar))',
    );
    const id = await evaluate(
      `(async()=>{const s=window.ferdium.stores.services;await s._createService({recipeId:'whatsapp',serviceData:{name:'备注验证账号',isEnabled:false},redirect:false});return s.createServiceRequest.result.data.id})()`,
    );
    const nickname = 'didddd';
    const nativeName = 'Emir';
    const remark = '菜单修改并重启保留的账号备注';
    await evaluate(
      `(async()=>{const id=${JSON.stringify(id)};const profile={status:'online',ownerId:'601129164349@c.us',phone:'601129164349',nickname:${JSON.stringify(nativeName)}};await require('electron').ipcRenderer.invoke('account-tools-profile',id,profile);require('mobx').runInAction(()=>{window.ferdium.stores.services.one(id).accountSnapshot=profile});return true})()`,
    );

    await evaluate(
      `(()=>{const s=window.ferdium.stores.settings;const c=JSON.parse(JSON.stringify(s.app.accountSidebar));c.collapsed=false;c.groups=c.groups.map(g=>({...g,collapsed:false}));c.accounts[${JSON.stringify(id)}]={...c.accounts[${JSON.stringify(id)}],nickname:${JSON.stringify(nickname)},remark:'个人账号'};s._update({type:'app',data:{accountSidebar:c}});return true})()`,
    );
    const card = `[data-service-id="${id}"]`;
    await wait(
      `document.querySelector(${JSON.stringify(card + ' .account-card__name')})?.textContent===${JSON.stringify(nativeName)}`,
      'native WhatsApp nickname replaces the legacy alias',
    );
    await click(card + ' .account-card__more');
    const labels = await evaluate(
      "[...document.querySelectorAll('[role=menuitem]')].map(n=>n.textContent.trim())",
    );
    assert(labels.includes('修改备注'));
    assert(!labels.includes('修改昵称'));
    const shot = await call('Page.captureScreenshot', { format: 'png' });
    writeFileSync(
      '/workspace/ZL-WA-remark-menu.png',
      Buffer.from(shot.data, 'base64'),
    );
    await clickText('修改备注');
    await wait(
      "document.querySelector('.account-dialog input')?.value==='个人账号'",
      'menu prefills the remark rather than the nickname',
    );
    const point = await evaluate(
      "(()=>{const e=document.querySelector('.account-dialog input');const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()",
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await call('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        clickCount: 1,
      });
    await call('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await call('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 0,
    });
    await call('Input.insertText', { text: remark });
    await clickText('保存');
    await wait(
      `!document.querySelector('.account-dialog') && document.querySelector(${JSON.stringify(card + ' .account-card__remark')})?.textContent.includes(${JSON.stringify(remark)})`,
      'menu edits the remark row',
    );
    assert.equal(
      await evaluate(
        `document.querySelector(${JSON.stringify(card + ' .account-card__name')}).textContent`,
      ),
      nativeName,
    );
    writeFileSync(
      manifest,
      JSON.stringify({ profile, id, nickname, nativeName, remark, before }),
    );
    console.log(
      'PASS menu label, prefilled remark, native text input, remark save and native WhatsApp nickname despite legacy alias; restart verification pending',
    );
  }
} finally {
  socket.close();
}

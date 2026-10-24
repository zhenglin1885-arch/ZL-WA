/* eslint-disable no-console, no-await-in-loop -- Sequential native send/edit gestures. */
import assert from 'node:assert/strict';

export async function verifyTranslationContexts({
  first,
  guest,
  evaluate,
  wait,
  service,
}) {
  const view = `${service(first)}.webview`;
  const clickGuest = async selector => {
    const point = await guest(
      first,
      `(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    for (const type of ['mouseDown', 'mouseUp'])
      await evaluate(
        `require('@electron/remote').webContents.fromId(${view}.getWebContentsId()).sendInputEvent(${JSON.stringify({ type, ...point, button: 'left', clickCount: 1 })});true`,
      );
  };
  const beforeEdited = await guest(first, 'fixture.edited.length');
  for (const confirm of ['wds-ic-checkmark-large', 'checkmark-medium']) {
    await guest(
      first,
      `(()=>{fixture.openEdit('新版本编辑翻译 ${confirm}',false,'Editar mensagem');const root=document.querySelector('#fixture-edit');root.prepend(Object.assign(document.createElement('div'),{innerText:'Preview\\n'.repeat(10)}));const input=root.querySelector('[contenteditable]');input.removeAttribute('role');input.removeAttribute('data-lexical-editor');const save=root.querySelector('[data-testid=fixture-edit-save]');save.innerHTML='<span data-icon="${confirm}">✓</span>';const inner=document.createElement('div');inner.setAttribute('role','dialog');inner.append(input,save);root.append(inner);return true})()`,
    );
    const count = await guest(first, 'fixture.edited.length');
    await clickGuest('#fixture-edit [data-testid=fixture-edit-save]');
    await wait(
      `${view}.executeJavaScript('document.querySelector("#fixture-edit [contenteditable]")?.textContent==="Hello translated"')`,
      'nested edit with unmarked editor translates',
    );
    assert.equal(
      await guest(first, 'fixture.edited.length'),
      count,
      'first native gesture cannot save raw edit',
    );
    await clickGuest('#fixture-edit [data-testid=fixture-edit-save]');
    await wait(
      `${view}.executeJavaScript('!document.querySelector("#fixture-edit")')`,
      'second native gesture confirms edit',
    );
    assert.equal(
      await guest(first, 'fixture.edited.at(-1)'),
      'Hello translated',
    );
  }
  assert.equal(await guest(first, 'fixture.edited.length'), beforeEdited + 2);
  const originalSent = await guest(first, 'fixture.sent.slice()');
  try {
    await guest(
      first,
      `(()=>{const footer=document.querySelector('#main footer');const input=footer.querySelector('[contenteditable]');fixture.contextAttributes={role:input.getAttribute('role'),lexical:input.getAttribute('data-lexical-editor')};input.removeAttribute('role');input.removeAttribute('data-lexical-editor');const wrapper=document.createElement('div');wrapper.dataset.testid='conversation-compose-box';input.before(wrapper);wrapper.append(input);const quote=document.createElement('div');quote.dataset.testid='reply-context';quote.dataset.id='quoted-message-A';quote.textContent='Quoted content must not be translated';footer.prepend(quote);input.textContent='引用回复原文';return true})()`,
    );
    const count = await guest(first, 'fixture.sent.length');
    await clickGuest('#main footer button');
    await wait(
      `${view}.executeJavaScript('Boolean(window.__zlTranslation.approved)&&!window.__zlTranslation.busy')`,
      'unmarked quoted-reply editor translated',
    );
    assert.equal(
      await guest(first, 'fixture.sent.length'),
      count,
      'quoted reply does not send raw text',
    );
    const providerInput = await evaluate(
      `require('@electron/remote').require('node:vm').runInThisContext('globalThis.__zlLastTranslationInput')`,
    );
    assert.equal(
      providerInput,
      '引用回复原文',
      'provider never receives quoted source text',
    );
    await clickGuest('#main footer button');
    await wait(
      `${view}.executeJavaScript('fixture.sent.length===${count + 1}')`,
      'quoted reply confirms on second native gesture',
    );
    assert.equal(await guest(first, 'fixture.sent.at(-1)'), 'Hello translated');
    await guest(
      first,
      `document.querySelector('#main footer [contenteditable]').textContent='切换引用目标时不得直接发送';document.querySelector('#main footer button').click();document.querySelector('[data-testid=reply-context]').dataset.id='quoted-message-B';true`,
    );
    await wait(
      `${view}.executeJavaScript('!window.__zlTranslation.busy')`,
      'changed quote invalidates translation',
    );
    assert.equal(await guest(first, 'fixture.sent.length'), count + 1);
    assert.equal(
      await guest(
        first,
        'document.querySelector("#main footer [contenteditable]").textContent',
      ),
      '切换引用目标时不得直接发送',
    );
    console.log(
      'PASS native pointer-driven edits, nested dialog headings, unmarked editors, new checkmark icons, quoted reply translation and quote-switch protection',
    );
  } finally {
    await guest(
      first,
      `(()=>{const footer=document.querySelector('#main footer');const input=footer.querySelector('[contenteditable]');input.textContent='';input.dispatchEvent(new Event('input',{bubbles:true}));const wrapper=footer.querySelector('[data-testid=conversation-compose-box]');if(wrapper){wrapper.before(input);wrapper.remove()}footer.querySelector('[data-testid=reply-context]')?.remove();for(const [key,value] of Object.entries({role:fixture.contextAttributes.role,'data-lexical-editor':fixture.contextAttributes.lexical})){if(value===null)input.removeAttribute(key);else input.setAttribute(key,value)}fixture.sent=${JSON.stringify(originalSent)};return true})()`,
    );
  }
}

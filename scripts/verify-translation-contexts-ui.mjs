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
  const clickGuest = async (selector, holdForTranslation = false) => {
    const point = await guest(
      first,
      `(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.scrollIntoView({block:'center'});const r=node.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
    );
    for (const type of ['mouseDown', 'mouseUp']) {
      await evaluate(
        `require('@electron/remote').webContents.fromId(${view}.getWebContentsId()).sendInputEvent(${JSON.stringify({ type, ...point, button: 'left', clickCount: 1 })});true`,
      );
      if (type === 'mouseDown' && holdForTranslation)
        await wait(
          `${view}.executeJavaScript('Boolean(window.__zlTranslation.approved)&&!window.__zlTranslation.busy')`,
          'holding first mouse gesture until translation completes',
        );
    }
  };
  const beforeEdited = await guest(first, 'fixture.edited.length');
  for (const [confirm, unmarked, enter] of [
    ['wds-ic-checkmark-large', false, false],
    ['checkmark-medium', false, false],
    ['wds-ic-checkmark-small', true, false],
    ['checkmark-circle', true, true],
  ]) {
    await guest(
      first,
      `(()=>{fixture.openEdit('新版本编辑翻译 ${confirm}',false,'Editar mensagem');const root=document.querySelector('#fixture-edit');root.prepend(Object.assign(document.createElement('div'),{innerText:'Preview\\n'.repeat(10)}));const input=root.querySelector('[contenteditable]');input.removeAttribute('role');input.removeAttribute('data-lexical-editor');const save=root.querySelector('[data-testid=fixture-edit-save]');save.innerHTML='<span data-icon="${confirm}">✓</span>';const inner=document.createElement('div');inner.setAttribute('role','dialog');inner.append(input,save);root.append(inner);return true})()`,
    );
    if (unmarked)
      await guest(
        first,
        `(()=>{const root=document.querySelector('#fixture-edit');root.removeAttribute('data-animate-modal-popup');root.querySelector('[role=dialog]').removeAttribute('role');const title=root.querySelector('h2');const header=document.createElement('div');header.style.display='flex';header.innerHTML='<button type="button"><span data-icon="x">×</span></button><span>Edit message</span>';title.replaceWith(header);return true})()`,
      );
    const save = async () => {
      if (enter) {
        await guest(
          first,
          `document.querySelector('#fixture-edit [contenteditable]').focus();true`,
        );
        for (const type of ['keyDown', 'keyUp'])
          await evaluate(
            `require('@electron/remote').webContents.fromId(${view}.getWebContentsId()).sendInputEvent(${JSON.stringify({ type, keyCode: 'Enter' })});true`,
          );
      } else {
        await clickGuest('#fixture-edit [data-testid=fixture-edit-save]');
      }
    };
    const count = await guest(first, 'fixture.edited.length');
    await save();
    await wait(
      `${view}.executeJavaScript('document.querySelector("#fixture-edit [contenteditable]")?.textContent==="Hello translated"')`,
      'nested edit with unmarked editor translates',
    );
    assert.equal(
      await guest(first, 'fixture.edited.length'),
      count,
      'first native gesture cannot save raw edit',
    );
    await save();
    await wait(
      `${view}.executeJavaScript('!document.querySelector("#fixture-edit")')`,
      'second native gesture confirms edit',
    );
    assert.equal(
      await guest(first, 'fixture.edited.at(-1)'),
      'Hello translated',
    );
  }
  assert.equal(await guest(first, 'fixture.edited.length'), beforeEdited + 4);
  const beforeMedia = await guest(first, 'fixture.mediaSent.length');
  for (const kind of ['image', 'video', 'file']) {
    for (const enter of [false, true]) {
      await guest(
        first,
        `(()=>{fixture.openMedia('附件说明必须先翻译',false,${JSON.stringify(kind)});const root=document.querySelector('#fixture-media');const wrap=root.querySelector('[data-testid=media-caption-input-container]');wrap.removeAttribute('data-testid');const input=wrap.querySelector('[contenteditable]');input.removeAttribute('role');input.removeAttribute('data-lexical-editor');input.setAttribute('aria-label','Type a message');const send=root.querySelector('[role=button]');send.removeAttribute('aria-label');send.innerHTML='<span data-icon="wds-ic-send">➤</span>';send.onpointerup=send.onclick;send.onclick=null;const footer=document.createElement('footer');footer.append(wrap,send);root.append(footer);document.querySelector('#main').append(root);if(${JSON.stringify(kind)}==='image')root.querySelector('img').src='https://web.whatsapp.com/preview.png';if(${JSON.stringify(kind)}==='file')root.querySelector('[data-testid=document-preview]').innerHTML='<span data-icon="wds-ic-document-text">sample.pdf</span>';input.focus();return true})()`,
      );
      const count = await guest(first, 'fixture.mediaSent.length');
      let initialGesture = true;
      const submit = async () => {
        if (enter) {
          await guest(
            first,
            `document.querySelector('#fixture-media [contenteditable]').focus();true`,
          );
          for (const type of ['keyDown', 'keyUp'])
            await evaluate(
              `require('@electron/remote').webContents.fromId(${view}.getWebContentsId()).sendInputEvent(${JSON.stringify({ type, keyCode: 'Enter' })});true`,
            );
        } else {
          await clickGuest(
            '#fixture-media [role=button]',
            initialGesture && kind === 'image',
          );
        }
      };
      await submit();
      initialGesture = false;
      await wait(
        `${view}.executeJavaScript('document.querySelector("#fixture-media [contenteditable]")?.textContent==="Hello translated"')`,
        `${kind} generic footer caption translates before ${enter ? 'Enter' : 'pointerup'} send`,
      );
      assert.equal(
        await guest(first, 'fixture.mediaSent.length'),
        count,
        'first attachment gesture never submits the original',
      );
      await submit();
      await wait(
        `${view}.executeJavaScript('fixture.mediaSent.length===${count + 1}')`,
        'second attachment gesture confirms translation',
      );
      assert.equal(
        await guest(first, 'fixture.mediaSent.at(-1).caption'),
        'Hello translated',
      );
      assert.equal(await guest(first, 'fixture.mediaSent.at(-1).kind'), kind);
    }
  }
  assert.equal(await guest(first, 'fixture.mediaSent.length'), beforeMedia + 6);
  console.log(
    'PASS image/video/file generic footer captions, remote image previews, new send icon, native pointerup and Enter, separate confirmation and original-text protection',
  );
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

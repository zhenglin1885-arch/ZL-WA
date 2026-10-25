/* eslint-disable no-console, no-await-in-loop -- Sequential fixture account and actual main-process translation pipeline. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, wait, socket } from './account-tools-cdp.mjs';

const fixture = readFileSync(
  new URL('fixtures/whatsapp-tools.html', import.meta.url),
  'utf8',
);
const vm = code =>
  evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(code)})`,
  );
let id;
let before;
try {
  await wait(
    'window.ferdium?.stores?.services.allServicesRequest.wasExecuted',
    'services ready',
  );
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
    'isolated QA profile only',
  );
  before = await evaluate('window.ferdium.stores.services.all.map(s=>s.id)');
  await evaluate(
    `window.ferdium.stores.services._createService({recipeId:'whatsapp',serviceData:{name:'QA send pipeline',isEnabled:true},redirect:false})`,
  );
  id = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result.data.id',
  );
  assert(!before.includes(id));
  await vm(
    `(()=>{const req=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json');const s=req('electron').session.fromPartition('persist:service-${id}');s.protocol.handle('https',()=>new Response(${JSON.stringify(fixture)},{headers:{'Content-Type':'text/html;charset=utf-8'}}));globalThis.__zlPipelineSession=s;globalThis.__zlPipelineFetch=s.fetch;s.fetch=async(url,options)=>{if(new URLSearchParams(options.body).get('q')?.startsWith('取消'))await new Promise(r=>setTimeout(r,1800));return new Response(JSON.stringify([[['How are you?']]]),{status:200,headers:{'Content-Type':'application/json'}})};})();true`,
  );
  await evaluate(
    `window.ferdium.actions.service.setActive({serviceId:${JSON.stringify(id)}});true`,
  );
  const service = `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
  const guest = code =>
    evaluate(`${service}.webview.executeJavaScript(${JSON.stringify(code)})`);
  await wait(`!!${service}.webview`, 'fixture mounted');
  await evaluate(`${service}.webview.reload()`);
  await wait(
    `${service}.accountSnapshot.status==='online'&&!${service}.isLoading`,
    'fixture online',
  );
  await evaluate(
    `require('./features/accountTools/runtime').saveTools(${JSON.stringify(id)},{...require('./features/accountTools/config').defaultTools(),translation:{...require('./features/accountTools/config').defaultTools().translation,outgoing:true}})`,
  );
  await wait(
    `${service}.webview.executeJavaScript('!!window.__zlTranslation?.config.outgoing')`,
    'outgoing enabled',
  );
  await guest(
    `(()=>{const s=window.__zlTranslation;window.pipelineTrace=[];const describe=n=>n?.closest('#fixture-edit,#fixture-media')?.id||n?.outerHTML?.slice(0,100);const original=s.contextKey;s.contextKey=input=>{const current=original(input);pipelineTrace.push({type:'context',current,jobs:[...s.pending.values()].map(j=>({context:j.context,chat:j.chat,text:j.text})),focused:describe(document.activeElement),composer:describe(s.composer())});return current};const composer=s.composer;s.composer=()=>{const result=composer();if(s.pending.size)pipelineTrace.push({type:'composer',selected:describe(result),focused:describe(document.activeElement)});return result};return true})()`,
  );
  await evaluate(`${service}.webview.focus()`);
  await guest(
    `fixture.openEdit('取消中的编辑');document.querySelector('#fixture-edit [data-testid=fixture-edit-save]').click();true`,
  );
  await wait(
    `${service}.webview.executeJavaScript('window.__zlTranslation.busy')`,
    'old edit pending',
  );
  await guest(
    `document.querySelector('#fixture-edit [data-testid=fixture-edit-cancel]').click();fixture.openMedia('你好吗');document.querySelector('#fixture-media [role=button]').click();true`,
  );
  await wait(
    `${service}.webview.executeJavaScript('document.querySelector("#fixture-media [contenteditable]")?.textContent==="How are you?"')`,
    'cancelled edit cannot block next attachment translation',
  );
  await guest(
    `document.querySelector('#fixture-media [role=button]').click();true`,
  );
  assert.equal(await guest('fixture.edited.length'), 0);
  assert.equal(await guest('fixture.mediaSent.at(-1).caption'), 'How are you?');
  console.log(
    'PASS cancelled edit ignores its late result and immediately accepts a new caption translation',
  );
  for (const kind of ['edit', 'image', 'video', 'file']) {
    await (kind === 'edit'
      ? guest(
          `fixture.openEdit('你好吗');document.querySelector('#fixture-edit [data-testid=fixture-edit-save]').click();true`,
        )
      : guest(
          `document.querySelector('#main footer [contenteditable]').textContent='保留后台草稿';fixture.openMedia('你好吗',true,${JSON.stringify(kind)});document.querySelector('#fixture-media [role=button]').click();true`,
        ));
    const root = kind === 'edit' ? '#fixture-edit' : '#fixture-media';
    try {
      await wait(
        `${service}.webview.executeJavaScript(${JSON.stringify(`document.querySelector('${root} [contenteditable]')?.textContent==='How are you?'`)})`,
        `${kind} translated through real IPC/queue/native insertion`,
      );
    } catch (error) {
      console.error(
        await guest(
          `({kind:${JSON.stringify(kind)},status:document.querySelector('#zl-translation-status')?.textContent,trace:pipelineTrace})`,
        ),
      );
      throw error;
    }
    assert(await guest('Boolean(window.__zlTranslation.approved)'));
    await (kind === 'edit'
      ? guest(
          `document.querySelector('#fixture-edit [data-testid=fixture-edit-save]').click();true`,
        )
      : guest(
          `document.querySelector('#fixture-media [role=button]').click();true`,
        ));
    assert.equal(
      await guest(
        kind === 'edit'
          ? 'fixture.edited.at(-1)'
          : 'fixture.mediaSent.at(-1).caption',
      ),
      'How are you?',
    );
    console.log('PASS actual translation pipeline:', kind);
  }
} finally {
  await vm(
    `if(globalThis.__zlPipelineSession){globalThis.__zlPipelineSession.fetch=globalThis.__zlPipelineFetch;globalThis.__zlPipelineSession.protocol.unhandle('https')}delete globalThis.__zlPipelineSession;delete globalThis.__zlPipelineFetch;true`,
  ).catch(() => {});
  if (id && !before?.includes(id))
    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:false})`,
    ).catch(() => {});
  socket.close();
}

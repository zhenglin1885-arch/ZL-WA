/* eslint-disable no-console -- Real Chromium regression using a disposable offline page. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const proof = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const file = `${process.cwd()}/build/features/accountTools/guest.js`;
        delete req.cache[req.resolve(file)];
        const guest = req(file);
        const partition = `zl-caption-regression-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(
              '<!doctype html><meta charset="utf-8"><div id="main"><div class="message-in" data-id="false_10001@g.us_caption"><div class="copyable-text" data-pre-plain-text="caption"><img alt="photo"><span class="selectable-text">Bom dia, pessoal!<br>Seguimos juntos!</span></div></div></div>',
              { headers: { 'Content-Type': 'text/html' } },
            ),
        );
        const win = new BrowserWindow({
          show: false,
          webPreferences: { partition },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          return await win.webContents.executeJavaScript(`(async()=>{
          const tick=${guest.translationTick.toString()},result=${guest.translationResult.toString()};
          const config={incoming:true,outgoing:false,preview:false,receiveEngine:'Google',receiveSource:'auto',receiveTarget:'zh-CN'};
          const scan=()=>{if(window.__zlTranslation)window.__zlTranslation.dirty=true;return tick(config)};
          const source=()=>document.querySelector('.copyable-text');
          const replace=()=>source().replaceWith(source().cloneNode(true));
          const count=()=>document.querySelectorAll('[data-zl-translation]').length;
          scan();document.querySelector('[data-zl-translate]').click();
          const first=scan();if(first.length!==1)throw Error('Expected one translation request');
          const original=first[0].text;
          result(first[0].id,first[0].token,{text:'各位早安！一起前进！',error:false});
          for(let i=0;i<4;i++){
            replace();const requests=scan();
            if(count()!==1)throw Error('Caption replacement left '+count()+' translations after rebuild '+i);
            if(requests.length)throw Error('Completed caption requested translation again');
            if(document.querySelector('[data-zl-translation-text]').textContent!=='各位早安！一起前进！')throw Error('Cached translation lost');
          }
          document.querySelector('[data-zl-retranslate]').click();const pending=scan();
          if(pending.length!==1)throw Error('Expected one explicit refresh');
          replace();scan();
          if(count()!==1||window.__zlTranslation.pending.size!==1)throw Error('Pending caption duplicated after rebuild');
          result(pending[0].id,pending[0].token,{text:'刷新后的译文',error:false});
          if(document.querySelector('[data-zl-translation-text]').textContent!=='刷新后的译文')throw Error('Pending result lost after caption replacement');
          const rebuilt=document.querySelector('.message-in').cloneNode(true);
          document.querySelector('.message-in').replaceWith(rebuilt);scan();
          if(count()!==1||document.querySelector('[data-zl-translation-text]').textContent!=='刷新后的译文')throw Error('Whole bubble clone duplicated decoration or lost cached result');
          const state=window.__zlTranslation,oldToken=state.token;
          state.revision=8;scan();
          if(window.__zlTranslation.token===oldToken||count()!==1||document.querySelector('[data-zl-translation-text]').textContent!=='刷新后的译文')throw Error('Live guest upgrade lost successful cache or retained duplicate decorations');
          const orphan=document.querySelector('[data-zl-translation-text]').cloneNode(true);
          source().append(orphan);
          if(window.__zlTranslation.readText(source()).trim()!==original)throw Error('Generated translation was read back as source');
          const bubble=document.querySelector('.message-in');
          const second=bubble.cloneNode(true);second.dataset.id='false_10001@g.us_other';
          second.querySelectorAll('[data-zl-translation],[data-zl-translation-text]').forEach(n=>n.remove());
          bubble.after(second);scan();
          if(count()!==2)throw Error('Identical separate messages must each retain one translation');
          source().querySelector('.selectable-text').textContent='Nova mensagem editada';scan();
          if(count()!==2||document.querySelector('[data-zl-translation-text]').textContent)throw Error('Edited caption retained stale translation');
          document.querySelector('[data-zl-translate]').click();const edited=scan();
          if(edited.length!==1||edited[0].text!=='Nova mensagem editada')throw Error('Caption editing did not target new source');
          result(edited[0].id,edited[0].token,{text:'编辑后的译文',error:false});
          if(document.querySelector('[data-zl-translation-text]').textContent!=='编辑后的译文')throw Error('Edited caption result lost');
          return {rebuilds:4,oneTranslationPerMessage:true,pendingRebound:true,sourceUnchanged:true,cacheEntries:window.__zlTranslation.memo.size};
        })()`);
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )})`,
  );
  assert.equal(proof.oneTranslationPerMessage, true);
  assert.equal(proof.pendingRebound, true);
  assert.equal(proof.sourceUnchanged, true);
  console.log(
    'PASS caption subtree rebuilds retain one translation, reuse cache and pending requests, and exclude generated text from source',
  );
  console.log(JSON.stringify(proof));
} finally {
  socket.close();
}

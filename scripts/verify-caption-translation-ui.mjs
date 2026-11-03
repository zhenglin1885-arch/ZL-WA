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
          document.querySelector('#main').innerHTML='<div class="message-in" data-id="false_10001@g.us_nested"><div data-testid="msg-author">+55 11 93206-1077</div><div class="copyable-text"><img alt="photo"><div data-id="caption-part-1"><span class="selectable-text">Amanhã à noite, o professor Lucas apresentará uma análise.<br>原文里的中文也必须保留</span></div><div data-id="caption-part-2"><span class="selectable-text">Como amanhã será feriado, o grupo ficará fechado.</span></div><div data-id="caption-part-3"><span class="selectable-text">Agradecemos a companhia de todos nesta noite! 🌹</span></div><div data-testid="msg-meta">20:49</div><blockquote><span class="selectable-text">Quoted text must not be translated</span></blockquote></div></div>';
          scan();if(count()!==1)throw Error('Nested media caption created '+count()+' translation controls instead of one');
          document.querySelector('[data-zl-translate]').click();const nested=scan();
          if(nested.length!==1||!nested[0].text.includes('apresentará')||!nested[0].text.includes('ficará fechado')||!nested[0].text.includes('companhia')||!nested[0].text.includes('原文里的中文也必须保留')||nested[0].text.includes('93206')||nested[0].text.includes('20:49')||nested[0].text.includes('Quoted'))throw Error('Caption paragraphs were split or sender/quote metadata was included');
          const copy=document.querySelector('.message-in').cloneNode(true);document.querySelector('.message-in').replaceWith(copy);scan();
          if(count()!==1||window.__zlTranslation.pending.size!==1)throw Error('Rebuilt caption duplicated a pending request');
          result(nested[0].id,nested[0].token,{text:'只显示一次的完整译文',error:false});scan();
          if(count()!==1||document.querySelector('[data-zl-translation-text]').textContent!=='只显示一次的完整译文')throw Error('Rebuilt caption lost its original request result');
          for(let i=0;i<3;i++)scan();
          if(count()!==1||document.querySelector('[data-zl-translation-text]').textContent!=='只显示一次的完整译文')throw Error('Repeated scans duplicated the caption translation');
          const duplicated=document.querySelector('.message-in').cloneNode(true);document.querySelector('.message-in').after(duplicated);scan();
          if(count()!==1)throw Error('Two DOM representations of the same message retained duplicate translations');
          duplicated.dataset.id='false_10001@g.us_separate';scan();if(count()!==2)throw Error('Two distinct messages with identical captions were merged');
          document.querySelector('#main').innerHTML='<div class="message-in" data-id="false_10001@g.us_auto"><div class="copyable-text"><div data-id="part-one"><span class="selectable-text">Mensagem nova para tradução automática.</span></div><div data-id="part-two"><span class="selectable-text">Segundo parágrafo, sem pedido duplicado.</span></div><div data-id="part-three"><span class="selectable-text">Terceiro parágrafo completo.</span></div></div></div>';
          const preview={...config,preview:true};tick(preview);window.__zlTranslation.previewBlockedChat=undefined;window.__zlTranslation.dirty=true;
          const auto=tick(preview);if(auto.length!==1||!auto[0].text.includes('Terceiro'))throw Error('Preview split one caption into multiple requests');
          for(let i=0;i<3;i++){window.__zlTranslation.dirty=true;if(tick(preview).length)throw Error('A pending preview was queued twice');}
          result(auto[0].id,auto[0].token,{text:'自动译文只显示一次',error:false});window.__zlTranslation.dirty=true;tick(preview);
          if(count()!==1||document.querySelector('[data-zl-translation-text]').textContent!=='自动译文只显示一次')throw Error('Auto preview translated its own generated result');
          return {sameIdDomCopiesDeduplicated:true,distinctIdenticalMessagesPreserved:true,oneAutomaticCaptionRequest:true,nestedCaptionDeduplicated:true,fullCaptionPreserved:true,pendingWholeMessageRebound:true,rebuilds:4,oneTranslationPerMessage:true,pendingRebound:true,sourceUnchanged:true,cacheEntries:window.__zlTranslation.memo.size};
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

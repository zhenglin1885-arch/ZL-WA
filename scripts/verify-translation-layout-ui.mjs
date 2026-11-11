/* eslint-disable no-console -- Report real Chromium layout assertions. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

// Disposable guest: no account data, network requests or translation-provider calls.
const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:16px;font:16px/1.5 sans-serif}#main{width:100%}
.message-out{width:fit-content;max-width:80%;padding:8px;margin:12px 0;background:#14533e}
.copyable-text{font:18px/27px sans-serif}img{display:block;width:260px;max-width:100%;height:90px}
</style><div id="main"><div class="message-out" data-id="true_10001@c.us_media">
<div class="copyable-text" data-pre-plain-text="caption"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">
<div class="selectable-text">Lucas Henrique Varella<br>CEO | Oravion Capital<br><br>Gestão de riscos.<br>约17:22见面<span>17:22<span data-icon="msg-dblcheck"></span></span></div><span class="native-metadata">17:22<span data-icon="msg-dblcheck"></span></span><span role="button">Read more</span></div></div>
<div class="message-out" data-id="true_10001@c.us_short"><div class="copyable-text"><span class="selectable-text">Oi</span></div></div><div class="message-out" data-id="true_10001@c.us_medium"><div class="copyable-text"><span class="selectable-text">Sim tenho</span></div></div><div class="message-out" data-id="true_10001@c.us_long"><div class="copyable-text"><span class="selectable-text">Ainda tem interesse em receber uma lista de ações?</span></div></div></div>`;
const translated = `卢卡斯·瓦雷拉\n首席执行官 | 公司名称\n\n${'投资管理与金融科技，保留原始信息的内容宽度。'.repeat(16)}\n\n${'PortfolioRiskManagement'.repeat(12)}`;
try {
  const result = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run(input) {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const guestPath = `${process.cwd()}/build/features/accountTools/guest.js`;
        delete req.cache[req.resolve(guestPath)];
        const guest = req(guestPath);
        const partition = `zl-translation-layout-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(input.html, {
              headers: { 'Content-Type': 'text/html' },
            }),
        );
        const win = new BrowserWindow({
          show: false,
          width: 960,
          height: 750,
          webPreferences: { partition },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          return await win.webContents.executeJavaScript(`(async()=>{
          const tick=${guest.translationTick.toString()};
          const result=${guest.translationResult.toString()};
          const config={incoming:true,outgoing:false,preview:false,receiveEngine:'Google',receiveSource:'auto',receiveTarget:'zh-CN'};
          const bubbles=[...document.querySelectorAll('.message-out')];
          const widths=()=>bubbles.map(n=>n.getBoundingClientRect().width);
          const before=widths();
          const source=document.querySelector('.copyable-text');
          const originalStyle=source.getAttribute('style');
          tick(config);
          const manual=widths();
          const buttons=[...document.querySelectorAll('[data-zl-translate]')].map(button=>{
            const rect=button.getBoundingClientRect(),bubble=button.closest('.message-out').getBoundingClientRect();
            return {width:rect.width,height:rect.height,nowrap:getComputedStyle(button).whiteSpace==='nowrap',fits:button.scrollWidth<=button.clientWidth&&rect.left>=bubble.left&&rect.right<=bubble.right};
          });
          document.querySelectorAll('[data-zl-translate]').forEach(b=>b.click());
          const requests=tick(config);
          if(requests.length!==4)throw Error('Expected four manual translation jobs');
          const captionRequest=requests.find(job=>job.text.includes('Lucas'));
          if(!captionRequest?.text.includes('约17:22见面')||captionRequest.text.includes('Read more')||(captionRequest.text.match(/17:22/g)||[]).length!==1)throw Error('Timestamp leaked into translation or legitimate message time removed: '+JSON.stringify(captionRequest?.text));
          requests.forEach(job=>result(job.id,job.token,{text:${JSON.stringify(input.translated)},error:false,...(job.text.includes('Lucas')?{provider:'MyMemory'}:{})}));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const after=widths();
          const containers=[...document.querySelectorAll('[data-zl-translation]')];
          const labels=[...document.querySelectorAll('[data-zl-translation-text]')];
          const font=getComputedStyle(source).font;
          const details={before,manual,after,buttons,backupCached:window.__zlTranslation.memo.size===4,paragraphs:labels.every(n=>n.textContent===${JSON.stringify(input.translated)}),fonts:containers.every(n=>getComputedStyle(n).font===font),wraps:labels.every(n=>getComputedStyle(n).whiteSpace==='pre-wrap'),noOverflow:containers.every(n=>n.scrollWidth<=n.clientWidth+1),originalUntouched:source.getAttribute('style')===originalStyle};
          containers.forEach(n=>n.style.contain='none');
          details.uncontained=widths();
          containers.forEach(n=>n.style.contain='inline-size');
          document.querySelectorAll('[data-zl-retranslate]').forEach(b=>b.click());
          details.pending=widths();
          const retry=tick(config);retry.forEach(job=>result(job.id,job.token,{text:'',error:true,message:'Synthetic provider failure'}));
          details.failed=widths();
          details.visibleFailure=labels.every(n=>n.textContent==='翻译失败'&&n.title.includes('Synthetic provider failure'));
          details.singleLineErrors=labels.every(n=>getComputedStyle(n).whiteSpace==='nowrap');
          document.querySelector('#main').style.width='280px';
          containers.forEach(n=>n.style.display='none');
          details.narrowOriginal=widths();
          containers.forEach(n=>n.style.display='');
          details.narrowTranslated=widths();
          const tailCases=[
            {text:'我承认',font:16,width:48},
            {text:'赌博',font:18,width:50},
            {text:'桑德罗',font:28,width:60},
            {text:'我花2000',font:18,width:80},
            {text:'这是多行译文，按钮跟随最后一个字。',font:18,width:140},
            {text:'PortfolioRiskManagementWithoutSpaces',font:18,width:130},
            {text:'保留段落'+String.fromCharCode(10)+'最后一行'+String.fromCharCode(10,10),font:18,width:100},
            {text:'好的🙂',font:20,width:70},
          ];
          details.inlineRefresh=[];
          for(const [index,item]of tailCases.entries()){
            const root=document.querySelector('#main');
            root.innerHTML='<div class="message-in" data-id="false_10001@c.us_tail'+index+'" style="width:'+item.width+'px;padding:8px"><div class="copyable-text" style="font-size:'+item.font+'px;line-height:1.5"><span class="selectable-text">Confesso '+index+'</span></div></div>';
            window.__zlTranslation.dirty=true;tick(config);
            root.querySelector('[data-zl-translate]').click();const job=tick(config).find(j=>j.text==='Confesso '+index);
            if(!job)throw Error('Missing tail layout job');
            result(job.id,job.token,{text:item.text,error:false});
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            const label=root.querySelector('[data-zl-translation-text]'),icon=root.querySelector('[data-zl-retranslate]');
            const walker=document.createTreeWalker(label,NodeFilter.SHOW_TEXT);let textNode;for(let node=walker.nextNode();node;node=walker.nextNode())if(node.textContent.trim()&&!node.parentElement.closest('button'))textNode=node;
            const segment=[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(textNode.textContent)].at(-1);
            const range=document.createRange();range.setStart(textNode,segment.index);range.setEnd(textNode,textNode.textContent.length);
            const glyph=range.getBoundingClientRect(),button=icon.getBoundingClientRect();
            if(button.left<glyph.right-1||Math.abs((button.top+button.height/2)-(glyph.top+glyph.height/2))>Math.max(8,item.font*0.3))throw Error('Refresh separated from last translated glyph: '+JSON.stringify({item,glyph:glyph.toJSON(),button:button.toJSON()}));
            if(label.textContent!==item.text.trimEnd())throw Error('Refresh glyph contaminated translation text');
            details.inlineRefresh.push({font:item.font,width:item.width,inline:true});
          }
          const contextChat=async(id,sample)=>{
            const root=document.querySelector('#main');
            root.innerHTML='<div class="message-in" data-id="false_'+id+'_context"><div class="copyable-text"><span class="selectable-text">'+sample+'</span></div></div><div class="message-in" data-id="false_'+id+'_short"><div class="copyable-text"><span class="selectable-text">manda link</span></div></div>';
            window.__zlTranslation.dirty=true;tick(config);
            await new Promise(r=>setTimeout(r,650));window.__zlTranslation.dirty=true;tick(config);
            const button=root.querySelector('[data-id$="_short"] [data-zl-translate]');
            if(!button||button.hidden)throw Error('A different conversation reused a short-message cache');
            button.click();return tick(config).find(job=>job.text==='manda link');
          };
          const pt='não abaixei essa sua plataforma';
          const shortPt=await contextChat('10001@c.us',pt);
          if(shortPt?.sourceContext!==pt)throw Error('Private source sample missing or contaminated by injected translations');
          result(shortPt.id,shortPt.token,{text:'发链接',error:false,provider:'MyMemory'});
          const en='Please send the application download address so I can install it on my computer';
          const shortEn=await contextChat('10002@c.us',en);
          if(shortEn?.sourceContext!==en)throw Error('Private-chat source sample leaked across conversations');
          result(shortEn.id,shortEn.token,{text:'',error:true,message:'Short source needs configuration'});
          const shortGroup=await contextChat('10003@g.us',pt);
          if(!shortGroup||shortGroup.sourceContext!==undefined)throw Error('Group participants must not share a private-chat hint');
          details.privateContextScoped=true;
          details.groupContextExcluded=true;
          details.shortCacheIsolated=true;
          return details;
        })()`);
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})(${JSON.stringify({ html, translated })})`,
    )})`,
  );
  for (const button of result.buttons) {
    assert.equal(button.width, 76);
    assert.equal(button.height, 34);
    assert(
      button.nowrap && button.fits,
      'Fixed translate button fits its bubble without wrapping',
    );
  }
  for (const phase of ['manual', 'after', 'pending', 'failed'])
    result[phase].forEach((width, index) =>
      assert(
        Math.abs(
          width -
            (phase === 'after'
              ? Math.max(result.before[index], 68)
              : Math.max(result.before[index], 92)),
        ) < 1,
        `${phase}: translation widened bubble ${index}`,
      ),
    );
  assert(
    result.uncontained[0] > result.before[0] + 10,
    'fixture must reproduce intrinsic-width expansion without containment',
  );
  result.narrowTranslated.forEach((width, index) =>
    assert(
      Math.abs(width - Math.max(result.narrowOriginal[index], 92)) < 1,
      'narrow layout widened',
    ),
  );
  for (const flag of [
    'backupCached',
    'paragraphs',
    'fonts',
    'wraps',
    'noOverflow',
    'originalUntouched',
    'visibleFailure',
    'singleLineErrors',
    'privateContextScoped',
    'groupContextExcluded',
    'shortCacheIsolated',
  ])
    assert.equal(result[flag], true, flag);
  console.log(
    'PASS real Chromium: fixed single-line buttons fit short/medium/long/media bubbles; long translations stay contained; source typography and paragraphs preserved; metadata timestamps/read-more excluded while times in message text remain',
  );
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

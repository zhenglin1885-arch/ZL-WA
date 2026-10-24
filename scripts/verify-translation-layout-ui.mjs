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
<div class="message-out" data-id="true_10001@c.us_short"><div class="copyable-text"><span class="selectable-text">Hello</span></div></div></div>`;
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
          document.querySelectorAll('[data-zl-translate]').forEach(b=>b.click());
          const requests=tick(config);
          if(requests.length!==2)throw Error('Expected two manual translation jobs');
          const captionRequest=requests.find(job=>job.text.includes('Lucas'));
          if(!captionRequest?.text.includes('约17:22见面')||captionRequest.text.includes('Read more')||(captionRequest.text.match(/17:22/g)||[]).length!==1)throw Error('Timestamp leaked into translation or legitimate message time removed: '+JSON.stringify(captionRequest?.text));
          requests.forEach(job=>result(job.id,job.token,{text:${JSON.stringify(input.translated)},error:false}));
          await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
          const after=widths();
          const containers=[...document.querySelectorAll('[data-zl-translation]')];
          const labels=[...document.querySelectorAll('[data-zl-translation-text]')];
          const font=getComputedStyle(source).font;
          const details={before,manual,after,paragraphs:labels.every(n=>n.textContent===${JSON.stringify(input.translated)}),fonts:containers.every(n=>getComputedStyle(n).font===font),wraps:labels.every(n=>getComputedStyle(n).whiteSpace==='pre-wrap'),noOverflow:containers.every(n=>n.scrollWidth<=n.clientWidth+1),originalUntouched:source.getAttribute('style')===originalStyle};
          containers.forEach(n=>n.style.contain='none');
          details.uncontained=widths();
          containers.forEach(n=>n.style.contain='inline-size');
          document.querySelector('[data-zl-retranslate]').click();
          details.pending=widths();
          const retry=tick(config);retry.forEach(job=>result(job.id,job.token,{text:'',error:true,message:'Synthetic provider failure'}));
          details.failed=widths();
          details.visibleFailure=labels[0].textContent.includes('Synthetic provider failure');
          document.querySelector('#main').style.width='280px';
          containers.forEach(n=>n.style.display='none');
          details.narrowOriginal=widths();
          containers.forEach(n=>n.style.display='');
          details.narrowTranslated=widths();
          return details;
        })()`);
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})(${JSON.stringify({ html, translated })})`,
    )})`,
  );
  for (const phase of ['manual', 'after', 'pending', 'failed'])
    result[phase].forEach((width, index) =>
      assert(
        Math.abs(width - result.before[index]) < 1,
        `${phase}: translation widened bubble ${index}`,
      ),
    );
  assert(
    result.uncontained[0] > result.before[0] + 10,
    'fixture must reproduce intrinsic-width expansion without containment',
  );
  result.narrowTranslated.forEach((width, index) =>
    assert(
      Math.abs(width - result.narrowOriginal[index]) < 1,
      'narrow layout widened',
    ),
  );
  for (const flag of [
    'paragraphs',
    'fonts',
    'wraps',
    'noOverflow',
    'originalUntouched',
    'visibleFailure',
  ])
    assert.equal(result[flag], true, flag);
  console.log(
    'PASS real Chromium: media/text bubble widths unchanged during manual translation, long results, refresh and failure; source typography and paragraphs preserved; metadata timestamps/read-more excluded while times in message text remain',
  );
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

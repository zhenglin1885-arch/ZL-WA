/* eslint-disable no-console, no-await-in-loop, no-continue -- Sequential trusted native events in disposable Chromium pages. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const results = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow, session } = req('electron');
        const file = `${process.cwd()}/build/features/accountTools/guest.js`;
        delete req.cache[req.resolve(file)];
        const guest = req(file);
        const partition = `zl-send-surfaces-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        let html = '';
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(html, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }),
        );
        const win = new BrowserWindow({
          show: true,
          width: 1000,
          height: 800,
          webPreferences: { partition },
        });
        const execute = code => win.webContents.executeJavaScript(code);
        const reports = [];
        const config = {
          outgoing: true,
          incoming: false,
          preview: false,
          engine: 'Google',
          receiveEngine: 'Google',
          source: 'auto',
          sendTarget: 'en',
          receiveTarget: 'zh-CN',
          receiveSource: 'auto',
        };
        try {
          for (const variant of [
            'edit-main',
            'edit-plaintext',
            'image',
            'video',
            'file',
          ]) {
            for (const gesture of ['mouse', 'Enter']) {
              const edit = variant.startsWith('edit');
              const media =
                variant === 'image'
                  ? '<img src="blob:https://web.whatsapp.com/A" width="250" height="250">'
                  : variant === 'video'
                    ? '<video src="blob:https://web.whatsapp.com/A" style="width:250px;height:250px"></video>'
                    : '<div><span data-icon="wds-ic-document-text"></span><span title="report.pdf">report.pdf</span></div>';
              html = `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif}#main{position:fixed;inset:20px;background:#fff;padding:20px}#editor{padding:15px;min-height:40px;border:1px solid #ddd}button{padding:20px}#background{position:fixed;left:0;bottom:0}</style><div id="app"><div id="background"><div contenteditable="true">保留后台草稿</div></div><div id="main" ${variant === 'edit-plaintext' ? 'role="dialog"' : ''}>${edit ? '<div><button aria-label="Dismiss"><svg></svg></button><div>Edit message</div></div><div data-id="true_chat_A">Are you OK</div>' : media}<div>${'<div>'.repeat(14)}<div id="editor" role="textbox" contenteditable="${variant === 'edit-plaintext' ? 'plaintext-only' : 'true'}" aria-label="Type a message">你好吗</div>${'</div>'.repeat(14)}</div><div><button id="confirm"><span data-icon="${edit ? 'wds-ic-checkmark-large' : 'wds-ic-send-filled'}">${edit ? '✓' : '➤'}</span></button></div></div></div>`;
              await win.loadURL('https://web.whatsapp.com/');
              await execute(
                `window.sent=[];window.nativeText='你好吗';window.trustedInputs=0;const editor=document.querySelector('#editor');editor.addEventListener('input',event=>{window.nativeText=editor.innerText;if(event.isTrusted)window.trustedInputs++});const submit=()=>{if(!window.sent.length)window.sent.push(window.nativeText)};document.querySelector('#main').addEventListener('pointerup',event=>{if(event.target.closest('#confirm'))submit()},true);editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submit()}});window.tick=${guest.translationTick.toString()};window.deliver=${guest.translationResult.toString()};window.config=${JSON.stringify(config)};tick(config);editor.focus();true`,
              );
              const submit = async () => {
                win.webContents.focus();
                await execute('new Promise(r=>requestAnimationFrame(r))');
                if (gesture === 'Enter') {
                  await execute(
                    `document.querySelector('#editor').focus();true`,
                  );
                  for (const type of ['keyDown', 'keyUp'])
                    win.webContents.sendInputEvent({ type, keyCode: 'Enter' });
                } else {
                  const point = await execute(
                    `(()=>{const r=document.querySelector('#confirm').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
                  );
                  for (const type of ['mouseDown', 'mouseUp'])
                    win.webContents.sendInputEvent({
                      type,
                      ...point,
                      button: 'left',
                      clickCount: 1,
                    });
                }
                await execute('new Promise(r=>requestAnimationFrame(r))');
              };
              await submit();
              const first = await execute(
                `({sent:window.sent.slice(),jobs:tick(config)})`,
              );
              if (first.sent.length > 0 || first.jobs.length !== 1) {
                reports.push({
                  variant,
                  gesture,
                  failed: 'raw send or missing translation job',
                  ...first,
                });
                continue;
              }
              const job = first.jobs[0];
              if (job.text !== '你好吗')
                throw new Error(
                  'Provider received preview/metadata instead of the draft',
                );
              // Provider failure must keep both an edit and a caption unsaved.
              await execute(
                `deliver(${job.id},${JSON.stringify(job.token)},{text:'',error:true,message:'Synthetic provider failure'});true`,
              );
              if (
                await execute(
                  `window.sent.length || document.querySelector('#editor').innerText!=='你好吗'`,
                )
              )
                throw new Error('Provider error sent or changed source text');
              await submit();
              const retry = await execute('tick(config)');
              if (retry.length !== 1)
                throw new Error('Cannot retry after provider failure');
              const next = retry[0];
              const args = `${next.id},${JSON.stringify(next.token)},{text:'How are you?',error:false}`;
              if (!(await execute(`deliver(${args},'prepare')`)))
                throw new Error(
                  'Outgoing context invalid before native insert',
                );
              if (!(await execute(`deliver(${args},'selected')`)))
                throw new Error('Draft selection invalid');
              await win.webContents.insertText('How are you?');
              await execute(`deliver(${args},'complete');true`);
              const preview = await execute(
                `({sent:sent.slice(),text:document.querySelector('#editor').innerText,approved:!!window.__zlTranslation.approved,trustedInputs,background:document.querySelector('#background').innerText})`,
              );
              if (
                preview.sent.length > 0 ||
                preview.text !== 'How are you?' ||
                !preview.approved ||
                !preview.trustedInputs ||
                preview.background !== '保留后台草稿'
              )
                throw new Error(
                  `Native translated preview/isolated draft verification failed: ${JSON.stringify(
                    preview,
                  )}`,
                );
              await submit();
              const sent = await execute('window.sent');
              if (sent.length !== 1 || sent[0] !== 'How are you?')
                throw new Error(
                  `Confirmation failed to save translated content: ${JSON.stringify(
                    sent,
                  )}`,
                );
              reports.push({
                variant,
                gesture,
                translated: sent[0],
                failureProtected: true,
                trustedInputs: preview.trustedInputs,
              });
            }
          }
          return reports;
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )} )`,
  );
  console.log(JSON.stringify(results));
  assert(
    results.every(report => !report.failed),
    'every edit/media surface must intercept before native save',
  );
  console.log(
    'PASS native click/Enter edit, image/video/file captions, deep/inline/plaintext editors, failed-provider retry, native replacement and original-send protection',
  );
} finally {
  socket.close();
}

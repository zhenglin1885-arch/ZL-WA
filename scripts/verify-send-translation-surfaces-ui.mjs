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
        const replaceDraft = async text => {
          await execute(
            `(()=>{const e=document.querySelector('#editor');e.focus();const r=document.createRange();r.selectNodeContents(e);const s=window.getSelection();s.removeAllRanges();s.addRange(r);})()`,
          );
          await win.webContents.insertText(text);
        };
        const reports = [];
        const config = {
          blockChinese: true,
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
            'chat',
            'reply',
            'edit-main',
            'edit-plaintext',
            'edit-live-modal',
            'image',
            'video',
            'file',
            'image-live-drawer',
            'video-live-drawer',
            'file-live-drawer',
            'multiple-live-drawer',
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
              if (variant === 'chat' || variant === 'reply') {
                html = `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif}footer{margin-top:160px}#editor{padding:15px;min-height:40px;border:1px solid #ddd}#confirm{padding:20px}#background{position:fixed;left:0;bottom:0}</style><div id="main"><header><span data-id="chat-A" title="Contact">Contact</span></header>${variant === 'reply' ? '<div data-testid="quoted-message">中文引用原文，不是待发送的正文</div>' : ''}<footer><div id="editor" role="textbox" contenteditable="true" data-testid="conversation-compose-box-input">你好吗</div><button id="confirm" aria-label="Send"><span data-icon="send">Send</span></button></footer></div><div id="background"><div contenteditable="true">保留后台草稿</div></div>`;
              }
              if (variant === 'edit-live-modal') {
                // Captured user structure: modal before the chat, a visible
                // background composer, bare SVGs and only an accessible label
                // on save. No data-icon/test ID on the save button.
                html = `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif}#editor{padding:15px;min-height:40px;border:1px solid #ddd}button{padding:20px}#background{position:fixed;left:0;bottom:0}</style><div id="app"><div role="dialog"><div data-testid="confirm-popup"><div data-testid="popup-contents"><div data-testid="edit-message-modal"><header><button aria-label="Close"><svg></svg></button><div>Edit message</div></header><div data-id="true_chat_A">Are you OK</div>${'<div>'.repeat(6)}<div id="editor" role="textbox" data-testid="edit-message-composer" contenteditable="true">你好吗</div>${'</div>'.repeat(6)}<div role="button"><svg></svg></div><button id="confirm" aria-label="Send edited message"><svg width="24" height="24"><path d="M1 12L8 20L23 1"/></svg></button></div></div></div></div><div id="main"><footer id="background"><div role="textbox" data-testid="conversation-compose-box-input" contenteditable="true">保留后台草稿</div><button aria-label="Send"><svg></svg></button></footer></div></div>`;
              }
              if (variant.endsWith('live-drawer')) {
                // User capture: no modal/media-editor marker or data-icon;
                // caption is itself editable and send is a labelled DIV.
                // A document has no image or recognizable legacy file icon.
                const attachment = variant.startsWith('file')
                  ? '<div><svg></svg><span title="report.pdf">report.pdf</span></div>'
                  : variant.startsWith('video')
                    ? '<video src="blob:https://web.whatsapp.com/A" style="width:250px;height:250px"></video>'
                    : '<img src="blob:https://web.whatsapp.com/A" width="250" height="250">';
                html = `<!doctype html><meta charset="utf-8"><style>body{font:16px sans-serif}#editor{padding:15px;min-height:40px;border:1px solid #ddd}#confirm{padding:20px;width:60px;height:60px}#background{position:fixed;left:0;bottom:0}</style><div id="app"><div data-testid="drawer-middle">${'<div>'.repeat(7)}${attachment}${'<div>'.repeat(5)}<div id="editor" role="textbox" data-testid="media-caption-input-container" contenteditable="true">你好吗</div>${'</div>'.repeat(5)}<div id="confirm" role="button" aria-label="Send ${variant.startsWith('multiple') ? 12 : 1} selected"><svg width="24" height="24"><path d="M1 1L23 12L1 23"/></svg></div>${'</div>'.repeat(7)}</div><div id="main"><footer id="background"><div role="textbox" data-testid="conversation-compose-box-input" contenteditable="true">保留后台草稿</div><button aria-label="Send"><svg></svg></button></footer></div></div>`;
              }
              await win.loadURL('https://web.whatsapp.com/');
              await execute(
                `window.sent=[];window.nativeText='你好吗';window.trustedInputs=0;const editor=document.querySelector('#editor');editor.addEventListener('input',event=>{window.nativeText=editor.innerText;if(event.isTrusted)window.trustedInputs++});const submit=()=>{if(!window.sent.length)window.sent.push(window.nativeText)};(document.querySelector('[data-testid="edit-message-modal"],[data-testid="drawer-middle"]')||document.querySelector('#main')).addEventListener('pointerup',event=>{if(event.target.closest('#confirm'))submit()},true);editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();submit()}});window.tick=${guest.translationTick.toString()};window.deliver=${guest.translationResult.toString()};window.config=${JSON.stringify(config)};tick(config);editor.focus();true`,
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
              await execute(
                'sent=[];config.outgoing=false;config.blockChinese=true;tick(config);true',
              );
              await replaceDraft('mixed 中文 𠮷');
              await submit();
              const blocked = await execute(
                `({sent:sent.slice(),notice:document.querySelector('#zl-translation-status')?.textContent,text:document.querySelector('#editor').innerText})`,
              );
              if (
                blocked.sent.length > 0 ||
                blocked.notice !== '禁止发送中文' ||
                blocked.text !== 'mixed 中文 𠮷'
              )
                throw new Error(
                  `Chinese text was sent or draft was lost ${JSON.stringify(
                    blocked,
                  )}`,
                );
              if (variant === 'chat' || variant === 'reply') {
                const positioned = await execute(
                  `(()=>{const n=document.querySelector('#zl-translation-status').getBoundingClientRect(),b=document.querySelector('#editor').closest('footer').getBoundingClientRect();return n.bottom<=b.top-7&&n.left>=b.left-1&&n.right<=innerWidth-7})()`,
                );
                if (!positioned)
                  throw new Error(
                    'Chinese warning was not placed above the active composer',
                  );
                win.setSize(760, 640);
                await execute(
                  'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
                );
                const resized = await execute(
                  `(()=>{const n=document.querySelector('#zl-translation-status').getBoundingClientRect(),b=document.querySelector('#editor').closest('footer').getBoundingClientRect();return n.bottom<=b.top-7&&n.left>=7&&n.right<=innerWidth-7})()`,
                );
                if (!resized)
                  throw new Error(
                    'Chinese warning lost its composer anchor after resize',
                  );
                win.setSize(1000, 800);
              }
              await execute('config.outgoing=true;tick(config);true');
              await submit();
              const policyJobs = await execute('tick(config)');
              const policyJob = policyJobs.find(
                candidate => candidate.direction === 'outgoing',
              );
              if (!policyJob)
                throw new Error(
                  'Chinese draft was blocked before allowed translation',
                );
              const policyArgs = `${policyJob.id},${JSON.stringify(policyJob.token)},{text:'译文仍含中文',error:false}`;
              if (
                !(await execute(`deliver(${policyArgs},'prepare')`)) ||
                !(await execute(`deliver(${policyArgs},'selected')`))
              )
                throw new Error('Could not prepare Chinese provider output');
              await win.webContents.insertText('译文仍含中文');
              await execute(`deliver(${policyArgs},'complete');true`);
              await submit();
              if (
                (await execute('sent.length')) !== 0 ||
                (await execute(
                  `document.querySelector('#zl-translation-status')?.textContent`,
                )) !== '禁止发送中文'
              )
                throw new Error(
                  'Approved provider output containing Chinese bypassed the guard',
                );
              await execute('config.outgoing=false;tick(config);true');
              await replaceDraft('Allowed English');
              await submit();
              if ((await execute('sent[0]')) !== 'Allowed English')
                throw new Error('Foreign text was incorrectly blocked');
              await execute(
                'sent=[];config.outgoing=false;config.blockChinese=false;tick(config);true',
              );
              await replaceDraft('关闭后允许中文');
              await submit();
              if ((await execute('sent[0]')) !== '关闭后允许中文')
                throw new Error('Disabled guard still blocked Chinese');
              reports.push({
                variant,
                gesture,
                translated: sent[0],
                failureProtected: true,
                blockChinese: true,
                composerNoticePosition:
                  variant === 'chat' || variant === 'reply',
                translatedChineseBlocked: true,
                disabledRestored: true,
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

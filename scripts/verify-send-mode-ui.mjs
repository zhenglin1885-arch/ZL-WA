/* Native Chromium key and composer regression with local, isolated chat pages. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';
try {
  const result = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function verify() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const { BrowserWindow, session } = req('electron');
        delete req.cache[
          req.resolve(process.cwd() + '/build/features/accounts/sendMode.js')
        ];
        const configure = req(
          process.cwd() + '/build/features/accounts/sendMode.js',
        ).configureMessageSendMode;
        const { translationTick, translationResult } = req(
          process.cwd() + '/build/features/accountTools/guest.js',
        );
        const config = req(
          process.cwd() + '/build/features/accountTools/config.js',
        ).defaultTools().translation;
        const partition = session.fromPartition('qa-send-mode-' + Date.now());
        const html =
          '<!doctype html><meta charset="utf-8"><div role="main" id="main"><header><span title="QA recipient">QA</span></header><form><footer><div id="draft" contenteditable="true" role="textbox" data-testid="conversation-compose-box-input" style="white-space:pre-wrap;min-height:60px">hello</div><button type="button" aria-label="Send">Send</button></footer></form></div><input id="search"><script>window.sends=0;document.querySelector("button").onclick=()=>window.sends++;document.addEventListener("keydown",e=>{if(e.target.closest("footer")&&e.key==="Enter"&&!e.shiftKey){e.preventDefault();document.querySelector("button").click()}});</script>';
        await partition.protocol.handle(
          'https',
          () =>
            new Response(html, {
              headers: { 'Content-Type': 'text/html; charset=utf-8' },
            }),
        );
        const win = new BrowserWindow({
          show: true,
          width: 850,
          height: 650,
          webPreferences: { session: partition },
        });
        const reports = {};
        try {
          win.webContents.debugger.attach('1.3');
          const js = async code => {
            const r = await win.webContents.executeJavaScript(
              `(async()=>{try{return {ok:true,value:await eval(${JSON.stringify(code)})}}catch(e){return {ok:false,error:String(e.stack||e)}}})()`,
            );
            if (!r.ok) throw Error(r.error);
            return r.value;
          };
          const press = async (shift = false, repeat = false) => {
            win.focus();
            win.webContents.focus();
            await js("document.querySelector('#draft').focus()");
            await win.webContents.debugger.sendCommand(
              'Input.dispatchKeyEvent',
              {
                type: 'keyDown',
                key: 'Enter',
                code: 'Enter',
                windowsVirtualKeyCode: 13,
                text: '\r',
                unmodifiedText: '\r',
                modifiers: shift ? 8 : 0,
                autoRepeat: repeat,
              },
            );
            await win.webContents.debugger.sendCommand(
              'Input.dispatchKeyEvent',
              {
                type: 'keyUp',
                key: 'Enter',
                code: 'Enter',
                windowsVirtualKeyCode: 13,
                modifiers: shift ? 8 : 0,
              },
            );
          };
          for (const host of ['web.whatsapp.com', 'business.facebook.com']) {
            await win.loadURL('https://' + host + '/');
            await js(`(${configure.toString()})('enter')`);
            await js('document.querySelector("#draft").focus()');
            await press();
            if ((await js('sends')) !== 1)
              throw Error(host + ' changed default Enter');
            await js(`(${configure.toString()})('shift-enter')`);
            await press();
            if ((await js('sends')) !== 1)
              throw Error(host + ' Enter sent in shift mode');
            if (
              !(await js(
                'document.querySelector("#draft").innerText.includes("\\n")',
              ))
            )
              throw Error(host + ' Enter did not insert a native newline');
            win.webContents.undo();
            if (
              await js(
                'document.querySelector("#draft").innerText.includes("\\n")',
              )
            )
              throw Error(host + ' native newline undo failed');
            await press(true);
            if ((await js('sends')) !== 2)
              throw Error(host + ' Shift Enter did not send exactly once');
            await press(true, true);
            if ((await js('sends')) !== 2)
              throw Error(host + ' held key duplicated send');
            await js(
              'document.querySelector("#draft").dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",shiftKey:true,isComposing:true,bubbles:true,cancelable:true}))',
            );
            if ((await js('sends')) !== 2) throw Error('IME composition sent');
            await js('document.querySelector("button").disabled=true');
            await press(true);
            if ((await js('sends')) !== 2) throw Error('Disabled button sent');
            await js('document.querySelector("button").disabled=false');
            await js(`(${configure.toString()})('enter')`);
            await press();
            if ((await js('sends')) !== 3)
              throw Error('Switching back did not restore Enter');
            reports[host] = {
              defaultEnter: true,
              enterNewline: true,
              nativeUndo: true,
              shiftEnterSingleSend: true,
              heldKeySuppressed: true,
              imeIgnored: true,
              disabledButtonIgnored: true,
              liveModeSwitch: true,
            };
          }
          for (const context of ['text', 'quote', 'media', 'edit']) {
            await win.loadURL('https://web.whatsapp.com/');
            await js(
              `(()=>{const footer=document.querySelector('footer');if(${JSON.stringify(context)}==='quote')footer.insertAdjacentHTML('afterbegin','<div data-testid="reply-context">Quoted message</div>');if(${JSON.stringify(context)}==='media'||${JSON.stringify(context)}==='edit'){const root=document.createElement('div');root.setAttribute('role','dialog');root.dataset.testid=${JSON.stringify(context)}==='media'?'media-editor':'edit-message-dialog';if(${JSON.stringify(context)}==='media')root.innerHTML='<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">';else root.innerHTML='<h1>Edit message</h1>';root.append(...footer.childNodes);footer.replaceWith(root);if(${JSON.stringify(context)}==='edit')root.querySelector('button').setAttribute('aria-label','Send edited message');else root.querySelector('#draft').setAttribute('aria-label','Add a caption');}return true})()`,
            );
            await js(
              `(${configure.toString()})('shift-enter');window.tick=${translationTick.toString()};window.result=${translationResult.toString()};window.cfg=${JSON.stringify({ ...config, outgoing: true, preview: true })};tick(cfg,false);document.querySelector('#draft').textContent='Hello original';document.querySelector('#draft').focus()`,
            );
            await press(true);
            const jobs = await js('tick(cfg)');
            if (jobs.length !== 1 || (await js('sends')) !== 0)
              throw Error('Translation preview bypassed');
            const job = jobs[0];
            await js(
              `result(${job.id},${JSON.stringify(job.token)},{text:'Hello translated',error:false},'prepare')`,
            );
            await press();
            if ((await js('sends')) !== 0)
              throw Error('Newline confirmed translation');
            await press(true);
            if ((await js('sends')) !== 1)
              throw Error(
                'Second Shift Enter did not confirm through click path',
              );
            reports[context + 'Translation'] = {
              firstShortcutOnlyPreviews: true,
              plainEnterDoesNotConfirm: true,
              secondShortcutConfirmsExactlyOnce: true,
            };
          }
          return reports;
        } finally {
          win.destroy();
          await partition.protocol.unhandle('https');
        }
      }.toString()})()`,
    )})`,
  );
  assert(result.textTranslation.secondShortcutConfirmsExactlyOnce);
  console.log(
    'PASS native Enter/Shift+Enter modes, newline/undo input path, IME, held keys, disabled buttons, live switching, Facebook and WhatsApp translation two-step confirmation',
  );
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

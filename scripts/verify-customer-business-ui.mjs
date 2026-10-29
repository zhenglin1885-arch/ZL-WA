/* eslint-disable no-console -- Offline Chromium regression output. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const result = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function verify() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const fs = req('node:fs');
        const vm = req('node:vm');
        const { BrowserWindow, session } = req('electron');
        const exportsFor = file => {
          const module = { exports: {} };
          vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
            module,
            exports: module.exports,
          });
          return module.exports;
        };
        const current = exportsFor(
          `${process.cwd()}/build/features/customers/guest.js`,
        );
        const fixture = fs.readFileSync(
          `${process.cwd()}/scripts/fixtures/whatsapp-tools.html`,
          'utf8',
        );
        const partition = `zl-business-row-${Date.now()}`;
        const isolated = session.fromPartition(partition);
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(fixture, { headers: { 'Content-Type': 'text/html' } }),
        );
        const win = new BrowserWindow({
          show: false,
          width: 1100,
          height: 800,
          webPreferences: { partition },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          const proof = await win.webContents.executeJavaScript(`(async()=>{
          const read=${current.readCustomerContext.toString()},tick=${current.customerTick.toString()};
          const model=fixture.chats[1],id=model.id._serialized;
          model.name='10002';model.formattedTitle='10002';model.contact={verifiedName:'AUVP',pushname:'previous name'};
          const row=()=>document.querySelector('[data-id="'+id+'"]');
          const title=()=>row().querySelector('[data-testid="cell-frame-title"]');
          const name=()=>title().querySelector('span');
          const owner=read().owners[0];
          const data={owner,revision:1,summaries:{[id]:{remarkName:'1',flags:['priority']}},aliases:{},pins:[],pinsInitialized:true};
          const render=async()=>{read();tick(data,id);await new Promise(r=>setTimeout(r,180));tick(undefined,id);};
          const check=(condition,message)=>{if(!condition)throw Error(message)};
          const valid=()=>row().querySelector('.zl-chat-note')?.value==='1'&&!!row().querySelector('[aria-label="重点"]');
          fixture.renderChats();name().title='AUVP';name().textContent='AUVP';
          row().querySelector('.fixture-preview').textContent='Waiting for this message. This may take a while.';
          document.querySelector('#main header span').removeAttribute('title');document.querySelector('#main header span').setAttribute('dir','auto');document.querySelector('#main header span').textContent='AUVP';
          await render();check(valid(),'Verified business title did not receive its saved note and flag');
          check(!!document.querySelector('#main header [aria-label="重点"]'),'Business header flag missing');
          name().removeAttribute('title');name().setAttribute('dir','auto');name().textContent='New presentation not in contact model';
          await render();check(valid(),'Exact native ID still depended on the displayed name');
          name().textContent='AUVP';delete row().__reactProps$fixture;row().removeAttribute('data-id');
          await render();const anonymous=document.querySelector('#pane-side [role="row"]:last-child');
          check(anonymous.querySelector('.zl-chat-note')?.value==='1','Unique verified-name fallback failed');
          const duplicate={id:{_serialized:'10003@c.us',server:'c.us',user:'10003'},name:'10003',contact:{verifiedName:'AUVP'}};
          fixture.chats.push(duplicate);await render();
          check(!anonymous.querySelector('.zl-chat-note')&&!anonymous.querySelector('.zl-customer-flags'),'Ambiguous recycled row retained another customer note or flag');
          anonymous.dataset.id=id;anonymous.__reactProps$fixture={chat:model};await render();
          check(valid(),'Exact ID did not disambiguate duplicate business names');
          check(row().querySelector('.fixture-preview').textContent.startsWith('Waiting for this message'),'Native pending-message preview was changed');
          const note=row().querySelector('.zl-chat-note');note.focus();note.value='new business note';note.dispatchEvent(new Event('input',{bubbles:true}));note.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
          const actions=tick(undefined,id);
          check(actions.some(a=>a.action==='saveRemark'&&a.chatId===id&&a.value==='new business note'&&a.owner===owner),'Inline note saved to wrong account/chat');
          note.blur();const bounds=note.getBoundingClientRect();
          return {verifiedBusiness:true,exactIdWithChangedDisplay:true,titleWithoutAttribute:true,uniqueAlias:true,duplicateNamesProtected:true,staleWidgetsRemoved:true,waitingPreviewPreserved:true,inlineSaveOwnerCorrect:true,point:{x:Math.round(bounds.x+bounds.width/2),y:Math.round(bounds.y+bounds.height/2)}};
        })()`);
          win.show();
          win.focus();
          win.webContents.focus();
          win.webContents.sendInputEvent({
            type: 'mouseDown',
            ...proof.point,
            button: 'left',
            clickCount: 1,
          });
          win.webContents.sendInputEvent({
            type: 'mouseUp',
            ...proof.point,
            button: 'left',
            clickCount: 1,
          });
          await new Promise(resolve => {
            setTimeout(resolve, 100);
          });
          const focused = await win.webContents.executeJavaScript(
            `document.activeElement?.classList.contains('zl-chat-note')`,
          );
          if (!focused)
            throw new Error(
              'Native mouse input did not focus the business note',
            );
          delete proof.point;
          return { ...proof, nativeMouseFocus: true };
        } finally {
          win.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )} )`,
  );
  assert.equal(result.verifiedBusiness, true);
  console.log(
    'PASS offline Chromium business contact notes/flags and virtual-row identity regression',
  );
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

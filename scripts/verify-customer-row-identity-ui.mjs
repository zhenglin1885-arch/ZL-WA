/* eslint-disable no-console -- Offline native Chromium customer row regression. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const program = `(${async function verify() {
    const req = process
      .getBuiltinModule('module')
      .createRequire(`${process.cwd()}/package.json`);
    const fs = req('node:fs');
    const vm = req('node:vm');
    const { BrowserWindow, session } = req('electron');
    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(
        `${process.cwd()}/build/features/customers/guest.js`,
        'utf8',
      ),
      { module, exports: module.exports },
    );
    const partition = session.fromPartition(`zl-row-identity-${Date.now()}`);
    const fixture = fs.readFileSync(
      `${process.cwd()}/scripts/fixtures/whatsapp-tools.html`,
      'utf8',
    );
    await partition.protocol.handle(
      'https',
      () => new Response(fixture, { headers: { 'Content-Type': 'text/html' } }),
    );
    const win = new BrowserWindow({
      show: false,
      width: 1100,
      height: 800,
      webPreferences: { session: partition },
    });
    try {
      await win.loadURL('https://web.whatsapp.com/');
      const proof = await win.webContents.executeJavaScript(`(async()=>{
        const tick=${module.exports.customerTick.toString()}, read=${module.exports.readCustomerContext.toString()};
        const check=(condition,message)=>{if(!condition)throw Error(message)};
        const owner=read().owners[0], model=fixture.chats[1], id=model.id._serialized, other=fixture.chats[0].id._serialized;
        const data={owner,revision:1,summaries:{[id]:{remarkName:'saved original note',flags:['priority']}},aliases:{'20002@lid':id},pins:[],pinsInitialized:true};
        model.name='stored phone name';model.formattedTitle='stored phone name';model.contact={name:'stored phone name'};fixture.renderChats();
        const row=document.querySelector('[data-id="'+id+'"]'), title=row.querySelector('[data-testid="cell-frame-title"]'), name=title.querySelector('span');
        const originalHeight=row.getBoundingClientRect().height;
        name.title='10.28-Paulo';name.textContent='10.28-Paulo';row.removeAttribute('data-id');delete row.__reactProps$fixture;
        row.setAttribute('aria-selected','true');
        row.__reactFiber$fixture={stateNode:row,memoizedProps:{},return:{stateNode:null,memoizedProps:{chatId:id},return:null}};
        const render=async()=>{read();tick(data,id);await new Promise(r=>setTimeout(r,180));tick(undefined,id);};
        const valid=()=>row.querySelector('.zl-chat-note')?.value==='saved original note'&&!!row.querySelector('[aria-label="重点"]');
        await render();check(valid(),'Composite Fiber chatId did not receive note/flag');
        check(window.__zlCustomers.rowIdentity.get(row)==='react-fiber','Row did not use the exact Fiber identity');
        delete row.__reactFiber$fixture;row.__reactProps$fixture={chat:'20002@lid'};await render();check(valid(),'String chat identity or PN/LID alias was not resolved');
        name.style.display='contents';await render();check(valid(),'display:contents title permanently blocked annotation');
        name.style.display='';
        const hidden=name.cloneNode(true);hidden.style.display='none';title.prepend(hidden);await render();check(valid(),'Hidden duplicate title blocked visible marker');hidden.remove();
        delete row.__reactProps$fixture;
        row.__reactFiber$fixture={stateNode:row,memoizedProps:{},return:{stateNode:document.querySelector('#pane-side'),memoizedProps:{chatId:other},return:null}};
        const unrelatedHidden=name.cloneNode(true);unrelatedHidden.title=fixture.chats[0].name;unrelatedHidden.textContent=fixture.chats[0].name;unrelatedHidden.style.display='none';title.prepend(unrelatedHidden);await render();check(!row.querySelector('.zl-chat-note'),'Row borrowed a parent list active identity');unrelatedHidden.remove();
        row.__reactFiber$fixture={stateNode:row,memoizedProps:{chatId:id},return:{stateNode:null,memoizedProps:{chatId:other},return:null}};
        await render();check(!row.querySelector('.zl-chat-note'),'Conflicting Fiber identities were guessed');
        row.__reactFiber$fixture={stateNode:row,memoizedProps:{id},return:null};await render();check(valid(),'Native composite id was not resolved');
        // Layout animation must not block the note forever; retain the native row height.
        row.querySelectorAll('[data-zl-customers]').forEach(n=>n.remove());window.__zlCustomers.initialGeometry.delete(row);
        const realNow=Date.now;let now=realNow();Date.now=()=>now;
        try{for(let i=0;i<9;i++){name.style.display='inline-block';name.style.width=(190+i)+'px';now+=400;tick(data,id);}}finally{Date.now=realNow;}
        check(valid(),'Changing title dimensions starved note insertion beyond the bounded wait');
        check(Math.abs(row.getBoundingClientRect().height-originalHeight)<1,'Native virtual row height changed');
        const note=row.querySelector('.zl-chat-note');note.focus();note.value='edited inline note';note.dispatchEvent(new Event('input',{bubbles:true}));note.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        const actions=tick(undefined,id);check(actions.some(a=>a.action==='saveRemark'&&a.chatId===id&&a.owner===owner&&a.value==='edited inline note'),'Inline edit lost original owner/chat');
        return {fiberChatId:true,stringAlias:true,displayContentsTitle:true,hiddenTitle:true,parentListProtected:true,conflictsRejected:true,compositeId:true,boundedLayoutWait:true,nativeHeightPreserved:true,originalOwnerSave:true};
      })()`);
      return proof;
    } finally {
      win.destroy();
      await partition.protocol.unhandle('https');
    }
  }.toString()})()`;
  const result = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(program)})`,
  );
  assert.equal(result.fiberChatId, true);
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

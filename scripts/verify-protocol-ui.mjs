import assert from 'node:assert/strict';
import { evaluate, wait, click, call, socket } from './account-tools-cdp.mjs';
let id, before;
const svc = () => `window.ferdium.stores.services.one(${JSON.stringify(id)})`;
async function fill(value) {
  await evaluate(
    `(()=>{const field=document.querySelector('[aria-label="消息内容"]');if(!field)throw Error('Missing composer');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}));field.focus();})()`,
  );
}
async function enter(shift = false, repeat = false) {
  await evaluate(
    "require('@electron/remote').getCurrentWindow().focus();require('@electron/remote').getCurrentWindow().webContents.focus();document.querySelector('[aria-label=\"消息内容\"]').focus();true",
  );
  await call('Page.bringToFront');
  await wait(
    'document.hasFocus()&&document.activeElement===document.querySelector(\'[aria-label="消息内容"]\')',
    'composer focus',
  );
  await call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    modifiers: shift ? 8 : 0,
    autoRepeat: repeat,
  });
  await call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Enter',
    code: 'Enter',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    modifiers: shift ? 8 : 0,
  });
}
try {
  await wait(
    'window.ferdium?.stores?.settings.loaded&&window.ferdium.stores.services.allServicesRequest.wasExecuted',
    'app ready',
  );
  await evaluate("require('@electron/remote').getCurrentWindow().webContents.closeDevTools();require('@electron/remote').getCurrentWindow().setSize(1400,900);true");
  assert.equal(
    await evaluate('window.ferdium.stores.services.all.some(s=>s.isEnabled)'),
    false,
    'Disposable empty QA profile required',
  );
  before = await evaluate(
    'JSON.parse(JSON.stringify({sidebar:window.ferdium.stores.settings.app.accountSidebar,sendMode:window.ferdium.stores.settings.app.messageSendMode}))',
  );
  const previousCreated = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result?.data?.id',
  );
  await click('[data-group-id="default"] .account-group__add');
  await wait(
    `!!window.ferdium.stores.services.createServiceRequest.result?.data?.id&&window.ferdium.stores.services.createServiceRequest.result.data.id!==${JSON.stringify(previousCreated)}&&!window.ferdium.stores.services.createServiceRequest.isWaitingForResponse`,
    'create service',
  );
  id = await evaluate(
    'window.ferdium.stores.services.createServiceRequest.result.data.id',
  );
  await wait(
    `${svc()}&&!!document.querySelector('[data-service-id=\"${id}\"]')`,
    'created service mounted',
  );
  await evaluate(
    `${svc()}.isHibernationEnabled=false;${svc()}.webview?.stop();true`,
  );
  await evaluate(`(()=>{
    const ipc=require('electron').ipcRenderer;
    const original=ipc.invoke.bind(ipc);
    const owner='5511999999999@c.us';const jid='5511888888888@c.us';
    window.__protocolQA={original,sends:[],reads:[],uncertain:false,owner,jid,state:{status:'connected',qr:null,syncEvents:4,nickname:'QA Protocol Account',ownerId:owner,ownerIds:[owner],phone:'5511999999999',error:'',chats:[{id:jid,name:'QA Contact',group:false,unread:1,timestamp:1795520000,lastText:'hello'},...['A','B','C','D'].map((name,index)=>({id:String(123456789012340+index)+'@g.us',name,group:true,unread:0,timestamp:1795520000-index}))]},messages:[{id:'incoming',jid,fromMe:false,participant:'',text:'hello',kind:'text',timestamp:1795520000,status:3}]};
    ipc.invoke=async(channel,account,action,args)=>{
      const q=window.__protocolQA;
      if(channel!=='protocol-request'||account!==${JSON.stringify(id)})return original(channel,account,action,args);
      if(action==='state')return q.state;
      if(action==='start'){setTimeout(()=>ipc.emit('protocol-state',{},account,q.state),0);return q.state;}
      if(action==='stop')return true;
      if(action==='aliases')return [args.jid];
      if(action==='messages')return q.messages.filter(message=>message.jid===args.jid);
      if(action==='read'||action==='read-all'){q.reads.push(args?.jid);return{read:1,failed:0};}
      if(action==='send'){q.sends.push(args);const messageId='sent-'+q.sends.length;if(q.uncertain)return{messageId,confirmed:false,halt:true,error:'QA unconfirmed'};q.messages.push({id:messageId,jid:args.jid,fromMe:true,participant:'',text:args.spec.text,kind:'text',timestamp:1795520001,status:2});return{messageId,confirmed:true};}
      if(action==='reconcile')return{messageId:args.id||'',confirmed:false,halt:true,error:'QA still unconfirmed'};
      if(action==='recipients')return q.state.chats.map(row=>({...row,contact:!row.group}));
      if(action==='groups')return q.state.chats.filter(row=>row.group).map(row=>({...row,admin:true,announce:false}));
      if(action==='group-operation')return {status:'success',message:'QA verified'};
      if(action==='diagnostics')return {status:'connected',syncEvents:4};
      throw Error('Unhandled fixture action '+action);
    };
    return true;
  })()`);
  const settings = await evaluate(
    `(async()=>{const stores=window.ferdium.stores;const config=JSON.parse(JSON.stringify(stores.settings.app.accountSidebar));config.accounts[${JSON.stringify(id)}]={...config.accounts[${JSON.stringify(id)}],connectionMode:'protocol',remark:'QA Account Remark',nickname:'STALE WRONG NAME'};await stores.settings._update({type:'app',data:{accountSidebar:config,messageSendMode:'enter'}});return true;})()`,
  );
  assert(settings);
  await wait(
    `${svc()}.accountSnapshot.status==='online'&&!!document.querySelector('[aria-label="新连接聊天"]')`,
    'integrated protocol online',
  );
  assert.equal(
    await evaluate(`${svc()}.webview===null`),
    true,
    'webview unmounted, original Session not reused',
  );
  assert.equal(
    await evaluate(
      `document.querySelector('[data-service-id="${id}"]').textContent.includes('QA Protocol Account')&&document.querySelector('[data-service-id="${id}"]').textContent.includes('QA Account Remark')`,
    ),
    true,
    'actual nickname and original remark',
  );
  await evaluate(
    "[...document.querySelectorAll('[aria-label=\"新连接聊天\"] aside button')].find(button=>(button.textContent.includes('QA Contact') || button.textContent.includes('QA SAVED REMARK'))).click();true",
  );
  await wait(
    "document.querySelector('[aria-label=\"新连接聊天\"]').textContent.includes('hello')",
    'incoming message displayed',
  );
  await fill('enter test');
  await enter();
  await wait('window.__protocolQA.sends.length===1', 'default Enter send');
  await wait(
    "document.querySelector('[aria-label=\"消息内容\"]').value===''",
    'draft cleared after ACK',
  );
  await evaluate(
    "window.ferdium.stores.settings._update({type:'app',data:{messageSendMode:'shift-enter'}})",
  );
  await fill('shift test');
  await enter(false);
  assert.equal(
    await evaluate('window.__protocolQA.sends.length'),
    1,
    'plain Enter does not send in Shift+Enter mode',
  );
  await fill('shift test');
  await enter(true);
  await wait(
    'window.__protocolQA.sends.length===2',
    'configured Shift+Enter send',
  );
  await fill('IME draft');
  await evaluate(
    "document.querySelector('[aria-label=\"消息内容\"]').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));true",
  );
  await enter(true);
  assert.equal(
    await evaluate('window.__protocolQA.sends.length'),
    2,
    'IME cannot send',
  );
  await evaluate(
    "document.querySelector('[aria-label=\"消息内容\"]').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));true",
  );
  await enter(true, true);
  assert.equal(
    await evaluate('window.__protocolQA.sends.length'),
    2,
    'held Enter cannot send',
  );
  const batch = await evaluate(
    `(async()=>{const q=require('./features/accountTools/bulkRuntime').getBulkQueue(window.ferdium.stores);const bottom=require('./features/accountTools/bulkRecipientOrder').bottomUpGroupRecipients;const targets=window.__protocolQA.state.chats.filter(row=>row.group).map(row=>({id:row.id,name:row.name,group:true,accountId:${JSON.stringify(id)},ownerId:window.__protocolQA.owner}));const key=await q.submit({type:'text',text:'QA BULK',targets:bottom(targets),typingSeconds:0,intervalMin:0.5,intervalMax:0.5,mentionAll:false,failure:'continue'});const record=q.records.find(row=>row.id===key);const outcome={success:record.success,order:window.__protocolQA.sends.filter(row=>row.spec.text==='QA BULK').map(row=>row.jid)};await q.remove([key]);return outcome;})()`,
  );
  assert.equal(batch.success, 4);
  assert.deepEqual(batch.order, [
    '123456789012343@g.us',
    '123456789012342@g.us',
    '123456789012341@g.us',
    '123456789012340@g.us',
  ]);
  await evaluate('window.__protocolQA.uncertain=true;true');
  await fill('uncertain');
  await enter(true);
  await wait(
    "[...document.querySelectorAll('button')].some(button=>button.textContent==='核验上一条（不重发）')",
    'uncertain send has read-only action',
  );
  const sendCount = await evaluate('window.__protocolQA.sends.length');
  await evaluate(
    "[...document.querySelectorAll('button')].find(button=>button.textContent==='核验上一条（不重发）').click();true",
  );
  await wait(
    "document.querySelector('[aria-label=\"新连接聊天\"]').textContent.includes('QA still unconfirmed')",
    'readonly result',
  );
  assert.equal(
    await evaluate('window.__protocolQA.sends.length'),
    sendCount,
    'uncertain messages are not resent',
  );
  const customer = await evaluate(
    `(async()=>{const runtime=require('./features/customers/runtime').getCustomerRuntime(window.ferdium.stores);await runtime.refresh();return runtime.current?.chat?.id;})()`,
  );
  assert.equal(
    customer,
    '5511888888888@c.us',
    'existing customer panel binds active protocol chat',
  );
  await evaluate(
    `(async()=>{const runtime=require('./features/customers/runtime').getCustomerRuntime(window.ferdium.stores);await require('electron').ipcRenderer.invoke('customers-patch',runtime.bundle.owner,window.__protocolQA.jid,{remarkName:'QA SAVED REMARK'});await require('electron').ipcRenderer.invoke('customers-pin',runtime.bundle.owner,window.__protocolQA.jid,'pin');await runtime.refresh();return true;})()`,
  );
  await wait(
    "document.querySelector('[aria-label=\"新连接聊天\"] aside').textContent.includes('QA SAVED REMARK')&&document.querySelector('[aria-label=\"新连接聊天\"] aside').textContent.includes('取消置顶')",
    'existing remark and pin store reflected',
  );
  const originalSessions = await evaluate(
    `(async()=>{const e=require('@electron/remote');const s=e.session.fromPartition('persist:service-'+${JSON.stringify(id)});await s.cookies.set({url:'https://web.whatsapp.com',name:'qa-original-session',value:'preserved'});return true;})()`,
  );
  assert(originalSessions);
  await evaluate(
    `(async()=>{const config=JSON.parse(JSON.stringify(window.ferdium.stores.settings.app.accountSidebar));config.accounts[${JSON.stringify(id)}].connectionMode='web';await window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:config}});return true;})()`,
  );
  await wait(
    `!!${svc()}.webview&&!document.querySelector('[aria-label="新连接聊天"]')`,
    'reversible original web connection',
  );
  assert.equal(
    await evaluate(
      `(async()=>{const cookies=await require('@electron/remote').session.fromPartition('persist:service-'+${JSON.stringify(id)}).cookies.get({name:'qa-original-session'});return cookies[0]?.value;})()`,
    ),
    'preserved',
  );
  console.log(
    'PASS integrated protocol UI: actual nickname/remark, incoming chat, default Enter, opt-in Shift+Enter, IME and held-key protection, original bulk queue D-C-B-A, uncertain-send reconciliation without resend, customer context, reversible web Session preserved',
  );
} catch (error) {
  console.error(
    await evaluate(
      "({focused:document.hasFocus(),active:document.activeElement?.outerHTML?.slice(0,200),win:require('@electron/remote').getCurrentWindow().isFocused()})",
    ),
  );
  throw error;
} finally {
  if (id)
    await evaluate(
      `window.ferdium.stores.services._deleteService({serviceId:${JSON.stringify(id)},redirect:null})`,
    ).catch(() => {});
  if (before)
    await evaluate(
      `window.ferdium.stores.settings._update({type:'app',data:{accountSidebar:${JSON.stringify(before.sidebar)},messageSendMode:${JSON.stringify(before.sendMode)}}})`,
    ).catch(() => {});
  await evaluate(
    "if(window.__protocolQA){require('electron').ipcRenderer.invoke=window.__protocolQA.original;delete window.__protocolQA;}true",
  ).catch(() => {});
  socket.close();
}

/* eslint-disable no-console -- Offline native UI regression with synthetic accounts. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const result = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function verify() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow } = req('electron');
        const fs = req('node:fs');
        const file = '/tmp/zl-aggregate-ui-fixture.html';
        fs.writeFileSync(
          file,
          `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="file://${process.cwd()}/build/styles/main.css"><style>html,body,#root{height:100%;margin:0;background:#1e2024}#fixture{display:flex;height:100%;}.fixture-right{flex:1;color:#ccc;padding:30px;box-sizing:border-box}</style><body class="theme__dark"><div id="root"></div></body>`,
        );
        const win = new BrowserWindow({
          show: true,
          width: 1100,
          height: 850,
          webPreferences: { nodeIntegration: true, contextIsolation: false },
        });
        req('@electron/remote/main').enable(win.webContents);
        try {
          await win.loadFile(file);
          const program = `(async()=>{
    const React=require(${JSON.stringify(`${process.cwd()}/node_modules/react`)}),{createRoot}=require(${JSON.stringify(`${process.cwd()}/node_modules/react-dom/client`)}),{observable,runInAction}=require(${JSON.stringify(`${process.cwd()}/node_modules/mobx`)});
    const {ipcRenderer}=require('electron');
    ipcRenderer.invoke=async(channel,owners)=>{if(channel==='customers-bind')return {owner:owners[0],ownerAliases:owners,revision:1,summaries:{'10001@c.us':{remarkName:'重点 Alice',flags:[]}},aliases:{},pins:[],pinsInitialized:true};if(channel==='account-tools-history')return [];return {};};
    const Component=require(${JSON.stringify(`${process.cwd()}/build/features/conversations/ConversationSidebar.js`)}).default;
    const rows=[{id:'10001@c.us',aliases:['10001@c.us'],name:'Alice',phone:'10001',group:false,archived:false,unread:3,preview:'Hello there',timestamp:1700000000,lastFromMe:false},{id:'12345@g.us',aliases:['12345@g.us'],name:'Investment group',phone:'',group:true,archived:false,unread:0,preview:'Group update',timestamp:1700000001,lastFromMe:true}];
    window.opened=[];
    const services=['A','B'].map((id,index)=>({id,name:'Account '+id,recipe:{id:'whatsapp'},isEnabled:true,isLoading:false,accountSnapshot:{status:'online',nickname:id,ownerId:'861380000000'+(index+1)+'@c.us'},webview:{executeJavaScript:async code=>{
      if(code.includes('openChatBottom')){opened.push(id);return true;}
      if(code.startsWith('location.hostname'))return false;
      if(code==='Boolean(window.WPP)'||code.startsWith('new Promise'))return true;
      if(code.includes('index:'))return {context:{token:'document-'+id,owners:['861380000000'+(index+1)+'@c.us']},index:{rows,contactsReady:true}};
      if(code.includes('image/jpeg'))return {};
      return true;
    }}}));
    const stores=observable({settings:{app:{aggregateConversations:{groups:[],members:{}},accountSidebar:{groups:[],accounts:{A:{remark:'蓝二号'},B:{remark:'蓝三号'}}}}},services:{all:services,active:services[0]}});
    stores.settings._update=async({data})=>{runInAction(()=>Object.assign(stores.settings.app,data));};
    const root=createRoot(document.querySelector('#root'));
    root.render(React.createElement('div',{id:'fixture'},React.createElement(Component,{stores,activate:id=>runInAction(()=>{stores.services.active=stores.services.all.find(item=>item.id===id);}),onBack:()=>{window.back=true;}}),React.createElement('main',{className:'fixture-right'},'原账号聊天区域')));
    const wait=async(test)=>{const until=Date.now()+12000;while(!test()){if(Date.now()>until)throw Error('Fixture UI condition timeout');await new Promise(r=>setTimeout(r,40));}};
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    await wait(()=>document.querySelectorAll('.conversation-row').length===4);
    check([...document.querySelectorAll('.conversation-row__account')].some(item=>item.textContent.includes('蓝二号')),'Account remark missing');
    check([...document.querySelectorAll('.conversation-row__account')].some(item=>item.textContent.includes('蓝三号')),'Other account remark missing');
    const first=document.querySelector('.conversation-row__open');first.click();await wait(()=>opened.length===1);
    document.querySelector('[aria-label="全选当前结果"]').click();
    await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 4'));
    document.querySelector('[aria-label="新增会话分组"]').click();
    await wait(()=>document.querySelector('[role="dialog"] input'));
    const input=document.querySelector('[role="dialog"] input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'重点客户');input.dispatchEvent(new Event('input',{bubbles:true}));
    [...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='确定').click();
    await wait(()=>stores.settings.app.aggregateConversations.groups.some(g=>g.name==='重点客户')&&!document.querySelector('[role="dialog"]')&&![...document.querySelectorAll('.conversation-toolbar button')].find(button=>button.textContent==='移动分组').disabled);
    [...document.querySelectorAll('.conversation-toolbar button')].find(button=>button.textContent==='移动分组').click();await wait(()=>document.querySelector('[aria-label="目标会话分组"]'));
    const select=document.querySelector('[aria-label="目标会话分组"]');select.value=stores.settings.app.aggregateConversations.groups.find(g=>g.name==='重点客户').id;select.dispatchEvent(new Event('change',{bubbles:true}));
    [...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='确定').click();
    await wait(()=>Object.keys(stores.settings.app.aggregateConversations.members).length===4&&!document.querySelector('[role="dialog"]')&&document.querySelector('.conversation-toolbar').textContent.includes('已选 0'));
    check(document.querySelectorAll('.conversation-row').length===4,'Move removed conversation records');
    const allCheckbox=document.querySelector('[aria-label="全选当前结果"]');allCheckbox.click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 4'));
    [...document.querySelectorAll('.conversation-toolbar button')].find(button=>button.textContent==='群发').click();await wait(()=>document.querySelector('.account-tools-dialog'));
    check(document.querySelector('.account-tools-dialog').textContent.includes('选择账号'),'Bulk composer did not open');
    document.querySelector('.bulk-dialog__close-icon').click();
    await wait(()=>!document.querySelector('.account-tools-dialog'));
    const filter=(label)=>[...document.querySelectorAll('.conversation-filters button')].find(button=>button.textContent===label);
    filter('未读').click();await wait(()=>document.querySelectorAll('.conversation-row').length===2);
    check(document.querySelector('.conversation-toolbar').textContent.includes('已选 0'),'Filter retained hidden selection');
    document.querySelector('[aria-label="全选当前结果"]').click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 2'));
    document.querySelectorAll('.conversation-filters')[1].querySelector('button').click();await wait(()=>document.querySelectorAll('.conversation-row').length===4);
    const search=document.querySelector('.conversation-search');setter.call(search,'蓝三号');search.dispatchEvent(new Event('input',{bubbles:true}));
    await wait(()=>document.querySelectorAll('.conversation-row').length===2);
    check([...document.querySelectorAll('.conversation-row__account')].every(item=>item.textContent.includes('蓝三号')),'Account remark search crossed accounts');
    setter.call(search,'');search.dispatchEvent(new Event('input',{bubbles:true}));await wait(()=>document.querySelectorAll('.conversation-row').length===4);
    rows.push(...Array.from({length:300},(_,i)=>({...rows[0],id:(20000+i)+'@c.us',aliases:[(20000+i)+'@c.us'],name:'Contact '+i})));
    await wait(()=>!document.querySelector('.conversation-accounts button').disabled);
    document.querySelector('.conversation-accounts button').click();
    await wait(()=>document.querySelector('.conversation-summary').textContent==='604 个会话');
    check(document.querySelectorAll('.conversation-row').length<30,'Large index rendered every row');
    document.querySelector('[aria-label="全选当前结果"]').click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 604'));
    return {separateAccountRows:true,accountRemarks:true,openUsesOriginalAccount:true,selectAll:true,createAndMoveGroup:true,bulkComposer:true,filteredSelection:true,accountRemarkSearch:true,virtualized604Conversations:true};
   })().catch(error=>({fixtureError:String(error.stack||error)}))`;
          fs.writeFileSync('/tmp/zl-aggregate-renderer.cjs', program);
          const output = await win.webContents.executeJavaScript(program);
          if (output.fixtureError) throw new Error(output.fixtureError);
          await win
            .capturePage()
            .then(image =>
              fs.writeFileSync('/tmp/zl-aggregate-ui.png', image.toPNG()),
            );
          return output;
        } catch (error) {
          await win
            .capturePage()
            .then(image =>
              fs.writeFileSync('/tmp/zl-aggregate-ui-error.png', image.toPNG()),
            );
          throw error;
        } finally {
          win.destroy();
        }
      }.toString()})()`,
    )})`,
  );
  console.log(JSON.stringify(result));
  assert(result.createAndMoveGroup);
} finally {
  socket.close();
}

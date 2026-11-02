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
    const rows=[{id:'10001@c.us',aliases:['10001@c.us'],name:'Alice',phone:'10001',group:false,archived:false,unread:123,preview:'Hello there',timestamp:1700000000,lastFromMe:false},{id:'12345@g.us',aliases:['12345@g.us'],name:'Investment group',phone:'',group:true,archived:false,unread:0,preview:'Group update',timestamp:1700000001,lastFromMe:true}];
    const heldIndexes=[];let blockIndexes=false;const canvas=document.createElement('canvas');canvas.width=8;canvas.height=8;const photo=canvas.toDataURL('image/jpeg');
    window.opened=[];const readKeys=new Set();window.markedRead=[];
    const services=['A','B'].map((id,index)=>({id,name:'Account '+id,recipe:{id:'whatsapp'},isEnabled:true,isLoading:false,accountSnapshot:{status:'online',nickname:id,ownerId:'861380000000'+(index+1)+'@c.us'},webview:{executeJavaScript:async code=>{
      if(code.includes('WAWebUpdateUnreadChatAction')){
        const start=code.lastIndexOf('})([')+3,end=code.lastIndexOf(');})()'),[targets]=JSON.parse('['+code.slice(start,end)+']');let count=0;
        for(const target of targets){const row=rows.find(row=>row.id===target);if(row?.unread>0&&!readKeys.has(id+':'+target))count++;readKeys.add(id+':'+target);markedRead.push(id+':'+target);}
        return {read:count,failed:0,halted:false};
      }
      if(code.includes('openChatBottom')){opened.push(id);return true;}
      if(code.startsWith('location.hostname'))return false;
      if(code==='Boolean(window.WPP)'||code.startsWith('new Promise'))return true;
      if(code.includes('return {context,index:')){const value={context:{token:'document-'+id,owners:['861380000000'+(index+1)+'@c.us']},index:{rows:rows.map(row=>({...row,unread:readKeys.has(id+':'+row.id)?0:row.unread})),contactsReady:true}};if(blockIndexes)return new Promise(resolve=>heldIndexes.push(()=>resolve(value)));return value;}
      if(code.includes('image/jpeg'))return Object.fromEntries(rows.map(row=>[row.id,photo]));
      return true;
    }}}));
    const stores=observable({settings:{app:{aggregateConversations:{groups:[],members:{}},accountSidebar:{groups:[],accounts:{A:{remark:'蓝二号'},B:{remark:'蓝三号'}}}}},services:{all:services,active:services[0]}});
    stores.settings._update=async({data})=>{runInAction(()=>Object.assign(stores.settings.app,data));};
    const wait=async(test)=>{const until=Date.now()+12000;while(!test()){if(Date.now()>until)throw Error('Fixture UI condition timeout');await new Promise(r=>setTimeout(r,40));}};
    const runtime=require(${JSON.stringify(`${process.cwd()}/build/features/conversations/runtime.js`)}).getConversationRuntime(stores);
    for(const service of stores.services.all)runtime.warm(service);
    await wait(()=>runtime.rows.length===4&&runtime.avatars.size===4);
    blockIndexes=true;
    const root=createRoot(document.querySelector('#root'));
    root.render(React.createElement('div',{id:'fixture'},React.createElement(Component,{stores,activate:id=>runInAction(()=>{stores.services.active=stores.services.all.find(item=>item.id===id);}),onBack:()=>{window.back=true;}}),React.createElement('main',{className:'fixture-right'},'原账号聊天区域')));
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    await wait(()=>document.querySelectorAll('.conversation-row').length===4);
    check(heldIndexes.length>0&&document.querySelectorAll('.conversation-row__avatar img').length===4,'Warm list/photos waited for fresh metadata');
    blockIndexes=false;heldIndexes.splice(0).forEach(release=>release());
    check([...document.querySelectorAll('.conversation-row__account')].some(item=>item.textContent.includes('蓝二号')),'Account remark missing');
    check([...document.querySelectorAll('.conversation-row__account')].some(item=>item.textContent.includes('蓝三号')),'Other account remark missing');
    check([...document.querySelectorAll('.conversation-row__title')].some(item=>item.textContent.startsWith('Alice'))&&!document.querySelector('.conversation-list').textContent.includes('重点 Alice'),'Customer remark replaced native row title');
    const first=document.querySelector('.conversation-row__open');first.click();await wait(()=>opened.length===1);
    document.querySelector('[aria-label="全选当前结果"]').click();
    await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 4'));
    const nativeClick=async(element,button='left')=>{
      await wait(()=>{const r=element.getBoundingClientRect();return r.width>0&&r.height>0&&element.contains(document.elementFromPoint(Math.round(r.x+r.width/2),Math.round(r.y+r.height/2)));});
      const r=element.getBoundingClientRect(),x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
      check(r.width>0&&r.height>0&&element.contains(document.elementFromPoint(x,y)),'Native click target is covered or offscreen');
      const contents=require(${JSON.stringify(`${process.cwd()}/node_modules/@electron/remote`)}).getCurrentWebContents();
      contents.sendInputEvent({type:'mouseMove',x,y});contents.sendInputEvent({type:'mouseDown',x,y,button,clickCount:1});contents.sendInputEvent({type:'mouseUp',x,y,button,clickCount:1});
      await new Promise(r=>setTimeout(r,80));
    };
    const groupToggle=name=>[...document.querySelectorAll('.conversation-group button[aria-expanded]')].find(button=>button.textContent.includes(name));
    const menuItem=label=>[...document.querySelectorAll('[role="menuitem"]')].find(item=>item.textContent===label);
    const badge=document.querySelector('.conversation-row__avatar b');check(badge.textContent==='99+'&&getComputedStyle(badge).backgroundColor==='rgb(229, 57, 53)'&&getComputedStyle(badge).fontSize==='10px','Unread badge cap, size or red color is wrong');
    await nativeClick(groupToggle('默认分组'),'right');await wait(()=>document.querySelector('[role="menu"]'));
    check(document.querySelectorAll('[role="menuitem"]').length===1&&menuItem('全部已读'),'Default group exposed edit/delete actions');
    require(${JSON.stringify(`${process.cwd()}/node_modules/@electron/remote`)}).getCurrentWebContents().sendInputEvent({type:'keyDown',keyCode:'Escape'});
    await wait(()=>!document.querySelector('[role="menu"]'));
    check(!document.querySelector('[aria-label="会话状态"]'),'Removed status filters are still shown');
    check(![...document.querySelectorAll('button')].some(button=>button.getAttribute('aria-label')?.endsWith('分组菜单')),'Group ellipsis menu is still shown');
    const plus=document.querySelector('[aria-label="新增会话分组"]');check(plus.getBoundingClientRect().width>=36&&parseFloat(getComputedStyle(plus).fontSize)>=24,'Group plus is too small');
    await nativeClick(plus);
    await wait(()=>document.querySelector('[role="dialog"] input'));
    const popupVisible=()=>{const paper=document.querySelector('[role="dialog"]'),r=paper.getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth;};
    await wait(popupVisible);
    check(document.querySelector('[role="dialog"]').getBoundingClientRect().height<250,'Create group popup fills the viewport');
    await nativeClick([...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='确认'));
    await wait(()=>document.querySelector('[role="dialog"] [role="alert"]')?.textContent.includes('请输入分组名称'));
    check(popupVisible()&&stores.settings.app.aggregateConversations.groups.length===0,'Empty group failed invisibly or saved an invalid group');
    const input=document.querySelector('[role="dialog"] input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'重点客户');input.dispatchEvent(new Event('input',{bubbles:true}));
    await nativeClick([...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='确认'));
    await wait(()=>stores.settings.app.aggregateConversations.groups.some(g=>g.name==='重点客户')&&!document.querySelector('[role="dialog"]')&&![...document.querySelectorAll('.conversation-toolbar button')].find(button=>button.textContent==='移动分组').disabled);
    const moveButton=()=>[...document.querySelectorAll('.conversation-toolbar button')].find(button=>button.textContent==='移动分组');
    await nativeClick(moveButton());await wait(()=>document.querySelector('[aria-label="目标会话分组"]'));await wait(popupVisible);
    check(document.querySelector('[aria-label="目标会话分组"]').value==='','Move popup silently preselected a group');
    check([...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='确认').disabled,'Move confirmation enabled without a destination');
    await nativeClick([...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='取消'));
    await wait(()=>!document.querySelector('[role="dialog"]'));check(Object.keys(stores.settings.app.aggregateConversations.members).length===0,'Cancelled move changed membership');
    await nativeClick(moveButton());await wait(()=>document.querySelector('[aria-label="目标会话分组"]'));await wait(popupVisible);
    const select=document.querySelector('[aria-label="目标会话分组"]');select.value=stores.settings.app.aggregateConversations.groups.find(g=>g.name==='重点客户').id;select.dispatchEvent(new Event('change',{bubbles:true}));
    await wait(()=>![...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='确认').disabled);
    await nativeClick([...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='确认'));
    await wait(()=>Object.keys(stores.settings.app.aggregateConversations.members).length===4&&!document.querySelector('[role="dialog"]')&&document.querySelector('.conversation-toolbar').textContent.includes('已选 0'));
    check(document.querySelectorAll('.conversation-row').length===4,'Move removed conversation records');
    await nativeClick(groupToggle('重点客户'),'right');await wait(()=>document.querySelectorAll('[role="menuitem"]').length===3);
    await nativeClick(menuItem('编辑'));await wait(()=>document.querySelector('[role="dialog"] input'));await wait(popupVisible);
    const rename=document.querySelector('[role="dialog"] input');check(rename.value==='重点客户','Rename popup lost original group name');setter.call(rename,'待跟进客户');rename.dispatchEvent(new Event('input',{bubbles:true}));
    await nativeClick([...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='确认'));await wait(()=>!document.querySelector('[role="dialog"]')&&groupToggle('待跟进客户'));
    const allCheckbox=document.querySelector('[aria-label="全选当前结果"]');allCheckbox.click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 4'));
    [...document.querySelectorAll('.conversation-toolbar button')].find(button=>button.textContent==='群发').click();await wait(()=>document.querySelector('.account-tools-dialog'));
    check(document.querySelector('.account-tools-dialog').textContent.includes('选择账号'),'Bulk composer did not open');
    document.querySelector('.bulk-dialog__close-icon').click();
    await wait(()=>!document.querySelector('.account-tools-dialog'));
    rows.push({...rows[0],id:'90003@c.us',aliases:['90003@c.us'],name:'Archived private',archived:true},{...rows[1],id:'90004@g.us',aliases:['90004@g.us'],name:'Archived group',archived:true});
    await wait(()=>!document.querySelector('.conversation-accounts button').disabled);document.querySelector('.conversation-accounts button').click();
    await wait(()=>!document.querySelector('.conversation-accounts button').disabled&&document.querySelector('.conversation-summary').textContent==='4 个会话');
    [...document.querySelectorAll('.conversation-filters button')].find(button=>button.textContent==='私聊').click();await wait(()=>document.querySelectorAll('.conversation-row').length===2);
    check(!document.querySelector('.conversation-list').textContent.includes('Archived'),'Archived private row leaked into private filter');
    [...document.querySelectorAll('.conversation-filters button')].find(button=>button.textContent==='已归档').click();await wait(()=>document.querySelectorAll('.conversation-row').length===4);
    check([...document.querySelectorAll('.conversation-row__title')].every(item=>item.textContent.startsWith('Archived')),'Archive filter lost archived rows or mixed ordinary rows');
    [...document.querySelectorAll('.conversation-filters button')].find(button=>button.textContent==='群聊').click();await wait(()=>document.querySelectorAll('.conversation-row').length===2);
    check(document.querySelector('.conversation-toolbar').textContent.includes('已选 0'),'Filter retained hidden selection');
    document.querySelector('[aria-label="全选当前结果"]').click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 2'));
    document.querySelector('.conversation-filters button').click();await wait(()=>document.querySelectorAll('.conversation-row').length===4);
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
    const defaultToggle=()=>[...document.querySelectorAll('.conversation-group button[aria-expanded]')].find(button=>button.textContent.includes('默认分组'));
    await nativeClick(defaultToggle());await wait(()=>document.querySelectorAll('.conversation-row').length===4&&document.querySelector('.conversation-toolbar').textContent.includes('已选 4'));
    document.querySelector('[aria-label="全选当前结果"]').click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 0'));
    document.querySelector('[aria-label="全选当前结果"]').click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 4'));
    await nativeClick(groupToggle('待跟进客户'),'right');await wait(()=>menuItem('全部已读'));await nativeClick(menuItem('全部已读'));
    await wait(()=>!document.querySelector('.conversation-row__avatar b')&&document.querySelector('.account-sidebar__notice')?.textContent.includes('已标记 2'));
    check(markedRead.length===4&&!markedRead.some(key=>key.includes('20000@c.us')),'Group read action marked another folder');
    await nativeClick(defaultToggle());await wait(()=>document.querySelector('.conversation-summary').textContent==='604 个会话');
    await wait(()=>document.querySelector('.conversation-row__avatar b'));
    check(document.querySelector('.conversation-toolbar').textContent.includes('已选 4'),'Reopening a folder restored hidden selections');
    document.querySelector('[aria-label="全选当前结果"]').click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 604'));
    await nativeClick(defaultToggle());await wait(()=>document.querySelectorAll('.conversation-row').length===4);
    await nativeClick(groupToggle('待跟进客户'),'right');await wait(()=>menuItem('删除'));await nativeClick(menuItem('删除'));
    await wait(()=>stores.settings.app.aggregateConversations.groups.length===1&&Object.keys(stores.settings.app.aggregateConversations.members).length===0&&document.querySelector('.conversation-toolbar').textContent.includes('已选 0'));
    await nativeClick(defaultToggle());await wait(()=>document.querySelector('.conversation-summary').textContent==='604 个会话');
    await nativeClick(defaultToggle(),'right');await wait(()=>menuItem('全部已读'));check(document.querySelectorAll('[role="menuitem"]').length===1,'Default group gained destructive actions after deleting a custom folder');await nativeClick(menuItem('全部已读'));
    await wait(()=>!document.querySelector('.conversation-row__avatar b')&&document.querySelector('.account-sidebar__notice')?.textContent.includes('已标记 602'));
    document.querySelector('[aria-label="全选当前结果"]').click();await wait(()=>document.querySelector('.conversation-toolbar').textContent.includes('已选 604'));
    await nativeClick(moveButton());await wait(()=>document.querySelector('[aria-label="目标会话分组"]'));await wait(popupVisible);
    const controller=require(${JSON.stringify(`${process.cwd()}/node_modules/@electron/remote`)}).getCurrentWindow();
    controller.setSize(640,480);await wait(()=>innerWidth<700&&popupVisible());
    document.body.classList.remove('theme__dark');await new Promise(r=>setTimeout(r,200));check(popupVisible(),'Light theme displaced the move popup');
    controller.setSize(1100,850);document.body.classList.add('theme__dark');await wait(()=>innerWidth>1000&&popupVisible());
    await new Promise(r=>setTimeout(r,200));
    await nativeClick([...document.querySelectorAll('[role="dialog"] button')].find(button=>button.textContent==='取消'));await wait(()=>!document.querySelector('[role="dialog"]'));
    await wait(()=>!runtime.refreshing&&document.querySelectorAll('.conversation-row__avatar img').length>0);
    root.render(React.createElement('main',null,'账户列表'));await wait(()=>!document.querySelector('.conversation-sidebar'));
    check(runtime.rows.length===608&&runtime.avatars.size>0,'Leaving aggregate discarded the cache');
    blockIndexes=true;
    root.render(React.createElement('div',{id:'fixture'},React.createElement(Component,{stores,activate:id=>runInAction(()=>{stores.services.active=stores.services.all.find(item=>item.id===id);}),onBack:()=>{window.back=true;}}),React.createElement('main',{className:'fixture-right'},'原账号聊天区域')));
    await wait(()=>document.querySelector('.conversation-row')&&document.querySelector('.conversation-row__avatar img'));
    check(heldIndexes.length>0,'Repeat-entry cache check did not hold fresh metadata');
    blockIndexes=false;heldIndexes.splice(0).forEach(release=>release());
    await new Promise(r=>setTimeout(r,200));
    return {instantWarmEntry:true,instantRepeatEntry:true,cachedAvatarReuse:true,groupContextMenuAndRename:true,deleteReturnsMembersToDefault:true,defaultGroupProtected:true,scopedAllReadAndBadgeRemoval:true,redUnreadBadge99Plus:true,expandedFoldersOnlySelection:true,archivesExclusiveToArchive:true,nativeTitlesIgnoreCustomerRemarks:true,popupWithinNarrowViewport:true,inlineValidationVisible:true,visibleNativeCreatePopup:true,visibleNativeMovePopup:true,cancelLeavesMembership:true,statusAndEllipsisRemoved:true,enlargedPlus:true,separateAccountRows:true,accountRemarks:true,openUsesOriginalAccount:true,selectAll:true,createAndMoveGroup:true,bulkComposer:true,filteredSelection:true,accountRemarkSearch:true,virtualized604Conversations:true};
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

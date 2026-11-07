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
        const { BrowserWindow, session } = req('electron');
        const fs = req('node:fs');
        delete req.cache[
          req.resolve(`${process.cwd()}/build/features/customers/guest.js`)
        ];
        const source = req(
          `${process.cwd()}/build/features/customers/guest.js`,
        );
        const draw = req(
          `${process.cwd()}/build/features/customers/flagIcons.js`,
        ).customerFlagSvg;
        const isolated = session.fromPartition(
          `zl-aggregate-header-${Date.now()}`,
        );
        await isolated.protocol.handle(
          'https',
          () =>
            new Response(
              fs.readFileSync(
                `${process.cwd()}/scripts/fixtures/whatsapp-tools.html`,
              ),
              { headers: { 'Content-Type': 'text/html' } },
            ),
        );
        const guest = new BrowserWindow({
          show: false,
          width: 1100,
          height: 800,
          webPreferences: { session: isolated },
        });
        const ui = new BrowserWindow({
          show: false,
          width: 375,
          height: 800,
          webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false,
          },
        });
        try {
          await guest.loadURL('https://web.whatsapp.com/');
          const header = await guest.webContents.executeJavaScript(`(async()=>{
            const tick=${source.customerTick.toString()},read=${source.readCustomerContext.toString()},draw=${draw.toString()};
            const check=(v,m)=>{if(!v)throw Error(m)};
            const id=fixture.chats[1].id._serialized,group=fixture.chats[0].id._serialized,owner=read().owners[0];
            const native=document.querySelector('#main header span');native.title='Native WhatsApp name';native.textContent='Native WhatsApp name';
            const data={owner,revision:1,summaries:{[id]:{remarkName:'Local remark only',flags:['priority','follow','signup','deposit']}},aliases:{},pins:[],pinsInitialized:true};
            const render=async(active=id)=>{tick(data,active,draw);await new Promise(r=>setTimeout(r,80));tick(undefined,active,draw);};
            document.documentElement.dataset.zlAggregateView='true';await render();
            let button=document.querySelector('.zl-header-remark');
            check(button?.textContent==='Local remark only','Header did not display short remark');
            check(getComputedStyle(native).display==='none','Native title still visible in aggregate mode');
            check(native.title==='Native WhatsApp name'&&native.textContent==='Native WhatsApp name','Native identity text was changed');
            button.click();let actions=tick(undefined,id,draw);
            check(actions.some(a=>a.action==='remark'&&a.chatId===id&&a.owner===owner),'Remark editor target mismatch');
            data.revision++;data.summaries[id].remarkName='';await render();
            button=document.querySelector('.zl-header-remark');check(button?.textContent==='添加备注','Empty remark lacks add action');
            button.click();actions=tick(undefined,id,draw);check(actions.some(a=>a.action==='remark'&&a.chatId===id),'Add remark not clickable');
            data.revision++;data.summaries[id].remarkName='Updated remark';await render();
            check(document.querySelector('.zl-header-remark')?.textContent==='Updated remark','Updated remark not rendered');
            delete document.documentElement.dataset.zlAggregateView;
            check(getComputedStyle(native).display!=='none'&&getComputedStyle(document.querySelector('.zl-header-remark')).display==='none','Leaving aggregate mode did not restore native title');
            document.documentElement.dataset.zlAggregateView='true';await render(group);
            check(!native.hasAttribute('data-zl-customer-header-title')&&!document.querySelector('.zl-header-remark'),'Group title was replaced');
            await render();data.owner='another@c.us';data.revision++;data.summaries={};await render();
            check(!document.querySelector('.zl-header-remark')&&getComputedStyle(native).display!=='none','Owner mismatch retained remark or hid native title');
            return {nativeTitlePreserved:true,remarkOnly:true,emptyRemarkClickable:true,liveUpdate:true,modeRestored:true,groupUnchanged:true,ownerIsolated:true};
          })()`);
          await ui.loadURL('about:blank');
          await ui.webContents.insertCSS(
            `${fs.readFileSync(`${process.cwd()}/build/styles/main.css`, 'utf8')}body{display:block!important;margin:0}#root{height:100vh;width:365px}`,
          );
          const rows = await ui.webContents.executeJavaScript(`(async()=>{
            const React=require(${JSON.stringify(`${process.cwd()}/node_modules/react`)}),{createRoot}=require(${JSON.stringify(`${process.cwd()}/node_modules/react-dom/client`)});
            const {getConversationRuntime}=require(${JSON.stringify(`${process.cwd()}/build/features/conversations/runtime.js`)});
            const Sidebar=require(${JSON.stringify(`${process.cwd()}/build/features/conversations/ConversationSidebar.js`)}).default;
            document.body.className='theme__dark';document.body.innerHTML='<aside id="root"></aside>';
            const stores={settings:{app:{aggregateConversations:{},accountSidebar:{accounts:{}}}},services:{all:[],active:undefined}};
            const runtime=getConversationRuntime(stores);runtime.start=()=>{};runtime.pause=()=>{};runtime.loadAvatars=async()=>{};
            const base={aliases:[],accountId:'account',owner:'owner',ownerAliases:[],accountName:'Account',accountRemark:'',remark:'Must not appear as title',archived:false,unread:0,preview:'Preview',timestamp:1};
            const items=[{...base,id:'1@c.us',key:'private',membershipKey:'owner:1',name:'Native nickname',phone:'123456',group:false,flags:['priority','follow','signup','deposit']},{...base,id:'2@g.us',key:'group',membershipKey:'owner:2',name:'Native group name',phone:'',group:true,flags:[]},{...base,id:'3@c.us',key:'phone',membershipKey:'owner:3',name:'',phone:'987654',group:false,flags:[]}];
            Object.defineProperty(runtime,'rows',{get:()=>items});
            const root=createRoot(document.querySelector('#root'));root.render(React.createElement(Sidebar,{stores,onBack(){},activate(){}}));
            await new Promise(r=>setTimeout(r,250));
            const names=[...document.querySelectorAll('.conversation-row__name')].map(n=>n.textContent);
            if(!['Native nickname','Native group name','987654'].every(n=>names.includes(n))||names.includes(base.remark))throw Error('Aggregate title sources wrong: '+names);
            const flags=[...document.querySelectorAll('[data-conversation-key="private"] .customer-letter-icon')];
            const colors=flags.map(n=>getComputedStyle(n.querySelector('svg')).color);
            if(flags.length!==4||new Set(colors).size!==4)throw Error('Missing customer markers');
            const marker=document.querySelector('.conversation-row__flags').getBoundingClientRect(),time=document.querySelector('[data-conversation-key="private"] time').getBoundingClientRect();
            if(marker.right>time.left)throw Error('Markers overlap timestamp');
            document.body.className='';await new Promise(r=>setTimeout(r,30));
            if(flags.some(n=>n.getBoundingClientRect().width!==14))throw Error('Light theme markers changed size');
            root.unmount();return {nativeNames:true,groupUnchanged:true,phoneFallback:true,markersBeforeTime:true,colors,lightAndDark:true};
          })()`);
          return { header, rows };
        } finally {
          guest.destroy();
          ui.destroy();
          await isolated.protocol.unhandle('https');
        }
      }})()`,
    )})`,
  );
  assert(result.header.emptyRemarkClickable && result.rows.nativeNames);
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

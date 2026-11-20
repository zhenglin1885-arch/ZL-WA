/* Native Chromium/Electron regressions with isolated synthetic Meta pages and account transport responses. */
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
        const fs = req('node:fs');
        const read = req(
          process.cwd() + '/build/features/accounts/facebook.js',
        ).readFacebookSnapshot;
        const isolated = session.fromPartition('qa-facebook-' + Date.now());
        await isolated.protocol.handle(
          'https',
          request =>
            new Response(
              new URL(request.url).searchParams.has('loggedout')
                ? '<!doctype html><button>用 Facebook 继续</button><button>用 Instagram 继续</button>'
                : '<!doctype html><nav><a href="/latest/home">Home</a><a href="/latest/inbox">Inbox</a><button>Content</button><button>Planner</button></nav>',
              { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
            ),
        );
        const meta = new BrowserWindow({
          show: true,
          width: 700,
          height: 500,
          webPreferences: { session: isolated },
        });
        try {
          for (const [query, expected] of [
            ['', 'online'],
            ['?loggedout', 'logged-out'],
          ]) {
            await meta.loadURL(
              'https://business.facebook.com/latest/home' + query,
            );
            const actual = await meta.webContents.executeJavaScript(
              `(${read.toString()})()`,
            );
            if (actual.status !== expected)
              throw Error(
                'Native Meta state mismatch: expected ' +
                  expected +
                  ', got ' +
                  actual.status,
              );
          }
        } finally {
          meta.destroy();
        }
        const icons = req(
          process.cwd() + '/build/features/customers/flagIcons.js',
        ).customerFlagSvg;
        const flags = ['vip', 'priority', 'follow', 'signup', 'deposit'];
        const file = '/tmp/zl-facebook-network-ui.html';
        fs.writeFileSync(
          file,
          '<!doctype html><meta charset="utf-8"><style>body{margin:0}#flags{display:flex;gap:10px}#flags>span{display:block;width:34px;height:38px}</style><div id="root"></div><div id="flags">' +
            flags
              .map(
                flag =>
                  '<span data-flag="' + flag + '">' + icons(flag) + '</span>',
              )
              .join('') +
            '</div>',
        );
        const ui = new BrowserWindow({
          show: true,
          width: 850,
          height: 600,
          webPreferences: { nodeIntegration: true, contextIsolation: false },
        });
        req('@electron/remote/main').enable(ui.webContents);
        try {
          await ui.loadFile(file);
          return await ui.webContents.executeJavaScript(`(async()=>{
        const React=require(${JSON.stringify(process.cwd() + '/node_modules/react')});
        const {createRoot}=require(${JSON.stringify(process.cwd() + '/node_modules/react-dom/client')});
        const {observable,runInAction}=require(${JSON.stringify(process.cwd() + '/node_modules/mobx')});
        const {ipcRenderer}=require('electron');
        const calls=[];
        ipcRenderer.invoke=async(...args)=>{calls.push(args);await new Promise(r=>setTimeout(r,120));return {target:args[3],ip:args[1]==='fb-test'?'203.0.113.9':'203.0.113.10',milliseconds:56,checkedAt:Date.now()}};
        const stores=observable({services:{active:{id:'fb-test',name:'FB fixture',recipe:{id:'facebook-business'},isEnabled:true,isHibernating:false,accountSnapshot:{nickname:'FB fixture'}}}});
        const Component=require(${JSON.stringify(process.cwd() + '/build/features/accountTools/AccountNetworkStatus.js')}).default;
        createRoot(document.querySelector('#root')).render(React.createElement(Component,{stores}));
        const wait=async check=>{const until=Date.now()+8000;while(!check()){if(Date.now()>until)throw Error('Native FB network UI timed out');await new Promise(r=>setTimeout(r,25))}};
        const check=(value,message)=>{if(!value)throw Error(message)};
        await wait(()=>document.querySelector('.account-network-status__ip')?.textContent.includes('203.0.113.9'));
        check(calls[0][3]==='facebook'&&document.querySelector('.account-network-status').title.includes('Meta Business Suite'),'FB destination/title mismatch');
        const button=document.querySelector('[aria-label="刷新 IP 和延迟"]');
        check(!button.disabled,'FB refresh is disabled');
        const rect=button.getBoundingClientRect();
        const wc=require(${JSON.stringify(process.cwd() + '/node_modules/@electron/remote')}).getCurrentWebContents();
        for(const type of ['mouseDown','mouseUp'])wc.sendInputEvent({type,x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2),button:'left',clickCount:1});
        await wait(()=>calls.length===2);
        check(calls[1][2]===true&&calls[1][3]==='facebook','Native refresh did not force FB request');
        await wait(()=>!button.disabled&&document.querySelector('.account-network-status__latency').textContent.includes('56 ms'));
        runInAction(()=>{stores.services.active={id:'wa-test',name:'WA fixture',recipe:{id:'whatsapp'},isEnabled:true,isHibernating:false,accountSnapshot:{nickname:'WA fixture'}}});
        await wait(()=>document.querySelector('.account-network-status__ip').textContent.includes('203.0.113.10'));
        check(calls.at(-1)[3]==='whatsapp','Switching accounts kept FB target');
        const expected=['rgb(255, 207, 0)','rgb(255, 48, 79)','rgb(33, 150, 255)','rgb(22, 223, 98)','rgb(179, 77, 255)'];
        for(const dark of [false,true]){
          document.body.style.background=dark?'#111820':'#ffffff';
          document.body.classList.toggle('theme__dark',dark);
          const paths=[...document.querySelectorAll('#flags path')];
          check(paths.length===5,'SABCD glyph missing');
          paths.forEach((path,index)=>{check(getComputedStyle(path).fill===expected[index],'SABCD color mismatch');check(parseFloat(getComputedStyle(path).strokeWidth)>0,'SABCD contrast outline missing');check(path.getBoundingClientRect().width>0,'SABCD glyph not rendered')});
        }
        return {nativeFacebookLoginAndLogout:true,nativeRefreshClick:true,accountSpecificNetworkResult:true,facebookWhatsAppTargetSwitch:true,allFiveFlagColorsInLightAndDark:true,contrastOutlines:true};
      })()`);
        } finally {
          ui.destroy();
        }
      }.toString()})()`,
    )})`,
  );
  assert(Object.values(result).every(value => value === true));
  console.log(
    'PASS native Facebook logged-in/logged-out detection, header IP/latency and refresh, account switch and SABCD colors in light/dark themes',
  );
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

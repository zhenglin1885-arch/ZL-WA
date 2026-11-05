/* eslint-disable no-console, no-await-in-loop -- Fresh disposable Chromium windows simulate restarting the app shell. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const proof = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function run() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(`${process.cwd()}/package.json`);
        const { BrowserWindow } = req('electron');
        const fs = req('node:fs');
        const dir = fs.mkdtempSync('/tmp/zl-sleep-persistence-');
        const file = `${dir}/index.html`;
        const prefs = `${dir}/prefs.json`;
        fs.writeFileSync(file, '<!doctype html><div id="root"></div>');
        fs.writeFileSync(
          prefs,
          JSON.stringify({
            groups: [],
            accounts: { sleeping: { remark: 'Keep remark' }, awake: {} },
          }),
        );
        const results = [];
        const partition = `zl-sleep-${Date.now()}`;
        try {
          for (const phase of [
            'sleep',
            'late-settings',
            'restart',
            'awake-restart',
          ]) {
            const win = new BrowserWindow({
              show: false,
              webPreferences: {
                partition,
                nodeIntegration: true,
                contextIsolation: false,
              },
            });
            req('@electron/remote/main').enable(win.webContents);
            try {
              await win.loadFile(file);
              const result = await win.webContents
                .executeJavaScript(`(async()=>{
                const fs=require('node:fs'),base=${JSON.stringify(process.cwd())},path=${JSON.stringify(prefs)},phase=${JSON.stringify(phase)};
                const {ipcRenderer}=require('electron');ipcRenderer.invoke=async()=>undefined;
                const app={...require(base+'/build/config').DEFAULT_APP_SETTINGS,hibernateOnStartup:false,accountSidebar:phase==='late-settings'?{groups:[],accounts:{}}:JSON.parse(fs.readFileSync(path,'utf8'))};
                const settings={app,_update:async({data})=>{Object.assign(app,data);fs.writeFileSync(path,JSON.stringify(app.accountSidebar));}};
                window.ferdium={stores:{settings}};
                localStorage.service=JSON.stringify({activeService:'sleeping'});
                const Service=require(base+'/build/models/Service').default;
                const first=[];
                Service.prototype._setAutoRun=function(){first.push({id:this.id,sleep:this.isHibernating});};
                const recipe={id:'whatsapp'};
                const sleeping=new Service({id:'sleeping',name:'Sleeping',isEnabled:true,isHibernationEnabled:false},recipe);
                const awake=new Service({id:'awake',name:'Awake',isEnabled:true,isHibernationEnabled:false},recipe);
                const Store=require(base+'/build/stores/ServicesStore').default;
                const store=Object.create(Store.prototype);
                Object.assign(store,{stores:{settings},one:id=>id==='sleeping'?sleeping:awake});
                const check=(value,label)=>{if(!value)throw Error(label);};
                if(phase==='sleep'){
                  store._hibernate({serviceId:'sleeping',manual:true});
                  check(sleeping.isHibernating&&!awake.isHibernating,'Manual sleep affected the wrong account');
                  check(JSON.parse(fs.readFileSync(path,'utf8')).accounts.sleeping.manualSleep===true,'Sleep was not saved');
                }else if(phase==='late-settings'){
                  check(!sleeping.isManuallyHibernating,'Fixture unexpectedly loaded preferences early');
                  app.accountSidebar=JSON.parse(fs.readFileSync(path,'utf8'));
                  Object.defineProperty(store,'all',{value:[sleeping,awake]});
                  store._restoreManualSleepReaction();
                  check(sleeping.isHibernating&&!awake.isHibernating,'Late preferences did not restore sleep before startup layout');
                }else if(phase==='restart'){
                  check(sleeping.isManuallyHibernating&&sleeping.isHibernating&&!awake.isHibernating,'Restart woke the saved sleeper or slept another account');
                  check(first.find(row=>row.id==='sleeping').sleep,'Sleep was restored after initial autorun');
                  store._awake({serviceId:'sleeping',automatic:true});
                  check(sleeping.isHibernating,'Automatic maintenance woke a saved sleeper');
                  store._awake({serviceId:'sleeping'});
                  check(!sleeping.isHibernating&&app.accountSidebar.accounts.sleeping.manualSleep===false,'Explicit wake did not clear persistence');
                }else{
                  check(!sleeping.isHibernating&&!awake.isHibernating,'Explicitly woken account slept again after restart');
                }
                check(app.accountSidebar.accounts.sleeping.remark==='Keep remark','Sleep changes overwrote another account preference');
                return {phase,sleeping:sleeping.isHibernating,awake:awake.isHibernating};
              })()`);
              results.push(result);
            } finally {
              win.destroy();
            }
          }
          return {
            savedAcrossFreshWindows: true,
            lastSelectedSleeperRestoredBeforeAutorun: true,
            automaticHibernationDisabled: true,
            automaticWakeBlocked: true,
            explicitWakePersists: true,
            otherAccountAndRemarkPreserved: true,
            phases: results,
          };
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }})()`,
    )})`,
  );
  assert.equal(proof.savedAcrossFreshWindows, true);
  console.log(JSON.stringify(proof));
} finally {
  socket.close();
}

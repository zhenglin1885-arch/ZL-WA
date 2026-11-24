/* Actual Chromium storage APIs and original/main-process permission callbacks. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';
try {
  const report = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function verify() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const { BrowserWindow, session } = req('electron');
        const fs = req('node:fs'),
          vm = req('node:vm'),
          ts = req('typescript');
        const allowWhatsAppPersistentStorage = req(
          process.cwd() + '/build/electron/whatsappStoragePermission.js',
        ).allowWhatsAppPersistentStorage;
        const old = req('node:child_process').execFileSync(
          'git',
          ['show', 'b1837882c644f5a889121d5ce510afad919e4d5b:src/index.ts'],
          { encoding: 'utf8' },
        );
        const current = fs.readFileSync(
          process.cwd() + '/src/index.ts',
          'utf8',
        );
        const callbacks = source => {
          const file = ts.createSourceFile(
            'index.ts',
            source,
            ts.ScriptTarget.Latest,
            true,
          );
          const found = {};
          const visit = node => {
            if (
              ts.isCallExpression(node) &&
              ts.isPropertyAccessExpression(node.expression) &&
              [
                'setPermissionRequestHandler',
                'setPermissionCheckHandler',
              ].includes(node.expression.name.text)
            )
              found[node.expression.name.text] = vm.runInNewContext(
                '(' + node.arguments[0].getText(file) + ')',
                { allowWhatsAppPersistentStorage, debug: () => {} },
              );
            ts.forEachChild(node, visit);
          };
          visit(file);
          return found;
        };
        const baseline = callbacks(old),
          fixed = callbacks(current),
          resources = [];
        const make = async (label, host, handlers) => {
          const events = [];
          const s = session.fromPartition(
            'qa-storage-' + label + '-' + Date.now(),
          );
          s.setPermissionRequestHandler((wc, p, cb, d) =>
            handlers.setPermissionRequestHandler(
              wc,
              p,
              value => {
                events.push({ kind: 'request', permission: p, allowed: value });
                cb(value);
              },
              d,
            ),
          );
          s.setPermissionCheckHandler((wc, p, origin, d) => {
            const value = handlers.setPermissionCheckHandler(wc, p, origin, d);
            events.push({ kind: 'check', permission: p, allowed: value });
            return value;
          });
          await s.protocol.handle(
            'https',
            () =>
              new Response(
                '<!doctype html><html><body>Isolated native storage fixture</body></html>',
                { headers: { 'Content-Type': 'text/html' } },
              ),
          );
          const win = new BrowserWindow({
            show: false,
            webPreferences: { session: s },
          });
          resources.push({ s, win });
          await win.loadURL('https://' + host + '/');
          return { win, s, events };
        };
        const persist = async f =>
          f.win.webContents.executeJavaScript(
            `(async()=>{const b=await navigator.storageBuckets.open('qa');return{originPersist:await navigator.storage.persist(),bucketPersist:await b.persist(),bucketPersisted:await b.persisted()};})()`,
          );
        const write = async (f, value) =>
          f.win.webContents.executeJavaScript(
            `(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('qa-record',1);r.onupgradeneeded=()=>r.result.createObjectStore('record');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('open failed'));});await new Promise((resolve,reject)=>{const tx=db.transaction('record','readwrite');tx.objectStore('record').put(${JSON.stringify(value)},'value');tx.oncomplete=resolve;tx.onerror=()=>reject(Error('write failed'));});db.close();return true;})()`,
          );
        const read = async f =>
          f.win.webContents.executeJavaScript(
            `(async()=>{const db=await new Promise(resolve=>{const r=indexedDB.open('qa-record',1);r.onsuccess=()=>resolve(r.result);});const value=await new Promise(resolve=>{const r=db.transaction('record').objectStore('record').get('value');r.onsuccess=()=>resolve(r.result);});db.close();return value;})()`,
          );
        try {
          const legacy = await make('old', 'web.whatsapp.com', baseline),
            denied = await persist(legacy);
          const a = await make('a', 'web.whatsapp.com', fixed),
            granted = await persist(a);
          const b = await make('b', 'web.whatsapp.com', fixed);
          await persist(b);
          await write(a, 'fixture-account-a');
          await write(b, 'fixture-account-b');
          await a.s.flushStorageData();
          await b.s.flushStorageData();
          await a.win.loadURL('https://web.whatsapp.com/login/');
          await b.win.loadURL('https://web.whatsapp.com/login/');
          const retainedA = await read(a),
            retainedB = await read(b);
          const foreign = await make('foreign', 'unrelated.invalid', fixed),
            foreignDenied = await persist(foreign);
          const facebook = await make('fb', 'business.facebook.com', fixed),
            facebookUnchanged = await persist(facebook);
          const worker = await a.win.webContents.executeJavaScript(
            `new Promise((resolve,reject)=>{const url=URL.createObjectURL(new Blob(['onmessage=async()=>{try{const b=await navigator.storageBuckets.open("qa");postMessage({canRequestPersistence:typeof b.persist==="function",persisted:await b.persisted()});}catch(e){postMessage({error:String(e)});}}'],{type:'text/javascript'}));const w=new Worker(url);const timer=setTimeout(()=>{w.terminate();URL.revokeObjectURL(url);reject(Error('worker timeout'));},3000);w.onmessage=e=>{clearTimeout(timer);w.terminate();URL.revokeObjectURL(url);resolve(e.data);};w.onerror=()=>reject(Error('worker failed'));w.postMessage(null);})`,
          );
          if (
            Object.values(denied).some(Boolean) ||
            !Object.values(granted).every(Boolean)
          )
            throw Error('Storage persistence regression');
          if (
            Object.values(foreignDenied).some(Boolean) ||
            Object.values(facebookUnchanged).some(Boolean)
          )
            throw Error('Unexpected grant to another origin');
          if (
            retainedA !== 'fixture-account-a' ||
            retainedB !== 'fixture-account-b'
          )
            throw Error('Storage isolation/retention failed');
          if (!worker.persisted)
            throw Error(
              'Worker could not read persisted bucket: ' +
                JSON.stringify({ worker, events: a.events }),
            );
          const servicePartition = 'qa-actual-service-storage-' + Date.now();
          const serviceSession = session.fromPartition(servicePartition);
          await serviceSession.protocol.handle(
            'https',
            () =>
              new Response(
                '<!doctype html><html><body>Official-origin service fixture</body></html>',
                { headers: { 'Content-Type': 'text/html' } },
              ),
          );
          const serviceHost = new BrowserWindow({
            show: false,
            webPreferences: {
              nodeIntegration: true,
              contextIsolation: false,
              webviewTag: true,
            },
          });
          resources.push({ win: serviceHost, s: serviceSession });
          await serviceHost.loadURL(
            'data:text/html,<html><body></body></html>',
          );
          const actualServiceWebview = await serviceHost.webContents
            .executeJavaScript(`new Promise((resolve,reject)=>{
            const v=document.createElement('webview');const timer=setTimeout(()=>reject(Error('service fixture timed out')),5000);
            v.setAttribute('partition',${JSON.stringify(servicePartition)});
            v.addEventListener('dom-ready',async()=>{try{const r=await v.executeJavaScript('(async()=>{const b=await navigator.storageBuckets.open("qa");return {originPersist:await navigator.storage.persist(),bucketPersist:await b.persist(),bucketPersisted:await b.persisted()};})()');clearTimeout(timer);resolve(r);}catch(e){clearTimeout(timer);reject(e);}});
            v.setAttribute('src','https://web.whatsapp.com/');document.body.append(v);
          })`);
          if (
            !serviceSession._permissionHandlersSet ||
            !Object.values(actualServiceWebview).every(Boolean)
          )
            throw Error('Actual service session permission handling failed');
          return {
            electron: process.versions.electron,
            baseline: denied,
            officialWhatsApp: granted,
            officialWorker: worker,
            actualServiceWebview,
            servicePermissionHandlersInstalled: true,
            unrelatedOrigin: foreignDenied,
            facebookUnchanged,
            recordsRetainedAfterReload: true,
            accountSessionsIsolated: true,
            persistentPermissionObserved: a.events.some(
              e => e.permission === 'persistent-storage' && e.allowed,
            ),
            realPhonePairingVerified: false,
          };
        } finally {
          for (const { win, s } of resources) {
            win.destroy();
            await s.protocol.unhandle('https');
          }
        }
      }.toString()})()`,
    )})`,
  );
  assert(
    report.officialWhatsApp.bucketPersisted &&
      report.recordsRetainedAfterReload &&
      report.accountSessionsIsolated,
  );
  console.log(
    'PASS actual original permission callbacks deny StorageManager/StorageBucket persistence; scoped fix allows official WhatsApp persistence and worker access, retains records across reload, isolates account sessions and preserves other-site policy',
  );
  console.log(JSON.stringify(report));
} finally {
  socket.close();
}

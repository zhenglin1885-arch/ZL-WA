/* Native guest regression. No real account or phone pairing is simulated. */
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
        const snapshot = req(
          process.cwd() + '/build/features/accounts/whatsapp.js',
        ).readWhatsAppSnapshot;
        const diagnostics = req(
          process.cwd() + '/build/features/accounts/sendDiagnostics.js',
        ).readSendDiagnostics;
        const pairing = req(
          process.cwd() + '/build/features/accounts/pairingDiagnostics.js',
        ).configurePairingDiagnostics;
        const customers = req(
          process.cwd() + '/build/features/customers/guest.js',
        ).readCustomerContext;
        const unread = req(
          process.cwd() + '/build/features/accounts/unread.js',
        ).watchWhatsAppUnread;
        const voice = req(
          process.cwd() + '/build/features/accounts/voice.js',
        ).configureWhatsAppVoice;
        const translation = req(
          process.cwd() + '/build/features/accountTools/guest.js',
        ).translationTick;
        const s = session.fromPartition('qa-login-readiness-' + Date.now());
        await s.protocol.handle(
          'https',
          () =>
            new Response(
              '<!doctype html><html><head></head><body></body></html>',
              { headers: { 'Content-Type': 'text/html' } },
            ),
        );
        const win = new BrowserWindow({
          show: false,
          webPreferences: { session: s },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/login/');
          return await win.webContents.executeJavaScript(`(async()=>{
        let calls=0;let reports=0;window.require=()=>{calls++;reports++;throw Error('unresolved dependencies')};window.WPP={isReady:true};
        const initialStart=performance.timeOrigin;
        const install=${pairing.toString()};install();
        const results=[];
        for(const state of ['loading','login']){
          document.body.innerHTML=state==='login'?'<div data-testid="qrcode"><canvas></canvas></div>':'';
          const value=await (${snapshot.toString()})(false,{state});
          const d=(${diagnostics.toString()})();
          const c=(${customers.toString()})();
          const t=(${translation.toString()})({});
          (${unread.toString()})();
          if((${voice.toString()})()!==false) throw Error('voice initialized on login');
          await new Promise(r=>setTimeout(r,1100));
          results.push({state,status:value.status,socket:d.socket,canInitialize:c.canInitialize,translationRequests:t.length});
        }
        return {results,nativeLoaderCalls:calls,errorReports:reports,noReload:performance.timeOrigin===initialStart,realPhonePairingVerified:false};
      })()`);
        } finally {
          win.destroy();
          await s.protocol.unhandle('https');
        }
      }.toString()})()`,
    )})`,
  );
  assert.equal(result.nativeLoaderCalls, 0);
  assert.equal(result.errorReports, 0);
  assert.equal(result.noReload, true);
  assert.deepEqual(
    result.results.map(x => x.status),
    ['loading', 'logged-out'],
  );
  console.log(
    'PASS actual Electron guest: login/loading and repeated pairing samples do not invoke native lazy modules, initialize SDK or reload',
  );
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

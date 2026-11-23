/* Native read-only pairing diagnostics checks; no real QR, phone or account is used. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';
try {
  const r = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${async function verify() {
        const req = process
          .getBuiltinModule('module')
          .createRequire(process.cwd() + '/package.json');
        const { BrowserWindow, session } = req('electron');
        const configure = req(
          process.cwd() + '/build/features/accounts/pairingDiagnostics.js',
        ).configurePairingDiagnostics;
        const read = req(
          process.cwd() + '/build/features/accounts/sendDiagnostics.js',
        ).readSendDiagnostics;
        const s = session.fromPartition('qa-pairing-' + Date.now());
        await s.protocol.handle(
          'https',
          () =>
            new Response(
              '<!doctype html><meta charset="utf-8"><div data-testid="qrcode" data-ref="PRIVATE_QR"><canvas></canvas></div>',
              { headers: { 'Content-Type': 'text/html' } },
            ),
        );
        const win = new BrowserWindow({
          show: false,
          webPreferences: { session: s },
        });
        try {
          await win.loadURL('https://web.whatsapp.com/');
          const r = await win.webContents.executeJavaScript(
            `(async()=>{const original={push:history.pushState,ws:WebSocket,fetch,open:indexedDB.open,start:performance.timeOrigin};const install=${configure.toString()};install();install();for(let i=0;i<3;i++){document.querySelector('[data-ref]').setAttribute('data-ref','PRIVATE_QR_'+i);await new Promise(r=>setTimeout(r,10))}window.dispatchEvent(new ErrorEvent('error',{error:new DOMException('PRIVATE_PHONE PRIVATE_CHAT','QuotaExceededError')}));await new Promise(r=>setTimeout(r,10));const value=(${read.toString()})();return {value,historyUnchanged:original.push===history.pushState,webSocketUnchanged:original.ws===WebSocket,fetchUnchanged:original.fetch===fetch,storageUnchanged:original.open===indexedDB.open,noPageReload:original.start===performance.timeOrigin}})()`,
          );
          if (
            !r.historyUnchanged ||
            !r.webSocketUnchanged ||
            !r.fetchUnchanged ||
            !r.storageUnchanged ||
            !r.noPageReload
          )
            throw Error('Diagnostic changed browser behavior');
          if (
            r.value.pairing.qrChanges !== 3 ||
            !r.value.pairing.events.some(e => e.code === 'QuotaExceededError')
          )
            throw Error('Pairing event not captured');
          if (/PRIVATE_/.test(JSON.stringify(r)))
            throw Error('Diagnostic leaked page content');
          return {
            qrRefreshObserved: r.value.pairing.qrChanges,
            exceptionTypesObserved: true,
            nativeBrowserApisUnchanged: true,
            noPageReload: true,
            noQrAccountOrChatContent: true,
          };
        } finally {
          win.destroy();
          await s.protocol.unhandle('https');
        }
      }.toString()})()`,
    )})`,
  );
  assert.equal(r.qrRefreshObserved, 3);
  console.log(
    'PASS native pairing observation records QR rotation and bounded error types without QR contents, browser API replacement, storage mutation or reload',
  );
  console.log(JSON.stringify(r));
} finally {
  socket.close();
}

/* Actual preload and IPC regression in isolated native Electron pages. */
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
          path = req('node:path'),
          os = req('node:os');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-preload-root-'));
        const preload = path.join(dir, 'preload.cjs');
        fs.writeFileSync(
          preload,
          `const {contextBridge}=require('electron');contextBridge.exposeInMainWorld('__zlRootAtPreload',Boolean(document.documentElement));require(${JSON.stringify(path.join(process.cwd(), 'build/webview/recipe.js'))});`,
        );
        const s = session.fromPartition('qa-preload-root-' + Date.now());
        await s.protocol.handle(
          'https',
          () =>
            new Response(
              '<!doctype html><html><head><title>QA</title></head><body><div data-testid="qrcode"><canvas></canvas></div></body></html>',
              { headers: { 'Content-Type': 'text/html' } },
            ),
        );
        const win = new BrowserWindow({
          show: false,
          webPreferences: {
            session: s,
            preload,
            sandbox: false,
            contextIsolation: true,
          },
        });
        req('@electron/remote/main').enable(win.webContents);
        const errors = [];
        const warnings = [];
        win.webContents.on('preload-error', (_event, _path, error) =>
          errors.push(String(error)),
        );
        win.webContents.on('console-message', (_event, level, message) => {
          if (
            /\[mobx\]|\[MobX\]|removeAttribute|Recipe initialization failed/i.test(
              message,
            )
          )
            (level >= 3 ? errors : warnings).push(message);
        });
        try {
          for (let i = 0; i < 3; i++) {
            await win.loadURL('https://web.whatsapp.com/login/');
            const atStart = await win.webContents.executeJavaScript(
              'window.__zlRootAtPreload',
            );
            if (atStart !== false)
              throw Error('Preload root absence was not exercised');
            win.webContents.send('settings-update', {
              enableSpellchecking: false,
              enableTranslator: false,
              searchEngine: 'https://example.invalid/',
            });
            win.webContents.send('service-settings-update', {
              id: 'qa-preload',
              isDarkModeEnabled: false,
              recipe: {
                path: path.join(process.cwd(), 'recipes/recipes/whatsapp'),
              },
            });
            await new Promise(r => setTimeout(r, 80));
          }
          if (errors.length || warnings.length)
            throw Error(JSON.stringify({ errors, warnings }));
          return {
            actualRecipePreload: true,
            rootAbsentAtPreload: true,
            threeNavigations: true,
            settingsIpcAfterReady: true,
            mobxErrors: errors.length,
            mobxWarnings: warnings.length,
            realPhonePairingVerified: false,
          };
        } finally {
          win.destroy();
          await s.protocol.unhandle('https');
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }.toString()})()`,
    )})`,
  );
  assert.equal(report.mobxErrors, 0);
  assert.equal(report.mobxWarnings, 0);
  console.log(
    'PASS real recipe preload before <html>, three native navigations and settings IPC produce no Dark Reader null-root error or MobX strict-mode warnings',
  );
  console.log(JSON.stringify(report));
} finally {
  socket.close();
}

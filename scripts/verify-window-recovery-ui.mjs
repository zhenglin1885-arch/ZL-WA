/* eslint-disable global-require, import/no-dynamic-require, unicorn/consistent-function-scoping, no-await-in-loop -- Isolated renderer code loads the actual compiled component and polls its React fallback. */
/* eslint-disable no-console -- Offline native crash and React boundary regression. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const program = `(${async function verify() {
    const req = process
      .getBuiltinModule('module')
      .createRequire(`${process.cwd()}/package.json`);
    const { BrowserWindow, session } = req('electron');
    const fs = req('node:fs');
    const vm = req('node:vm');
    const module = { exports: {} };
    vm.runInNewContext(
      fs.readFileSync(
        `${process.cwd()}/build/electron/windowHealth.js`,
        'utf8',
      ),
      {
        module,
        exports: module.exports,
        require: req,
        setTimeout,
        clearTimeout,
        Date,
      },
    );
    const isolated = session.fromPartition(`zl-window-recovery-${Date.now()}`);
    await isolated.protocol.handle(
      'https',
      () =>
        new Response(
          '<!doctype html><html><body><div id="root">ready</div></body></html>',
          { headers: { 'Content-Type': 'text/html' } },
        ),
    );
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        session: isolated,
        nodeIntegration: true,
        contextIsolation: false,
        sandbox: false,
      },
    });
    const records = [];
    let dispose;
    let timer;
    try {
      await win.loadURL('https://window-recovery.invalid/');
      await win.webContents.executeJavaScript(
        "localStorage.setItem('original-profile','preserved');document.cookie='synthetic=preserved;path=/';",
      );
      dispose = module.exports.installWindowRecovery(win, {
        record: row => records.push(row),
        quitting: () => false,
      });
      const loaded = new Promise(resolve => {
        win.webContents.once('did-finish-load', resolve);
      });
      win.webContents.forcefullyCrashRenderer();
      await Promise.race([
        loaded,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Renderer did not recover')),
            15_000,
          );
        }),
      ]);
      clearTimeout(timer);
      const preserved = await win.webContents.executeJavaScript(
        "localStorage.getItem('original-profile') === 'preserved' && document.cookie.includes('synthetic=preserved') && document.querySelector('#root').textContent === 'ready'",
      );
      if (
        !preserved ||
        records.filter(row => row.event === 'renderer-reload').length !== 1 ||
        !records.some(row => row.event === 'renderer-gone')
      )
        throw new Error(
          'Crash recovery or original session preservation failed',
        );
      const boundary = await win.webContents.executeJavaScript(
        `(${async function verifyBoundary(base) {
          const React = require(`${base}/node_modules/react`);
          const { createRoot } = require(
            `${base}/node_modules/react-dom/client`,
          );
          const Boundary = require(
            `${base}/build/components/util/AppErrorBoundary`,
          ).default;
          const { ipcRenderer } = require('electron');
          const captured = [];
          const original = ipcRenderer.send;
          ipcRenderer.send = (channel, details) => {
            if (channel === 'zl-window-renderer-error') captured.push(details);
            else original.call(ipcRenderer, channel, details);
          };
          function Broken() {
            throw new TypeError('synthetic-private-message');
          }
          window.__recoveryButtonClicked = 0;
          const root = createRoot(document.querySelector('#root'));
          root.render(
            React.createElement(
              Boundary,
              {
                onReload: () => {
                  window.__recoveryButtonClicked += 1;
                },
              },
              React.createElement(Broken),
            ),
          );
          const until = Date.now() + 5000;
          while (
            !document.querySelector('[role="alert"] button') &&
            Date.now() < until
          )
            await new Promise(resolve => {
              setTimeout(resolve, 25);
            });
          const button = document.querySelector('[role="alert"] button');
          if (
            !button ||
            captured.length === 0 ||
            JSON.stringify(captured).includes('synthetic-private-message')
          )
            throw new Error(
              'Root error fallback or private diagnostics failed',
            );
          const bounds = button.getBoundingClientRect();
          return {
            x: Math.round(bounds.x + bounds.width / 2),
            y: Math.round(bounds.y + bounds.height / 2),
            payload: captured[0],
          };
        }.toString()})(${JSON.stringify(process.cwd())})`,
      );
      win.show();
      win.focus();
      win.webContents.focus();
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        x: boundary.x,
        y: boundary.y,
        button: 'left',
        clickCount: 1,
      });
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        x: boundary.x,
        y: boundary.y,
        button: 'left',
        clickCount: 1,
      });
      await new Promise(resolve => {
        setTimeout(resolve, 150);
      });
      if (
        !(await win.webContents.executeJavaScript(
          'window.__recoveryButtonClicked === 1',
        ))
      )
        throw new Error('Native recovery button click failed');
      return {
        nativeRendererCrashRecovered: true,
        originalStoragePreserved: true,
        noReloadLoop: true,
        rootReactFallbackVisible: true,
        privateMessagesExcluded: true,
        nativeRecoveryButton: true,
      };
    } finally {
      clearTimeout(timer);
      dispose?.();
      win.destroy();
      await isolated.protocol.unhandle('https');
    }
  }.toString()})()`;
  const result = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(program)})`,
  );
  assert.equal(result.nativeRendererCrashRecovered, true);
  console.log(JSON.stringify(result));
} finally {
  socket.close();
}

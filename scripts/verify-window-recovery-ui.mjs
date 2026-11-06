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
    const readyPage =
      '<!doctype html><html><body><div id="root"><main>ready</main></div></body></html>';
    let pageHtml = readyPage;
    await isolated.protocol.handle(
      'https',
      () =>
        new Response(pageHtml, { headers: { 'Content-Type': 'text/html' } }),
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
    const resumeEvents = new (req('node:events').EventEmitter)();
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
        resumeEvents,
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
      await win.webContents.executeJavaScript(
        "document.querySelector('#root').replaceChildren();true",
      );
      const empty = await module.exports.inspectWindowSurface(win);
      if (empty.state !== 'root-empty')
        throw new Error('Empty application root was reported as ready');
      await win.webContents.executeJavaScript(
        "document.querySelector('#root').innerHTML='<main>ready</main>';true",
      );
      win.show();
      resumeEvents.emit('resume');
      await new Promise(resolve => {
        setTimeout(resolve, 3200);
      });
      if (
        !records.some(row => row.event === 'renderer-repaint-requested') ||
        !records.some(
          row =>
            row.event === 'renderer-surface' &&
            row.surface.state === 'root-present',
        ) ||
        records.filter(row => row.event === 'renderer-reload').length !== 1
      )
        throw new Error('Resume repaint did not preserve the live renderer');
      // Use a fresh recovery lifecycle so the preceding intentional crash's
      // cooldown does not mask the independent blank-startup scenario.
      dispose();
      dispose = module.exports.installWindowRecovery(win, {
        record: row => records.push(row),
        quitting: () => false,
        resumeEvents,
      });
      pageHtml =
        '<!doctype html><html><body><div id="root"></div></body></html>';
      await win.loadURL('https://window-recovery.invalid/?empty-startup');
      pageHtml = readyPage;
      const recoveredBlank = new Promise(resolve => {
        win.webContents.once('did-finish-load', resolve);
      });
      await Promise.race([
        recoveredBlank,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Empty root did not recover')),
            15_000,
          );
        }),
      ]);
      clearTimeout(timer);
      if (
        !records.some(
          row =>
            row.event === 'renderer-reload' &&
            row.reason === 'startup-incomplete',
        )
      )
        throw new Error(
          'Blank startup did not use bounded main-process recovery',
        );
      if (
        !(await win.webContents.executeJavaScript(
          "document.querySelector('#root').textContent === 'ready' && localStorage.getItem('original-profile') === 'preserved' && document.cookie.includes('synthetic=preserved')",
        ))
      )
        throw new Error('Blank startup recovery lost the shell or profile');
      const startup = await win.webContents.executeJavaScript(
        `(${function verifyStartup(base) {
          const startupGuard = require(
            `${base}/build/electron/rendererStartup`,
          );
          const { ipcRenderer } = require('electron');
          const captured = [];
          const original = ipcRenderer.send;
          ipcRenderer.send = (channel, details) => {
            if (channel === 'zl-window-renderer-error') captured.push(details);
            else original.call(ipcRenderer, channel, details);
          };
          let starts = 0;
          startupGuard.startRendererWhenReady(() => {
            starts += 1;
          });
          window.dispatchEvent(new Event('load'));
          if (starts !== 1)
            throw new Error('Late initialization was skipped or duplicated');
          document.querySelector('#root').innerHTML =
            '<section data-zl-startup="pending">loading</section>';
          startupGuard.installRendererStartupGuard();
          const error = new TypeError('synthetic-private-startup');
          error.stack =
            'TypeError: synthetic-private-startup\n at initialize (file:///C:/private-home/app.js:12:4)';
          startupGuard.startRendererWhenReady(() => {
            throw error;
          });
          window.dispatchEvent(new ErrorEvent('error', { error }));
          window.dispatchEvent(
            new PromiseRejectionEvent('unhandledrejection', {
              promise: Promise.resolve(),
              reason: error,
            }),
          );
          const button = document.querySelector(
            '[data-zl-startup="failed"] button',
          );
          if (
            !button ||
            captured.length !== 3 ||
            JSON.stringify(captured).includes('synthetic-private') ||
            JSON.stringify(captured).includes('private-home')
          )
            throw new Error(
              'Pre-React fallback or sanitized exception reporting failed',
            );
          const box = button.getBoundingClientRect();
          return {
            x: Math.round(box.x + box.width / 2),
            y: Math.round(box.y + box.height / 2),
          };
        }.toString()})(${JSON.stringify(process.cwd())})`,
      );
      const failedSurface = await module.exports.inspectWindowSurface(win);
      if (failedSurface.state !== 'startup-failed')
        throw new Error('Startup fallback was mistaken for a ready shell');
      win.focus();
      win.webContents.focus();
      const startupScreenshot = await win.webContents.capturePage();
      fs.writeFileSync(
        '/tmp/zl-window-startup-fallback.png',
        startupScreenshot.toPNG(),
      );
      const manuallyRecovered = new Promise(resolve => {
        win.webContents.once('did-finish-load', resolve);
      });
      win.webContents.sendInputEvent({
        type: 'mouseDown',
        x: startup.x,
        y: startup.y,
        button: 'left',
        clickCount: 1,
      });
      win.webContents.sendInputEvent({
        type: 'mouseUp',
        x: startup.x,
        y: startup.y,
        button: 'left',
        clickCount: 1,
      });
      await Promise.race([
        manuallyRecovered,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Startup recovery button did not reload')),
            5000,
          );
        }),
      ]);
      clearTimeout(timer);
      if (
        !(await win.webContents.executeJavaScript(
          "document.querySelector('#root').textContent === 'ready'",
        ))
      )
        throw new Error('Manual startup recovery did not restore the shell');
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
        incompleteStartupAutomaticallyRecovered: true,
        startupFailureBeforeReactVisible: true,
        lateStartupInitializedOnce: true,
        startupErrorAndRejectionSanitized: true,
        nativeStartupRecoveryButton: true,
        resumeRepaintWithoutReload: true,
        emptyRootDetected: true,
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

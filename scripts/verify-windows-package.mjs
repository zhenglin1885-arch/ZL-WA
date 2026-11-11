/* eslint-disable no-console, no-await-in-loop -- Verify a disposable native Windows application process and its packaged renderer. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import verifyMessageTranslation from './verify-message-translation-native.cjs';

assert.equal(process.platform, 'win32');
assert.equal(process.arch, 'x64');
const expectedVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const executable = resolve(process.argv[2]);
const profile = mkdtempSync(join(tmpdir(), 'zl-packaged-startup-'));
// Reproduce the actual startup blocker with synthetic bytes, never a user profile.
const zeroFilledConfig = Buffer.alloc(1_350_233);
writeFileSync(join(profile, 'account-tools.json'), zeroFilledConfig);
const child = spawn(executable, ['--remote-debugging-port=9333'], {
  env: { ...process.env, ZL_WA_APPDATA_DIR: profile },
  stdio: ['ignore', 'pipe', 'pipe'],
});
// Drain output without publishing profile information or local authentication data.
child.stdout.on('data', () => {});
child.stderr.on('data', () => {});
let socket;
let state;
let childError;
child.on('error', error => {
  childError = error;
});
const pause = ms =>
  new Promise(resolvePause => {
    setTimeout(resolvePause, ms);
  });
try {
  const until = Date.now() + 90_000;
  let page;
  while (Date.now() < until && child.exitCode === null) {
    if (childError) break;
    try {
      const response = await fetch('http://127.0.0.1:9333/json/list');
      const pages = await response.json();
      page = pages.find(
        item =>
          item.type === 'page' &&
          item.url.startsWith('file://') &&
          item.url.includes('app.asar/index.html'),
      );
      if (page) break;
    } catch {
      // The packaged main process or debugger is still starting.
    }
    await pause(250);
  }
  assert(
    page,
    `Packaged window unavailable: exit=${child.exitCode}; spawnError=${childError?.code || 'none'}`,
  );
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open', { signal: AbortSignal.timeout(10_000) });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      waiter(message);
    }
  });
  const evaluate = async expression => {
    sequence += 1;
    const id = sequence;
    let timer;
    try {
      const response = new Promise(resolveResponse => {
        pending.set(id, resolveResponse);
      });
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
      const message = await Promise.race([
        response,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Packaged renderer timed out')),
            10_000,
          );
        }),
      ]);
      if (message.error || message.result?.exceptionDetails) return null;
      return message.result?.result?.value;
    } finally {
      clearTimeout(timer);
      pending.delete(id);
    }
  };
  const ready = async requireReload => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline && child.exitCode === null) {
      state = await evaluate(
        `(()=>{const s=window.ferdium?.stores;return {version:require('@electron/remote').app.getVersion(),arch:process.arch,platform:process.platform,reloaded:!window.__zlPackagedBeforeReload,documentState:document.readyState,localSessionReady:!!s?.user.localSessionReady,settingsLoaded:!!s?.settings.loaded,servicesLoaded:!!s?.services.allServicesRequest.wasExecuted,rootElements:document.querySelector('#root')?.childElementCount||0,startupPlaceholder:!!document.querySelector('[data-zl-startup]'),errorFallback:!!document.querySelector('[role="alert"] h1')}})()`,
      );
      if (
        state?.localSessionReady &&
        state.settingsLoaded &&
        state.servicesLoaded &&
        state.rootElements > 0 &&
        !state.startupPlaceholder &&
        !state.errorFallback &&
        (!requireReload || state.reloaded)
      ) {
        assert.equal(state.version, expectedVersion);
        assert.equal(state.arch, 'x64');
        assert.equal(state.platform, 'win32');
        return state;
      }
      await pause(250);
    }
    throw new Error(`Packaged UI did not initialize: ${JSON.stringify(state)}`);
  };
  const initial = await ready(false);
  const rebuilt = JSON.parse(
    readFileSync(join(profile, 'account-tools.json'), 'utf8'),
  );
  assert.equal(rebuilt.recoveryRequiresProxyReview, true);
  const preserved = readdirSync(profile).find(name =>
    name.startsWith('account-tools.json.preserved-'),
  );
  assert(preserved, 'Original zero-filled config was not preserved');
  assert(readFileSync(join(profile, preserved)).equals(zeroFilledConfig));
  const recoveryGuard = await evaluate(`(async()=>{
    const {ipcRenderer}=require('electron');
    const config=await ipcRenderer.invoke('account-tools-get','recovery-verification');
    let blocked=false;try{await ipcRenderer.invoke('account-tools-prepare','recovery-verification');}catch{blocked=true;}
    const saved=await ipcRenderer.invoke('account-tools-save','recovery-verification',config,true);
    const other=await ipcRenderer.invoke('account-tools-get','other-unreviewed-account');
    return {blocked,reviewRequired:config.requiresProxyReview===true,confirmed:!saved.requiresProxyReview,otherStillBlocked:other.requiresProxyReview===true};
  })()`);
  assert.deepEqual(recoveryGuard, {
    blocked: true,
    reviewRequired: true,
    confirmed: true,
    otherStillBlocked: true,
  });
  const appPath = await evaluate(
    "require('@electron/remote').app.getAppPath()",
  );
  const normalMessages = await evaluate(
    `require('@electron/remote').require('node:vm').runInThisContext(${JSON.stringify(
      `(${verifyMessageTranslation.toString()})(${JSON.stringify(appPath)})`,
    )})`,
  );
  assert.deepEqual(normalMessages, {
    normalMessagesTranslated: 3,
    nonMessageCardsExcluded: 2,
  });
  await evaluate(
    `window.__zlPackagedBeforeReload=true;require('electron').ipcRenderer.send('zl-window-reload-requested','system-resume');true`,
  );
  const afterResumeReload = await ready(true);
  const asar = join(dirname(executable), 'resources', 'app.asar');
  const report = {
    version: expectedVersion,
    commit: process.env.GITHUB_SHA,
    nativePackagedStartup: true,
    mainProcessResumeReload: true,
    zeroFilledConfigurationRebuilt: true,
    zeroFilledOriginalPreserved: true,
    explicitNetworkReviewRequired: true,
    normalMessageTranslationVerified: true,
    asarSha256: createHash('sha256').update(readFileSync(asar)).digest('hex'),
    initial,
    afterResumeReload,
  };
  writeFileSync(
    join(dirname(dirname(executable)), 'windows-startup-verification.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.error(
    `::error::${String(error instanceof Error ? error.message : error).replaceAll(/[\n\r]/g, ' ')}`,
  );
  try {
    const events = JSON.parse(
      readFileSync(join(profile, 'window-health.json'), 'utf8'),
    );
    console.error('Sanitized shell events:', JSON.stringify(events.slice(-12)));
  } catch {
    /* A failed early launch may not have a health file. */
  }
  throw error;
} finally {
  if (socket?.readyState === WebSocket.OPEN)
    socket.send(
      JSON.stringify({
        id: 99_999,
        method: 'Runtime.evaluate',
        params: { expression: "require('@electron/remote').app.quit();true" },
      }),
    );
  await pause(1200);
  socket?.close();
  if (child.pid && child.exitCode === null && child.signalCode === null)
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
    });
}

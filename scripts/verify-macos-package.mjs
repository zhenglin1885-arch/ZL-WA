/* eslint-disable no-console, no-await-in-loop -- Native packaged-app smoke test on a disposable macOS runner. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [executable, arch, output] = process.argv.slice(2);
assert.equal(process.platform, 'darwin');
assert(['arm64', 'x64'].includes(arch));
const port = 9333;
const child = spawn(executable, [`--remote-debugging-port=${port}`], {
  detached: true,
  env: {
    ...process.env,
    ZL_WA_APPDATA_DIR: mkdtempSync(join(tmpdir(), 'zl-macos-smoke-')),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
const appendLog = chunk => {
  logs = (logs + chunk.toString()).slice(-16_000);
};
for (const stream of [child.stdout, child.stderr]) stream.on('data', appendLog);
let socket;
try {
  const until = Date.now() + 90_000;
  let page;
  while (Date.now() < until && child.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const pages = await response.json();
      page = pages.find(
        item =>
          item.type === 'page' &&
          item.url.startsWith('file://') &&
          item.url.includes('app.asar/index.html'),
      );
      if (page) break;
    } catch {
      /* App/debugger is still starting. */
    }
    await new Promise(resolve => {
      setTimeout(resolve, 300);
    });
  }
  assert(page, `Packaged app did not create its window. ${logs}`);
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
    const reply = new Promise(resolve => {
      pending.set(id, resolve);
    });
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    );
    let timer;
    try {
      const message = await Promise.race([
        reply,
        new Promise((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Renderer evaluation timed out')),
            10_000,
          );
        }),
      ]);
      assert(
        !message.error && !message.result.exceptionDetails,
        JSON.stringify(message),
      );
      return message.result.result.value;
    } finally {
      clearTimeout(timer);
    }
  };
  let state;
  while (Date.now() < until) {
    state = await evaluate(
      `(()=>{const stores=window.ferdium?.stores;return {version:require('@electron/remote').app.getVersion(),arch:process.arch,platform:process.platform,localSessionReady:Boolean(stores?.user.localSessionReady),settingsLoaded:Boolean(stores?.settings.loaded),servicesLoaded:Boolean(stores?.services.allServicesRequest.wasExecuted),rootElements:document.querySelector('#root')?.childElementCount||0,errorFallback:Boolean(document.querySelector('[role="alert"] h1'))}})()`,
    );
    if (
      state.localSessionReady &&
      state.settingsLoaded &&
      state.servicesLoaded &&
      state.rootElements > 0
    )
      break;
    await new Promise(resolve => {
      setTimeout(resolve, 500);
    });
  }
  assert.equal(state.version, '7.3.8');
  assert.equal(state.arch, arch);
  assert.equal(state.platform, 'darwin');
  assert(
    state.localSessionReady &&
      state.settingsLoaded &&
      state.servicesLoaded &&
      state.rootElements > 0,
    `Packaged UI did not initialize: ${JSON.stringify(state)} ${logs}`,
  );
  assert.equal(state.errorFallback, false);
  writeFileSync(
    output,
    `${JSON.stringify({ nativePackagedStartup: true, ...state }, null, 2)}\n`,
  );
  console.log(JSON.stringify(state));
} finally {
  socket?.close();
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Already exited. */
    }
    await Promise.race([
      once(child, 'exit'),
      new Promise(resolve => {
        setTimeout(resolve, 1000);
      }),
    ]);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* Already exited. */
    }
  }
}

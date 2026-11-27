import { EventEmitter } from 'node:events';

let ipc: any;
let Recipe: any;
beforeEach(() => {
  jest.resetModules();
  ipc = new EventEmitter();
  ipc.sendToHost = jest.fn();
  jest.doMock('electron', () => ({ ipcRenderer: ipc }));
  jest.doMock('@electron/remote', () => ({ BrowserWindow: {} }));
  Recipe = require('../src/webview/lib/RecipeWebview').default;
});
afterEach(() => {
  jest.dontMock('electron');
  jest.dontMock('@electron/remote');
});
it('skips the known legacy DB reader only while native unreads are live and retains recipe heartbeats', () => {
  let live = false;
  const getMessages = jest.fn();
  const getActiveDialogTitle = jest.fn();
  const recipe = new Recipe({}, {}, {}, {}, () => live);
  recipe.loop(() => {
    getMessages();
    getActiveDialogTitle();
  });
  ipc.emit('poll');
  expect(getMessages).toHaveBeenCalledTimes(1);
  live = true;
  for (let i = 0; i < 25; i += 1) ipc.emit('poll');
  expect(getMessages).toHaveBeenCalledTimes(1);
  expect(ipc.sendToHost).toHaveBeenCalledTimes(26);
  live = false;
  ipc.emit('poll');
  expect(getMessages).toHaveBeenCalledTimes(2);
  recipe.dispose();
  expect(ipc.listenerCount('poll')).toBe(0);
});
it('retains other service and custom recipe loops and disposes old reload listeners', () => {
  const custom = jest.fn();
  for (let i = 0; i < 50; i += 1) {
    const recipe = new Recipe({}, {}, {}, {}, () => true);
    recipe.loop(custom);
    ipc.emit('poll');
    recipe.dispose();
  }
  expect(custom).toHaveBeenCalledTimes(50);
  expect(ipc.listenerCount('poll')).toBe(0);
});

it('preserves every native WhatsApp navigation while retaining other unsafe recipe helpers', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { runInNewContext } = require('node:vm');
  const directory = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'zl-navigation-'),
  );
  try {
    const excluded = path.join(directory, 'webview-unsafe.js');
    const other = path.join(directory, 'other.js');
    const legacy = fs.readFileSync(
      path.join(process.cwd(), 'recipes/recipes/whatsapp/webview-unsafe.js'),
      'utf8',
    );
    fs.writeFileSync(excluded, legacy);
    fs.writeFileSync(other, 'window.otherHelperReady=true;');
    // Reproduce the pinned recipe interference rather than mocking the bug.
    const oldPush = jest.fn();
    const oldPage = { history: { pushState: oldPush } };
    runInNewContext(legacy, {
      window: oldPage,
      setTimeout: () => {},
      console: { log() {} },
    });
    oldPage.history.pushState();
    oldPage.history.pushState();
    expect(oldPush).toHaveBeenCalledTimes(1);
    const nativePush = jest.fn();
    const page: any = { history: { pushState: nativePush } };
    ipc.sendToHost.mockImplementation((channel, ...scripts) => {
      if (channel === 'inject-js-unsafe')
        for (const script of scripts) runInNewContext(script, { window: page });
    });
    const recipe = new Recipe({}, {}, {}, {}, () => false, excluded);
    recipe.injectJSUnsafe(excluded, other);
    await Promise.resolve();
    await Promise.resolve();
    page.history.pushState();
    page.history.pushState();
    expect(nativePush).toHaveBeenCalledTimes(2);
    expect(page.otherHelperReady).toBe(true);
    recipe.dispose();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

it('retains unsafe helpers for recipes that do not exclude a navigation script', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const directory = fs.mkdtempSync(
    path.join(require('node:os').tmpdir(), 'zl-other-recipe-'),
  );
  try {
    const file = path.join(directory, 'webview-unsafe.js');
    fs.writeFileSync(file, 'window.customRecipeReady=true;');
    const recipe = new Recipe({}, {}, {}, {});
    recipe.injectJSUnsafe(file);
    await Promise.resolve();
    await Promise.resolve();
    expect(ipc.sendToHost).toHaveBeenCalledWith(
      'inject-js-unsafe',
      'window.customRecipeReady=true;',
    );
    recipe.dispose();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
